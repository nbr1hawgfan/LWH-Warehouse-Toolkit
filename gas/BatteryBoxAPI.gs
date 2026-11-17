// ============================================================
//  BOM INVENTORY SYSTEM — Code.gs
//  Logistics Warehouse — Production/Assembly Model
//  Build masters first → ship from built stock (tracking only)
//
//  v3.1 — LWH light theme (red & black, sharp edges) for the
//  web app and all emails. Email layouts use tables only (no
//  flexbox) so they render the same in Outlook and Gmail.
//  No logic, sheet structure, or function names changed.
//
//  v4.0 (Warehouse Toolkit v1.89.0) — the screens moved to the
//  Warehouse Toolkit → "Battery Box & BOM". This Sheet stays the
//  database and this script keeps every email, timer and the
//  Battery Box Shipment Tracking sync. New (search "TOOLKIT API"):
//    - doPost() JSON API for the Toolkit, checked on every request:
//      the Toolkit's employee sign-in + this Sheet's "Access" tab
//      (Role: edit or view)
//    - one save at a time (lock) for builds, shipments, receiving,
//      counts, orders, components, BOM items and customers
//    - Built By / Shipped By / Received By default to the sign-in
//      name; "Entered by …" goes in Notes when someone else did it
//    - count changes are written to a new "Stock_Log" tab
//    - fixes: a component listed twice on a BOM is added up before
//      the stock check; re-saving a BOM item replaces its whole
//      block (it used to leave the old component rows behind and
//      they attached to the item above); an order already Shipped
//      or Cancelled can't be shipped again; PO numbers on reports
//      come from the Shipment_ID instead of matching item + date;
//      receiving IDs no longer repeat
//    - doGet() shows a "moved" page (?health=1 for a check)
//  Setup: docs/BATTERY_BOX_SETUP.md in the Toolkit repo.
//
//  EMAIL PALETTE
//    Brand red   #C41230   Maroon   #7D1935   Black  #111111
//    Text        #1A1A1A   Muted    #4A4F57   Faint  #6B7280
//    Border      #D6D9DE   Row line #E3E6EA   Page   #F4F5F7
//    OK green    #157A4F   Warn     #B86E00   Crit   #B00020
//    Links       #1F5FA8
// ============================================================

var CONFIG = {
  SPREADSHEET_ID: '1Z2HUvxfKWxFIurPC5RHHu8sE6JGndKyWl0xmA__jx00',
  TRACKING_SHEET_ID: '1UlUbTIB2j0wFbo0ltv-tZSmPmVRoD8kKLs_BT0zmEk8', // Battery Box Shipment Tracking
  TIMEZONE: 'America/Chicago',
  SHEETS: {
    INVENTORY:      'Inventory',
    BOM_DATA:       'BOM_Data',
    OPEN_ORDERS:    'OpenOrders',
    SHIPMENTS:      'Shipments',
    HISTORY:        'Production_History',
    CUSTOMERS:      'Customers',
    RECEIVING:      'Receiving_Log',
    MASTER_STOCK:   'Master_Stock',
    PRODUCTION_LOG: 'Production_Log'
  },
  NOTIFY: [
    'tjennings@logistics-warehouse.com',
    'mwalker@logistics-warehouse.com',
    'tbolton@logistics-warehouse.com',
    'sbolton@logistics-warehouse.com',
    'kdavidson@logistics-warehouse.com'
  ],
  // Customer-facing weekly report recipients — edit as needed
  CUSTOMER_NOTIFY: [
    'mwalker@logistics-warehouse.com'
  ]
};

// ============================================================
//  WEB APP ENTRY POINT
// ============================================================

// doGet() now lives in the TOOLKIT API section at the bottom (the screens
// moved to the Warehouse Toolkit). The old index.html file can stay in the
// project; nothing serves it any more.

// ============================================================
//  SPREADSHEET HELPERS
// ============================================================

function ss() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

function getSheet(name) {
  var sheet = ss().getSheetByName(name);
  if (!sheet) throw new Error('Sheet not found: ' + name);
  return sheet;
}

function sheetData(name) {
  SpreadsheetApp.flush();
  var sheet = ss().getSheetByName(name);
  if (!sheet) return [];
  var last = sheet.getLastRow();
  if (last <= 1) return [];
  var cols = Math.max(sheet.getLastColumn(), 1);
  return sheet.getRange(1, 1, last, cols).getValues();
}

function today() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function fmtDate(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }
  var s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  if (s.indexOf('T') !== -1)         return s.substring(0, 10);
  try {
    var d = new Date(s);
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000)
      return Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  } catch(e) {}
  return s.substring(0, 10);
}

function numVal(v) {
  if (typeof v === 'number') return v;
  return parseFloat(String(v).replace(/[^0-9.\-]/g, '')) || 0;
}

// ============================================================
//  SETUP — run once from editor
// ============================================================

function setupAllSheets() {
  var spreadsheet = ss();
  var configs = [
    { name: 'Inventory',
      headers: ['code','description','quantity','reserved','lastUpdated','lowThreshold','criticalThreshold'],
      widths:  [140,280,90,90,160,120,130] },
    { name: 'BOM_Data',
      headers: ['Company','Item','Component','Description','Qty_Per_Unit'],
      widths:  [160,160,160,280,100] },
    { name: 'OpenOrders',
      headers: ['Order_Date','PO_Number','Item_Name','Order_Qty','Shipped_Qty','Due_Qty','Unit','Customer','Priority','Status','Address','Notes'],
      widths:  [110,120,180,90,100,90,80,180,90,90,200,200] },
    { name: 'Shipments',
      headers: ['Shipment_ID','Date','Customer','Address','Item','Qty_Shipped','Tracking','Shipped_By','Notes','Timestamp','LD_Numbers'],
      widths:  [130,100,180,240,160,90,200,120,180,160,200] },
    { name: 'Customers',
      headers: ['Customer_Name','Address','City_State','Contact'],
      widths:  [200,300,180,160] },
    { name: 'Receiving_Log',
      headers: ['Log_ID','Date','Component_Code','Component_Name','PO_Number','Vendor','Qty_Received','Unit_Cost','Total_Cost','Received_By','Notes'],
      widths:  [130,100,140,240,130,180,110,100,100,130,220] },
    { name: 'Production_History',
      headers: ['Date','PO_Number','Item','Description','Quantity','Shipped_By','Status','Tracking_Summary'],
      widths:  [100,130,160,280,90,120,100,200] },
    { name: 'Master_Stock',
      headers: ['Item_Code','Description','Company','Qty_Built','Qty_Shipped','Qty_Available','Last_Built','Last_Shipped'],
      widths:  [160,280,160,100,100,100,160,160] },
    { name: 'Production_Log',
      headers: ['Log_ID','Date','Item_Code','Description','Qty_Built','Built_By','Components_Used','Notes','Timestamp'],
      widths:  [130,100,160,280,90,120,320,200,160] }
  ];

  var created = [], skipped = [];
  configs.forEach(function(cfg) {
    var sheet = spreadsheet.getSheetByName(cfg.name);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(cfg.name);
      created.push(cfg.name);
    } else {
      skipped.push(cfg.name);
    }
    if (sheet.getLastRow() === 0) sheet.appendRow(cfg.headers);
    var hdr = sheet.getRange(1, 1, 1, cfg.headers.length);
    hdr.setBackground('#C41230').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(11);
    cfg.widths.forEach(function(w, i) { try { sheet.setColumnWidth(i + 1, w); } catch(e) {} });
    sheet.setFrozenRows(1);
  });

  Logger.log('Created: ' + created.join(', '));
  Logger.log('Existed: ' + skipped.join(', '));
  return { success: true, created: created, skipped: skipped };
}

// ============================================================
//  COMPONENTS (INVENTORY)
// ============================================================

function getComponents() {
  var data = sheetData(CONFIG.SHEETS.INVENTORY);
  if (!data.length) return [];
  return data.slice(1).filter(function(r) { return r[0]; }).map(function(r) {
    return {
      code:              String(r[0]).trim(),
      description:       String(r[1] || 'No description'),
      quantity:          numVal(r[2]),
      reserved:          numVal(r[3]),
      lastUpdated:       r[4] || '',
      lowThreshold:      numVal(r[5]) || 50,
      criticalThreshold: numVal(r[6]) || 25
    };
  });
}

function updateStock(componentCode, newQuantity) {
  SpreadsheetApp.flush();
  var sheet = ss().getSheetByName(CONFIG.SHEETS.INVENTORY);
  if (!sheet) return { success: false, message: 'Inventory sheet not found' };
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(componentCode).trim()) {
      var cell = sheet.getRange(i + 1, 3);
      cell.setValue(Number(newQuantity));
      cell.setNumberFormat('0');
      sheet.getRange(i + 1, 5).setValue(new Date().toISOString());
      SpreadsheetApp.flush();
      return { success: true, message: 'Updated ' + componentCode + ' to ' + newQuantity };
    }
  }
  return { success: false, message: 'Component not found: ' + componentCode };
}

function adjustStock(componentCode, delta) {
  SpreadsheetApp.flush();
  var sheet = ss().getSheetByName(CONFIG.SHEETS.INVENTORY);
  if (!sheet) return { success: false };
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(componentCode).trim()) {
      var before = numVal(data[i][2]);
      var after  = Math.max(0, before + delta);
      var cell   = sheet.getRange(i + 1, 3);
      cell.setValue(after);
      cell.setNumberFormat('0');
      sheet.getRange(i + 1, 5).setValue(new Date().toISOString());
      SpreadsheetApp.flush();
      return { success: true, before: before, after: after };
    }
  }
  return { success: false, error: 'Not found: ' + componentCode };
}

function addNewComponent(data) {
  SpreadsheetApp.flush();
  var sheet = ss().getSheetByName(CONFIG.SHEETS.INVENTORY);
  if (!sheet) return { success: false, error: 'Inventory sheet not found' };
  var existing = sheet.getDataRange().getValues();
  for (var i = 1; i < existing.length; i++) {
    if (String(existing[i][0]).trim().toLowerCase() === String(data.code).trim().toLowerCase())
      return { success: false, error: 'Component ' + data.code + ' already exists' };
  }
  sheet.appendRow([
    String(data.code).trim(),
    String(data.description).trim(),
    Number(data.quantity)          || 0,
    Number(data.reserved)          || 0,
    new Date().toISOString(),
    Number(data.lowThreshold)      || 10,
    Number(data.criticalThreshold) || 10
  ]);
  var lr = sheet.getLastRow();
  [3,4,6,7].forEach(function(c) { sheet.getRange(lr, c).setNumberFormat('0'); });
  SpreadsheetApp.flush();
  return { success: true, code: data.code };
}

function formatInventorySheet() {
  SpreadsheetApp.flush();
  var sheet = ss().getSheetByName(CONFIG.SHEETS.INVENTORY);
  if (!sheet) return { success: false, message: 'Inventory sheet not found' };
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: true, message: 'No data rows' };
  [3,4,6,7].forEach(function(c) {
    sheet.getRange(2, c, lastRow - 1, 1).setNumberFormat('0');
  });
  SpreadsheetApp.flush();
  return { success: true, message: 'Formatted ' + (lastRow - 1) + ' rows' };
}

// ============================================================
//  BOM DATA
// ============================================================

function getBOMItems() {
  var data = sheetData(CONFIG.SHEETS.BOM_DATA);
  if (!data.length) return [];
  var items = {};
  var currentItem = '', currentCompany = '', currentDescription = '';
  for (var i = 1; i < data.length; i++) {
    var company   = String(data[i][0] || '').trim();
    var item      = String(data[i][1] || '').trim();
    var component = String(data[i][2] || '').trim();
    var desc      = String(data[i][3] || '').trim();
    var qty       = numVal(data[i][4]) || 1;

    if (item) {
      currentItem        = item;
      currentCompany     = company;
      currentDescription = desc;
      if (!items[item]) {
        items[item] = { item: item, company: currentCompany, description: currentDescription || item, components: [] };
      }
    }
    if (component && currentItem) {
      items[currentItem].components.push({ code: component, description: desc || 'No description', quantity: qty });
    }
  }
  return Object.values(items);
}

function addNewBOMItem(data) {
  SpreadsheetApp.flush();
  var sheet = ss().getSheetByName(CONFIG.SHEETS.BOM_DATA);
  if (!sheet) return { success: false, error: 'BOM_Data sheet not found' };
  if (!data.item) return { success: false, error: 'Item code required' };
  if (!data.components || !data.components.length) return { success: false, error: 'At least one component required' };

  var company = String(data.company || '').trim();
  var item    = String(data.item).trim();

  // Only the first row of a BOM block carries the item code; the rows under it
  // (blank item column) are its components. Remove the WHOLE block, bottom-up.
  var existing = sheet.getDataRange().getValues();
  var blocks = [];
  for (var i = 1; i < existing.length; i++) {
    if (String(existing[i][1]).trim() === item) {
      var end = i;
      while (end + 1 < existing.length && !String(existing[end + 1][1]).trim() && String(existing[end + 1][2]).trim()) end++;
      blocks.push([i, end]);
      i = end;
    }
  }
  for (var b = blocks.length - 1; b >= 0; b--) {
    sheet.deleteRows(blocks[b][0] + 1, blocks[b][1] - blocks[b][0] + 1);
  }

  data.components.forEach(function(comp, idx) {
    sheet.appendRow([
      idx === 0 ? company : '',
      idx === 0 ? item    : '',
      String(comp.componentCode || '').trim(),
      String(comp.description   || '').trim(),
      Number(comp.qty) || 1
    ]);
  });
  SpreadsheetApp.flush();
  return { success: true, item: item, componentCount: data.components.length };
}

// ============================================================
//  MASTER STOCK
//  Tracks how many assembled/built units of each BOM item
//  are ready to ship.
//  Sheet cols: 0=Item_Code, 1=Description, 2=Company,
//              3=Qty_Built, 4=Qty_Shipped, 5=Qty_Available,
//              6=Last_Built, 7=Last_Shipped
// ============================================================

function getMasterStock() {
  var data = sheetData(CONFIG.SHEETS.MASTER_STOCK);
  if (!data.length) return [];
  return data.slice(1).filter(function(r) { return r[0]; }).map(function(r) {
    var built     = numVal(r[3]);
    var shipped   = numVal(r[4]);
    var available = numVal(r[5]);
    return {
      itemCode:    String(r[0]).trim(),
      description: String(r[1] || ''),
      company:     String(r[2] || ''),
      qtyBuilt:    built,
      qtyShipped:  shipped,
      qtyAvailable:available,
      lastBuilt:   fmtDate(r[6]),
      lastShipped: fmtDate(r[7])
    };
  });
}

function _getMasterStockRow(itemCode) {
  // Returns { sheet, rowIndex (1-based), data } or null
  SpreadsheetApp.flush();
  var sheet = ss().getSheetByName(CONFIG.SHEETS.MASTER_STOCK);
  if (!sheet) return null;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(itemCode).trim()) {
      return { sheet: sheet, rowIndex: i + 1, data: data[i] };
    }
  }
  return { sheet: sheet, rowIndex: -1, data: null };
}

function _upsertMasterStockRow(itemCode, description, company, builtDelta, shippedDelta, isShip) {
  SpreadsheetApp.flush();
  var sheet = ss().getSheetByName(CONFIG.SHEETS.MASTER_STOCK);
  if (!sheet) {
    setupAllSheets();
    sheet = ss().getSheetByName(CONFIG.SHEETS.MASTER_STOCK);
  }
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(itemCode).trim()) {
      var built     = numVal(data[i][3]) + (builtDelta || 0);
      var shipped   = numVal(data[i][4]) + (shippedDelta || 0);
      var available = Math.max(0, built - shipped);
      var now       = new Date().toISOString();
      sheet.getRange(i + 1, 4).setValue(built);
      sheet.getRange(i + 1, 5).setValue(shipped);
      sheet.getRange(i + 1, 6).setValue(available);
      if (!isShip) sheet.getRange(i + 1, 7).setValue(now); // last built
      if (isShip)  sheet.getRange(i + 1, 8).setValue(now); // last shipped
      [4,5,6].forEach(function(c) { sheet.getRange(i + 1, c).setNumberFormat('0'); });
      SpreadsheetApp.flush();
      return { built: built, shipped: shipped, available: available };
    }
  }
  // Insert new row
  var built     = builtDelta  || 0;
  var shipped   = shippedDelta || 0;
  var available = Math.max(0, built - shipped);
  var now       = new Date().toISOString();
  sheet.appendRow([
    String(itemCode).trim(),
    String(description || '').trim(),
    String(company     || '').trim(),
    built, shipped, available,
    !isShip ? now : '',
    isShip  ? now : ''
  ]);
  var lr = sheet.getLastRow();
  [4,5,6].forEach(function(c) { sheet.getRange(lr, c).setNumberFormat('0'); });
  SpreadsheetApp.flush();
  return { built: built, shipped: shipped, available: available };
}

// ── RECORD PRODUCTION RUN ────────────────────────────────
// Checks component availability, deducts components, adds to Master_Stock
function recordProductionRun(data) {
  try {
    var itemCode = String(data.itemCode || '').trim();
    var qty      = Number(data.qty) || 0;
    var builtBy  = String(data.builtBy  || 'Production');
    var notes    = String(data.notes    || '');
    if (data.enteredBy && data.enteredBy !== builtBy) notes = (notes ? notes + ' — ' : '') + 'Entered by ' + data.enteredBy;

    if (!itemCode) return { success: false, error: 'Item code is required' };
    if (qty < 1)   return { success: false, error: 'Quantity must be at least 1' };

    // Find BOM
    var bomItems = getBOMItems();
    var bomItem  = bomItems.filter(function(b) { return b.item === itemCode; })[0];
    if (!bomItem) return { success: false, error: 'Item not found in BOM: ' + itemCode };

    if (!bomItem.components.length) return { success: false, error: 'This item has no components on BOM_Data' };

    // A component listed twice on one BOM is added up (checked and deducted once, for the total).
    var merged = {}, order = [];
    bomItem.components.forEach(function(comp) {
      if (!merged[comp.code]) { merged[comp.code] = { code: comp.code, description: comp.description, quantity: 0 }; order.push(comp.code); }
      merged[comp.code].quantity += comp.quantity;
    });
    var bomComps = order.map(function(c) { return merged[c]; });

    // Check component availability
    var components = getComponents();
    var shortages  = [];
    bomComps.forEach(function(comp) {
      var needed = comp.quantity * qty;
      var found  = components.filter(function(c) { return c.code === comp.code; })[0];
      var onHand = found ? found.quantity : 0;
      if (onHand < needed) {
        shortages.push({
          code:        comp.code,
          description: comp.description,
          needed:      needed,
          onHand:      onHand,
          short:       needed - onHand
        });
      }
    });

    if (shortages.length) {
      return {
        success:   false,
        error:     'Insufficient components to build ' + qty + ' unit(s) of ' + itemCode,
        shortages: shortages
      };
    }

    // Deduct components
    var compLog          = [];
    var alertCandidates  = [];

    bomComps.forEach(function(comp) {
      var needed   = comp.quantity * qty;
      var before   = (components.filter(function(c) { return c.code === comp.code; })[0] || {}).quantity || 0;
      var r        = adjustStock(comp.code, -needed);
      compLog.push(comp.code + ': -' + needed + ' (' + r.before + '->' + r.after + ')');

      var fullComp      = components.filter(function(c) { return c.code === comp.code; })[0] || {};
      var critT         = fullComp.criticalThreshold || 25;
      var lowT          = fullComp.lowThreshold      || 50;
      var crossedCrit   = before > critT && r.after <= critT;
      var crossedWarn   = before > lowT  && r.after <= lowT;

      if (crossedCrit || crossedWarn) {
        alertCandidates.push({
          code:              comp.code,
          description:       fullComp.description || comp.description,
          newQty:            r.after,
          criticalThreshold: critT,
          lowThreshold:      lowT,
          crossedCritical:   crossedCrit,
          crossedWarning:    crossedWarn,
          openOrdersAffected: []
        });
      }
    });

    // Update master stock
    var stockResult = _upsertMasterStockRow(itemCode, bomItem.description, bomItem.company, qty, 0, false);

    // Write to Production_Log
    var logSheet = ss().getSheetByName(CONFIG.SHEETS.PRODUCTION_LOG);
    if (!logSheet) { setupAllSheets(); logSheet = ss().getSheetByName(CONFIG.SHEETS.PRODUCTION_LOG); }
    var logId    = 'PRD-' + new Date().getTime();
    var now      = new Date().toISOString();
    logSheet.appendRow([
      logId, today(), itemCode, bomItem.description, qty,
      builtBy, compLog.join('; '), notes, now
    ]);
    SpreadsheetApp.flush();

    // Low stock alerts
    if (alertCandidates.length) {
      try {
        sendLowStockAlert(alertCandidates, {
          shipmentId: logId,
          item:       itemCode,
          qty:        qty,
          customer:   'Production Run',
          date:       today()
        });
      } catch(e) { Logger.log('Low stock alert error: ' + e.message); }
    }

    // Production email notification
    try { sendProductionEmail(logId, itemCode, bomItem.description, qty, builtBy, compLog, stockResult); } catch(e) {
      Logger.log('Production email error: ' + e.message);
    }

    return {
      success:       true,
      logId:         logId,
      itemCode:      itemCode,
      qtyBuilt:      qty,
      qtyAvailable:  stockResult.available,
      compLog:       compLog
    };

  } catch(err) {
    Logger.log('recordProductionRun error: ' + err.message);
    return { success: false, error: err.message };
  }
}

// ── GET PRODUCTION LOG ────────────────────────────────────
function getProductionLog() {
  var data = sheetData(CONFIG.SHEETS.PRODUCTION_LOG);
  if (!data.length) return [];
  return data.slice(1).reverse().map(function(r) {
    return {
      logId:       String(r[0] || ''),
      date:        fmtDate(r[1]),
      itemCode:    String(r[2] || ''),
      description: String(r[3] || ''),
      qtyBuilt:    numVal(r[4]),
      builtBy:     String(r[5] || ''),
      components:  String(r[6] || ''),
      notes:       String(r[7] || ''),
      timestamp:   String(r[8] || '')
    };
  }).filter(function(r) { return r.logId; });
}

// ── WHAT CAN BE BUILT? ────────────────────────────────────
// Returns for each BOM item how many units can be built given current component stock
function getBuildCapacity() {
  var bomItems   = getBOMItems();
  var components = getComponents();
  var masterStock = getMasterStock();

  return bomItems.map(function(bomItem) {
    var maxBuildable = Infinity;
    // A component listed twice on one BOM counts once, for the total per unit.
    var merged = {}, order = [];
    bomItem.components.forEach(function(c) {
      if (!merged[c.code]) { merged[c.code] = { code: c.code, description: c.description, quantity: 0 }; order.push(c.code); }
      merged[c.code].quantity += c.quantity;
    });
    var componentStatus = order.map(function(code) { return merged[code]; }).map(function(comp) {
      var found  = components.filter(function(c) { return c.code === comp.code; })[0];
      var onHand = found ? found.quantity : 0;
      var canMake = comp.quantity > 0 ? Math.floor(onHand / comp.quantity) : Infinity;
      if (canMake < maxBuildable) maxBuildable = canMake;
      return {
        code:        comp.code,
        description: comp.description,
        qtyPerUnit:  comp.quantity,
        onHand:      onHand,
        canMake:     canMake,
        status:      canMake === 0 ? 'blocking' : canMake < 10 ? 'low' : 'ok'
      };
    });
    if (maxBuildable === Infinity) maxBuildable = 0;

    var ms = masterStock.filter(function(m) { return m.itemCode === bomItem.item; })[0];
    return {
      item:           bomItem.item,
      description:    bomItem.description,
      company:        bomItem.company,
      maxBuildable:   maxBuildable,
      qtyAvailable:   ms ? ms.qtyAvailable : 0,
      qtyBuilt:       ms ? ms.qtyBuilt     : 0,
      qtyShipped:     ms ? ms.qtyShipped   : 0,
      lastBuilt:      ms ? ms.lastBuilt    : '',
      components:     componentStatus
    };
  });
}

// ============================================================
//  OPEN ORDERS
// ============================================================

function getOpenOrders() {
  var data = sheetData(CONFIG.SHEETS.OPEN_ORDERS);
  if (!data.length) return [];
  return data.slice(1).filter(function(r) { return r[1]; }).map(function(r) {
    return {
      orderDate:     fmtDate(r[0]),
      poNumber:      String(r[1]  || ''),
      itemName:      String(r[2]  || ''),
      orderQuantity: numVal(r[3]),
      shippedQty:    numVal(r[4]),
      dueQuantity:   numVal(r[5]),
      unit:          String(r[6]  || ''),
      customer:      String(r[7]  || ''),
      priorityLevel: String(r[8]  || 'Normal'),
      status:        String(r[9]  || 'Open'),
      address:       String(r[10] || ''),
      notes:         String(r[11] || '')
    };
  });
}

function saveOrder(data) {
  SpreadsheetApp.flush();
  var sheet = ss().getSheetByName(CONFIG.SHEETS.OPEN_ORDERS);
  if (!sheet) return { success: false, error: 'OpenOrders sheet not found' };
  var rows = sheet.getDataRange().getValues();
  var qty  = Number(data.orderQty) || Number(data.dueQty) || 1;

  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).trim() === String(data.poNumber).trim()) {
      sheet.getRange(i + 1, 3, 1, 10).setValues([[
        data.itemName  || rows[i][2],
        qty,
        rows[i][4],
        qty,
        data.unit      || rows[i][6] || 'Each',
        data.customer  || rows[i][7],
        data.priority  || rows[i][8] || 'Normal',
        rows[i][9],
        data.address   || rows[i][10] || '',
        data.notes     || rows[i][11] || ''
      ]]);
      SpreadsheetApp.flush();
      return { success: true, message: 'Order ' + data.poNumber + ' updated' };
    }
  }
  sheet.appendRow([
    today(),
    data.poNumber,
    data.itemName,
    qty, 0, qty,
    data.unit     || 'Each',
    data.customer,
    data.priority || 'Normal',
    'Open',
    data.address  || '',
    data.notes    || ''
  ]);
  SpreadsheetApp.flush();
  return { success: true, message: 'Order ' + data.poNumber + ' created' };
}

function updateOrderStatus(poNumber, status) {
  SpreadsheetApp.flush();
  var sheet = ss().getSheetByName(CONFIG.SHEETS.OPEN_ORDERS);
  if (!sheet) return { success: false, error: 'OpenOrders sheet not found' };
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim() === String(poNumber).trim()) {
      sheet.getRange(i + 1, 10).setValue(status);
      SpreadsheetApp.flush();
      if (status === 'Cancelled') {
        var order = {
          poNumber:      String(data[i][1]),
          itemName:      String(data[i][2]),
          customer:      String(data[i][7]),
          dueQuantity:   numVal(data[i][5]),
          orderQuantity: numVal(data[i][3]),
          priorityLevel: String(data[i][8] || 'Normal')
        };
        sendCancellationEmail(poNumber, order);
      }
      return { success: true };
    }
  }
  return { success: false, error: 'PO not found: ' + poNumber };
}

// ============================================================
//  SHIPMENTS
//  Shipments now ONLY deduct from Master_Stock — no component
//  deduction happens at ship time.
// ============================================================

function getShipments() {
  SpreadsheetApp.flush();
  var sheet = ss().getSheetByName(CONFIG.SHEETS.SHIPMENTS);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  var numCols = Math.max(sheet.getLastColumn(), 11);
  var data    = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
  return data.map(function(r) {
    return {
      id:         String(r[0]  || ''),
      date:       fmtDate(r[1]),
      customer:   String(r[2]  || ''),
      address:    String(r[3]  || ''),
      item:       String(r[4]  || ''),
      qtyShipped: numVal(r[5]),
      tracking:   String(r[6]  || ''),
      shippedBy:  String(r[7]  || ''),
      notes:      String(r[8]  || ''),
      timestamp:  String(r[9]  || ''),
      ldNumbers:  String(r[10] || '')
    };
  }).filter(function(r) { return r.id && r.item; }).reverse();
}

function recordShipment(data) {
  try {
    var spreadsheet = ss();
    var shipSheet   = spreadsheet.getSheetByName(CONFIG.SHEETS.SHIPMENTS);
    var orderSheet  = spreadsheet.getSheetByName(CONFIG.SHEETS.OPEN_ORDERS);
    var histSheet   = spreadsheet.getSheetByName(CONFIG.SHEETS.HISTORY);

    if (!shipSheet) return { success: false, error: 'Shipments sheet not found' };

    var item      = String(data.item       || '');
    var qty       = Number(data.qtyShipped) || 1;
    var tracking  = String(data.tracking   || '');
    var ldNumbers = String(data.ldNumbers  || '');
    var shippedBy = String(data.shippedBy  || '');
    var customer  = String(data.customer   || '');
    var address   = String(data.address    || '');
    var notes     = String(data.notes      || '');
    var poNumber  = String(data.poNumber   || '').trim();
    if (data.enteredBy && data.enteredBy !== shippedBy) notes = (notes ? notes + ' — ' : '') + 'Entered by ' + data.enteredBy;

    if (!item)   return { success: false, error: 'Item is required' };
    if (qty < 1) return { success: false, error: 'Quantity must be at least 1' };

    // ── An order can only ship once (a second tap or a second person) ──
    if (orderSheet && poNumber) {
      var od = orderSheet.getDataRange().getValues();
      for (var k = 1; k < od.length; k++) {
        if (String(od[k][1]).trim() === poNumber) {
          var st = String(od[k][9] || 'Open');
          if (st === 'Shipped' || st === 'Cancelled') {
            return { success: false, error: 'Order ' + poNumber + ' is already ' + st + '.' };
          }
          break;
        }
      }
    }

    // ── Check master stock availability ─────────────────
    var ms = getMasterStock().filter(function(m) { return m.itemCode === item; })[0];
    var available = ms ? ms.qtyAvailable : 0;
    if (available < qty) {
      return {
        success: false,
        error:   'Not enough built units to ship. Need ' + qty + ', have ' + available + ' available for ' + item + '.'
      };
    }

    // ── Deduct from master stock ─────────────────────────
    var bomItems = getBOMItems();
    var bomItem  = bomItems.filter(function(b) { return b.item === item; })[0];
    var company  = bomItem ? bomItem.company     : '';
    var desc     = bomItem ? bomItem.description : '';
    var stockResult = _upsertMasterStockRow(item, desc, company, 0, qty, true);

    // ── Write shipment row ────────────────────────────────
    var shipId    = 'SH-' + new Date().getTime();
    var shipDate  = today();
    var timestamp = new Date().toISOString();

    shipSheet.appendRow([
      shipId, shipDate, customer, address, item, qty,
      tracking, shippedBy, notes, timestamp, ldNumbers
    ]);
    shipSheet.getRange(shipSheet.getLastRow(), 6).setNumberFormat('0');
    SpreadsheetApp.flush();

    // ── Update order ─────────────────────────────────────
    var orderUpdated = false;
    if (orderSheet && poNumber) {
      SpreadsheetApp.flush();
      var orderData = orderSheet.getDataRange().getValues();
      for (var i = 1; i < orderData.length; i++) {
        if (String(orderData[i][1]).trim() === poNumber) {
          orderSheet.getRange(i + 1, 5).setValue(qty);
          orderSheet.getRange(i + 1, 5).setNumberFormat('0');
          orderSheet.getRange(i + 1, 6).setValue(0);
          orderSheet.getRange(i + 1, 6).setNumberFormat('0');
          orderSheet.getRange(i + 1, 10).setValue('Shipped');
          SpreadsheetApp.flush();
          orderUpdated = true;
          break;
        }
      }
    }

    // ── Write history row (col 8 = Shipment_ID for exact tracking lookup) ──
    if (histSheet) {
      histSheet.appendRow([shipDate, poNumber, item, 'Shipped to ' + customer, qty, shippedBy, 'Shipped', shipId]);
      SpreadsheetApp.flush();
    }

    // ── Save customer ─────────────────────────────────────
    if (customer && data.saveCustomer) {
      try { saveCustomer({ name: customer, address: address, city: '', contact: '' }); } catch(e) {}
    }

    // ── Shipment email ────────────────────────────────────
    try { sendShipmentEmail(shipId, data, tracking, qty, stockResult.available); } catch(e) {
      Logger.log('Shipment email error: ' + e.message);
    }

    return {
      success:          true,
      shipmentId:       shipId,
      orderUpdated:     orderUpdated,
      remainingStock:   stockResult.available
    };

  } catch(err) {
    Logger.log('recordShipment error: ' + err.message);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  HISTORY
// ============================================================

function getHistory() {
  var data = sheetData(CONFIG.SHEETS.HISTORY);
  if (!data.length) return [];
  return data.slice(1).reverse().map(function(r) {
    return {
      date:        fmtDate(r[0]),
      poNumber:    String(r[1] || ''),
      item:        String(r[2] || ''),
      description: String(r[3] || ''),
      quantity:    numVal(r[4]),
      user:        String(r[5] || ''),
      status:      String(r[6] || 'Completed'),
      shipmentId:  String(r[7] || '')   // Shipment_ID → exact lookup in S.shipments
    };
  }).filter(function(r) { return r.item; });
}

// History row for a shipment: the exact Shipment_ID first (written since v3), then the old item + date match.
function _historyFor_(histData, s) {
  var exact = histData.filter(function(h) { return h.shipmentId && h.shipmentId === s.id; })[0];
  return exact || histData.filter(function(h) { return String(h.shipmentId || '').indexOf('SH-') !== 0 && h.item === s.item && h.date === s.date; })[0];
}

// ============================================================
//  CUSTOMERS
// ============================================================

function getCustomers() {
  var data = sheetData(CONFIG.SHEETS.CUSTOMERS);
  if (!data.length) return [];
  return data.slice(1).filter(function(r) { return r[0]; }).map(function(r) {
    return { name: String(r[0] || ''), address: String(r[1] || ''), city: String(r[2] || ''), contact: String(r[3] || '') };
  });
}

function saveCustomer(data) {
  var sheet = ss().getSheetByName(CONFIG.SHEETS.CUSTOMERS);
  if (!sheet) return { success: false };
  var existing = sheet.getDataRange().getValues();
  for (var i = 1; i < existing.length; i++) {
    if (existing[i][0].toString().toLowerCase() === data.name.toLowerCase()) {
      sheet.getRange(i + 1, 2, 1, 3).setValues([[data.address || '', data.city || '', data.contact || '']]);
      SpreadsheetApp.flush();
      return { success: true, action: 'updated' };
    }
  }
  sheet.appendRow([data.name, data.address || '', data.city || '', data.contact || '']);
  SpreadsheetApp.flush();
  return { success: true, action: 'added' };
}

// ============================================================
//  RECEIVING LOG
// ============================================================

function getReceivingLog() {
  var data = sheetData(CONFIG.SHEETS.RECEIVING);
  if (!data.length) return [];
  return data.slice(1).reverse().map(function(r) {
    return {
      id:            String(r[0]  || ''),
      date:          fmtDate(r[1]),
      componentCode: String(r[2]  || ''),
      componentName: String(r[3]  || ''),
      poNumber:      String(r[4]  || ''),
      vendor:        String(r[5]  || ''),
      qtyReceived:   numVal(r[6]),
      unitCost:      numVal(r[7]),
      totalCost:     numVal(r[8]),
      receivedBy:    String(r[9]  || ''),
      notes:         String(r[10] || '')
    };
  }).filter(function(r) { return r.id; });
}

function receiveStock(data) {
  try {
    var qty      = Number(data.qtyReceived) || 0;
    var unitCost = Number(data.unitCost)    || 0;
    var total    = qty * unitCost;
    if (qty <= 0) return { success: false, error: 'Quantity must be > 0' };

    var components = getComponents();
    var comp = components.filter(function(c) { return c.code === data.componentCode; })[0];
    if (!comp) return { success: false, error: 'Component not found: ' + data.componentCode };

    var adj = adjustStock(data.componentCode, qty);
    if (!adj.success) return { success: false, error: 'Failed to update inventory' };

    var sheet = ss().getSheetByName(CONFIG.SHEETS.RECEIVING);
    if (!sheet) { setupAllSheets(); sheet = ss().getSheetByName(CONFIG.SHEETS.RECEIVING); }

    var id = 'RCV-' + Date.now();
    sheet.appendRow([
      id, today(),
      data.componentCode, comp.description,
      data.poNumber   || '',
      data.vendor     || '',
      qty, unitCost, total,
      data.receivedBy || 'Manager',
      data.notes      || ''
    ]);
    SpreadsheetApp.flush();

    return { success: true, id: id, newQty: adj.after, totalCost: total,
             message: 'Received ' + qty + ' of ' + data.componentCode + '. New stock: ' + adj.after };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// ============================================================
//  DASHBOARD
// ============================================================

function getDashboardData() {
  var components   = getComponents();
  var shipments    = getShipments();
  var openOrders   = getOpenOrders();
  var masterStock  = getMasterStock();
  var todayStr     = today();

  var low          = components.filter(function(c) { return c.quantity <= c.criticalThreshold; });
  var warning      = components.filter(function(c) { return c.quantity > c.criticalThreshold && c.quantity <= c.lowThreshold; });
  var todayShips   = shipments.filter(function(s)  { return s.date === todayStr; });
  var activeOrders = openOrders.filter(function(o) { return o.status === 'Open' || o.status === 'Pending'; });

  // Total ready-to-ship across all items
  var totalReadyToShip = masterStock.reduce(function(acc, m) { return acc + m.qtyAvailable; }, 0);

  var weekData = [];
  for (var i = 6; i >= 0; i--) {
    var d  = new Date();
    d.setDate(d.getDate() - i);
    var ds = Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd');
    weekData.push({
      day:   ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()],
      date:  ds,
      count: shipments.filter(function(s) { return s.date === ds; }).length
    });
  }

  var byItem = {};
  shipments.forEach(function(s) {
    if (s.item) byItem[s.item] = (byItem[s.item] || 0) + (s.qtyShipped || 1);
  });

  return {
    totalComponents:  components.length,
    criticalCount:    low.length,
    warningCount:     warning.length,
    healthyCount:     components.length - low.length - warning.length,
    totalShipments:   shipments.length,
    todayShipments:   todayShips.length,
    openOrderCount:   activeOrders.length,
    totalReadyToShip: totalReadyToShip,
    criticalItems:    low,
    warningItems:     warning,
    recentShipments:  shipments.slice(0, 8),
    masterStock:      masterStock,
    weeklyChart:      weekData,
    byItem:           Object.keys(byItem)
                        .map(function(k) { return { item: k, count: byItem[k] }; })
                        .sort(function(a, b) { return b.count - a.count; })
                        .slice(0, 8)
  };
}

// ============================================================
//  FULL PAGE DATA LOADER
// ============================================================

function getFullPageData() {
  function safe(fn) {
    try {
      var r = fn();
      return Array.isArray(r) ? r : (r || null);
    } catch(e) {
      Logger.log('getFullPageData error [' + fn.name + ']: ' + e.message);
      return [];
    }
  }
  return {
    components:     safe(getComponents),
    bomItems:       safe(getBOMItems),
    history:        safe(getHistory),
    openOrders:     safe(getOpenOrders),
    shipments:      safe(getShipments),
    customers:      safe(getCustomers),
    receivingLog:   safe(getReceivingLog),
    masterStock:    safe(getMasterStock),
    productionLog:  safe(getProductionLog),
    buildCapacity:  safe(getBuildCapacity),
    dashboard:      safe(getDashboardData)
  };
}

// ============================================================
//  TRACKING UTILITIES
// ============================================================

function parseTracking(stored) {
  if (!stored || stored === 'N/A') return [];
  return stored.split('|').map(function(s) { return s.trim(); }).filter(Boolean);
}

// LD numbers keep their box position (an empty LD between two filled ones stays empty),
// so box 3's LD never slides up to box 2.
function parseLd_(stored) {
  if (!stored || stored === 'N/A') return [];
  return String(stored).split('|').map(function(s) { return s.trim(); });
}

function fedexURL(num) {
  return 'https://www.fedex.com/fedextrack/?tracknumbers=' + encodeURIComponent(num);
}

// ============================================================
//  EMAIL BUILDING BLOCKS (LWH light theme, Outlook-safe)
// ============================================================

// Red header band with black underline. kicker = small caps line, sub = optional subtitle
function _emailHeader(kicker, title, sub) {
  return '<tr><td style="background:#C41230;padding:20px 24px;border-bottom:4px solid #111111">' +
    '<div style="font-size:10px;color:#FFFFFF;text-transform:uppercase;letter-spacing:2px;margin-bottom:4px;font-weight:700">' + kicker + '</div>' +
    '<div style="font-size:20px;font-weight:700;color:#FFFFFF">' + title + '</div>' +
    (sub ? '<div style="font-size:12px;color:#F6D5DB;margin-top:3px">' + sub + '</div>' : '') +
    '</td></tr>';
}

// Outer page + white container. rows = '<tr>...</tr>' strings
function _emailShell(width, rows) {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
    '<body style="margin:0;padding:0;background:#F4F5F7;font-family:Arial,Helvetica,sans-serif;color:#1A1A1A">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F5F7"><tr><td align="center" style="padding:16px 8px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:' + width + 'px;background:#FFFFFF;border:1px solid #D6D9DE;border-collapse:collapse">' +
    rows +
    '</table></td></tr></table></body></html>';
}

// Label/value detail row
function _detailRow(label, valueHtml, last) {
  return '<tr' + (last ? '' : ' style="border-bottom:1px solid #E3E6EA"') + '>' +
    '<td style="padding:9px 14px;color:#4A4F57;font-size:12px;width:140px;border-bottom:' + (last ? '0' : '1px solid #E3E6EA') + '">' + label + '</td>' +
    '<td style="padding:9px 14px;color:#1A1A1A;border-bottom:' + (last ? '0' : '1px solid #E3E6EA') + '">' + valueHtml + '</td></tr>';
}

// Black header cell for data tables
function _th(label, align) {
  return '<th style="padding:9px 12px;text-align:' + (align || 'left') + ';background:#111111;color:#FFFFFF;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;white-space:nowrap">' + label + '</th>';
}

// Grey footnote box
function _note(html) {
  return '<div style="background:#F4F5F7;border:1px solid #D6D9DE;border-left:4px solid #111111;padding:11px 14px;font-size:11px;color:#4A4F57">' + html + '</div>';
}

// ============================================================
//  EMAIL HELPERS
// ============================================================

function sendProductionEmail(logId, itemCode, description, qty, builtBy, compLog, stockResult) {
  var todayStr = today();
  var body =
    '<tr><td style="padding:20px 24px">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #D6D9DE;margin-bottom:18px">' +
        _detailRow('Item',          '<span style="font-family:monospace;color:#C41230;font-weight:700">' + itemCode + '</span>') +
        _detailRow('Description',   description) +
        _detailRow('Qty Built',     '<span style="color:#157A4F;font-weight:700;font-size:18px">' + qty + '</span>') +
        _detailRow('Now Available', '<span style="color:#111111;font-weight:700;font-size:18px">' + (stockResult ? stockResult.available : '—') + '</span>') +
        _detailRow('Built By',      builtBy, true) +
      '</table>' +
      _note('<strong style="color:#1A1A1A">Components deducted:</strong> ' + (compLog.join(', ') || 'None')) +
    '</td></tr>';

  var html = _emailShell(600,
    _emailHeader('Logistics Warehouse — Production', 'Production Run Recorded', logId + ' | ' + todayStr) + body);

  GmailApp.sendEmail(
    CONFIG.NOTIFY.join(','),
    'Production Run — ' + itemCode + ' x' + qty + ' built — ' + todayStr,
    logId + ': ' + qty + ' of ' + itemCode + ' built by ' + builtBy,
    { htmlBody: html, name: 'BOM Inventory System' }
  );
}

function sendShipmentEmail(shipId, data, tracking, qty, remainingStock) {
  var nums      = parseTracking(tracking);
  var ldNums    = parseLd_(data.ldNumbers || '');
  var todayStr  = today();

  var trackingRows = '';
  if (!nums.length) {
    trackingRows = '<tr><td colspan="3" style="padding:7px 12px;color:#6B7280">No tracking numbers recorded</td></tr>';
  } else {
    nums.forEach(function(n, i) {
      var ld = ldNums[i] || '';
      trackingRows +=
        '<tr>' +
          '<td style="padding:7px 12px;color:#4A4F57;font-family:monospace;font-size:11px;white-space:nowrap;border-bottom:1px solid #E3E6EA">Box ' + (i + 1) + '</td>' +
          '<td style="padding:7px 12px;font-family:monospace;font-size:12px;border-bottom:1px solid #E3E6EA">' +
            '<a href="' + fedexURL(n) + '" style="color:#1F5FA8;text-decoration:none">' + n + ' &#x2197;</a>' +
          '</td>' +
          '<td style="padding:7px 12px;font-family:monospace;font-size:12px;border-bottom:1px solid #E3E6EA;color:' + (ld ? '#7D1935;font-weight:700' : '#9AA0A8') + '">' +
            (ld || '—') +
          '</td>' +
        '</tr>';
    });
  }

  var body =
    '<tr><td style="padding:20px 24px">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #D6D9DE;margin-bottom:18px">' +
        _detailRow('Customer',        '<strong>' + (data.customer || '—') + '</strong>') +
        _detailRow('Address',         data.address || '—') +
        _detailRow('Item',            '<span style="font-family:monospace;color:#C41230;font-weight:700">' + data.item + '</span>') +
        _detailRow('PO Number',       data.poNumber || '—') +
        _detailRow('Qty Shipped',     '<span style="color:#157A4F;font-weight:700;font-size:16px">' + qty + '</span>') +
        _detailRow('Shipped By',      data.shippedBy || '—') +
        _detailRow('Still Available', '<strong>' + (remainingStock !== undefined ? remainingStock + ' built units remaining' : '—') + '</strong>', true) +
      '</table>' +
      '<div style="font-size:11px;color:#4A4F57;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;font-weight:700">FedEx Tracking &amp; LD Numbers — ' + nums.length + ' box' + (nums.length !== 1 ? 'es' : '') + '</div>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #D6D9DE;margin-bottom:18px">' +
        '<thead><tr>' + _th('Box') + _th('FedEx Tracking') + _th('LD Number') + '</tr></thead>' +
        '<tbody>' + trackingRows + '</tbody>' +
      '</table>' +
      _note('No components were deducted at ship time — inventory is managed through production runs.') +
    '</td></tr>';

  var html = _emailShell(600,
    _emailHeader('Logistics Warehouse', 'Shipment Confirmation', shipId + ' | ' + todayStr) + body);

  GmailApp.sendEmail(
    CONFIG.NOTIFY.join(','),
    'FedEx Shipped — ' + data.item + ' x' + qty + ' — ' + (data.customer || ''),
    'Shipment ' + shipId + ' recorded.',
    { htmlBody: html, name: 'BOM Inventory System' }
  );
}

function sendCancellationEmail(poNumber, order) {
  try {
    var now     = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'MMM d, yyyy h:mm a z');
    var subject = 'Order Cancelled — ' + poNumber + (order ? ' — ' + order.itemName : '');
    var rows =
      _detailRow('PO Number', '<strong>' + poNumber + '</strong>') +
      (order ? _detailRow('Customer', order.customer || '—') : '') +
      (order ? _detailRow('Item', '<span style="font-family:monospace;color:#C41230;font-weight:700">' + (order.itemName || '—') + '</span>') : '') +
      _detailRow('Cancelled At', now, true);

    var html = _emailShell(500,
      _emailHeader('Logistics Warehouse', 'Order Cancelled', '') +
      '<tr><td style="padding:20px 24px">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #D6D9DE">' + rows + '</table>' +
      '</td></tr>');

    GmailApp.sendEmail(CONFIG.NOTIFY.join(','), subject, 'Order ' + poNumber + ' cancelled.', { htmlBody: html, name: 'BOM Inventory System' });
  } catch(e) { Logger.log('Cancellation email error: ' + e.message); }
}

// ============================================================
//  REPORTS
// ============================================================

function sendReportNow(email) {
  try {
    var d          = getDashboardData();
    var components = getComponents();
    var todayStr   = today();
    var subject    = (d.criticalCount > 0 ? 'CRITICAL STOCK — ' : '') + 'Daily Inventory Report — ' + todayStr;
    var html       = buildDailyEmailHtml(d, components, todayStr);
    GmailApp.sendEmail(CONFIG.NOTIFY.join(','), subject, 'See HTML report.', { htmlBody: html, name: 'BOM Inventory System' });
    return { success: true };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

function sendDailyReport() { sendReportNow(null); }

function setupDailyTrigger() {
  try {
    ScriptApp.getProjectTriggers().forEach(function(t) {
      if (t.getHandlerFunction() === 'sendDailyReport') ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger('sendDailyReport').timeBased().atHour(8).everyDays(1).create();
    return { success: true, message: 'Daily trigger set for 8:00 AM.' };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

function setupSyncTrigger() {
  try {
    // Remove any existing sync trigger first to avoid duplicates
    ScriptApp.getProjectTriggers().forEach(function(t) {
      if (t.getHandlerFunction() === 'syncTrackingToExternalSheet') ScriptApp.deleteTrigger(t);
    });
    // Runs at 7 AM daily — one hour before the inventory report
    // so the tracking sheet is fresh before anyone checks in the morning
    ScriptApp.newTrigger('syncTrackingToExternalSheet').timeBased().atHour(7).everyDays(1).create();
    return { success: true, message: 'Tracking sync trigger set — runs daily at 7:00 AM CST.' };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

function sendShipmentHistoryReport(email, daysBack) {
  daysBack = daysBack || 30;
  var shipments = getShipments();
  var cutoff    = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  var filtered  = shipments.filter(function(s) {
    return s.timestamp && new Date(s.timestamp) >= cutoff;
  });

  var subject  = 'Shipment History — Last ' + daysBack + ' Days — Logistics Warehouse';
  var todayStr = today();
  var histData = getHistory();

  function getPOForShipment(s) {
    var match = _historyFor_(histData, s);
    return match ? (match.poNumber || '—') : '—';
  }

  var rows = filtered.map(function(s) {
    var nums   = parseTracking(s.tracking  || '');
    var ldNums = parseLd_(s.ldNumbers || '');
    var po     = getPOForShipment(s);
    var trackHtml = '';
    if (!nums.length) {
      trackHtml = '<span style="color:#6B7280">No tracking recorded</span>';
    } else {
      trackHtml = nums.map(function(n, i) {
        var ld = ldNums[i] || '';
        return '<div style="margin-bottom:4px;white-space:nowrap">' +
               '<span style="font-size:10px;color:#6B7280;font-family:monospace;margin-right:6px">Box ' + (i + 1) + '</span>' +
               '<a href="' + fedexURL(n) + '" style="color:#1F5FA8;font-family:monospace;font-size:12px;text-decoration:none">' +
               n + ' &#x2197;</a>' +
               (ld ? '<span style="margin-left:8px;background:#F6E3E7;color:#7D1935;padding:1px 7px;font-family:monospace;font-size:11px;font-weight:700">' + ld + '</span>' : '') +
               '</div>';
      }).join('');
    }
    var td = 'padding:9px 12px;border-bottom:1px solid #E3E6EA;';
    return '<tr>' +
      '<td style="' + td + 'color:#4A4F57;font-size:12px;white-space:nowrap">' + s.date + '</td>' +
      '<td style="' + td + 'font-family:monospace;color:#C41230;font-size:12px;white-space:nowrap;font-weight:700">' + po + '</td>' +
      '<td style="' + td + 'color:#1A1A1A;font-weight:700">' + (s.customer || '—') + '</td>' +
      '<td style="' + td + 'font-family:monospace;color:#1A1A1A;font-size:12px">' + s.item + '</td>' +
      '<td style="' + td + 'color:#157A4F;font-weight:700;text-align:center">' + s.qtyShipped + '</td>' +
      '<td style="' + td + '">' + trackHtml + '</td>' +
      '<td style="' + td + 'color:#4A4F57;font-size:12px">' + (s.shippedBy || '—') + '</td>' +
      '</tr>';
  }).join('');

  var totalQty = filtered.reduce(function(a, s) { return a + s.qtyShipped; }, 0);
  var custs    = {};
  filtered.forEach(function(s) { if (s.customer) custs[s.customer] = 1; });

  var body =
    '<tr><td style="padding:16px 24px">' +
      _kpiStrip([
        kpiBox(filtered.length,           'Shipments',        '#1F5FA8'),
        kpiBox(totalQty,                  'Units Shipped',    '#157A4F'),
        kpiBox(Object.keys(custs).length, 'Unique Customers', '#C41230')
      ]) +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #D6D9DE">' +
      '<thead><tr>' +
      ['Date','PO Number','Customer','Item','Qty','FedEx Tracking','Shipped By'].map(function(h) { return _th(h); }).join('') +
      '</tr></thead><tbody>' +
      (rows || '<tr><td colspan="7" style="padding:24px;text-align:center;color:#6B7280">No shipments in the last ' + daysBack + ' days</td></tr>') +
      '</tbody></table>' +
      '<div style="padding:14px 0 4px;font-size:11px;color:#6B7280;text-align:center">BOM Inventory System — Logistics Warehouse</div>' +
    '</td></tr>';

  var html = _emailShell(750,
    _emailHeader('Logistics Warehouse', 'Shipment History — Last ' + daysBack + ' Days',
                 filtered.length + ' shipment(s) | Generated ' + todayStr) + body);

  GmailApp.sendEmail(CONFIG.NOTIFY.join(','), subject,
    filtered.length + ' shipment(s) in last ' + daysBack + ' days.',
    { htmlBody: html, name: 'BOM Inventory System' });
  return { success: true };
}

// One KPI cell (returns a <td>; wrap with _kpiStrip)
function kpiBox(value, label, color) {
  return '<td width="33%" style="background:#FFFFFF;border:1px solid #D6D9DE;border-top:3px solid #111111;padding:14px;text-align:center">' +
    '<div style="font-size:10px;color:#4A4F57;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;font-weight:700">' + label + '</div>' +
    '<div style="font-size:26px;font-weight:800;color:' + color + '">' + value + '</div>' +
    '</td>';
}

// Row of KPI cells — tables instead of flexbox so Outlook lays it out the same
function _kpiStrip(cells) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="6" border="0" style="border-collapse:separate;margin-bottom:14px"><tr>' +
    cells.join('') + '</tr></table>';
}

function sendOpenOrdersReport(email) {
  var orders = getOpenOrders();
  var active = orders.filter(function(o) { return o.status === 'Open' || o.status === 'Pending'; });
  var subject = 'Open Orders Report — ' + active.length + ' Active — Logistics Warehouse';
  var td = 'padding:8px;border-bottom:1px solid #E3E6EA;color:#1A1A1A;';
  var rows = active.map(function(o) {
    return '<tr><td style="' + td + 'font-family:monospace;color:#C41230;font-weight:700">' + o.poNumber + '</td>' +
           '<td style="' + td + '">' + (o.customer || '—') + '</td>' +
           '<td style="' + td + 'font-family:monospace">' + (o.itemName || '—') + '</td>' +
           '<td style="' + td + 'font-weight:700">' + o.dueQuantity + '</td>' +
           '<td style="' + td + '">' + (o.priorityLevel || 'Normal') + '</td>' +
           '<td style="' + td + '">' + o.status + '</td>' +
           '<td style="' + td + '">' + o.orderDate + '</td></tr>';
  }).join('');
  var html = buildEmailWrapper(subject,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #D6D9DE">' +
    '<thead><tr>' +
    ['PO Number','Customer','Item','Qty','Priority','Status','Date'].map(function(h) { return _th(h); }).join('') +
    '</tr></thead><tbody>' +
    (rows || '<tr><td colspan="7" style="padding:20px;text-align:center;color:#6B7280">No active orders</td></tr>') +
    '</tbody></table>');
  GmailApp.sendEmail(CONFIG.NOTIFY.join(','), subject, active.length + ' active order(s).', { htmlBody: html, name: 'BOM Inventory System' });
  return { success: true };
}

function sendReceivingReport(email, daysBack) {
  daysBack  = daysBack || 30;
  var log   = getReceivingLog();
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  var filtered = log.filter(function(r) { return new Date(r.date) >= cutoff; });
  var subject  = 'Receiving Report — Last ' + daysBack + ' Days — Logistics Warehouse';
  var td = 'padding:8px;border-bottom:1px solid #E3E6EA;color:#1A1A1A;';
  var rows     = filtered.map(function(r) {
    return '<tr><td style="' + td + '">' + r.date + '</td>' +
           '<td style="' + td + 'font-family:monospace;color:#C41230;font-weight:700">' + r.componentCode + '</td>' +
           '<td style="' + td + '">' + (r.poNumber || '—') + '</td>' +
           '<td style="' + td + '">' + (r.vendor || '—') + '</td>' +
           '<td style="' + td + 'color:#157A4F;font-weight:700">+' + r.qtyReceived + '</td>' +
           '<td style="' + td + '">$' + Number(r.totalCost).toFixed(2) + '</td></tr>';
  }).join('');
  var html = buildEmailWrapper(subject,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #D6D9DE">' +
    '<thead><tr>' +
    ['Date','Component','PO #','Vendor','Qty In','Total $'].map(function(h) { return _th(h); }).join('') +
    '</tr></thead><tbody>' +
    (rows || '<tr><td colspan="6" style="padding:20px;text-align:center;color:#6B7280">No receiving records in last ' + daysBack + ' days</td></tr>') +
    '</tbody></table>');
  GmailApp.sendEmail(CONFIG.NOTIFY.join(','), subject, filtered.length + ' receiving event(s).', { htmlBody: html, name: 'BOM Inventory System' });
  return { success: true };
}

function buildEmailWrapper(title, content) {
  return _emailShell(700,
    _emailHeader('Logistics Warehouse', title, '') +
    '<tr><td style="padding:16px 22px">' + content + '</td></tr>');
}

function buildDailyEmailHtml(d, components, todayStr) {
  var critical = components.filter(function(c) { return c.quantity <= c.criticalThreshold; });
  var warning  = components.filter(function(c) { return c.quantity > c.criticalThreshold && c.quantity <= c.lowThreshold; });
  var healthy  = components.filter(function(c) { return c.quantity > c.lowThreshold; });

  var td = 'padding:8px 12px;border-bottom:1px solid #E3E6EA;';

  // Master stock section
  var ms = d.masterStock || [];
  var msRows = ms.map(function(m) {
    var avColor = m.qtyAvailable === 0 ? '#B00020' : m.qtyAvailable < 5 ? '#B86E00' : '#157A4F';
    return '<tr>' +
      '<td style="' + td + 'font-family:monospace;color:#C41230;font-weight:700">' + m.itemCode + '</td>' +
      '<td style="' + td + 'color:#4A4F57;font-size:12px">' + m.description.substring(0, 40) + '</td>' +
      '<td style="' + td + 'text-align:center;color:#4A4F57">' + m.qtyBuilt + '</td>' +
      '<td style="' + td + 'text-align:center;color:#4A4F57">' + m.qtyShipped + '</td>' +
      '<td style="' + td + 'text-align:center;color:' + avColor + ';font-weight:700;font-size:15px">' + m.qtyAvailable + '</td>' +
      '</tr>';
  }).join('');

  function itemRow(item, color) {
    return '<tr>' +
      '<td style="' + td + 'font-family:monospace;color:#C41230;font-weight:700">' + item.code + '</td>' +
      '<td style="' + td + 'color:#4A4F57;font-size:12px">' + item.description + '</td>' +
      '<td style="' + td + 'color:' + color + ';font-weight:700;text-align:center">' + item.quantity + '</td>' +
      '<td style="' + td + 'color:#6B7280;text-align:center">' + item.criticalThreshold + '</td></tr>';
  }

  function section(title, color, rows) {
    if (!rows) return '';
    return '<div style="margin-bottom:18px">' +
      '<div style="font-size:11px;color:' + color + ';text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;font-weight:700;border-left:4px solid ' + color + ';padding-left:8px">' + title + '</div>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #D6D9DE">' +
      '<thead><tr>' + _th('Code') + _th('Description') + _th('On Hand', 'center') + _th('Threshold', 'center') + '</tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  function dailyKpi(value, label, color) {
    return '<td width="25%" style="background:#FFFFFF;border:1px solid #D6D9DE;border-top:3px solid ' + color + ';padding:12px;text-align:center">' +
      '<div style="font-size:10px;color:#4A4F57;text-transform:uppercase;margin-bottom:4px;font-weight:700">' + label + '</div>' +
      '<div style="font-size:26px;font-weight:800;color:' + color + '">' + value + '</div></td>';
  }

  return buildEmailWrapper('Daily Inventory Report — ' + todayStr,

    // KPI strip
    _kpiStrip([
      dailyKpi(critical.length,             'Critical',      '#B00020'),
      dailyKpi(warning.length,              'Warning',       '#B86E00'),
      dailyKpi(healthy.length,              'Healthy',       '#157A4F'),
      dailyKpi(d.totalReadyToShip || 0,     'Ready to Ship', '#111111')
    ]) +

    // Master stock table
    (ms.length ? (
      '<div style="font-size:11px;color:#111111;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;font-weight:700;border-left:4px solid #C41230;padding-left:8px">Master Stock — Built Units Ready to Ship</div>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #D6D9DE;margin-bottom:18px">' +
      '<thead><tr>' + _th('Item') + _th('Description') + _th('Total Built', 'center') + _th('Shipped', 'center') + _th('Available', 'center') + '</tr></thead>' +
      '<tbody>' + msRows + '</tbody></table>'
    ) : '') +

    section('Critical Stock — Order Immediately', '#B00020', critical.map(function(i) { return itemRow(i, '#B00020'); }).join('')) +
    section('Low Stock — Reorder Soon', '#B86E00', warning.map(function(i) { return itemRow(i, '#B86E00'); }).join('')) +
    section('Healthy Stock', '#157A4F', healthy.map(function(i) { return itemRow(i, '#157A4F'); }).join(''))
  );
}

function getShipmentHistoryHTML(daysBack) {
  daysBack  = daysBack || 30;
  var shipments = getShipments();
  var cutoff    = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  var filtered  = shipments.filter(function(s) {
    return s.timestamp && new Date(s.timestamp) >= cutoff;
  });

  var histData = getHistory();
  var todayStr = today();

  function getPOForShipment(s) {
    var match = _historyFor_(histData, s);
    return match ? (match.poNumber || '—') : '—';
  }

  var totalQty = filtered.reduce(function(a, s) { return a + s.qtyShipped; }, 0);
  var custs    = {};
  filtered.forEach(function(s) { if (s.customer) custs[s.customer] = 1; });

  var rows = filtered.map(function(s, idx) {
    var nums   = parseTracking(s.tracking  || '');
    var ldNums = parseLd_(s.ldNumbers || '');
    var po     = getPOForShipment(s);
    var trackText = nums.length
      ? nums.map(function(n, i) {
          var ld = ldNums[i] || '';
          return 'Box ' + (i + 1) + ': ' + n + (ld ? '  [LD: ' + ld + ']' : '');
        }).join('\n')
      : 'No tracking';
    var bg = idx % 2 === 0 ? '#ffffff' : '#f7f7f8';
    return '<tr style="background:' + bg + ';page-break-inside:avoid">' +
      '<td style="padding:8px 10px;border:1px solid #ddd;white-space:nowrap">' + s.date + '</td>' +
      '<td style="padding:8px 10px;border:1px solid #ddd;font-weight:700;color:#C41230">' + po + '</td>' +
      '<td style="padding:8px 10px;border:1px solid #ddd;font-weight:700">' + (s.customer || '—') + '</td>' +
      '<td style="padding:8px 10px;border:1px solid #ddd;font-family:monospace;font-size:11px">' + s.item + '</td>' +
      '<td style="padding:8px 10px;border:1px solid #ddd;text-align:center;font-weight:700">' + s.qtyShipped + '</td>' +
      '<td style="padding:8px 10px;border:1px solid #ddd;font-family:monospace;font-size:10px;white-space:pre-line">' + trackText + '</td>' +
      '<td style="padding:8px 10px;border:1px solid #ddd">' + (s.shippedBy || '—') + '</td>' +
      '</tr>';
  }).join('');

  return '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<title>Shipment History — Logistics Warehouse</title>' +
    '<style>' +
      'body{font-family:"Segoe UI",Arial,sans-serif;color:#111;background:#fff;margin:0;padding:0}' +
      '.page{max-width:960px;margin:0 auto;padding:30px 36px}' +
      '.header{border-bottom:4px solid #C41230;padding-bottom:14px;margin-bottom:20px}' +
      '.company{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#C41230;margin-bottom:4px}' +
      '.title{font-size:26px;font-weight:700;color:#111;margin-bottom:3px}' +
      '.subtitle{font-size:12px;color:#555}' +
      '.kpi-row{display:flex;gap:16px;margin-bottom:22px}' +
      '.kpi{flex:1;border:1px solid #ddd;border-top:3px solid #111;padding:12px 16px;text-align:center}' +
      '.kpi-val{font-size:28px;font-weight:800;color:#111;line-height:1}' +
      '.kpi-lbl{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#777;margin-top:4px}' +
      'table{width:100%;border-collapse:collapse;font-size:12px}' +
      'thead th{background:#111;color:#fff;padding:9px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.8px;border:1px solid #111}' +
      'tfoot td{border-top:2px solid #111;padding:8px 10px;font-size:11px;color:#555}' +
      '.print-btn{position:fixed;top:20px;right:20px;background:#C41230;color:#fff;border:none;padding:10px 20px;font-size:13px;font-weight:700;cursor:pointer;border-radius:0;font-family:inherit}' +
      '.print-btn:hover{background:#A30F28}' +
      '.footer{margin-top:24px;padding-top:12px;border-top:1px solid #ddd;font-size:10px;color:#999;display:flex;justify-content:space-between}' +
      '@media print{.print-btn{display:none}thead th{background:#111 !important;color:#fff !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.header{-webkit-print-color-adjust:exact;print-color-adjust:exact}tr{page-break-inside:avoid}}' +
    '</style></head><body>' +
    '<button class="print-btn" onclick="window.print()">Print / Save PDF</button>' +
    '<div class="page">' +
    '<div class="header">' +
      '<div class="company">Logistics Warehouse — Fort Smith, AR</div>' +
      '<div class="title">Shipment History Log</div>' +
      '<div class="subtitle">Period: Last ' + daysBack + ' days | Generated: ' + todayStr + ' | ' + filtered.length + ' shipment(s)</div>' +
    '</div>' +
    '<div class="kpi-row">' +
      '<div class="kpi"><div class="kpi-val">' + filtered.length + '</div><div class="kpi-lbl">Total Shipments</div></div>' +
      '<div class="kpi"><div class="kpi-val">' + totalQty + '</div><div class="kpi-lbl">Units Shipped</div></div>' +
      '<div class="kpi"><div class="kpi-val">' + Object.keys(custs).length + '</div><div class="kpi-lbl">Unique Customers</div></div>' +
    '</div>' +
    '<table><thead><tr>' +
    '<th style="width:90px">Date</th><th style="width:110px">PO Number</th><th>Customer</th>' +
    '<th style="width:130px">Item</th><th style="width:45px;text-align:center">Qty</th>' +
    '<th>FedEx Tracking</th><th style="width:100px">Shipped By</th>' +
    '</tr></thead><tbody>' +
    (rows || '<tr><td colspan="7" style="padding:20px;text-align:center;color:#999">No shipments in the last ' + daysBack + ' days</td></tr>') +
    '</tbody><tfoot><tr>' +
    '<td colspan="4" style="border:1px solid #ddd;padding:8px 10px"><strong>TOTAL</strong></td>' +
    '<td style="border:1px solid #ddd;padding:8px 10px;text-align:center;font-weight:700">' + totalQty + '</td>' +
    '<td colspan="2" style="border:1px solid #ddd;padding:8px 10px;color:#555">' + filtered.length + ' shipment(s) in period</td>' +
    '</tr></tfoot></table>' +
    '<div class="footer"><span>Logistics Warehouse — BOM Inventory System</span><span>Printed: ' + todayStr + '</span></div>' +
    '</div>' +
    '<script>window.onload=function(){document.title="Shipment Log ' + todayStr + '";};<\/script>' +
    '</body></html>';
}

// ============================================================
//  LOW STOCK ALERT
// ============================================================

function sendLowStockAlert(affectedComponents, shipmentContext) {
  try {
    var critical = affectedComponents.filter(function(c) { return c.crossedCritical; });
    var warning  = affectedComponents.filter(function(c) { return c.crossedWarning && !c.crossedCritical; });
    if (!critical.length && !warning.length) return;

    var subject = critical.length
      ? 'CRITICAL STOCK ALERT — ' + critical.map(function(c) { return c.code; }).join(', ')
      : 'Low Stock Alert — ' + warning.map(function(c) { return c.code; }).join(', ');

    var td = 'padding:10px 14px;border-bottom:1px solid #E3E6EA;';

    function compRows(list) {
      return list.map(function(c) {
        var atRisk = (c.openOrdersAffected || []).map(function(o) {
          return o.poNumber + ' (' + o.customer + ', needs ' + o.required + ')';
        }).join('<br>');
        return '<tr>' +
          '<td style="' + td + 'font-family:monospace;font-size:13px;color:#C41230;font-weight:700">' + c.code + '</td>' +
          '<td style="' + td + 'color:#4A4F57;font-size:12px">' + c.description + '</td>' +
          '<td style="' + td + 'text-align:center;font-size:20px;font-weight:800;color:' + (c.crossedCritical ? '#B00020' : '#B86E00') + '">' + c.newQty + '</td>' +
          '<td style="' + td + 'text-align:center;color:#6B7280">' + c.criticalThreshold + '</td>' +
          '<td style="' + td + 'font-size:11px;color:' + (atRisk ? '#B00020' : '#157A4F') + '">' + (atRisk || 'None pending') + '</td>' +
          '</tr>';
      }).join('');
    }

    function alertTable(title, color, list) {
      return '<div style="font-size:10px;font-weight:700;color:' + color + ';text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px;border-left:4px solid ' + color + ';padding-left:8px">' + title + '</div>' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #D6D9DE;margin-bottom:20px">' +
        '<thead><tr>' + _th('Component') + _th('Description') + _th('On Hand', 'center') + _th('Threshold', 'center') + _th('Build Runs At Risk') + '</tr></thead>' +
        '<tbody>' + compRows(list) + '</tbody></table>';
    }

    var hdrTitle = critical.length ? 'Critical Stock Alert' : 'Low Stock Warning';
    var hdrSub   = 'Triggered by production run ' + shipmentContext.shipmentId + ' — ' + shipmentContext.item + ' x' + shipmentContext.qty + ' — ' + shipmentContext.date;

    var html = _emailShell(680,
      _emailHeader('Logistics Warehouse — Inventory Alert', hdrTitle, hdrSub) +
      '<tr><td style="padding:20px 24px">' +
        (critical.length ? alertTable('Critical — Order Immediately', '#B00020', critical) : '') +
        (warning.length  ? alertTable('Low Stock — Reorder Soon',     '#B86E00', warning)  : '') +
        _note('This alert fired after a production run deducted components. The daily 8 AM report will also reflect these levels.') +
      '</td></tr>');

    GmailApp.sendEmail(CONFIG.NOTIFY.join(','), subject,
      (critical.length ? 'CRITICAL: ' : 'Low stock: ') +
      affectedComponents.map(function(c) { return c.code + ' (' + c.newQty + ' left)'; }).join(', '),
      { htmlBody: html, name: 'BOM Inventory System' });

  } catch(e) {
    Logger.log('sendLowStockAlert error: ' + e.message);
  }
}

// ============================================================
//  WEEKLY CUSTOMER SHIPMENT REPORT
//  Auto-fires Saturday 6 PM CST via setupWeeklyTrigger()
//  Also callable manually from Reports tab or menu.
// ============================================================

function sendWeeklyCustomerReport() {
  return _buildAndSendWeeklyReport(null);
}

function sendWeeklyCustomerReportToEmails(emailsCsv) {
  return _buildAndSendWeeklyReport(emailsCsv);
}

function _buildAndSendWeeklyReport(emailOverride) {
  try {
    var now       = new Date();
    var tz        = CONFIG.TIMEZONE;

    // Week window: previous Sunday 00:00 through today end-of-day
    // For a Saturday send this captures the full Mon–Sat work week
    var dayOfWeek = now.getDay(); // 0=Sun, 6=Sat
    var weekStart = new Date(now);
    weekStart.setDate(now.getDate() - dayOfWeek); // back to Sunday
    weekStart.setHours(0, 0, 0, 0);
    var weekEnd = new Date(now);
    weekEnd.setHours(23, 59, 59, 999);

    var weekStartStr = Utilities.formatDate(weekStart, tz, 'yyyy-MM-dd');
    var weekEndStr   = Utilities.formatDate(weekEnd,   tz, 'yyyy-MM-dd');
    var weekLabel    = Utilities.formatDate(weekStart, tz, 'MMM d') + ' – ' +
                       Utilities.formatDate(weekEnd,   tz, 'MMM d, yyyy');

    // Filter shipments to this week
    var allShipments = getShipments().reverse(); // chronological order
    var shipments    = allShipments.filter(function(s) {
      return s.date >= weekStartStr && s.date <= weekEndStr;
    });

    // Build CSV
    var csv = _buildWeeklyCSV(shipments, weekLabel);

    // Build HTML email
    var html = _buildWeeklyEmailHtml(shipments, weekLabel, weekStartStr, weekEndStr);

    // Recipients
    var toList = emailOverride
      ? emailOverride.split(',').map(function(e) { return e.trim(); }).filter(Boolean)
      : CONFIG.CUSTOMER_NOTIFY;

    var subject = 'Weekly Shipment Report — ' + weekLabel + ' — Logistics Warehouse';

    var csvBlob = Utilities.newBlob(csv, 'text/csv', 'shipments_' + weekStartStr + '_to_' + weekEndStr + '.csv');

    GmailApp.sendEmail(
      toList.join(','),
      subject,
      shipments.length + ' shipment(s) this week. See attached CSV for full detail.',
      {
        htmlBody:    html,
        attachments: [csvBlob],
        name:        'Logistics Warehouse — BOM Inventory System',
        cc:          CONFIG.NOTIFY.join(',')
      }
    );

    Logger.log('Weekly report sent to: ' + toList.join(', '));
    return { success: true, shipmentCount: shipments.length, week: weekLabel };

  } catch(err) {
    Logger.log('sendWeeklyCustomerReport error: ' + err.message);
    return { success: false, error: err.message };
  }
}

function _buildWeeklyCSV(shipments, weekLabel) {
  var rows = [];
  // Header
  rows.push([
    'Shipment_ID', 'Date', 'PO_Number', 'Customer', 'Address',
    'Item', 'Qty_Shipped', 'Shipped_By', 'Notes',
    'Box_1_FedEx', 'Box_1_LD',
    'Box_2_FedEx', 'Box_2_LD',
    'Box_3_FedEx', 'Box_3_LD',
    'Box_4_FedEx', 'Box_4_LD',
    'Box_5_FedEx', 'Box_5_LD',
    'Box_6_FedEx', 'Box_6_LD',
    'Box_7_FedEx', 'Box_7_LD',
    'Box_8_FedEx', 'Box_8_LD',
    'Box_9_FedEx', 'Box_9_LD',
    'Box_10_FedEx','Box_10_LD'
  ].map(_csvCell).join(','));

  // Match PO numbers from history
  var histData = getHistory();
  function getPO(s) {
    var h = _historyFor_(histData, s);
    return h ? (h.poNumber || '') : '';
  }

  shipments.forEach(function(s) {
    var tNums  = parseTracking(s.tracking  || '');
    var ldNums = parseLd_(s.ldNumbers || '');
    var boxCols = [];
    for (var b = 0; b < 10; b++) {
      boxCols.push(_csvCell(tNums[b]  || ''));
      boxCols.push(_csvCell(ldNums[b] || ''));
    }
    rows.push([
      _csvCell(s.id),
      _csvCell(s.date),
      _csvCell(getPO(s)),
      _csvCell(s.customer),
      _csvCell(s.address),
      _csvCell(s.item),
      _csvCell(String(s.qtyShipped)),
      _csvCell(s.shippedBy),
      _csvCell(s.notes)
    ].concat(boxCols).join(','));
  });

  return rows.join('\r\n');
}

function _csvCell(val) {
  val = String(val || '').replace(/"/g, '""');
  return '"' + val + '"';
}

function _buildWeeklyEmailHtml(shipments, weekLabel, weekStartStr, weekEndStr) {
  var tz = CONFIG.TIMEZONE;

  // KPI totals
  var totalQty   = shipments.reduce(function(a, s) { return a + s.qtyShipped; }, 0);
  var customers  = {};
  var items      = {};
  shipments.forEach(function(s) {
    if (s.customer) customers[s.customer] = 1;
    if (s.item)     items[s.item]         = (items[s.item] || 0) + s.qtyShipped;
  });
  var custCount = Object.keys(customers).length;

  // Item summary rows
  var itemSummaryRows = Object.keys(items).map(function(item) {
    return '<tr>' +
      '<td style="padding:8px 12px;font-family:monospace;font-weight:700;color:#C41230;border-bottom:1px solid #E3E6EA">' + item + '</td>' +
      '<td style="padding:8px 12px;text-align:center;font-weight:800;font-size:16px;border-bottom:1px solid #E3E6EA">' + items[item] + '</td>' +
    '</tr>';
  }).join('');

  // History for PO lookup
  var histData = getHistory();
  function getPO(s) {
    var h = _historyFor_(histData, s);
    return h ? (h.poNumber || '—') : '—';
  }

  // Shipment detail rows
  var detailRows = shipments.map(function(s, idx) {
    var tNums  = parseTracking(s.tracking  || '');
    var ldNums = parseLd_(s.ldNumbers || '');
    var bg     = idx % 2 === 0 ? '#ffffff' : '#f7f7f8';
    var trkHtml = tNums.length
      ? tNums.map(function(n, i) {
          var ld = ldNums[i] || '';
          return '<div style="margin-bottom:4px;font-family:monospace;font-size:11px">' +
            '<span style="color:#6B7280;font-size:9px;margin-right:5px">Box ' + (i + 1) + '</span>' +
            '<a href="https://www.fedex.com/fedextrack/?tracknumbers=' + encodeURIComponent(n) +
            '" style="color:#1F5FA8;text-decoration:none">' + n + ' ↗</a>' +
            (ld ? '<span style="margin-left:8px;background:#F6E3E7;color:#7D1935;padding:1px 6px;font-size:10px;font-weight:700">' + ld + '</span>' : '') +
            '</div>';
        }).join('')
      : '<span style="color:#9AA0A8;font-size:11px">No tracking</span>';

    var cell = 'padding:9px 12px;border:1px solid #E3E6EA;';
    return '<tr style="background:' + bg + ';page-break-inside:avoid">' +
      '<td style="' + cell + 'white-space:nowrap;font-size:12px">' + s.date + '</td>' +
      '<td style="' + cell + 'font-weight:700;font-family:monospace;font-size:12px;color:#C41230">' + getPO(s) + '</td>' +
      '<td style="' + cell + 'font-weight:700">' + (s.customer || '—') + '</td>' +
      '<td style="' + cell + 'font-family:monospace;font-size:11px">' + s.item + '</td>' +
      '<td style="' + cell + 'text-align:center;font-weight:800;font-size:15px">' + s.qtyShipped + '</td>' +
      '<td style="' + cell + 'min-width:260px">' + trkHtml + '</td>' +
      '<td style="' + cell + 'font-size:11px;color:#4A4F57">' + (s.shippedBy || '—') + '</td>' +
    '</tr>';
  }).join('');

  var genTime = Utilities.formatDate(new Date(), tz, 'MMM d, yyyy h:mm a z');

  var sectionLbl = function(t) {
    return '<div style="font-size:10px;font-weight:800;color:#111111;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px;border-left:4px solid #C41230;padding-left:8px">' + t + '</div>';
  };

  return _emailShell(800,
    // Header
    _emailHeader('Logistics Warehouse — Fort Smith, AR', 'Weekly Shipment Report', weekLabel) +

    // KPI strip
    '<tr><td style="padding:14px 18px 0">' +
      _kpiStrip([
        _weekKpi(shipments.length, 'Total Shipments',  '#1F5FA8'),
        _weekKpi(totalQty,         'Total Units Sent', '#157A4F'),
        _weekKpi(custCount,        'Customers Served', '#C41230')
      ]) +
    '</td></tr>' +

    // Item summary
    (Object.keys(items).length
      ? '<tr><td style="padding:4px 24px 0">' +
          sectionLbl('Units Shipped by Item') +
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #D6D9DE;margin-bottom:20px">' +
            '<thead><tr>' + _th('Item') + _th('Qty', 'center') + '</tr></thead>' +
            '<tbody>' + itemSummaryRows + '</tbody>' +
          '</table>' +
        '</td></tr>'
      : '') +

    // Shipment detail table
    '<tr><td style="padding:0 24px 20px">' +
      sectionLbl('Shipment Detail — FedEx &amp; LD Numbers') +
      (shipments.length
        ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px;border:1px solid #D6D9DE">' +
            '<thead><tr>' +
              _th('Date') + _th('PO Number') + _th('Customer') + _th('Item') + _th('Qty', 'center') +
              _th('FedEx Tracking / LD Number') + _th('Shipped By') +
            '</tr></thead>' +
            '<tbody>' + detailRows + '</tbody>' +
          '</table>'
        : '<p style="color:#9AA0A8;text-align:center;padding:30px 0">No shipments recorded this week.</p>'
      ) +
    '</td></tr>' +

    // Footer
    '<tr><td style="background:#F4F5F7;border-top:1px solid #D6D9DE;padding:14px 24px">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
        '<td style="font-size:10px;color:#6B7280">Logistics Warehouse — BOM Inventory System</td>' +
        '<td align="right" style="font-size:10px;color:#6B7280">Generated: ' + genTime + '</td>' +
      '</tr></table>' +
    '</td></tr>'
  );
}

function _weekKpi(value, label, color) {
  return '<td width="33%" style="background:#FFFFFF;border:1px solid #D6D9DE;border-top:3px solid #111111;padding:16px 20px;text-align:center">' +
    '<div style="font-size:28px;font-weight:800;color:' + color + ';line-height:1">' + value + '</div>' +
    '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#4A4F57;margin-top:5px;font-weight:700">' + label + '</div>' +
  '</td>';
}

function setupWeeklyTrigger() {
  try {
    ScriptApp.getProjectTriggers().forEach(function(t) {
      if (t.getHandlerFunction() === 'sendWeeklyCustomerReport') ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger('sendWeeklyCustomerReport')
      .timeBased()
      .onWeekDay(ScriptApp.WeekDay.SATURDAY)
      .atHour(18) // 6 PM CST
      .create();
    return { success: true, message: 'Weekly trigger set — Saturdays at 6:00 PM CST.' };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

// ============================================================
//  EXTERNAL TRACKING SHEET SYNC
//  Writes one row per box to the Battery Box Shipment Tracking
//  spreadsheet:
//    Col A — FedEx Tracking (clickable hyperlink)
//    Col B — LD Number
//    Col C — Dealer Name (manual, never touched)
//    Col D — Date Shipped
//  Safe to re-run anytime — skips tracking numbers already present.
// ============================================================

function syncTrackingToExternalSheet() {
  try {
    var extSS    = SpreadsheetApp.openById(CONFIG.TRACKING_SHEET_ID);
    var extSheet = extSS.getSheets()[0]; // Sheet1

    // ── Build set of tracking numbers already in the sheet ──
    // Col A may be plain text (old rows) or a HYPERLINK formula — extract the number either way
    var lastRow  = extSheet.getLastRow();
    var existing = {};
    if (lastRow >= 2) {
      var existingData = extSheet.getRange(2, 1, lastRow - 1, 1).getValues();
      existingData.forEach(function(r) {
        var val = String(r[0] || '').trim();
        if (!val) return;
        // getValues() on a HYPERLINK formula returns the display text, so this just works
        existing[val] = true;
      });
    }

    // ── Gather all shipments, oldest first ──────────────────
    var shipments = getShipments().slice().reverse(); // chronological

    // ── Build rows to append ────────────────────────────────
    var toAppend = [];
    shipments.forEach(function(s) {
      var tNums  = parseTracking(s.tracking  || '');
      var ldNums = parseLd_(s.ldNumbers || '');
      tNums.forEach(function(trk, i) {
        trk = trk.trim();
        if (!trk)            return; // skip blank
        if (existing[trk])   return; // skip already written
        var ld      = (ldNums[i] || '').trim();
        var formula = '=HYPERLINK("https://www.fedex.com/fedextrack/?tracknumbers=' + trk + '","' + trk + '")';
        toAppend.push([formula, ld, '', s.date]); // col C blank — dealer adds manually; col D = ship date
        existing[trk] = true;         // prevent dupes within this run
      });
    });

    if (!toAppend.length) {
      Logger.log('syncTrackingToExternalSheet: nothing new to write.');
      return { success: true, written: 0, message: 'Sheet is already up to date — no new tracking numbers found.' };
    }

    // ── Append all new rows — col A as hyperlink formulas, B/C/D as values ──
    var startRow  = lastRow + 1;
    var numNew    = toAppend.length;
    var formulas  = toAppend.map(function(r) { return [r[0]]; });          // col A: =HYPERLINK(...)
    var plainVals = toAppend.map(function(r) { return [r[1], r[2], r[3]]; }); // col B, C, D

    extSheet.getRange(startRow, 1, numNew, 1).setFormulas(formulas);
    extSheet.getRange(startRow, 2, numNew, 3).setValues(plainVals);

    // ── Format: monospace col A & B, blue link on col A, date style on col D ──
    var newRange = extSheet.getRange(startRow, 1, numNew, 2);
    newRange.setHorizontalAlignment('left');
    newRange.setFontFamily('Courier New');
    newRange.setFontSize(10);
    extSheet.getRange(startRow, 1, numNew, 1).setFontColor('#1155CC'); // Google Sheets link blue
    extSheet.getRange(startRow, 4, numNew, 1)                          // col D — date
      .setHorizontalAlignment('center')
      .setFontFamily('Arial')
      .setFontSize(10)
      .setNumberFormat('yyyy-mm-dd');

    SpreadsheetApp.flush();

    var msg = 'Sync complete — ' + toAppend.length + ' tracking row' + (toAppend.length !== 1 ? 's' : '') + ' written.';
    Logger.log(msg);
    return { success: true, written: toAppend.length, message: msg };

  } catch(err) {
    Logger.log('syncTrackingToExternalSheet error: ' + err.message);
    return { success: false, error: err.message };
  }
}

// ============================================================
//  SHEET MENU (onOpen)
// ============================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Inventory System')
    .addItem('Send Daily Report Now',            'sendDailyReport')
    .addItem('Send Weekly Customer Report Now',   'sendWeeklyCustomerReport')
    .addSeparator()
    .addItem('Sync Tracking to External Sheet',        'syncTrackingToExternalSheet')
    .addItem('Setup Daily Sync Trigger (7 AM)',         'setupSyncTrigger')
    .addSeparator()
    .addItem('Setup Daily Trigger (8 AM)',         'setupDailyTrigger')
    .addItem('Setup Weekly Trigger (Sat 6 PM)',    'setupWeeklyTrigger')
    .addSeparator()
    .addItem('Setup All Sheets',                  'setupAllSheets')
    .addItem('Fix Inventory Number Format',        'formatInventorySheet')
    .addItem('Backfill History Shipment IDs',      'backfillHistoryShipmentIds')
    .addItem('Send Test Emails (Theme Preview)',   'sendThemePreviewEmails')
    .addToUi();
}

// ============================================================
//  THEME PREVIEW — sends sample copies of each email to the
//  person running it only (Session user). No sheet writes.
//  Run once after deploying to eyeball the new look.
// ============================================================

function sendThemePreviewEmails() {
  var me = Session.getActiveUser().getEmail();
  var d  = getDashboardData();
  var comps = getComponents();
  var t  = today();
  GmailApp.sendEmail(me, '[PREVIEW] Daily Inventory Report — ' + t, 'Preview',
    { htmlBody: buildDailyEmailHtml(d, comps, t), name: 'BOM Inventory System' });

  var weekShips = getShipments().slice(0, 5).reverse();
  GmailApp.sendEmail(me, '[PREVIEW] Weekly Shipment Report', 'Preview',
    { htmlBody: _buildWeeklyEmailHtml(weekShips, 'Preview Week', t, t), name: 'BOM Inventory System' });
  Logger.log('Theme preview emails sent to ' + me);
}

// ============================================================
//  ONE-TIME BACKFILL — run once from editor or menu
//  Matches Production_History rows to Shipments by date+item
//  and writes the Shipment_ID into col 8 of History.
// ============================================================

function backfillHistoryShipmentIds() {
  SpreadsheetApp.flush();
  var spreadsheet = ss();
  var histSheet   = spreadsheet.getSheetByName(CONFIG.SHEETS.HISTORY);
  var shipSheet   = spreadsheet.getSheetByName(CONFIG.SHEETS.SHIPMENTS);
  if (!histSheet || !shipSheet) {
    Logger.log('Backfill: sheet not found');
    return { success: false, error: 'Sheet not found' };
  }

  var histData = histSheet.getDataRange().getValues();
  var shipData = shipSheet.getDataRange().getValues();

  // Build map from Shipments sheet indexed by date+item, preserving insertion order
  // so each is consumed only once (FIFO per date+item bucket).
  var buckets = {}; // key: "date|item" → array of shipment IDs in order
  for (var s = 1; s < shipData.length; s++) {
    var sId   = String(shipData[s][0] || '').trim();
    var sDate = fmtDate(shipData[s][1]);
    var sItem = String(shipData[s][4] || '').trim();
    if (!sId || !sDate || !sItem) continue;
    var key = sDate + '|' + sItem;
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(sId);
  }
  // Reverse each bucket so we can pop() in chronological order
  Object.keys(buckets).forEach(function(k) { buckets[k].reverse(); });

  // Track which bucket positions we've consumed per History row
  var consumed = {}; // key → index already handed out

  var updated = 0;
  for (var h = 1; h < histData.length; h++) {
    var existingId = String(histData[h][7] || '').trim();
    // Skip if already looks like a Shipment_ID
    if (existingId.indexOf('SH-') === 0) continue;

    var hDate = fmtDate(histData[h][0]);
    var hItem = String(histData[h][2] || '').trim();
    var key   = hDate + '|' + hItem;

    if (!buckets[key] || !buckets[key].length) continue;

    if (!consumed[key]) consumed[key] = 0;
    var idx = consumed[key];
    if (idx >= buckets[key].length) continue;

    var assignId = buckets[key][buckets[key].length - 1 - idx];
    consumed[key]++;

    histSheet.getRange(h + 1, 8).setValue(assignId);
    updated++;
  }

  SpreadsheetApp.flush();
  Logger.log('Backfill complete. Updated ' + updated + ' history rows.');
  SpreadsheetApp.getUi().alert('Backfill complete — ' + updated + ' history rows updated with Shipment IDs.');
  return { success: true, updated: updated };
}
// =========================================================================================
// TOOLKIT API  (Warehouse Toolkit → Battery Box & BOM)
// Everything below is new. It calls the same functions above that the old web page called.
// =========================================================================================
var TOOLKIT_API_VERSION = '1.89.0';
var API_SERVICE_NAME = 'LWH Battery Box BOM API';
var ACCESS_TAB = 'Access';
var STOCK_LOG_TAB = 'Stock_Log';
var SUPA_URL_DEFAULT = 'https://tjivcqxnkftujceumdtx.supabase.co';
var SUPA_KEY_DEFAULT = 'sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';

function doGet(e) {
  if (e && e.parameter && e.parameter.health) {
    return json_({ ok: true, service: API_SERVICE_NAME, version: TOOLKIT_API_VERSION });
  }
  var url = toolkitUrl_() + '?view=batteryBox';
  return HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,sans-serif;max-width:520px;margin:60px auto;text-align:center">' +
    '<div style="border:1px solid #D6D9DE;border-top:5px solid #C41230;padding:24px">' +
    '<h2 style="margin:0 0 8px">This page has moved</h2>' +
    '<p>Battery box builds, master stock, components, open orders and shipments are now in the <b>Warehouse Toolkit &rarr; Battery Box &amp; BOM</b>.</p>' +
    '<p><a href="' + url + '" target="_top" style="display:inline-block;background:#C41230;color:#fff;padding:12px 20px;text-decoration:none;font-weight:bold">Open Battery Box &amp; BOM</a></p></div></div>'
  ).setTitle('Moved to the Warehouse Toolkit').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'bad_request' }); }
  var lock = null;
  try {
    var who = auth_(body.token);
    var route = API_ROUTES[body.action];
    if (!route) return json_({ ok: false, error: 'unknown_action' });
    if (route.write) {
      if (who.role !== 'edit') throw new Error('view_only');
      lock = LockService.getScriptLock();
      if (!lock.tryLock(25000)) { lock = null; throw new Error('busy'); }
    }
    var out = route.fn(body, who) || {};
    if (route.write && out.fresh !== false) out.data = getFullPageData();
    delete out.fresh;
    out.ok = out.ok !== false;
    return json_(out);
  } catch (err) {
    var msg = String((err && err.message) || err);
    if (!/^(signed_out|no_access|view_only|busy|bad_input:)/.test(msg)) {
      Logger.log(API_SERVICE_NAME + ' error (' + body.action + '): ' + ((err && err.stack) || msg));
    }
    return json_({ ok: false, error: msg });
  } finally {
    if (lock) { try { SpreadsheetApp.flush(); } catch (e2) {} lock.releaseLock(); }
  }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function props_() { return PropertiesService.getScriptProperties(); }
function toolkitUrl_() { return props_().getProperty('TOOLKIT_URL') || 'https://nbr1hawgfan.github.io/LWH-Warehouse-Toolkit/'; }
function bad_(msg) { throw new Error('bad_input:' + msg); }
function str_(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 300); }
function wholeNumber_(v, label, allowZero) {
  var n = Number(v);
  if (v === '' || v == null || !isFinite(n) || Math.floor(n) !== n || n < 0 || (!allowZero && n === 0)) {
    bad_(label + ' must be a whole number' + (allowZero ? ' (0 or more).' : ' more than 0.'));
  }
  if (n > 1000000) bad_(label + ' is too large.');
  return n;
}
/** The old functions answer {success:false, error}; turn that into a message the screen shows. */
function check_(r, fallback) {
  if (!r || r.success === false) bad_((r && (r.error || r.message)) || fallback || 'That didn\'t save.');
  return r;
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
  var cache = CacheService.getScriptCache(), ck = 'bb_' + hash_(token);
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
  var sh = ss().getSheetByName(ACCESS_TAB);
  if (!sh || sh.getLastRow() < 2) return '';
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getDisplayValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === id) return /^view/i.test(String(rows[i][2]).trim()) ? 'view' : 'edit';
  }
  return '';
}

/** Run once from the editor. Adds the Access and Stock_Log tabs; never deletes or moves anything. */
function setupToolkitApi() {
  var book = ss();
  var sh = book.getSheetByName(ACCESS_TAB);
  if (!sh) {
    sh = book.insertSheet(ACCESS_TAB);
    sh.getRange(1, 1, 1, 4).setValues([['Employee ID', 'Name', 'Role (edit or view)', 'Note']]);
    sh.getRange(1, 1, 1, 4).setBackground('#C41230').setFontColor('#FFFFFF').setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@');
  }
  stockLogSheet_();
  var msg = 'Toolkit API is set up. On the "' + ACCESS_TAB + '" tab, put the employee ID of each person allowed in ' +
    '(column A — the ID they sign in to the Toolkit with). Role: edit (default) or view.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* run from the editor — no UI */ }
  return msg;
}

function stockLogSheet_() {
  var book = ss(), sh = book.getSheetByName(STOCK_LOG_TAB);
  if (!sh) {
    sh = book.insertSheet(STOCK_LOG_TAB);
    sh.getRange(1, 1, 1, 7).setValues([['Timestamp', 'Component Code', 'Previous Qty', 'New Qty', 'Change', 'User', 'Note']]);
    sh.getRange(1, 1, 1, 7).setBackground('#C41230').setFontColor('#FFFFFF').setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Who changed a component count, from what to what. A log failure never blocks the count itself. */
function logStockChange_(code, previous, next, who, note) {
  try {
    stockLogSheet_().appendRow([new Date(), code, previous, Number(next), Number(next) - Number(previous), who || '', note || '']);
  } catch (e) { Logger.log('Stock log failed: ' + e.message); }
}

// ---- Actions -----------------------------------------------------------------------------
var API_ROUTES = {
  bootstrap:    { fn: apiBootstrap_ },
  printLog:     { fn: apiPrintLog_ },
  build:        { fn: apiBuild_,       write: true },
  ship:         { fn: apiShip_,        write: true },
  saveOrder:    { fn: apiSaveOrder_,   write: true },
  cancelOrder:  { fn: apiCancelOrder_, write: true },
  setStock:     { fn: apiSetStock_,    write: true },
  setLimits:    { fn: apiSetLimits_,   write: true },
  addComponent: { fn: apiAddComponent_, write: true },
  saveBom:      { fn: apiSaveBom_,     write: true },
  receive:      { fn: apiReceive_,     write: true },
  saveCustomer: { fn: apiSaveCustomer_, write: true },
  report:       { fn: apiReport_,      write: true },
  trigger:      { fn: apiTrigger_,     write: true }
};

function apiBootstrap_(b, who) {
  return { me: who, version: TOOLKIT_API_VERSION, data: getFullPageData() };
}

function bomItem_(code) { return getBOMItems().filter(function(x) { return x.item === code; })[0] || null; }
function orderRow_(po) { return getOpenOrders().filter(function(o) { return String(o.poNumber).trim() === po; })[0] || null; }

function apiBuild_(b, who) {
  var item = str_(b.itemCode, 100);
  if (!bomItem_(item)) bad_('Pick an item that is on the BOM.');
  var qty = wholeNumber_(b.qty, 'Quantity');
  var r = recordProductionRun({
    itemCode: item, qty: qty, builtBy: str_(b.builtBy, 80) || who.name,
    notes: str_(b.notes, 300), enteredBy: who.name
  });
  if (r && r.shortages && r.shortages.length) {
    bad_(r.error + ': ' + r.shortages.map(function(x) { return x.code + ' (need ' + x.needed + ', have ' + x.onHand + ')'; }).join(', '));
  }
  check_(r, 'Production run failed');
  return { message: 'Recorded ' + qty + ' × ' + item + '. ' + r.qtyAvailable + ' now ready to ship.' };
}

/** Ship a whole order. Customer, address, item and quantity come from the order on the Sheet, not the phone. */
function apiShip_(b, who) {
  var po = str_(b.poNumber, 100);
  var o = po && orderRow_(po);
  if (!o) bad_('Order ' + (po || '') + ' isn\'t on the OpenOrders tab.');
  if (o.status !== 'Open' && o.status !== 'Pending') bad_('Order ' + po + ' is ' + o.status + '.');
  var qty = Number(o.dueQuantity || o.orderQuantity || 0);
  if (!(qty > 0)) bad_('Order ' + po + ' has no quantity due.');
  var trk = (Array.isArray(b.tracking) ? b.tracking : []).map(function(t) { return str_(t, 60).replace(/[\s|]+/g, ''); });
  var ld  = (Array.isArray(b.ldNumbers) ? b.ldNumbers : []).map(function(t) { return str_(t, 60).replace(/[\s|]+/g, ''); });
  // Box i = tracking i + LD i. Boxes with no tracking are dropped; an LD with no tracking is refused.
  var boxT = [], boxL = [];
  for (var i = 0; i < Math.max(trk.length, ld.length); i++) {
    if (!trk[i] && ld[i]) bad_('Box ' + (i + 1) + ' has an LD number but no FedEx tracking number.');
    if (trk[i]) { boxT.push(trk[i]); boxL.push(ld[i] || ''); }
  }
  if (!boxT.length) bad_('Enter at least one FedEx tracking number.');
  while (boxL.length && !boxL[boxL.length - 1]) boxL.pop();
  var r = check_(recordShipment({
    customer: o.customer, address: o.address, item: o.itemName, qtyShipped: qty,
    tracking: boxT.join('|'), ldNumbers: boxL.join('|'),
    shippedBy: str_(b.shippedBy, 80) || who.name, notes: str_(b.notes, 300),
    poNumber: po, saveCustomer: false, enteredBy: who.name
  }), 'Ship failed');
  return { message: 'Shipped ' + po + ' — ' + qty + ' × ' + o.itemName + '. ' + r.remainingStock + ' built units left.', shipmentId: r.shipmentId };
}

function apiSaveOrder_(b) {
  var po = str_(b.poNumber, 100);
  if (!po) bad_('PO Number is required.');
  var customer = str_(b.customer, 150);
  if (!customer) bad_('Customer is required.');
  var item = str_(b.itemName, 100);
  if (!bomItem_(item)) bad_('Pick an item that is on the BOM.');
  var qty = wholeNumber_(b.qty, 'Order quantity');
  var existing = orderRow_(po);
  if (b.isNew && existing) bad_('PO ' + po + ' is already on the OpenOrders tab. Use Edit on that order.');
  if (!b.isNew && !existing) bad_('PO ' + po + ' isn\'t on the OpenOrders tab.');
  if (existing && (existing.status === 'Shipped' || existing.status === 'Cancelled')) bad_('Order ' + po + ' is ' + existing.status + ' and can\'t be changed.');
  var pr = str_(b.priority, 20);
  var r = check_(saveOrder({
    poNumber: po, customer: customer, address: str_(b.address, 300), itemName: item,
    orderQty: qty, dueQty: qty, unit: 'Each', priority: /^(Normal|High|Rush)$/.test(pr) ? pr : 'Normal',
    notes: str_(b.notes, 300)
  }), 'Save failed');
  return { message: r.message };
}

function apiCancelOrder_(b, who) {
  var po = str_(b.poNumber, 100);
  var o = po && orderRow_(po);
  if (!o) bad_('Order ' + (po || '') + ' isn\'t on the OpenOrders tab.');
  if (o.status === 'Shipped' || o.status === 'Cancelled') bad_('Order ' + po + ' is already ' + o.status + '.');
  check_(updateOrderStatus(po, 'Cancelled'), 'Cancel failed');
  Logger.log('Order ' + po + ' cancelled by ' + who.name);
  return { message: 'Order ' + po + ' cancelled. The cancellation email went out.' };
}

function componentRow_(code) { return getComponents().filter(function(c) { return c.code === code; })[0] || null; }

function apiSetStock_(b, who) {
  var code = str_(b.code, 100);
  var c = code && componentRow_(code);
  if (!c) bad_('Component ' + (code || '') + ' isn\'t on the Inventory tab.');
  var qty = wholeNumber_(b.quantity, 'Quantity', true);
  check_(updateStock(code, qty), 'Update failed');
  logStockChange_(code, c.quantity, qty, who.name, str_(b.note, 300) || 'Set count');
  return { message: code + ' set to ' + qty + ' (was ' + c.quantity + ').' };
}

function apiSetLimits_(b, who) {
  var code = str_(b.code, 100);
  if (!code || !componentRow_(code)) bad_('Component ' + (code || '') + ' isn\'t on the Inventory tab.');
  var low = wholeNumber_(b.low, 'Low limit', true), crit = wholeNumber_(b.critical, 'Critical limit', true);
  if (crit > low) bad_('The critical limit should be at or below the low limit.');
  var sheet = getSheet(CONFIG.SHEETS.INVENTORY), data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === code) {
      sheet.getRange(i + 1, 6, 1, 2).setValues([[low, crit]]).setNumberFormat('0');
      Logger.log('Limits for ' + code + ' set to ' + low + ' / ' + crit + ' by ' + who.name);
      return { message: code + ': low ' + low + ', critical ' + crit + '.' };
    }
  }
  bad_('Component ' + code + ' isn\'t on the Inventory tab.');
}

function apiAddComponent_(b, who) {
  var code = str_(b.code, 100), desc = str_(b.description, 200);
  if (!code) bad_('Component code is required.');
  if (!desc) bad_('Description is required.');
  var qty = wholeNumber_(b.quantity || 0, 'Starting quantity', true);
  var low = wholeNumber_(b.low == null || b.low === '' ? 10 : b.low, 'Low limit', true);
  var crit = wholeNumber_(b.critical == null || b.critical === '' ? 10 : b.critical, 'Critical limit', true);
  check_(addNewComponent({ code: code, description: desc, quantity: qty, reserved: 0, lowThreshold: low, criticalThreshold: crit }), 'Add failed');
  if (qty) logStockChange_(code, 0, qty, who.name, 'New component');
  return { message: 'Component ' + code + ' added.' };
}

function apiSaveBom_(b, who) {
  var item = str_(b.item, 100);
  if (!item) bad_('Item code is required.');
  var comps = Array.isArray(b.components) ? b.components : [];
  var known = {}; getComponents().forEach(function(c) { known[c.code] = c; });
  var lines = comps.map(function(c) {
    var code = str_(c.code, 100);
    if (!known[code]) bad_('Component ' + code + ' isn\'t on the Inventory tab. Add it first.');
    return { componentCode: code, description: known[code].description, qty: wholeNumber_(c.qty, 'Quantity for ' + code) };
  });
  if (!lines.length) bad_('Add at least one component.');
  var existed = !!bomItem_(item);
  check_(addNewBOMItem({ company: str_(b.company, 100), item: item, components: lines }), 'Save failed');
  Logger.log('BOM ' + item + (existed ? ' replaced' : ' added') + ' by ' + who.name);
  return { message: 'BOM ' + item + (existed ? ' updated' : ' saved') + ' — ' + lines.length + ' component' + (lines.length === 1 ? '' : 's') + '.' };
}

function apiReceive_(b, who) {
  var code = str_(b.componentCode, 100);
  if (!code || !componentRow_(code)) bad_('Pick a component that is on the Inventory tab.');
  var po = str_(b.poNumber, 100);
  if (!po) bad_('PO Number is required.');
  var qty = wholeNumber_(b.qtyReceived, 'Quantity received');
  var cost = Number(b.unitCost || 0);
  if (!isFinite(cost) || cost < 0 || cost > 1000000) bad_('Unit cost doesn\'t look right.');
  var by = str_(b.receivedBy, 80) || who.name, notes = str_(b.notes, 300);
  if (by !== who.name) notes = (notes ? notes + ' — ' : '') + 'Entered by ' + who.name;
  var r = check_(receiveStock({ componentCode: code, poNumber: po, vendor: str_(b.vendor, 150), qtyReceived: qty,
    unitCost: Math.round(cost * 100) / 100, receivedBy: by, notes: notes }), 'Receive failed');
  return { message: r.message };
}

function apiSaveCustomer_(b) {
  var name = str_(b.name, 150);
  if (!name) bad_('Customer name is required.');
  var r = check_(saveCustomer({ name: name, address: str_(b.address, 300), city: str_(b.city, 150), contact: str_(b.contact, 150) }), 'Save failed');
  return { message: 'Customer ' + name + ' ' + (r.action || 'saved') + '.' };
}

/** Emails and the tracking-sheet sync. Each goes to the same list the old page used. */
function apiReport_(b, who) {
  var type = String(b.type || ''), days = Math.max(1, Math.min(365, parseInt(b.days, 10) || 30)), r;
  if (type === 'daily')          { r = sendReportNow(null); }
  else if (type === 'ships')     { r = sendShipmentHistoryReport(null, days); }
  else if (type === 'orders')    { r = sendOpenOrdersReport(null); }
  else if (type === 'receiving') { r = sendReceivingReport(null, days); }
  else if (type === 'weekly') {
    var emails = String(b.emails || '').split(/[,;\s]+/).filter(String);
    if (!emails.length) bad_('Enter at least one email address.');
    emails.forEach(function(x) { if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)) bad_(x + ' doesn\'t look like an email address.'); });
    if (emails.length > 20) bad_('Up to 20 addresses at a time.');
    r = check_(_buildAndSendWeeklyReport(emails.join(',')), 'Weekly report failed');
    Logger.log('Weekly report sent by ' + who.name + ' to ' + emails.join(', '));
    return { message: 'Weekly report sent — ' + r.shipmentCount + ' shipment(s) for ' + r.week + '.', fresh: false };
  }
  else if (type === 'sync') {
    r = check_(syncTrackingToExternalSheet(), 'Sync failed');
    return { message: r.message, fresh: false };
  }
  else bad_('Unknown report.');
  check_(r, 'Send failed');
  Logger.log('Report "' + type + '" sent by ' + who.name);
  return { message: 'Sent to the usual list.', fresh: false };
}

function apiTrigger_(b, who) {
  var type = String(b.type || ''), r;
  if (type === 'daily') r = setupDailyTrigger();
  else if (type === 'weekly') r = setupWeeklyTrigger();
  else if (type === 'sync') r = setupSyncTrigger();
  else bad_('Unknown timer.');
  check_(r, 'Timer setup failed');
  Logger.log('Trigger "' + type + '" set by ' + who.name);
  return { message: r.message, fresh: false };
}

function apiPrintLog_(b) {
  var days = Math.max(1, Math.min(365, parseInt(b.days, 10) || 30));
  return { html: getShipmentHistoryHTML(days) };
}
