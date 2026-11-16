/**
 * LWH Sonoco BOM Inventory (Warehouse Toolkit v1.87.0)
 * =========================================================================================
 * This is the complete Code.gs for the existing "Sonoco BOM Inventory (Sonoco Component Inventory)" Apps Script project.
 *
 * Unchanged: the Sheet is still the database, and the 8 AM component
 * stock email runs exactly as before (same recipients, same 10 / 20 limits).
 *
 * New (search for "TOOLKIT API" near the bottom):
 *   - doPost() — a JSON API the Warehouse Toolkit's "Sonoco Inventory" screen calls
 *   - every request is checked: the Toolkit sends the signed-in session, this script asks
 *     Supabase who it is, and only employee IDs on this Sheet's "Access" tab get in
 *     (Role column: edit or view)
 *   - recording a build takes a lock and deducts nothing unless every component is covered;
 *     Production_History records the Toolkit sign-in name instead of "Web User"
 *   - changing a component count is locked and written to a new "Stock_Log" tab (who, from, to)
 *   - open orders match the exact BOM item number first, so items with a hyphen in their own
 *     name (e.g. N0260150140A010-SP27) are no longer reported as "BOM Missing"
 *   - the Toolkit screen uses each component's own limits from the Thresholds tab
 *
 * Setup: docs/SONOCO_INVENTORY_SETUP.md in the Toolkit repo. Short version:
 *   1. Keep a copy of the old Code.gs. Paste this file over Code.gs.
 *   2. Run setupToolkitApi() once. On the new "Access" tab add the employee IDs allowed in.
 *   3. Deploy -> Manage deployments -> edit the existing web app -> Version: New version.
 *      Execute as: Me, Who has access: Anyone. The /exec link stays the same.
 *
 * Script Properties (optional): ADMIN_EMP_IDS (comma list, always allowed), SUPABASE_URL,
 * SUPABASE_KEY, TOOLKIT_URL.
 * =========================================================================================
 */

// Configuration with your email addresses built-in
const CONFIG = {
  SPREADSHEET_ID: '1-m4_31ADVvBx6SB8OzVZe7HjUBK8ljcUc7r2APB2-dU',
  SHEETS: {
    BOM_DATA: 'BOM_Data',
    INVENTORY: 'Inventory',
    THRESHOLDS: 'Thresholds', 
    HISTORY: 'Production_History',
    SETTINGS: 'Settings',
    OPEN_ORDERS: 'OpenOrders'
  },
  EMAILS: {
    reportEmail: 'tjennings@logistics-warehouse.com,rhewitt@logistics-warehouse.com,cknautz@logistics-warehouse.com',
    alertEmail: 'rhewitt@logistics-warehouse.com,cknautz@logistics-warehouse.com',
    companyName: 'Logistics Warehouse',
    emailEnabled: true
  }
};

// ============================================================================
// WEB APP ENDPOINT
// ============================================================================

// doGet() now lives in the TOOLKIT API section at the bottom (the screens moved to the Warehouse Toolkit).

// ============================================================================
// API FUNCTIONS FOR WEBAPP
// ============================================================================

function getComponents() {
  try {
    const sheet = getSheet(CONFIG.SHEETS.INVENTORY);
    const data = sheet.getDataRange().getValues();
    
    if (data.length <= 1) return [];
    
    const components = [];
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) {
        components.push({
          code: data[i][0],
          description: data[i][1] || 'No description',
          quantity: data[i][2] || 0,
          reserved: data[i][3] || 0,
          lowThreshold: 20,
          criticalThreshold: 10
        });
      }
    }
    return components;
  } catch (error) {
    throw new Error('Failed to get components: ' + error.message);
  }
}

function getBOMItems() {
  try {
    const sheet = getSheet(CONFIG.SHEETS.BOM_DATA);
    const data = sheet.getDataRange().getValues();
    
    if (data.length <= 1) return [];
    
    const items = {};
    let currentItem = null;
    let currentCompany = '';
    let currentDescription = '';
    
    for (let i = 1; i < data.length; i++) {
      const company = data[i][0] || '';
      const item = data[i][1] || '';
      const component = data[i][2] || '';
      const description = data[i][3] || '';
      const qty = data[i][4] || 1;
      
      if (item && item.trim() !== '') {
        currentItem = item.trim();
        currentCompany = company.trim();
        currentDescription = description.trim();
        
        if (!items[currentItem]) {
          items[currentItem] = {
            item: currentItem,
            company: currentCompany,
            description: currentDescription || currentItem,
            components: []
          };
        }
      }
      
      if (component && component.trim() !== '' && currentItem) {
        items[currentItem].components.push({
          code: component.trim(),
          description: description.trim() || 'No description',
          quantity: Number(qty) || 1
        });
      }
    }
    
    return Object.values(items);
  } catch (error) {
    console.error('getBOMItems failed:', error);
    throw new Error('Failed to get BOM items: ' + error.message);
  }
}

function getHistory() {
  try {
    const sheet = getSheet(CONFIG.SHEETS.HISTORY);
    const data = sheet.getDataRange().getValues();
    
    if (data.length <= 1) return [];
    
    const history = [];
    for (let i = 1; i < data.length; i++) {
      history.push({
        date: data[i][0],
        item: data[i][1],
        quantity: data[i][3],
        componentsUsed: data[i][4],
        status: data[i][5] || 'Completed'
      });
    }
    return history.slice(-50);
  } catch (error) {
    throw new Error('Failed to get history: ' + error.message);
  }
}

function getComponentDetails(componentCode) {
  try {
    const sheet = getSheet(CONFIG.SHEETS.INVENTORY);
    const data = sheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === componentCode) {
        return {
          code: data[i][0],
          description: data[i][1] || 'No description',
          quantity: data[i][2] || 0,
          reserved: data[i][3] || 0,
          lastUpdated: data[i][4]
        };
      }
    }
    
    return null;
  } catch (error) {
    console.error('Failed to get component details:', error);
    return null;
  }
}

function updateStock(componentCode, newQuantity, who, note) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Failed to update stock: busy');
  try {
    const sheet = getSheet(CONFIG.SHEETS.INVENTORY);
    const data = sheet.getDataRange().getValues();
    
    let found = false;
    let previous = '';
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === componentCode) {
        previous = Number(data[i][2]) || 0;
        const quantityRange = sheet.getRange(i + 1, 3);
        const dateRange = sheet.getRange(i + 1, 5);
        
        quantityRange.setValue(newQuantity);
        quantityRange.setNumberFormat('@');
        
        dateRange.setValue(new Date());
        dateRange.setNumberFormat('@');
        
        found = true;
        break;
      }
    }
    
    if (!found) {
      const newRow = [componentCode, 'Manual entry', newQuantity, 0, new Date()];
      const lastRow = sheet.getLastRow() + 1;
      const range = sheet.getRange(lastRow, 1, 1, newRow.length);
      range.setValues([newRow]);
      range.setNumberFormat('@');
    }
    
    logStockChange_(componentCode, previous, newQuantity, who, note);
    return { success: true, message: `Updated ${componentCode} to ${newQuantity} units` };
  } catch (error) {
    throw new Error('Failed to update stock: ' + error.message);
  } finally {
    lock.releaseLock();
  }
}

/** Who changed a component count, from what to what. A log failure never blocks the count itself. */
function logStockChange_(code, previous, next, who, note) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    let sh = ss.getSheetByName(STOCK_LOG_TAB);
    if (!sh) {
      sh = ss.insertSheet(STOCK_LOG_TAB);
      sh.getRange(1, 1, 1, 7).setValues([['Timestamp', 'Component Code', 'Previous Qty', 'New Qty', 'Change', 'User', 'Note']]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    const change = previous === '' ? '' : Number(next) - Number(previous);
    sh.appendRow([new Date(), code, previous, Number(next), change, who || 'Sheet / old page', note || '']);
  } catch (e) {
    console.error('Stock log failed:', e);
  }
}

function processProduction(itemCode, quantity, who) {
  // One build at a time, and nothing is deducted unless every component can be covered.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Production failed: busy');
  try {
    quantity = Number(quantity);
    const bomItem = getBOMItems().find(item => item.item === itemCode);
    if (!bomItem) {
      throw new Error('Item not found in BOM');
    }
    if (!bomItem.components.length) {
      throw new Error('This item has no components listed on BOM_Data');
    }

    const invSheet = getSheet(CONFIG.SHEETS.INVENTORY);
    const invData = invSheet.getDataRange().getValues();
    const rowOf = {};
    for (let i = 1; i < invData.length; i++) {
      const code = String(invData[i][0] == null ? '' : invData[i][0]).trim();
      if (code && rowOf[code] === undefined) rowOf[code] = i;
    }

    // Total needed per component (a component listed twice on a BOM is added up, not overwritten).
    const need = {};
    bomItem.components.forEach(comp => { need[comp.code] = (need[comp.code] || 0) + comp.quantity * quantity; });

    const shortages = [];
    Object.keys(need).forEach(code => {
      const i = rowOf[code];
      const available = i === undefined ? 0 : (Number(invData[i][2]) || 0);
      if (available < need[code]) {
        shortages.push(i === undefined ? `${code}: not on the Inventory tab` : `${code}: need ${need[code]}, have ${available}`);
      }
    });
    if (shortages.length > 0) {
      throw new Error('Insufficient inventory: ' + shortages.join(', '));
    }

    const now = new Date();
    Object.keys(need).forEach(code => {
      const i = rowOf[code];
      const newQty = (Number(invData[i][2]) || 0) - need[code];

      const quantityRange = invSheet.getRange(i + 1, 3);
      const dateRange = invSheet.getRange(i + 1, 5);

      quantityRange.setValue(newQty);
      quantityRange.setNumberFormat('@');

      dateRange.setValue(now);
      dateRange.setNumberFormat('@');
    });

    const historySheet = getSheet(CONFIG.SHEETS.HISTORY);
    const newRow = [
      new Date().toLocaleDateString('en-US'),
      itemCode,
      bomItem.description,
      quantity,
      bomItem.components.length,
      'Completed',
      who || 'Web User',
      new Date()
    ];

    const lastRow = historySheet.getLastRow() + 1;
    const range = historySheet.getRange(lastRow, 1, 1, newRow.length);
    range.setValues([newRow]);
    range.setNumberFormat('@');

    return {
      success: true,
      message: `Successfully produced ${quantity} unit(s) of ${itemCode}`
    };
  } catch (error) {
    throw new Error('Production failed: ' + error.message);
  } finally {
    lock.releaseLock();
  }
}

// ============================================================================
// UPDATED OPEN ORDERS FUNCTIONALITY - NEW STRUCTURE
// ============================================================================

function getOpenOrders() {
  try {
    const sheet = getSheet(CONFIG.SHEETS.OPEN_ORDERS);
    const data = sheet.getDataRange().getValues();
    
    if (data.length <= 1) return [];
    
    const openOrders = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      // New structure: LWH ID | Customer Number | Sonoco Item Number | PO Number | Qty
      if (row[0]) { // If LWH ID exists
        openOrders.push({
          lwhId: row[0],
          customerNumber: row[1] || '',
          itemNumber: row[2] || '',
          poNumber: row[3] || '',
          quantity: row[4] || 0
        });
      }
    }
    
    return openOrders;
  } catch (error) {
    console.error('Failed to get open orders:', error);
    return [];
  }
}

function calculateOpenOrderRequirements() {
  try {
    const openOrders = getOpenOrders();
    const bomItems = getBOMItems();
    
    if (!openOrders.length || !bomItems.length) {
      return { orders: [], componentRequirements: {} };
    }
    
    const componentRequirements = {};
    const processedOrders = [];
    
    openOrders.forEach(order => {
      if (!order.itemNumber || !order.quantity) return;
      
      // Clean item number - remove suffix after hyphen if exists
      const cleanItemName = order.itemNumber.toString().split('-')[0].trim();
      
      // Exact item number first (some BOM items have a hyphen in their own name, e.g. "...A010-SP27"),
      // then the number with its suffix removed.
      const exactItemName = order.itemNumber.toString().trim();
      const bomItem = bomItems.find(item => item.item === exactItemName) ||
                      bomItems.find(item => item.item === cleanItemName);
      
      if (bomItem && bomItem.components) {
        const orderWithComponents = {
          ...order,
          cleanItemName: cleanItemName,
          bomFound: true,
          components: []
        };
        
        bomItem.components.forEach(comp => {
          const totalRequired = comp.quantity * order.quantity;
          
          if (!componentRequirements[comp.code]) {
            componentRequirements[comp.code] = {
              code: comp.code,
              description: comp.description,
              totalRequired: 0,
              orders: []
            };
          }
          
          componentRequirements[comp.code].totalRequired += totalRequired;
          componentRequirements[comp.code].orders.push({
            lwhId: order.lwhId,
            poNumber: order.poNumber,
            itemNumber: order.itemNumber,
            quantity: order.quantity,
            requiredForThisOrder: totalRequired
          });
          
          orderWithComponents.components.push({
            code: comp.code,
            description: comp.description,
            quantityPerUnit: comp.quantity,
            totalRequired: totalRequired
          });
        });
        
        processedOrders.push(orderWithComponents);
      } else {
        processedOrders.push({
          ...order,
          cleanItemName: cleanItemName,
          bomFound: false,
          components: []
        });
      }
    });
    
    return {
      orders: processedOrders,
      componentRequirements: componentRequirements
    };
  } catch (error) {
    console.error('Failed to calculate requirements:', error);
    return { orders: [], componentRequirements: {} };
  }
}

// ============================================================================
// EMAIL REPORTING SYSTEM
// ============================================================================

function setupDailyReportTrigger() {
  try {
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(trigger => {
      if (trigger.getHandlerFunction() === 'sendDailyReport') {
        ScriptApp.deleteTrigger(trigger);
      }
    });
    
    ScriptApp.newTrigger('sendDailyReport')
      .timeBased()
      .everyDays(1)
      .atHour(8)
      .create();
    
    console.log('Daily report trigger set up for 8:00 AM');
  } catch (error) {
    console.error('Failed to set up daily trigger:', error);
  }
}

function sendDailyReport() {
  try {
    if (!CONFIG.EMAILS.emailEnabled || !CONFIG.EMAILS.reportEmail) {
      console.log('Email not configured');
      return;
    }
    
    const components = getComponents();
    const openOrdersData = calculateOpenOrderRequirements();
    const bomItems = getBOMItems();
    
    let lowStockItems = [];
    let criticalStockItems = [];
    let healthyStockItems = [];
    
    components.forEach(comp => {
      const quantity = comp.quantity || 0;
      const criticalThreshold = comp.criticalThreshold || 10;
      const lowThreshold = comp.lowThreshold || 20;
      
      if (quantity <= criticalThreshold) {
        criticalStockItems.push({
          code: comp.code,
          description: comp.description,
          quantity: quantity,
          threshold: criticalThreshold
        });
      } else if (quantity <= lowThreshold) {
        lowStockItems.push({
          code: comp.code,
          description: comp.description,
          quantity: quantity,
          threshold: lowThreshold
        });
      } else {
        healthyStockItems.push(comp);
      }
    });
    
    let subject = `Daily Inventory Report - ${CONFIG.EMAILS.companyName}`;
    if (criticalStockItems.length > 0) {
      subject = `CRITICAL STOCK ALERT - ${subject}`;
    } else if (lowStockItems.length > 0) {
      subject = `LOW STOCK ALERT - ${subject}`;
    }
    
    const htmlBody = buildEmailBody(
      CONFIG.EMAILS.companyName,
      components,
      criticalStockItems,
      lowStockItems,
      healthyStockItems,
      openOrdersData,
      bomItems.length
    );
    
    MailApp.sendEmail({
      to: CONFIG.EMAILS.reportEmail,
      cc: CONFIG.EMAILS.alertEmail,
      subject: subject,
      htmlBody: htmlBody
    });
    
    console.log(`Daily report sent to ${CONFIG.EMAILS.reportEmail}`);
    
  } catch (error) {
    console.error('Failed to send daily report:', error);
  }
}

function buildEmailBody(companyName, components, criticalItems, lowStockItems, healthyItems, openOrdersData, bomItemCount) {
  const now = new Date();
  const reportDate = now.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  const reportTime = now.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit', 
    timeZoneName: 'short' 
  });
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Daily Inventory Report</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f7fa; color: #333333;">
        
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
                <td align="center" style="padding: 20px 0;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width: 600px;">
                        <tr>
                            <td style="background-color: #ffffff; padding: 30px; border-radius: 8px 8px 0 0; border-bottom: 4px solid #2563eb;">
                                <h1 style="margin: 0 0 10px 0; color: #1e40af; font-size: 28px; font-weight: bold; text-align: center;">
                                    Daily Inventory Report
                                </h1>
                                <h2 style="margin: 0; color: #64748b; font-size: 18px; font-weight: normal; text-align: center;">
                                    ${companyName}
                                </h2>
                                <p style="margin: 15px 0 0 0; color: #6b7280; font-size: 14px; text-align: center;">
                                    ${reportDate} at ${reportTime}
                                </p>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
        
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
                <td align="center">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width: 600px;">
                        <tr>
                            <td style="background-color: #ffffff; padding: 30px;">
                                <h3 style="margin: 0 0 20px 0; color: #1e40af; font-size: 20px; font-weight: bold;">
                                    Executive Summary
                                </h3>
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td width="25%" style="padding: 15px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; text-align: center;">
                                            <div style="font-size: 24px; font-weight: bold; color: #1e40af;">${components.length}</div>
                                            <div style="font-size: 12px; color: #64748b; text-transform: uppercase;">Total Components</div>
                                        </td>
                                        <td width="25%" style="padding: 15px; background-color: ${criticalItems.length > 0 ? '#fef2f2' : '#f8fafc'}; border: 1px solid ${criticalItems.length > 0 ? '#fca5a5' : '#e2e8f0'}; border-radius: 6px; text-align: center;">
                                            <div style="font-size: 24px; font-weight: bold; color: ${criticalItems.length > 0 ? '#dc2626' : '#64748b'};">${criticalItems.length}</div>
                                            <div style="font-size: 12px; color: #64748b; text-transform: uppercase;">Critical Stock</div>
                                        </td>
                                        <td width="25%" style="padding: 15px; background-color: ${lowStockItems.length > 0 ? '#fffbeb' : '#f8fafc'}; border: 1px solid ${lowStockItems.length > 0 ? '#fcd34d' : '#e2e8f0'}; border-radius: 6px; text-align: center;">
                                            <div style="font-size: 24px; font-weight: bold; color: ${lowStockItems.length > 0 ? '#d97706' : '#64748b'};">${lowStockItems.length}</div>
                                            <div style="font-size: 12px; color: #64748b; text-transform: uppercase;">Low Stock</div>
                                        </td>
                                        <td width="25%" style="padding: 15px; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; text-align: center;">
                                            <div style="font-size: 24px; font-weight: bold; color: #16a34a;">${healthyItems.length}</div>
                                            <div style="font-size: 12px; color: #64748b; text-transform: uppercase;">Healthy Stock</div>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
        
        ${criticalItems.length > 0 ? `
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
                <td align="center">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width: 600px;">
                        <tr>
                            <td style="background-color: #ffffff; padding: 30px;">
                                <h3 style="margin: 0 0 20px 0; color: #dc2626; font-size: 20px; font-weight: bold;">
                                    CRITICAL STOCK ITEMS
                                </h3>
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse;">
                                    <tr style="background-color: #fef2f2;">
                                        <th style="padding: 10px; border: 1px solid #fca5a5; text-align: left; font-size: 12px;">Component</th>
                                        <th style="padding: 10px; border: 1px solid #fca5a5; text-align: center; font-size: 12px;">Stock</th>
                                    </tr>
                                    ${criticalItems.map(item => `
                                        <tr>
                                            <td style="padding: 8px 10px; border: 1px solid #e5e7eb; font-family: monospace;">${item.code}</td>
                                            <td style="padding: 8px 10px; border: 1px solid #e5e7eb; text-align: center; color: #dc2626; font-weight: bold;">${item.quantity}</td>
                                        </tr>
                                    `).join('')}
                                </table>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
        ` : ''}
        
    </body>
    </html>
  `;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function getSheet(sheetName) {
  try {
    const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    let sheet = spreadsheet.getSheetByName(sheetName);
    
    if (!sheet) {
      throw new Error(`Sheet ${sheetName} not found`);
    }
    
    return sheet;
  } catch (error) {
    console.error(`Error accessing sheet ${sheetName}:`, error);
    throw new Error(`Could not access sheet ${sheetName}: ${error.message}`);
  }
}

function testDailyReport() {
  console.log('Testing daily report...');
  sendDailyReport();
  console.log('Daily report test completed');
}

function initializeCompleteSystemEnhanced() {
  console.log('Email system configured');
  setupDailyReportTrigger();
  return { success: true, message: 'System ready' };
}

// ============================================================================
// CUSTOM MENU
// ============================================================================

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  
  ui.createMenu('📊 Inventory System')
    .addItem('🚀 Open Web App', 'openWebApp')
    .addItem('📧 Send Daily Report Now', 'sendDailyReportManually')
    .addSeparator()
    .addItem('📈 Test Email System', 'testEmailSystem')
    .addItem('📋 Show System Status', 'showSystemStatus')
    .addSeparator()
    .addSubMenu(ui.createMenu('⚙️ Admin Tools')
      .addItem('🔄 Setup Daily Trigger', 'setupDailyReportTrigger')
      .addItem('❌ Remove Daily Trigger', 'removeDailyTrigger'))
    .addToUi();
}

function openWebApp() {
  const url = 'YOUR_WEB_APP_URL_HERE';
  const htmlOutput = HtmlService.createHtmlOutput(`
    <script>
      window.open('${url}', '_blank');
      google.script.host.close();
    </script>
    <p>Opening Web App...</p>
  `).setWidth(400).setHeight(200);
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, 'Opening Web App');
}

function sendDailyReportManually() {
  const ui = SpreadsheetApp.getUi();
  try {
    sendDailyReport();
    ui.alert('✅ Report Sent!', `Sent to: ${CONFIG.EMAILS.reportEmail}`, ui.ButtonSet.OK);
  } catch (error) {
    ui.alert('❌ Failed', error.message, ui.ButtonSet.OK);
  }
}

function testEmailSystem() {
  const ui = SpreadsheetApp.getUi();
  try {
    MailApp.sendEmail({
      to: CONFIG.EMAILS.alertEmail,
      subject: 'TEST: Stock Alert System',
      htmlBody: '<h2>Test Email</h2><p>System is working!</p>'
    });
    ui.alert('✅ Test Sent!', 'Check your email', ui.ButtonSet.OK);
  } catch (error) {
    ui.alert('❌ Failed', error.message, ui.ButtonSet.OK);
  }
}

function showSystemStatus() {
  const ui = SpreadsheetApp.getUi();
  const components = getComponents();
  const bomItems = getBOMItems();
  const openOrders = getOpenOrders();
  
  ui.alert('📊 System Status', 
    `Components: ${components.length}\n` +
    `BOM Items: ${bomItems.length}\n` +
    `Open Orders: ${openOrders.length}`, 
    ui.ButtonSet.OK);
}

function removeDailyTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'sendDailyReport') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}


// =========================================================================================
// TOOLKIT API  (Warehouse Toolkit → Sonoco Inventory & BOM)
// Everything below is new. It calls the same functions above that the old web page called.
// =========================================================================================
var TOOLKIT_API_VERSION = '1.87.0';
var ACCESS_TAB = 'Access';
var SUPA_URL_DEFAULT = 'https://tjivcqxnkftujceumdtx.supabase.co';
var SUPA_KEY_DEFAULT = 'sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';

function doGet(e) {
  // The screens now live in the Warehouse Toolkit (Sonoco Inventory). This script is their API.
  if (e && e.parameter && e.parameter.health) {
    return json_({ ok: true, service: API_SERVICE_NAME, version: TOOLKIT_API_VERSION });
  }
  var url = toolkitUrl_() + '?view=sonocoInv';
  return HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,sans-serif;max-width:520px;margin:60px auto;text-align:center">' +
    '<div style="border:1px solid #ddd;border-top:5px solid #c8102e;padding:24px">' +
    '<h2 style="margin:0 0 8px">This page has moved</h2>' +
    '<p>Sonoco inventory, components, builds and open orders are now in the <b>Warehouse Toolkit &rarr; Sonoco Inventory</b>.</p>' +
    '<p><a href="' + url + '" target="_top" style="display:inline-block;background:#c8102e' +
    ';color:#fff;padding:12px 20px;text-decoration:none;font-weight:bold">Open Sonoco Inventory</a></p></div></div>'
  ).setTitle('Moved to the Warehouse Toolkit').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'bad_request' }); }
  try {
    var who = auth_(body.token);
    var fn = API_ROUTES[body.action];
    if (!fn) return json_({ ok: false, error: 'unknown_action' });
    var out = fn(body, who) || {};
    out.ok = out.ok !== false;
    return json_(out);
  } catch (err) {
    var msg = String((err && err.message) || err);
    if (!/^(signed_out|no_access|view_only|busy|bad_input:)/.test(msg)) {
      Logger.log(API_SERVICE_NAME + ' error (' + body.action + '): ' + ((err && err.stack) || msg));
    }
    return json_({ ok: false, error: msg });
  }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function props_() { return PropertiesService.getScriptProperties(); }
function toolkitUrl_() { return props_().getProperty('TOOLKIT_URL') || 'https://nbr1hawgfan.github.io/LWH-Warehouse-Toolkit/'; }
function bad_(msg) { throw new Error('bad_input:' + msg); }
function wholeNumber_(v, label, allowZero) {
  var n = Number(v);
  if (v === '' || v == null || !isFinite(n) || Math.floor(n) !== n || n < 0 || (!allowZero && n === 0)) {
    bad_(label + ' must be a whole number' + (allowZero ? ' (0 or more).' : ' more than 0.'));
  }
  if (n > 10000000) bad_(label + ' is too large.');
  return n;
}

// ---- Sign-in: the Toolkit's employee session, checked with Supabase ---------------------
function supa_(fn, args) {
  var p = props_();
  var url = p.getProperty('SUPABASE_URL') || SUPA_URL_DEFAULT, key = p.getProperty('SUPABASE_KEY') || SUPA_KEY_DEFAULT;
  var res = UrlFetchApp.fetch(url + '/rest/v1/rpc/' + fn, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: key }, payload: JSON.stringify(args || {})
  });
  if (res.getResponseCode() >= 300) throw new Error('Supabase ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText());
}

function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

function auth_(token) {
  if (!token) throw new Error('signed_out');
  var cache = CacheService.getScriptCache(), ck = 'tk_' + hash_(token);
  var hit = cache.get(ck);
  if (hit) return JSON.parse(hit);
  var me = supa_('whm_me', { p_token: String(token) });
  if (!me || !me.ok) throw new Error('signed_out');
  var role = roleFor_(me.emp_id);
  if (!role) throw new Error('no_access');
  var who = { empId: String(me.emp_id), name: me.name || ('ID ' + me.emp_id), role: role };
  cache.put(ck, JSON.stringify(who), 300);   // 5 minutes — Access tab changes apply within 5 min
  return who;
}

/** Access tab: column A = employee ID, column C = Role ("view" = look only; anything else = edit). */
function roleFor_(empId) {
  var id = String(empId == null ? '' : empId).trim();
  if (!id) return '';
  var admins = String(props_().getProperty('ADMIN_EMP_IDS') || '').split(/[,\s]+/).filter(String);
  if (admins.indexOf(id) >= 0) return 'edit';
  var sh = apiSpreadsheet_().getSheetByName(ACCESS_TAB);
  if (!sh || sh.getLastRow() < 2) return '';
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getDisplayValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === id) return /^view/i.test(String(rows[i][2]).trim()) ? 'view' : 'edit';
  }
  return '';
}
function requireEdit_(who) { if (who.role !== 'edit') throw new Error('view_only'); }

/** Run once from the editor. Adds the Access tab; never deletes or moves anything. */
function setupToolkitApi() {
  var ss = apiSpreadsheet_();
  var sh = ss.getSheetByName(ACCESS_TAB);
  if (!sh) {
    sh = ss.insertSheet(ACCESS_TAB);
    sh.getRange(1, 1, 1, 4).setValues([['Employee ID', 'Name', 'Role (edit or view)', 'Note']]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@');
  }
  var msg = 'Toolkit API is set up. On the "' + ACCESS_TAB + '" tab, put the employee ID of each person allowed in ' +
    '(column A — the ID they sign in to the Toolkit with). Role: edit (default) or view.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* run from the editor — no UI */ }
  return msg;
}

// ---- Sonoco BOM: actions -----------------------------------------------------------------
var API_SERVICE_NAME = 'LWH Sonoco BOM API';
var STOCK_LOG_TAB = 'Stock_Log';
function apiSpreadsheet_() { return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID); }

var API_ROUTES = {
  bootstrap: apiBootstrap_, components: apiComponents_, history: apiHistory_, requirements: apiRequirements_,
  build: apiBuild_, setStock: apiSetStock_, sendReport: apiSendReport_
};

function fmtDay_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, Session.getScriptTimeZone(), 'MM/dd/yyyy');
  return String(v == null ? '' : v);
}

/** Component stock with each component's own limits from the Thresholds tab (no limits listed = never flagged low). */
function componentsFull_() {
  var limits = {};
  var ts = apiSpreadsheet_().getSheetByName(CONFIG.SHEETS.THRESHOLDS);
  if (ts && ts.getLastRow() > 1) {
    ts.getRange(2, 1, ts.getLastRow() - 1, 3).getValues().forEach(function (r) {
      var code = String(r[0]).trim();
      if (code) limits[code] = { low: Number(r[1]) || 0, critical: Number(r[2]) || 0 };
    });
  }
  var data = getSheet(CONFIG.SHEETS.INVENTORY).getDataRange().getValues();
  var out = [], seen = {};
  for (var i = 1; i < data.length; i++) {
    var code = String(data[i][0] == null ? '' : data[i][0]).trim();
    if (!code) continue;
    var qty = Number(data[i][2]) || 0, lim = limits[code] || { low: 0, critical: 0 };
    var status = qty <= 0 ? 'out' : (lim.critical > 0 && qty <= lim.critical) ? 'critical' : (lim.low > 0 && qty <= lim.low) ? 'low' : 'ok';
    // A code listed twice: builds and counts only ever use the FIRST row, so later rows are marked, not counted.
    if (seen[code]) status = 'duplicate';
    seen[code] = true;
    out.push({ code: code, description: String(data[i][1] || ''), quantity: qty, reserved: Number(data[i][3]) || 0,
      lastUpdated: fmtDay_(data[i][4]), low: lim.low, critical: lim.critical, status: status, row: i + 1 });
  }
  return out;
}

function apiComponents_() { return { components: componentsFull_() }; }

function apiBootstrap_(b, who) {
  return { me: who, version: TOOLKIT_API_VERSION, components: componentsFull_(), items: getBOMItems() };
}

function apiHistory_(b) {
  var limit = Math.max(1, Math.min(2000, parseInt(b.limit, 10) || 300));
  var data = getSheet(CONFIG.SHEETS.HISTORY).getDataRange().getValues();
  var rows = [];
  for (var i = data.length - 1; i >= 1 && rows.length < limit; i--) {
    if (!data[i][0] && !data[i][1]) continue;
    rows.push({ date: fmtDay_(data[i][0]), item: String(data[i][1] || ''), description: String(data[i][2] || ''),
      quantity: Number(data[i][3]) || 0, componentsUsed: Number(data[i][4]) || 0,
      status: String(data[i][5] || 'Completed'), user: String(data[i][6] || '') });
  }
  return { rows: rows, total: Math.max(0, data.length - 1) };
}

function apiRequirements_() {
  var r = calculateOpenOrderRequirements();
  return { orders: r.orders || [], componentRequirements: r.componentRequirements || {} };
}

function apiBuild_(b, who) {
  requireEdit_(who);
  var item = String(b.item == null ? '' : b.item);
  if (!item) bad_('Pick the item that was built.');
  var qty = wholeNumber_(b.quantity, 'Quantity');
  var r;
  try { r = processProduction(item, qty, who.name); }
  catch (err) {
    var m = String((err && err.message) || err).replace(/^Production failed:\s*/, '');
    if (/^busy/.test(m)) throw new Error('busy');
    bad_(m);
  }
  return { message: r.message, components: componentsFull_() };
}

function apiSetStock_(b, who) {
  requireEdit_(who);
  var code = String(b.code == null ? '' : b.code).trim();
  if (!code) bad_('Pick the component.');
  var qty = wholeNumber_(b.quantity, 'Quantity', true);
  if (!getComponentDetails(code)) bad_('Component ' + code + ' isn\'t on the Inventory tab. New components are added on the Sheet.');
  var r;
  try { r = updateStock(code, qty, who.name, String(b.note || '').slice(0, 300)); }
  catch (err) {
    var m = String((err && err.message) || err).replace(/^Failed to update stock:\s*/, '');
    if (/^busy/.test(m)) throw new Error('busy');
    bad_(m);
  }
  return { message: r.message, components: componentsFull_() };
}

/** The same email the 8 AM trigger sends, to the same recipients. */
function apiSendReport_(b, who) {
  requireEdit_(who);
  sendDailyReport();
  Logger.log('Component stock report sent on request by ' + who.name);
  return { message: 'Component stock report sent.' };
}
