const CRM_SHEET_ID = '1KbM5G_-O24NfRfiAX9eBcp9KBg_GjGXd7aUCKVdfkHY';

function doPost(event) {
  try {
    const input = JSON.parse(event.postData.contents);
    const key = PropertiesService.getScriptProperties().getProperty('CRM_BRIDGE_SECRET');
    if (!key || key.length < 32 || typeof input.body !== 'string' || !/^[a-f0-9]{64}$/.test(input.signature || '')) return reply(403, {});
    const expected = Utilities.computeHmacSha256Signature('crm-bridge-v1.' + input.body, key);
    let difference = 0;
    for (let i = 0; i < expected.length; i++) {
      difference |= (expected[i] & 255) ^ parseInt(input.signature.slice(i * 2, i * 2 + 2), 16);
    }
    if (difference) return reply(403, {});
    const request = JSON.parse(input.body);
    if (!Number.isInteger(request.at) || Math.abs(Date.now() - request.at) > 120000 || !/^[a-f0-9-]{36}$/.test(request.nonce || '')) return reply(403, {});
    if ((request.method === 'POST' || request.kind === 'photo-add') && !acceptWrite(request.nonce)) return reply(409, {});
    if (request.kind === 'photo-get' || request.kind === 'photo-add') return photos(request);
    if (request.kind !== 'sheets' || !allowed(request.method, request.path)) return reply(403, {});
    const response = fetchSheet(request.path, request.method, request.payload);
    return rawReply(response.getResponseCode(), response.getContentText());
  } catch (_) {
    return reply(502, { error: 'Apps Script CRM request failed' });
  }
}

function fetchSheet(path, method = 'GET', payload) {
  const options = {
    method: method.toLowerCase(), contentType: 'application/json', muteHttpExceptions: true, followRedirects: false,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
  };
  if (method === 'POST') options.payload = payload;
  return UrlFetchApp.fetch('https://sheets.googleapis.com/v4/spreadsheets/' + CRM_SHEET_ID + path, options);
}

function acceptWrite(nonce) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return false;
  try {
    const cache = CacheService.getScriptCache();
    if (cache.get(nonce)) return false;
    cache.put(nonce, 'used', 240);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function isCrmPhoto(fileId) {
  const response = fetchSheet("/values:batchGet?ranges='photos'&ranges='customers'&majorDimension=COLUMNS");
  if (response.getResponseCode() !== 200) return false;
  const { valueRanges = [] } = JSON.parse(response.getContentText());
  return valueRanges.some(({ values = [] }) =>
    values.some(([header, ...cells]) => ['fileId', 'storePhotoFileIds'].includes(header)
      && cells.some(cell => String(cell).split(',').some(id => id.trim() === fileId))));
}

function allowed(method, path) {
  if (typeof path !== 'string' || /[\\#\r\n]/.test(path) || /%[0-9a-f]{2}/i.test(path)) return false;
  if (method === 'GET') return /^\/values\/[\w'%!:$]+(?:\?majorDimension=COLUMNS)?$/.test(path)
    || /^\/values:batchGet\?ranges=[\w'%!:$=&-]+$/.test(path)
    || path === '?fields=sheets.properties(sheetId,title)';
  return method === 'POST' && (path === ':batchUpdate' || path === '/values:batchUpdate'
    || /^\/values\/[\w'%!:$]+:append\?valueInputOption=RAW&insertDataOption=INSERT_ROWS$/.test(path));
}

function driveRequest(path, options = {}) {
  return UrlFetchApp.fetch('https://www.googleapis.com/' + path, {
    muteHttpExceptions: true, followRedirects: false,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    ...options,
  });
}

function photoFolder() {
  const properties = PropertiesService.getScriptProperties();
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const existing = properties.getProperty('CRM_PHOTO_FOLDER');
    if (existing) return existing;
    const response = driveRequest('drive/v3/files?fields=id', {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ name: 'HAVAN CRM Photos', mimeType: 'application/vnd.google-apps.folder' }),
    });
    if (response.getResponseCode() !== 200) throw new Error('Cannot create the CRM photo folder');
    const folder = JSON.parse(response.getContentText()).id;
    if (!folder) throw new Error('Drive did not return a folder ID');
    properties.setProperty('CRM_PHOTO_FOLDER', folder);
    return folder;
  } finally {
    lock.releaseLock();
  }
}

function photos(request) {
  const images = /^image\/(jpeg|png|webp|gif|heic|heif)$/;
  if (request.kind === 'photo-get') {
    if (!/^[\w-]{3,120}$/.test(request.fileId || '')) return reply(403, {});
    if (!isCrmPhoto(request.fileId)) return reply(404, {});
    const response = driveRequest('drive/v3/files/' + request.fileId + '?alt=media&supportsAllDrives=true');
    if (response.getResponseCode() !== 200) return reply(response.getResponseCode(), {});
    const blob = response.getBlob(), mime = blob.getContentType(), bytes = blob.getBytes();
    if (!images.test(mime) || bytes.length > 5000000) return reply(403, {});
    return reply(200, { mime, base64: Utilities.base64Encode(bytes) });
  }
  if (!images.test(request.mime || '') ||
      typeof request.base64 !== 'string' || request.base64.length > 6700000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(request.base64)) return reply(400, {});
  const folderId = photoFolder();
  const name = String(request.name || 'CRM photo').replace(/[\/\\]/g, '_').slice(0, 180);
  const boundary = 'crm-' + Utilities.getUuid();
  const payload = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'
    + JSON.stringify({ name, parents: [folderId] })
    + '\r\n--' + boundary + '\r\nContent-Type: ' + request.mime
    + '\r\nContent-Transfer-Encoding: base64\r\n\r\n' + request.base64 + '\r\n--' + boundary + '--';
  const response = driveRequest('upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id', {
    method: 'post', contentType: 'multipart/related; boundary=' + boundary, payload,
  });
  if (response.getResponseCode() !== 200) return reply(response.getResponseCode(), {});
  return reply(200, { fileId: JSON.parse(response.getContentText()).id, folderId });
}

function reply(status, result) {
  return rawReply(status, JSON.stringify(result));
}

function rawReply(status, body) {
  return ContentService.createTextOutput(status + '\n' + body).setMimeType(ContentService.MimeType.TEXT);
}
