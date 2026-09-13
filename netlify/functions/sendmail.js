// E-Mail-Versand über Microsoft Graph (Absender hanna.wrobel@pilatescompany.de).
// Wird von fahrten.js genutzt (Einreichung an die Verwaltung, Beleg an die Buchhaltung).
// Der frühere offene Endpunkt ist abgeschaltet – Mails gehen nur noch aus der
// geprüften Sitzung heraus.

const https = require('https');

const TENANT_ID = process.env.AZURE_TENANT_ID;
const CLIENT_ID = process.env.AZURE_CLIENT_ID;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;
const FROM_EMAIL = process.env.MAIL_FROM || 'hanna.wrobel@pilatescompany.de';

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'POST', headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function getAccessToken() {
  const body = 'grant_type=client_credentials'
    + '&client_id=' + encodeURIComponent(CLIENT_ID)
    + '&client_secret=' + encodeURIComponent(CLIENT_SECRET)
    + '&scope=' + encodeURIComponent('https://graph.microsoft.com/.default');
  const res = await httpsPost('login.microsoftonline.com', `/${TENANT_ID}/oauth2/v2.0/token`,
    { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': body.length }, body);
  const json = JSON.parse(res.body);
  if (!json.access_token) throw new Error('Token error: ' + res.body);
  return json.access_token;
}

async function sendEmail(token, to, subject, htmlBody) {
  const mail = JSON.stringify({
    message: { subject, body: { contentType: 'HTML', content: htmlBody }, toRecipients: [{ emailAddress: { address: to } }] },
    saveToSentItems: true,
  });
  return httpsPost('graph.microsoft.com', `/v1.0/users/${FROM_EMAIL}/sendMail`,
    { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(mail) }, mail);
}

exports.getAccessToken = getAccessToken;
exports.sendEmail = sendEmail;

exports.handler = async () => ({
  statusCode: 410,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ error: 'Mails werden über /.netlify/functions/fahrten versendet.' }),
});
