/* LWH Warehouse Toolkit — Home screen tiles (v1.70.0)
   Hub-style home: search box, category chips, and ☆ favorites that pin a
   person's go-to tools to the top. Favorites are saved on this device only
   (LWHStorage 'homeFavs'), the same way the LWH Hub saves its pinned tiles.
   To add a new tool to Home, add one line to TOOLS below. */
(function () {
  const CATS = [
    { id: 'inv',    label: 'Inventory & Lookup' },
    { id: 'ship',   label: 'Shipping & Receiving' },
    { id: 'labels', label: 'Labels & Badges' },
    { id: 'time',   label: 'Time & Hours' },
    { id: 'tools',  label: 'Scan & Utilities' }
  ];
  const TOOLS = [
    { view: "quickLookup", cat: "inv", name: "Quick Lookup", desc: "One box: type, scan or speak an LWH ID, item, customer ID, bay or lot. See pallets, summary and history, print with barcodes, or send it to Excel.", kw: "quick lookup search scan speak voice find pallet item bay customer id lot history excel export print barcode",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><path d=\"M4 6v12M7 6v12M10 6v8M13 6v8\"/><circle cx=\"16.5\" cy=\"15.5\" r=\"3.5\"/><path d=\"M19 18l2.5 2.5\"/></svg>" },
    { view: "customerLookup", cat: "inv", name: "Master Lookup", desc: "Search anything: LWH ID, INV Receipt, customer, item, lot, vendor, bay, or customer-specific fields.", kw: "search find inventory lwh id invrec receipt item lot vendor bay customer",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><circle cx=\"10.5\" cy=\"10.5\" r=\"6.5\"/><path d=\"M20 20l-4.8-4.8\"/></svg>" },
    { view: "bayContents", cat: "inv", name: "Bay Contents", desc: "Same filters as Pick List \u2014 filter by bay, customer, item, lot, or warehouse. Plain data table with CSV export, or print a scannable barcode sheet of what's in a bay.", kw: "bay rack location what is in csv barcode sheet",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><rect x=\"3\" y=\"4\" width=\"18\" height=\"16\" rx=\"1\"/><path d=\"M3 10h18M9 10v10\"/></svg>" },
    { view: "fifo", cat: "inv", name: "FIFO / Aging", desc: "Pick oldest first \u2014 see which bay to pull from, and which pallets are getting old.", kw: "oldest age aging first in first out pull",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><path d=\"M4 7h11M4 12h8M4 17h5\"/><path d=\"M18 5v14\"/><path d=\"M15 16l3 3 3-3\"/></svg>" },
    { view: "locoverview", cat: "inv", name: "Location Overview", desc: "Pick a warehouse, see every customer's pallet count and qty, click through to their full inventory.", kw: "warehouse location zero street 5th van buren customers pallet count",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><path d=\"M12 21s-7-6.5-7-11a7 7 0 0 1 14 0c0 4.5-7 11-7 11z\"/><circle cx=\"12\" cy=\"10\" r=\"2.5\"/></svg>" },
    { view: "customerview", cat: "inv", name: "Customer View", desc: "Pick a customer, see their pallet count and qty at each warehouse, click through to full inventory.", kw: "customer pallets qty warehouses",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"8\" r=\"3.2\"/><path d=\"M6 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5\"/></svg>" },
    { view: "transactionHistory", cat: "inv", name: "Transaction History", desc: "Rolling 90-day inbound/outbound trail \u2014 search by Bill-to-Ref, item, or LWH ID to see when something arrived or shipped.", kw: "history inbound outbound shipped arrived 90 day bill to ref",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><path d=\"M3 7h18M3 12h18M3 17h12\"/><circle cx=\"19\" cy=\"17\" r=\"2\"/></svg>" },
    { view: "itemTxnLookup", cat: "inv", name: "Item Transaction Lookup", desc: "Pallet-level inbound/outbound detail by item, or a total pallets/qty summary by item \u2014 filter by item #, warehouse, and date range, with a smart search across every column.", kw: "item transactions inbound outbound pallet detail summary",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><path d=\"M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z\"/><path d=\"M21 21l-4.35-4.35\"/><path d=\"M8 11h6M11 8v6\"/></svg>" },
    { view: "dailyActivity", cat: "inv", name: "Daily Activity", desc: "Day-by-day inbound/outbound pallet and qty totals, filterable by warehouse, over the last 90 days.", kw: "daily inbound outbound totals per day",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><rect x=\"3\" y=\"4\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"M3 9h18M8 3v3M16 3v3\"/><path d=\"M8 14l2 2 4-4\"/></svg>" },
    { view: "dockBoard", cat: "ship", name: "Today's Dock", desc: "Every inbound and outbound load for the day on one screen \u2014 carrier, trailer, pallets, status. TV Mode for the shipping office.", kw: "dock today loads inbound outbound tv mode shipping office",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><path d=\"M3 21V9l9-5 9 5v12\"/><path d=\"M7 21v-8h10v8\"/><path d=\"M7 16h10\"/></svg>" },
    { view: "loadDetails", cat: "ship", name: "Load Details", desc: "Carrier, trailer, seal, and item breakdown by load \u2014 search by Pro #, carrier, trailer, or Bill-to-Ref.", kw: "load carrier trailer seal pro",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><path d=\"M3 13h4l2-6h6l2 6h4\"/><rect x=\"3\" y=\"13\" width=\"18\" height=\"6\" rx=\"1\"/><circle cx=\"7.5\" cy=\"19\" r=\"1.5\"/><circle cx=\"16.5\" cy=\"19\" r=\"1.5\"/></svg>" },
    { view: "packingList", cat: "ship", name: "Packing List", desc: "Pallet-level detail for one load \u2014 search by Pro # or Bill-to-Ref.", kw: "packing list pallets load pro",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><rect x=\"4\" y=\"3\" width=\"16\" height=\"18\" rx=\"2\"/><path d=\"M8 7h8M8 11h8M8 15h5\"/><path d=\"M8 3v2h8V3\"/></svg>" },
    { view: "picklist", cat: "ship", name: "Pick List", desc: "Filter by customer/item/lot/bay/warehouse, print a scannable pick list table or a grouped Item Summary.", kw: "pick list picking item summary print",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><path d=\"M5 4h14v16H5z\"/><path d=\"M9 9h6M9 13h6M9 17h3\"/><path d=\"M7 4v2M17 4v2\"/></svg>" },
    { view: "outbound", cat: "ship", name: "Outbound Loads / BOL", desc: "Build an outbound load from a sub-customer's own items, scan pallets with every tag checked against inventory, and print a detailed BOL. Saved for WMS re-entry.", kw: "outbound load bol bill of lading ship scan pallets wms",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><path d=\"M2 16V7h11v9\"/><path d=\"M13 10h4l4 3.5V16h-2\"/><circle cx=\"7\" cy=\"18\" r=\"1.6\"/><circle cx=\"17.5\" cy=\"18\" r=\"1.6\"/><path d=\"M5 10.5h5M8 8l2 2.5L8 13\"/></svg>" },
    { view: "osInbound", cat: "ship", name: "One Source Inbound", desc: "Unload One Source trailers without the WMS: scan Pallet ID, PGID and QTY per pallet, then print a scan sheet with a barcode for every Pallet ID. Syncs between devices.", kw: "one source inbound unload trailer pallet id pgid",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><path d=\"M22 16V7H11v9\"/><path d=\"M11 10H7l-4 3.5V16h2\"/><circle cx=\"17\" cy=\"18\" r=\"1.6\"/><circle cx=\"6.5\" cy=\"18\" r=\"1.6\"/><path d=\"M19 10.5h-5M16 8l-2 2.5 2 2.5\"/></svg>" },
    { view: "loadScan", cat: "ship", name: "Load Tag Scan", desc: "Scan a load's pallet tags with a scanner or the camera \u2014 running count, duplicates blocked \u2014 then print or download a barcode + QR sheet to scan into SAP.", kw: "scan load tags sap barcode qr count",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><path d=\"M4 5v10M7 5v10M10 5v10M13 5v10M16 5v10\"/><path d=\"M19 5v4\"/><path d=\"M4 19h8\"/><path d=\"M17 15l2 2 3-4\"/></svg>" },
    { view: "pasReader", cat: "ship", name: "PAS Sheet Reader", desc: "Scan or photograph a PAS sheet or Ardagh bill of lading \u2014 get checked pallet IDs for Excel, or a barcode sheet to scan into the WMS instead of typing.", kw: "pas sheet reader ardagh scan photo pallet ids ocr",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><path d=\"M6 2h9l5 5v15H6z\"/><path d=\"M15 2v5h5\"/><path d=\"M4 13h16\"/><path d=\"M9 17h2M13 17h2M9 9h3\"/></svg>" },
    { view: "receiving", cat: "ship", name: "Receiving Print", desc: "Enter an InvRec and print every pallet label from that load.", kw: "receiving print invrec labels load",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><path d=\"M2 16V7h11v9\"/><path d=\"M13 10h4l4 3.5V16h-2\"/><circle cx=\"7\" cy=\"18\" r=\"1.6\"/><circle cx=\"17.5\" cy=\"18\" r=\"1.6\"/></svg>" },
    { view: "shipwt", cat: "ship", name: "Ship Weights", desc: "Calculate gross shipment weight and print a 4x6 label with freight class.", kw: "ship weight freight class gross label 4x6",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><path d=\"M12 3v18\"/><path d=\"M5 7h14\"/><path d=\"M5 7 2 14a3 3 0 0 0 6 0z\"/><path d=\"M19 7l-3 7a3 3 0 0 0 6 0z\"/></svg>" },
    { view: "trailer", cat: "ship", name: "Trailer Checklist", desc: "Pre-loading GMP and pre-shipment checklist, ready to print.", kw: "trailer checklist gmp pre loading pre shipment inspection",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><rect x=\"6\" y=\"3\" width=\"12\" height=\"18\" rx=\"2\"/><path d=\"M9 3h6v2H9z\"/><path d=\"M9 12l2 2 4-4\"/></svg>" },
    { view: "bol", cat: "ship", name: "Bill of Lading", desc: "Fillable, printable BOL with your logo and drawable signatures.", kw: "bol bill of lading signature",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><path d=\"M6 2h9l5 5v15H6z\"/><path d=\"M15 2v5h5\"/><path d=\"M9 13h6M9 17h6M9 9h2\"/></svg>" },
    { view: "paperForms", cat: "ship", name: "Paper Forms", desc: "Blank BOL (same layout as the Outbound BOL) and a receiving tally to print ahead of time \u2014 the fallback when devices or the network are down.", kw: "paper forms blank bol tally backup network down",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><path d=\"M6 2h9l5 5v15H6z\"/><path d=\"M15 2v5h5\"/><path d=\"M9 12h7M9 15.5h7M9 19h4\"/><path d=\"M3 6v15a1 1 0 0 0 1 1h1\"/></svg>" },
    { view: "pallet", cat: "labels", name: "Pallet Labels", desc: "Simple entry, bulk paste, and print from lookup.", kw: "pallet labels print tag",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><path d=\"M12 3 4 7v10l8 4 8-4V7z\"/><path d=\"M4 7l8 4 8-4M12 11v10\"/></svg>" },
    { view: "rack", cat: "labels", name: "Rack Labels", desc: "4x6 bay tags with 1D barcode and QR.", kw: "rack labels bay tags 4x6",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><path d=\"M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z\"/><circle cx=\"12\" cy=\"10\" r=\"2.4\"/></svg>" },
    { view: "signs", cat: "labels", name: "Bay Signs", desc: "8.5x11 warehouse signage with barcode.", kw: "bay aisle signs 8.5x11 signage",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><rect x=\"3\" y=\"4\" width=\"18\" height=\"13\" rx=\"1.5\"/><path d=\"M8 21h8M12 17v4\"/></svg>" },
    { view: "generate", cat: "labels", name: "Generate Code", desc: "Turn any text or number into a QR code or barcode \u2014 download, share, or print at 4x6 with the text underneath.", kw: "qr code barcode generate make print",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><rect x=\"3\" y=\"3\" width=\"7\" height=\"7\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\"/><path d=\"M14 14h3v3h-3zM19 14h2v2h-2zM14 19h2v2h-2zM19 19h2v2h-2z\"/></svg>" },
    { view: "visitor", cat: "labels", name: "Visitor Badges", desc: "Visitor, vendor, contractor badges with optional photo.", kw: "visitor vendor contractor badge",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><rect x=\"4\" y=\"3\" width=\"16\" height=\"18\" rx=\"2\"/><circle cx=\"12\" cy=\"9\" r=\"2.6\"/><path d=\"M8 17c0-2 1.8-3.4 4-3.4s4 1.4 4 3.4\"/></svg>" },
    { view: "empbadge", cat: "labels", name: "Employee Badges", desc: "Timecard scan badge or full front/back company ID badge \u2014 CR80 card size.", kw: "employee badge id card timecard",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><rect x=\"3\" y=\"6\" width=\"18\" height=\"12\" rx=\"2\"/><circle cx=\"8\" cy=\"12\" r=\"2\"/><path d=\"M13 10h5M13 14h3\"/></svg>" },
    { view: "contact", cat: "labels", name: "Contact QR", desc: "Business-card QR code with your name, phone and email \u2014 scan to save the contact.", kw: "contact qr vcard business card phone",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><rect x=\"3\" y=\"5\" width=\"18\" height=\"14\" rx=\"2\"/><circle cx=\"9\" cy=\"11\" r=\"2\"/><path d=\"M6 16c0-1.7 1.5-3 3-3s3 1.3 3 3M14 9h4M14 13h4\"/></svg>" },
    { view: "myHours", cat: "time", name: "My Hours", desc: "Enter your employee ID to see your hours for any Sunday\u2013Saturday week.", kw: "my hours time clock timeclock punches week paycheck",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v5l3 2\"/></svg>" },
    { view: "missedPunches", cat: "time", name: "Missed Punches", desc: "Managers: missing clock-ins/outs, shifts over 10 hours, usual workdays with no punches \u2014 plus everyone's weekly hours. Passcode required.", kw: "missed punches managers clock in out overtime",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"13\" r=\"8\"/><path d=\"M12 9v4l2 2\"/><path d=\"M9 2h6\"/><path d=\"M19 5l1.5-1.5\"/></svg>" },
    { view: "spotterTimesheets", cat: "time", name: "Spotter Timesheets", desc: "Weekly hours synced from drivers' phones \u2014 search, print, or export.", kw: "spotter timesheets drivers hours",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><rect x=\"3\" y=\"4\" width=\"18\" height=\"17\" rx=\"1.5\"/><path d=\"M3 9h18M8 3v3M16 3v3\"/><path d=\"M7 13h3M12 13h3M7 17h3\"/></svg>" },
    { view: "utilities", cat: "tools", name: "Warehouse Tools", desc: "Calculator, unit converter, pallet footprint, notepad, Quick Message, trailer cube, date calc, age calc, loan calc, cost per foot, health, storage revenue, distance planner, and more.", kw: "calculator converter notepad message cube date loan cost per foot footprint distance",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><path d=\"M3 9h18v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z\"/><path d=\"M8 9V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v3\"/><path d=\"M3 13h18\"/></svg>" },
    { view: "scancode", cat: "tools", name: "Scan Code", desc: "Quick camera scan of any barcode or QR \u2014 copy, add to notes, email, or open a link straight from the result.", kw: "scan barcode qr camera",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><path d=\"M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3\"/><path d=\"M4 12h16\"/></svg>" },
    { view: "docscan", cat: "tools", name: "Doc Scanner", desc: "Auto-detects and straightens paperwork as you scan, extract text, and share or download as a PDF \u2014 multi-page.", kw: "document scanner pdf paperwork camera ocr",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><rect x=\"4\" y=\"3\" width=\"16\" height=\"18\" rx=\"2\"/><path d=\"M8 8h8M8 12h8M8 16h5\"/></svg>" },
    { view: "radar", cat: "tools", name: "Weather Radar", desc: "Animated precipitation radar for the yard and surrounding area.", kw: "weather radar rain storm",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 12 12 4\"/><path d=\"M12 12 17 15\"/></svg>" },
    { view: "settings", cat: "tools", name: "Settings", desc: "Logo, colors, calibration, and source data.", kw: "settings logo calibration source data",
      icon: "<svg class=\"icon\" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.4-2-3.4-2.3.8a7.6 7.6 0 0 0-2.6-1.5L14 2h-4l-.5 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.3-.8-2 3.4 2 1.4a7.6 7.6 0 0 0 0 3l-2 1.4 2 3.4 2.3-.8a7.6 7.6 0 0 0 2.6 1.5L10 22h4l.5-2.5a7.6 7.6 0 0 0 2.6-1.5l2.3.8 2-3.4z\"/></svg>" }
  ];

  const K_FAV = 'homeFavs', K_CAT = 'homeCat';
  const byView = {}; TOOLS.forEach(t => { byView[t.view] = t; });
  let favs = (LWHStorage.get(K_FAV, []) || []).filter(v => byView[v]);
  let cat = LWHStorage.get(K_CAT, 'all'); if (cat !== 'all' && !CATS.some(c => c.id === cat)) cat = 'all';
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const catLabel = id => (CATS.find(c => c.id === id) || {}).label || '';

  function tile(t, pinned) {
    const on = favs.indexOf(t.view) !== -1;
    return '<div class="tk-tile c-' + t.cat + (pinned ? ' pinned' : '') + '" data-view="' + t.view + '" role="button" tabindex="0">' +
      '<span class="tk-ic">' + t.icon + '</span>' +
      '<span class="tk-tx"><b>' + esc(t.name) + '</b><span class="d">' + esc(t.desc) + '</span>' +
      (pinned ? '<span class="tk-cat">' + esc(catLabel(t.cat)) + '</span>' : '') + '</span>' +
      '<button type="button" class="tk-star' + (on ? ' on' : '') + '" data-star="' + t.view + '" title="' + (on ? 'Remove from My Tools' : 'Add to My Tools') + '" aria-label="' + (on ? 'Remove ' : 'Add ') + esc(t.name) + (on ? ' from' : ' to') + ' My Tools">' + (on ? '★' : '☆') + '</button></div>';
  }

  function matches(t, q) {
    if (!q) return true;
    const hay = (t.name + ' ' + t.desc + ' ' + t.kw + ' ' + catLabel(t.cat)).toLowerCase();
    return q.split(/\s+/).every(w => hay.indexOf(w) !== -1);
  }

  function render() {
    const box = $('tkSections'); if (!box) return;
    const q = ($('toolSearch').value || '').trim().toLowerCase();
    document.querySelectorAll('#tkChips [data-cat]').forEach(b => b.classList.toggle('on', b.dataset.cat === cat));
    const inCat = t => q || cat === 'all' || t.cat === cat;   // search always looks across everything

    const favList = favs.map(v => byView[v]).filter(t => matches(t, q));
    let shown = favList.length;
    $('tkFavs').innerHTML = favList.length
      ? '<div class="tk-sec mine">★ My Tools <span class="n">' + favList.length + '</span></div><div class="tk-grid">' + favList.map(t => tile(t, true)).join('') + '</div>'
      : (!q && !favs.length
          ? '<div class="tk-sec mine">★ My Tools</div><div class="tk-fav-empty"><span class="tk-big">☆</span><span><b>Pick your go-to tools</b>Tap the star on any tool below and it will show up right here, first thing, every time you open the Toolkit. Saved on this device.</span></div>'
          : '');

    box.innerHTML = CATS.map(c => {
      const list = TOOLS.filter(t => t.cat === c.id && inCat(t) && matches(t, q));
      shown += list.length;
      if (!list.length) return '';
      return '<div class="tk-sec">' + esc(c.label) + ' <span class="n">' + list.length + '</span></div><div class="tk-grid">' + list.map(t => tile(t, false)).join('') + '</div>';
    }).join('');
    $('tkNone').hidden = shown > 0;
    $('tkAllHead').hidden = !favList.length || !box.innerHTML;
  }

  function toggleFav(view) {
    const i = favs.indexOf(view);
    if (i === -1) favs.push(view); else favs.splice(i, 1);
    LWHStorage.set(K_FAV, favs);
    render();
  }

  function init() {
    const box = $('tkSections'); if (!box) return;
    $('tkChips').innerHTML = '<button type="button" class="tk-chip" data-cat="all">All tools</button>' +
      CATS.map(c => '<button type="button" class="tk-chip" data-cat="' + c.id + '">' + esc(c.label) + '</button>').join('');

    // Star clicks are handled here and stopped, so the document-level
    // [data-view] listener in app.js doesn't also open the tool.
    $('home').addEventListener('click', e => {
      const s = e.target.closest('[data-star]');
      if (s) { e.preventDefault(); e.stopPropagation(); toggleFav(s.dataset.star); return; }
      const c = e.target.closest('#tkChips [data-cat]');
      if (c) { e.stopPropagation(); cat = c.dataset.cat; LWHStorage.set(K_CAT, cat); render(); }
    });
    $('home').addEventListener('keydown', e => {
      const t = e.target.closest && e.target.closest('.tk-tile');
      if (t && e.target === t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); window.LWHUI && LWHUI.show(t.dataset.view); }
    });
    const qi = $('toolSearch');
    qi.addEventListener('input', render);
    qi.addEventListener('keydown', e => {
      if (e.key === 'Escape') { qi.value = ''; render(); }
      if (e.key === 'Enter') { const first = document.querySelector('#home .tk-tile'); if (first) { e.preventDefault(); LWHUI.show(first.dataset.view); } }
    });
    document.addEventListener('keydown', e => {
      if (e.key !== '/' || !$('home').classList.contains('active')) return;
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) return;
      e.preventDefault(); qi.focus();
    });
    render();
  }

  window.LWHHomeTiles = { render, tools: TOOLS };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
