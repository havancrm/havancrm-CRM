// Single source of truth for the 18 CRM tabs / 178 columns.
// Data is always read/written by HEADER NAME - never by fixed column position.
export const SCHEMA = {
  customers: ['id','name','type','address','contactName','paymentTerm','billClerk','activeFlag','gpsLat','gpsLng','mapLink','lineId','keepNote','customerNote','specialConditions','storeHours','taxInvoiceRequired','taxName','taxAddress','taxBranch','taxId','receiptRequired','documentNote','photoFolderId','storePhotoFileIds','birthday'],
  customer_phones: ['customerId','seq','phone'],
  customer_labels: ['customerId','seq','label'],
  bills: ['no','date','customerId','customerNameOverride','paymentTerm','openedBy','salesperson','vatMode','source','updatedAt'],
  bill_items: ['billNo','line','code','name','qty','price','amount'],
  products: ['code','name'],
  orders: ['no','date','customerId','customerNameOverride','paymentTerm','vatMode','status','billNo','note','createdBy','deviceId','opId','updatedAt'],
  order_items: ['orderNo','line','code','name','qty','price','unit','amount'],
  visits: ['visitId','customerId','at','lat','lng','source','note','fileId','status','plannedAt','completedAt','outcome','opId','updatedAt','data'],
  tasks: ['taskId','customerId','type','title','dueAt','status','note','owner','updatedAt','data','opId','createdAt','completedAt'],
  activities: ['activityId','customerId','type','at','refType','refId','note','updatedAt','data','opId'],
  gps: ['gpsId','customerId','at','lat','lng','accuracy','source','visitId','note','updatedAt','data','opId'],
  photos: ['photoId','customerId','visitId','at','fileId','folderId','photoType','caption','lat','lng','source','updatedAt','data','opId'],
  ACCESS: ['email','active','note','role'],
  changes: ['at','entity','id','action','before','after','opId','deviceId','user'],
  systemSettings: ['id','updatedAt','data'],
  IMPORT_BATCHES: ['batchId','at','kind','fileName','fileHash','source','format','status','summary','user','deviceId'],
  IMPORT_REVIEW: ['reviewId','batchId','sourceFile','entityType','sourceKey','issueCode','severity','sourceValue','existingValue','suggestedAction','status','reviewedBy','reviewedAt','resolutionNote','createdAt'],
};
export const TABS = Object.keys(SCHEMA);
export const TOTAL_COLUMNS = TABS.reduce((n, t) => n + SCHEMA[t].length, 0);

// Tabs the app loads on bootstrap (read model). Logs/review tabs are loaded lazily.
export const CORE_TABS = ['customers','customer_phones','customer_labels','bills','bill_items','products','orders','order_items','visits','tasks','activities','gps','photos','systemSettings'];

// Tabs that carry an opId column and therefore support duplicate-save protection.
export const OPID_TABS = TABS.filter(t => SCHEMA[t].includes('opId'));

// Convert a raw sheet value matrix (header row first) into objects by header name.
// Tolerates short rows (Sheets API trims trailing empty cells) and unknown/extra columns.
export function rowsToObjects(values) {
  if (!values || !values.length) return [];
  const head = values[0].map(h => String(h ?? '').trim());
  const out = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (!row || !row.length) continue;
    const o = {};
    for (let c = 0; c < head.length; c++) {
      if (!head[c]) continue;
      const v = row[c];
      o[head[c]] = v === undefined || v === null ? '' : String(v);
    }
    out.push(o);
  }
  return out;
}

// Build a row array in the order of the *actual* sheet header (by name).
export function objectToRow(headers, obj) {
  return headers.map(h => {
    const v = obj[h];
    return v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  });
}

export function tabFromRange(range) {
  const m = /^'?([^'!]+)'?!/.exec(range || '');
  return m ? m[1] : null;
}

// Compare the real header row of a tab with the expected schema (by name, order-independent).
export function checkHeaders(tab, headerRow) {
  const have = (headerRow || []).map(h => String(h ?? '').trim());
  const want = SCHEMA[tab] || [];
  return {
    tab,
    missing: want.filter(h => !have.includes(h)),
    extra: have.filter(h => h && !want.includes(h)),
    ok: want.every(h => have.includes(h)),
  };
}
// Columns written as real numbers (everything else is written as text so ids/codes stay text).
export const NUMERIC_COLS = {
  bill_items: ['line', 'qty', 'price', 'amount'],
  order_items: ['line', 'qty', 'price', 'amount'],
  customers: ['gpsLat', 'gpsLng'],
  gps: ['lat', 'lng', 'accuracy'],
  visits: ['lat', 'lng'],
  photos: ['lat', 'lng'],
  customer_phones: ['seq'],
  customer_labels: ['seq'],
};
