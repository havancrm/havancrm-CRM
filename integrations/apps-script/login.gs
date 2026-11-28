const CRM_ORIGINS = ['https://staging-crm.havan-crm.workers.dev', 'https://crm.havan-crm.workers.dev'];

function doGet(event) {
  const { origin, state } = event.parameter;
  if (!CRM_ORIGINS.includes(origin) || !/^[a-f0-9-]{36}$/.test(state || '')) {
    return HtmlService.createHtmlOutput('กรุณาเริ่มเข้าสู่ระบบจากหน้า HAVAN CRM');
  }
  const email = Session.getActiveUser().getEmail().toLowerCase();
  const secret = PropertiesService.getScriptProperties().getProperty('CRM_LOGIN_SECRET');
  if (!email || !secret || secret.length < 32) {
    return HtmlService.createHtmlOutput('ยังไม่สามารถยืนยันบัญชี Google ของคุณกับ HAVAN CRM ได้');
  }
  const payload = Utilities.base64EncodeWebSafe(JSON.stringify({ email, origin, exp: Date.now() + 4 * 3600000 })).replace(/=+$/, '');
  const signature = Utilities.computeHmacSha256Signature('crm-login-v1.' + payload, secret)
    .map(byte => (byte & 255).toString(16).padStart(2, '0')).join('');
  const url = origin + '/#crm-login=' + payload + '.' + signature + '&amp;state=' + state;
  return HtmlService.createHtmlOutput('<meta name="viewport" content="width=device-width, initial-scale=1"><p>ยืนยันบัญชี Google แล้ว</p><p><a target="_top" href="' + url + '">กลับไปเข้า HAVAN CRM</a></p>');
}
