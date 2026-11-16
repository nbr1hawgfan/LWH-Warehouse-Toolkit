/**
 * LWH Sonoco Inventory — Spool Works (Warehouse Toolkit v1.87.0)
 * =========================================================================================
 * This is the complete Code.gs for the existing "Sonoco Inventory (Spool Works Dashboard)" Apps Script project.
 *
 * Unchanged: the Sheet is still the database, and the 7 AM inventory & open orders
 * email, the 7 AM shipment email and the TLand inventory snapshot CSV all work as before.
 *
 * New (search for "TOOLKIT API" near the bottom):
 *   - doPost() — a JSON API the Warehouse Toolkit's "Sonoco Inventory" screen calls
 *   - every request is checked: the Toolkit sends the signed-in session, this script asks
 *     Supabase who it is, and only employee IDs on this Sheet's "Access" tab get in
 *     (Role column: edit or view)
 *   - add / ship take a lock, so two people saving together can't overwrite each other
 *   - the transaction log records the Toolkit sign-in name
 *   - a failed TLand snapshot no longer reports the (already saved) stock change as failed
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

// ============================================
// MAIN WEB APP CODE
// ============================================

// doGet() now lives in the TOOLKIT API section at the bottom (the screens moved to the Warehouse Toolkit).

var SONOCO_EXPORT_FOLDER_ID = '1HGdU3SrArJhq-jQLpuX2dwP-K44zLzOV';

function exportInventorySnapshot_() {
  var folder = DriveApp.getFolderById(SONOCO_EXPORT_FOLDER_ID);
  var filename = 'sonoco_inventory_current.csv';

  var existing = folder.getFilesByName(filename);
  while (existing.hasNext()) {
    existing.next().setTrashed(true);
  }

  var items = getInventoryData();
  var lines = ['ItemName,Quantity,Unit'];
  items.forEach(function(item) {
    var name = String(item.itemName).indexOf(',') !== -1
      ? '"' + item.itemName.replace(/"/g, '""') + '"'
      : item.itemName;
    lines.push([name, item.quantity, item.unit].join(','));
  });

  folder.createFile(filename, lines.join('\n'), MimeType.CSV);
}

/**
 * The stock change is already saved and logged by the time this runs. If Drive hiccups, log it and carry on —
 * failing here would tell the user "it didn't save" and invite a second, duplicate entry. The next change re-exports.
 */
function exportSnapshotSafely_() {
  try { exportInventorySnapshot_(); }
  catch (e) { Logger.log('TLand inventory snapshot failed (stock change WAS saved): ' + e); }
}

// ============================================
// INVENTORY MANAGEMENT FUNCTIONS
// ============================================

function addInventory(itemName, quantity, notes, who) {
  // One stock change at a time, so two people saving together can't overwrite each other.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Someone else is saving right now — try again in a moment.');
  try {
    return addInventoryLocked_(itemName, quantity, notes, who);
  } finally {
    lock.releaseLock();
  }
}

function addInventoryLocked_(itemName, quantity, notes, who) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inventorySheet = ss.getSheetByName('Inventory');
  const transactionSheet = getOrCreateTransactionSheet();
  
  if (!inventorySheet) {
    throw new Error('Inventory sheet not found');
  }
  
  // Find the item in inventory
  const data = inventorySheet.getDataRange().getValues();
  let itemRow = -1;
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === itemName) {
      itemRow = i + 1; // +1 because getRange is 1-indexed
      break;
    }
  }
  
  if (itemRow === -1) {
    throw new Error('Item not found in inventory');
  }
  
  // Update inventory quantity
  const currentQty = Number(inventorySheet.getRange(itemRow, 2).getValue()) || 0;
  const newQty = currentQty + Number(quantity);
  inventorySheet.getRange(itemRow, 2).setValue(newQty);
  
  // Log transaction - format everything as strings for display
  const timestamp = new Date();
  transactionSheet.appendRow([
    Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'yyyy-MM-dd hh:mm a'),
    'ADD',
    String(itemName),
    Number(quantity),
    Number(currentQty),
    Number(newQty),
    String(notes || ''),
    String(who || Session.getActiveUser().getEmail())
  ]);
  
  // ---- push a fresh snapshot to TLand every time inventory changes ----
  exportSnapshotSafely_();
  
  return {
    success: true,
    message: `Added ${quantity} units to ${itemName}. New total: ${newQty}`,
    newQuantity: newQty
  };
}

function shipInventory(itemName, quantity, notes, who) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Someone else is saving right now — try again in a moment.');
  try {
    return shipInventoryLocked_(itemName, quantity, notes, who);
  } finally {
    lock.releaseLock();
  }
}

function shipInventoryLocked_(itemName, quantity, notes, who) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inventorySheet = ss.getSheetByName('Inventory');
  const transactionSheet = getOrCreateTransactionSheet();
  
  if (!inventorySheet) {
    throw new Error('Inventory sheet not found');
  }
  
  // Find the item in inventory
  const data = inventorySheet.getDataRange().getValues();
  let itemRow = -1;
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === itemName) {
      itemRow = i + 1;
      break;
    }
  }
  
  if (itemRow === -1) {
    throw new Error('Item not found in inventory');
  }
  
  // Update inventory quantity
  const currentQty = Number(inventorySheet.getRange(itemRow, 2).getValue()) || 0;
  
  if (currentQty < Number(quantity)) {
    throw new Error(`Insufficient inventory. Current: ${currentQty}, Requested: ${quantity}`);
  }
  
  const newQty = currentQty - Number(quantity);
  inventorySheet.getRange(itemRow, 2).setValue(newQty);
  
  // Log transaction - format everything as strings for display
  const timestamp = new Date();
  transactionSheet.appendRow([
    Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'yyyy-MM-dd hh:mm a'),
    'SHIP',
    String(itemName),
    Number(quantity),
    Number(currentQty),
    Number(newQty),
    String(notes || ''),
    String(who || Session.getActiveUser().getEmail())
  ]);
  
  // ---- push a fresh snapshot to TLand every time inventory changes ----
  exportSnapshotSafely_();
  
  return {
    success: true,
    message: `Shipped ${quantity} units of ${itemName}. New total: ${newQty}`,
    newQuantity: newQty
  };
}

function getOrCreateTransactionSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let transactionSheet = ss.getSheetByName('InventoryTransactions');
  
  if (!transactionSheet) {
    transactionSheet = ss.insertSheet('InventoryTransactions');
    transactionSheet.getRange('A1:H1').setValues([[
      'Date/Time', 'Type', 'Item Name', 'Quantity', 'Previous Total', 'New Total', 'Notes', 'User'
    ]]);
    transactionSheet.getRange('A1:H1').setFontWeight('bold');
    transactionSheet.setFrozenRows(1);
    
    // Set column A (Date/Time) to plain text to avoid formatting issues
    transactionSheet.getRange('A:A').setNumberFormat('@STRING@');
    // Set columns B, C, G, H (text columns) to plain text
    transactionSheet.getRange('B:C').setNumberFormat('@STRING@');
    transactionSheet.getRange('G:H').setNumberFormat('@STRING@');
    // Set columns D, E, F (number columns) to number format
    transactionSheet.getRange('D:F').setNumberFormat('0');
  }
  
  return transactionSheet;
}

function getInventoryItems() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inventorySheet = ss.getSheetByName('Inventory');
  
  if (!inventorySheet) return [];
  
  const data = inventorySheet.getDataRange().getValues();
  const items = [];
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) {
      items.push({
        name: data[i][0],
        quantity: Number(data[i][1]) || 0,
        unit: data[i][2]
      });
    }
  }
  
  return items;
}

function getTransactionHistory(limit = 50) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const transactionSheet = ss.getSheetByName('InventoryTransactions');
  
  if (!transactionSheet) return [];
  
  const data = transactionSheet.getDataRange().getValues();
  const transactions = [];
  
  // Get last 'limit' rows (excluding header)
  const startRow = Math.max(1, data.length - limit);
  
  for (let i = data.length - 1; i >= startRow; i--) {
    if (data[i][0]) {
      // Format all data as strings/numbers to avoid display issues
      let datetime = data[i][0];
      if (datetime instanceof Date) {
        datetime = Utilities.formatDate(datetime, Session.getScriptTimeZone(), 'yyyy-MM-dd hh:mm a');
      }
      
      transactions.push({
        datetime: String(datetime),
        type: String(data[i][1] || ''),
        itemName: String(data[i][2] || ''),
        quantity: Number(data[i][3]) || 0,
        previousTotal: Number(data[i][4]) || 0,
        newTotal: Number(data[i][5]) || 0,
        notes: String(data[i][6] || ''),
        user: String(data[i][7] || '')
      });
    }
  }
  
  return transactions;
}

function getShipmentHistory(daysBack = 30) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shipmentSheet = ss.getSheetByName('Shipment History');
  
  if (!shipmentSheet) return [];
  
  // Use getDisplayValues() instead of getValues() to get formatted text
  const dataRange = shipmentSheet.getDataRange();
  const displayData = dataRange.getDisplayValues();
  const shipments = [];
  
  // Read from bottom to top to get most recent first (assuming newest entries are at bottom of sheet)
  for (let i = displayData.length - 1; i >= 1; i--) {
    if (displayData[i][0]) {
      shipments.push({
        invReceipt: String(displayData[i][0] || ''),
        subCustNm: String(displayData[i][1] || ''),
        customerNumber: String(displayData[i][2] || ''),
        sonocoNumber: String(displayData[i][3] || ''),
        poNumber: String(displayData[i][4] || ''),
        quantity: Number(displayData[i][5]) || 0,
        billToReference: String(displayData[i][6] || ''),
        shippedDate: String(displayData[i][7] || '')
      });
    }
  }
  
  return shipments;
}

// NEW: Get shipments organized by date for calendar
function getShipmentsByDate() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shipmentSheet = ss.getSheetByName('Shipment History');
  
  if (!shipmentSheet) {
    Logger.log('Shipment History sheet not found');
    return {};
  }
  
  const dataRange = shipmentSheet.getDataRange();
  const displayData = dataRange.getDisplayValues();
  const values = dataRange.getValues();
  const shipmentsByDate = {};
  
  Logger.log('Processing ' + (displayData.length - 1) + ' rows for calendar');
  
  for (let i = 1; i < displayData.length; i++) {
    if (displayData[i][0]) {
      const shipment = {
        invReceipt: String(displayData[i][0] || ''),
        subCustNm: String(displayData[i][1] || ''),
        customerNumber: String(displayData[i][2] || ''),
        sonocoNumber: String(displayData[i][3] || ''),
        poNumber: String(displayData[i][4] || ''),
        quantity: Number(displayData[i][5]) || 0,
        billToReference: String(displayData[i][6] || ''),
        shippedDate: String(displayData[i][7] || '')
      };
      
      // Normalize the date format to MM/DD/YYYY
      let dateKey = shipment.shippedDate;
      
      // If the value in column 7 is a Date object, format it
      if (values[i][7] instanceof Date) {
        const dateObj = values[i][7];
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        const year = dateObj.getFullYear();
        dateKey = `${month}/${day}/${year}`;
        shipment.shippedDate = dateKey; // Update the display value too
      } else {
        // Try to parse and normalize the string date
        dateKey = normalizeDateString(dateKey);
      }
      
      if (dateKey && dateKey !== 'Invalid Date') {
        if (!shipmentsByDate[dateKey]) {
          shipmentsByDate[dateKey] = [];
        }
        shipmentsByDate[dateKey].push(shipment);
      }
    }
  }
  
  Logger.log('Shipments grouped by ' + Object.keys(shipmentsByDate).length + ' dates');
  Logger.log('Sample date keys: ' + Object.keys(shipmentsByDate).slice(0, 5).join(', '));
  
  return shipmentsByDate;
}

function normalizeDateString(dateStr) {
  if (!dateStr || dateStr.trim() === '') return null;
  
  try {
    // Handle MM/DD/YYYY format
    const slashMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      const month = slashMatch[1].padStart(2, '0');
      const day = slashMatch[2].padStart(2, '0');
      const year = slashMatch[3];
      return `${month}/${day}/${year}`;
    }
    
    // Handle YYYY-MM-DD format
    const dashMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (dashMatch) {
      const month = dashMatch[2];
      const day = dashMatch[3];
      const year = dashMatch[1];
      return `${month}/${day}/${year}`;
    }
    
    // Try parsing as a date
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const year = date.getFullYear();
      return `${month}/${day}/${year}`;
    }
  } catch (e) {
    Logger.log('Error parsing date: ' + dateStr + ' - ' + e.toString());
  }
  
  return null;
}

function getInventoryData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inventorySheet = ss.getSheetByName('Inventory');
  
  if (!inventorySheet) return [];
  
  const data = inventorySheet.getDataRange().getValues();
  const headers = data[0];
  const rows = data.slice(1).filter(row => row[0]); // Filter empty rows
  
  return rows.map(row => ({
    itemName: row[0],
    quantity: Number(row[1]) || 0,
    unit: row[2]
  }));
}

function getOpenOrdersData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ordersSheet = ss.getSheetByName('OpenOrders');
  
  if (!ordersSheet) return [];
  
  const data = ordersSheet.getDataRange().getValues();
  const rows = data.slice(1); // Skip header row
  
  // Filter out completely empty rows
  const filteredRows = rows.filter(row => {
    // Check if any cell in the row has content
    return row.some(cell => cell !== '' && cell !== null && cell !== undefined);
  });
  
  return filteredRows.map(row => ({
    lwhId: String(row[0] || ''),
    customerNumber: String(row[1] || ''),
    itemNumber: String(row[2] || ''),
    poNumber: String(row[3] || ''),
    quantity: Number(row[4]) || 0
  }));
}

// ============================================
// DAILY EMAIL AUTOMATION
// ============================================

function setupDailyTrigger() {
  // Delete existing triggers
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'sendDailyReport' || trigger.getHandlerFunction() === 'sendDailyShipmentReport') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // Create new trigger for inventory/orders report at 7 AM daily
  ScriptApp.newTrigger('sendDailyReport')
    .timeBased()
    .atHour(7)
    .everyDays(1)
    .create();
  
  // Create new trigger for shipment history report at 7 AM daily
  ScriptApp.newTrigger('sendDailyShipmentReport')
    .timeBased()
    .atHour(7)
    .everyDays(1)
    .create();
  
  Logger.log('Daily triggers set for 7 AM');
}

function sendDailyReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inventoryData = getInventoryData();
  const openOrdersData = getOpenOrdersData();
  
  // Generate HTML report
  const htmlBody = generateHtmlReport(inventoryData, openOrdersData);
  
  // Generate CSV files
  const inventoryCsv = generateInventoryCsv(inventoryData);
  const ordersCsv = generateOpenOrdersCsv(openOrdersData);
  
  // Get recipient email (change this to your email)
   const recipient = "tjennings@logistics-warehouse.com,rrobertson@logistics-warehouse.com,rhewitt@logistics-warehouse.com, cknautz@logistics-warehouse.com";
  
  // Create blobs for attachments
  const inventoryBlob = Utilities.newBlob(inventoryCsv, 'text/csv', 'Inventory_Report_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd') + '.csv');
  const ordersBlob = Utilities.newBlob(ordersCsv, 'text/csv', 'Open_Orders_Report_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd') + '.csv');
  
  // Send email
  MailApp.sendEmail({
    to: recipient,
    subject: 'Daily Inventory & Open Orders Report - ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM dd, yyyy'),
    htmlBody: htmlBody,
    attachments: [inventoryBlob, ordersBlob]
  });
  
  Logger.log('Daily report sent successfully to: ' + recipient);
}

function sendDailyShipmentReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shipmentData = getShipmentHistory(30); // Last 30 days
  
  // Generate HTML report
  const htmlBody = generateShipmentHtmlReport(shipmentData);
  
  // Generate CSV file
  const shipmentCsv = generateShipmentCsv(shipmentData);
  
  // Get recipient email (change this to your email)
  const recipient = "tjennings@logistics-warehouse.com, rhewitt@logistics-warehouse.com, rrobertson@logistics-warehouse.com";
  
  // Create blob for attachment
  const shipmentBlob = Utilities.newBlob(shipmentCsv, 'text/csv', 'Shipment_History_Report_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd') + '.csv');
  
  // Send email
  MailApp.sendEmail({
    to: recipient,
    subject: 'Daily Shipment History Report - ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM dd, yyyy'),
    htmlBody: htmlBody,
    attachments: [shipmentBlob]
  });
  
  Logger.log('Daily shipment report sent successfully to: ' + recipient);
}

function generateHtmlReport(inventoryData, openOrdersData) {
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMMM dd, yyyy');
  const time = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'hh:mm a');
  
  // Outlook-friendly HTML with table-based layout and inline styles
  let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f5f5f5;">
    <tr>
      <td align="center" style="padding: 20px 10px;">
        
        <!-- Main Container -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 600px; background-color: #ffffff;">
          
          <!-- Header -->
          <tr>
            <td bgcolor="#800000" align="center" style="padding: 30px 20px; color: #ffffff;">
              <h1 style="margin: 0; font-size: 24px; font-weight: bold; color: #ffffff;">Daily Inventory & Orders Report</h1>
              <p style="margin: 10px 0 0 0; font-size: 14px; color: #ffffff;">${today}</p>
            </td>
          </tr>
          
          <!-- Content Area -->
          <tr>
            <td style="padding: 30px 20px;">
              
              <!-- Inventory Section -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 30px;">
                <tr>
                  <td bgcolor="#800000" style="padding: 12px 15px;">
                    <h2 style="margin: 0; font-size: 18px; font-weight: bold; color: #ffffff;">Current Inventory</h2>
                  </td>
                </tr>
                <tr>
                  <td bgcolor="#fff3cd" style="padding: 15px; border-left: 4px solid #800000;">
                    <p style="margin: 0; font-size: 14px; color: #333;"><strong>Total Items:</strong> ${inventoryData.length} | <strong>Low Stock:</strong> ${inventoryData.filter(item => item.quantity <= 5 && item.quantity > 0).length} | <strong>Out of Stock:</strong> ${inventoryData.filter(item => item.quantity === 0).length}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top: 15px;">
                    <!-- Inventory Table -->
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="8" border="1" style="border-collapse: collapse; border: 1px solid #e0e0e0; font-size: 13px;">
                      <tr>
                        <th align="left" bgcolor="#f8f9fa" style="padding: 10px 8px; border: 1px solid #e0e0e0; font-weight: bold; color: #333;">Item Name</th>
                        <th align="left" bgcolor="#f8f9fa" style="padding: 10px 8px; border: 1px solid #e0e0e0; font-weight: bold; color: #333;">Qty</th>
                        <th align="left" bgcolor="#f8f9fa" style="padding: 10px 8px; border: 1px solid #e0e0e0; font-weight: bold; color: #333;">Unit</th>
                      </tr>`;
  
  inventoryData.forEach(item => {
    const bgColor = item.quantity === 0 ? '#f8d7da' : (item.quantity <= 5 ? '#fff3cd' : '#ffffff');
    html += `
                      <tr>
                        <td bgcolor="${bgColor}" style="padding: 8px; border: 1px solid #e0e0e0;">${item.itemName}</td>
                        <td bgcolor="${bgColor}" style="padding: 8px; border: 1px solid #e0e0e0;">${item.quantity}</td>
                        <td bgcolor="${bgColor}" style="padding: 8px; border: 1px solid #e0e0e0;">${item.unit}</td>
                      </tr>`;
  });
  
  html += `
                    </table>
                  </td>
                </tr>
              </table>
              
              <!-- Open Orders Section -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td bgcolor="#800000" style="padding: 12px 15px;">
                    <h2 style="margin: 0; font-size: 18px; font-weight: bold; color: #ffffff;">Open Orders</h2>
                  </td>
                </tr>
                <tr>
                  <td bgcolor="#fff3cd" style="padding: 15px; border-left: 4px solid #800000;">
                    <p style="margin: 0; font-size: 14px; color: #333;"><strong>Total Open Orders:</strong> ${openOrdersData.length}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top: 15px;">
                    <!-- Orders Table -->
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="8" border="1" style="border-collapse: collapse; border: 1px solid #e0e0e0; font-size: 12px;">
                      <tr>
                        <th align="left" bgcolor="#f8f9fa" style="padding: 8px 6px; border: 1px solid #e0e0e0; font-weight: bold; color: #333;">LWH ID</th>
                        <th align="left" bgcolor="#f8f9fa" style="padding: 8px 6px; border: 1px solid #e0e0e0; font-weight: bold; color: #333;">Customer</th>
                        <th align="left" bgcolor="#f8f9fa" style="padding: 8px 6px; border: 1px solid #e0e0e0; font-weight: bold; color: #333;">Item #</th>
                        <th align="left" bgcolor="#f8f9fa" style="padding: 8px 6px; border: 1px solid #e0e0e0; font-weight: bold; color: #333;">PO #</th>
                        <th align="left" bgcolor="#f8f9fa" style="padding: 8px 6px; border: 1px solid #e0e0e0; font-weight: bold; color: #333;">Qty</th>
                      </tr>`;
  
  openOrdersData.forEach(order => {
    html += `
                      <tr>
                        <td style="padding: 6px; border: 1px solid #e0e0e0;">${order.lwhId}</td>
                        <td style="padding: 6px; border: 1px solid #e0e0e0;">${order.customerNumber}</td>
                        <td style="padding: 6px; border: 1px solid #e0e0e0;">${order.itemNumber}</td>
                        <td style="padding: 6px; border: 1px solid #e0e0e0;">${order.poNumber}</td>
                        <td style="padding: 6px; border: 1px solid #e0e0e0;">${order.quantity}</td>
                      </tr>`;
  });
  
  html += `
                    </table>
                  </td>
                </tr>
              </table>
              
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td bgcolor="#f8f9fa" align="center" style="padding: 20px; border-top: 3px solid #800000;">
              <p style="margin: 0 0 5px 0; font-size: 12px; color: #666;">Automated report from Sonoco inventory system</p>
              <p style="margin: 0; font-size: 12px; color: #666;">Generated on ${today} at ${time}</p>
            </td>
          </tr>
          
        </table>
        <!-- End Main Container -->
        
      </td>
    </tr>
  </table>
</body>
</html>`;
  
  return html;
}

function generateInventoryCsv(inventoryData) {
  let csv = 'Item Name,Quantity,Unit\n';
  
  inventoryData.forEach(item => {
    csv += `"${item.itemName}",${item.quantity},"${item.unit}"\n`;
  });
  
  return csv;
}

function generateShipmentHtmlReport(shipmentData) {
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMMM dd, yyyy');
  const time  = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'hh:mm a');

  // 🔽 Sort by shippedDate DESC (most recent first)
  const sortedShipmentData = [...shipmentData].sort((a, b) => {
    const da = new Date(a.shippedDate);
    const db = new Date(b.shippedDate);
    if (isNaN(da) || isNaN(db)) return 0; // if either can't be parsed, leave relative order
    return db - da; // newer date first
  });

  // Calculate total quantity shipped using the sorted data (same numbers, just consistent)
  const totalQuantity = sortedShipmentData.reduce((sum, shipment) => sum + Number(shipment.quantity || 0), 0);

  // Outlook-friendly HTML with table-based layout
  let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f5f5f5;">
    <tr>
      <td align="center" style="padding: 20px 10px;">
        
        <!-- Main Container -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 800px; background-color: #ffffff;">
          
          <!-- Header -->
          <tr>
            <td bgcolor="#800000" align="center" style="padding: 30px 20px; color: #ffffff;">
              <h1 style="margin: 0; font-size: 24px; font-weight: bold; color: #ffffff;">Daily Shipment History Report</h1>
              <p style="margin: 10px 0 0 0; font-size: 14px; color: #ffffff;">${today}</p>
            </td>
          </tr>
          
          <!-- Content Area -->
          <tr>
            <td style="padding: 30px 20px;">
              
              <!-- Shipment History Section -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td bgcolor="#800000" style="padding: 12px 15px;">
                    <h2 style="margin: 0; font-size: 18px; font-weight: bold; color: #ffffff;">Recent Shipments (Last 30 Days)</h2>
                  </td>
                </tr>
                <tr>
                  <td bgcolor="#fff3cd" style="padding: 15px; border-left: 4px solid #800000;">
                    <p style="margin: 0; font-size: 14px; color: #333;">
                      <strong>Total Shipments:</strong> ${sortedShipmentData.length}
                      | <strong>Total Quantity Shipped:</strong> ${totalQuantity.toLocaleString()}
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top: 15px;">
                    <!-- Shipments Table -->
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="6" border="1" style="border-collapse: collapse; border: 1px solid #e0e0e0; font-size: 11px;">
                      <tr>
                        <th align="left" bgcolor="#f8f9fa" style="padding: 8px 5px; border: 1px solid #e0e0e0; font-weight: bold; color: #333;">INV Receipt</th>
                        <th align="left" bgcolor="#f8f9fa" style="padding: 8px 5px; border: 1px solid #e0e0e0; font-weight: bold; color: #333;">Customer #</th>
                        <th align="left" bgcolor="#f8f9fa" style="padding: 8px 5px; border: 1px solid #e0e0e0; font-weight: bold; color: #333;">Sonoco #</th>
                        <th align="left" bgcolor="#f8f9fa" style="padding: 8px 5px; border: 1px solid #e0e0e0; font-weight: bold; color: #333;">PO #</th>
                        <th align="left" bgcolor="#f8f9fa" style="padding: 8px 5px; border: 1px solid #e0e0e0; font-weight: bold; color: #333;">Qty</th>
                        <th align="left" bgcolor="#f8f9fa" style="padding: 8px 5px; border: 1px solid #e0e0e0; font-weight: bold; color: #333;">Bill To Ref</th>
                        <th align="left" bgcolor="#f8f9fa" style="padding: 8px 5px; border: 1px solid #e0e0e0; font-weight: bold; color: #333;">Shipped Date</th>
                      </tr>`;

  // Use the sorted data here
  sortedShipmentData.forEach(shipment => {
    html += `
                      <tr>
                        <td style="padding: 5px; border: 1px solid #e0e0e0;">${shipment.invReceipt}</td>
                        <td style="padding: 5px; border: 1px solid #e0e0e0;">${shipment.customerNumber}</td>
                        <td style="padding: 5px; border: 1px solid #e0e0e0;">${shipment.sonocoNumber}</td>
                        <td style="padding: 5px; border: 1px solid #e0e0e0;">${shipment.poNumber}</td>
                        <td style="padding: 5px; border: 1px solid #e0e0e0;">${shipment.quantity}</td>
                        <td style="padding: 5px; border: 1px solid #e0e0e0;">${shipment.billToReference}</td>
                        <td style="padding: 5px; border: 1px solid #e0e0e0;">${shipment.shippedDate}</td>
                      </tr>`;
  });

  html += `
                    </table>
                  </td>
                </tr>
              </table>
              
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td bgcolor="#f8f9fa" align="center" style="padding: 20px; border-top: 3px solid #800000;">
              <p style="margin: 0 0 5px 0; font-size: 12px; color: #666;">Automated report from Sonoco inventory system</p>
              <p style="margin: 0; font-size: 12px; color: #666;">Generated on ${today} at ${time}</p>
            </td>
          </tr>
          
        </table>
        <!-- End Main Container -->
        
      </td>
    </tr>
  </table>
</body>
</html>`;

  return html;
}


function generateShipmentCsv(shipmentData) {
  // Sort by shippedDate DESC
  const sortedShipmentData = [...shipmentData].sort((a, b) => {
    const da = new Date(a.shippedDate);
    const db = new Date(b.shippedDate);
    if (isNaN(da) || isNaN(db)) return 0;
    return db - da;
  });

  let csv = 'INV Receipt,SubCustNm,Customer Number,Sonoco Number,PO Number,Quantity,Bill To Reference,Shipped Date\n';
  
  sortedShipmentData.forEach(shipment => {
    csv += `"${shipment.invReceipt}","${shipment.subCustNm}","${shipment.customerNumber}","${shipment.sonocoNumber}","${shipment.poNumber}",${shipment.quantity},"${shipment.billToReference}","${shipment.shippedDate}"\n`;
  });
  
  return csv;
}


function generateOpenOrdersCsv(openOrdersData) {
  let csv = 'LWH ID,Customer Number,Sonoco Item Number,PO Number,Quantity\n';
  
  openOrdersData.forEach(order => {
    csv += `"${order.lwhId}","${order.customerNumber}","${order.itemNumber}","${order.poNumber}",${order.quantity}\n`;
  });
  
  return csv;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function testEmail() {
  sendDailyReport();
  Logger.log('Test email sent!');
}

function testShipmentEmail() {
  sendDailyShipmentReport();
  Logger.log('Test shipment email sent!');
}

function getWebAppUrl() {
  const url = ScriptApp.getService().getUrl();
  Logger.log('Web App URL: ' + url);
  return url;
}

// Debug function to check OpenOrders data
function debugOpenOrders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ordersSheet = ss.getSheetByName('OpenOrders');
  
  if (!ordersSheet) {
    Logger.log('ERROR: OpenOrders sheet not found!');
    return;
  }
  
  const data = ordersSheet.getDataRange().getValues();
  Logger.log('Total rows (including header): ' + data.length);
  Logger.log('Headers: ' + data[0].join(', '));
  
  const rows = data.slice(1);
  Logger.log('Data rows: ' + rows.length);
  
  if (rows.length > 0) {
    Logger.log('First data row: ' + JSON.stringify(rows[0]));
    Logger.log('Second data row: ' + JSON.stringify(rows[1]));
  }
  
  const result = getOpenOrdersData();
  Logger.log('Processed orders: ' + result.length);
  if (result.length > 0) {
    Logger.log('First processed order: ' + JSON.stringify(result[0]));
  }
}


function getComponentsData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Components');

  if (!sheet) return [];

  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  const displayValues = dataRange.getDisplayValues();

  const rows = [];

  for (let i = 1; i < values.length; i++) {
    if (!values[i][0]) continue; // skip blank rows

    // Last Updated: use display value if it's a date object
    let lastUpdated = displayValues[i][4] || '';
    if (values[i][4] instanceof Date) {
      lastUpdated = Utilities.formatDate(
        values[i][4],
        Session.getScriptTimeZone(),
        'MM/dd/yyyy'
      );
    }

    rows.push({
      componentCode: String(values[i][0] || ''),
      description:   String(values[i][1] || ''),
      quantity:      Number(values[i][2]) || 0,
      reserved:      Number(values[i][3]) || 0,
      lastUpdated:   lastUpdated
    });
  }

  return rows;
}

function testExportSnapshot() {
  exportInventorySnapshot_();
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

// ---- Sonoco Inventory: actions -----------------------------------------------------------
var API_SERVICE_NAME = 'LWH Sonoco Inventory API';
function apiSpreadsheet_() { return SpreadsheetApp.getActiveSpreadsheet(); }

var API_ROUTES = {
  bootstrap: apiBootstrap_, inventory: apiInventory_, shipments: apiShipments_, transactions: apiTransactions_,
  addStock: apiAddStock_, shipStock: apiShipStock_, sendReport: apiSendReport_
};

function apiInventory_() { return { inventory: getInventoryData(), orders: getOpenOrdersData() }; }

function apiBootstrap_(b, who) {
  var out = apiInventory_();
  out.me = who; out.version = TOOLKIT_API_VERSION;
  return out;
}

/** Shipment History rows with the shipped date as yyyy-MM-dd. Default: the last 13 months; all:true for everything. */
function apiShipments_(b) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Shipment History');
  if (!sheet) return { rows: [], all: true };
  var range = sheet.getDataRange(), display = range.getDisplayValues(), values = range.getValues();
  var cutoff = '';
  if (!b.all) {
    var c = new Date(); c.setMonth(c.getMonth() - 13); c.setDate(1);
    cutoff = Utilities.formatDate(c, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var rows = [], older = 0;
  for (var i = 1; i < display.length; i++) {
    if (!display[i][0]) continue;
    var key = '';
    if (Object.prototype.toString.call(values[i][7]) === '[object Date]') {
      key = Utilities.formatDate(values[i][7], Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } else {
      var n = normalizeDateString(String(display[i][7] || ''));       // MM/DD/YYYY or null
      if (n) key = n.slice(6) + '-' + n.slice(0, 2) + '-' + n.slice(3, 5);
    }
    if (cutoff && key && key < cutoff) { older++; continue; }
    rows.push({
      invReceipt: String(display[i][0] || ''), subCustNm: String(display[i][1] || ''),
      customerNumber: String(display[i][2] || ''), sonocoNumber: String(display[i][3] || ''),
      poNumber: String(display[i][4] || ''), quantity: Number(String(display[i][5]).replace(/,/g, '')) || 0,
      billToReference: String(display[i][6] || ''), shippedDate: String(display[i][7] || ''), date: key
    });
  }
  return { rows: rows, all: !!b.all || older === 0, since: cutoff };
}

function apiTransactions_(b) {
  var limit = Math.max(1, Math.min(1000, parseInt(b.limit, 10) || 200));
  return { rows: getTransactionHistory(limit) };
}

function stockMove_(b, who, fn) {
  requireEdit_(who);
  var item = String(b.item == null ? '' : b.item);
  if (!item) bad_('Pick the item.');
  var qty = wholeNumber_(b.quantity, 'Quantity');
  var r;
  try { r = fn(item, qty, String(b.notes || '').slice(0, 300), who.name); }
  catch (err) { bad_(String((err && err.message) || err)); }
  return { message: r.message, newQuantity: r.newQuantity, inventory: getInventoryData() };
}
function apiAddStock_(b, who) { return stockMove_(b, who, addInventory); }
function apiShipStock_(b, who) { return stockMove_(b, who, shipInventory); }

/** The same two emails the old page's buttons sent, to the same fixed recipient lists. */
function apiSendReport_(b, who) {
  requireEdit_(who);
  if (b.type === 'shipments') { sendDailyShipmentReport(); Logger.log('Shipment report sent on request by ' + who.name); return { message: 'Shipment report sent.' }; }
  sendDailyReport(); Logger.log('Inventory & orders report sent on request by ' + who.name);
  return { message: 'Inventory & open orders report sent.' };
}
