const https = require('https');

const TENANT_ID = process.env.AZURE_TENANT_ID;
const CLIENT_ID = process.env.AZURE_CLIENT_ID;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;
const FROM_EMAIL = 'hanna.wrobel@pilatescompany.de';

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'POST', headers }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function getAccessToken() {
  // Manuell encoden damit Sonderzeichen im Secret korrekt behandelt werden
  const body = 'grant_type=client_credentials'
    + '&client_id=' + encodeURIComponent(CLIENT_ID)
    + '&client_secret=' + encodeURIComponent(CLIENT_SECRET)
    + '&scope=' + encodeURIComponent('https://graph.microsoft.com/.default');

  const res = await httpsPost(
    'login.microsoftonline.com',
    `/${TENANT_ID}/oauth2/v2.0/token`,
    { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': body.length },
    body
  );
  const json = JSON.parse(res.body);
  if (!json.access_token) throw new Error('Token error: ' + res.body);
  return json.access_token;
}

async function sendEmail(token, to, subject, htmlBody) {
  const mail = JSON.stringify({
    message: {
      subject,
      body: { contentType: 'HTML', content: htmlBody },
      toRecipients: [{ emailAddress: { address: to } }]
    },
    saveToSentItems: true
  });

  const res = await httpsPost(
    'graph.microsoft.com',
    `/v1.0/users/${FROM_EMAIL}/sendMail`,
    {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(mail)
    },
    mail
  );
  return res;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const body = JSON.parse(event.body || '{}');
    const { name, fahrten, km, kosten, datum, entries, type } = body;

    // Benachrichtigung an Hanna bei neuer Einreichung
    if (type === 'notification') {
      const token = await getAccessToken();
      const subject = 'Neue Abrechnung: ' + name;
      const htmlBody = '<div style="font-family:Arial,sans-serif;padding:20px">'+
        '<h2 style="color:#2c2825">Neue Abrechnung eingereicht</h2>'+
        '<p><b>'+name+'</b> hat eine neue Abrechnung eingereicht:</p>'+
        '<ul><li>Fahrten: '+fahrten+'</li>'+
        '<li>Kilometer: '+km+' km</li>'+
        '<li>Betrag: '+kosten+' €</li></ul>'+
        '<p>Bitte in der Fahrtenbuch-App unter <b>Admin</b> prüfen und genehmigen.</p>'+
        '<p style="color:#888;font-size:12px">physiofahrtenbuch.netlify.app</p></div>';
      const result = await sendEmail(token, 'hanna.wrobel@pilatescompany.de', subject, htmlBody);
      if (result.status === 202) return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
      else return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: result.body }) };
    }

    const rows = (entries || []).map(e => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${e.datum||''}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${e.von||''} → ${e.nach||''}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">${e.km||0} km</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${parseFloat(e.kosten||0).toFixed(2)} €</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${e.zweck||'–'}</td>
      </tr>`).join('');

    const htmlBody = `
      <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;color:#2c2825">
        <div style="background:#2c2825;padding:20px 24px;border-radius:8px 8px 0 0">
          <h1 style="color:#faf8f4;font-size:20px;margin:0">PhysioPro Lübeck</h1>
          <p style="color:rgba(250,248,244,0.6);margin:4px 0 0;font-size:12px">FAHRTKOSTENABRECHNUNG</p>
        </div>
        <div style="background:#f5f5f0;padding:16px 24px">
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:4px 0;color:#888;font-size:12px">Mitarbeiter:in</td><td style="font-weight:bold">${name}</td></tr>
            <tr><td style="padding:4px 0;color:#888;font-size:12px">Eingereicht am</td><td>${datum}</td></tr>
            <tr><td style="padding:4px 0;color:#888;font-size:12px">Km-Pauschale</td><td>0,30 € / km</td></tr>
          </table>
        </div>
        <div style="padding:20px 24px">
          <table style="width:100%;border-collapse:collapse">
            <thead>
              <tr style="background:#2c2825;color:#faf8f4">
                <th style="padding:8px 10px;text-align:left;font-size:12px">Datum</th>
                <th style="padding:8px 10px;text-align:left;font-size:12px">Route</th>
                <th style="padding:8px 10px;text-align:center;font-size:12px">km</th>
                <th style="padding:8px 10px;text-align:right;font-size:12px">Betrag</th>
                <th style="padding:8px 10px;text-align:left;font-size:12px">Zweck</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
            <tfoot>
              <tr style="background:#e8f0ea;font-weight:bold">
                <td colspan="2" style="padding:10px">Gesamt (${fahrten} Fahrten)</td>
                <td style="padding:10px;text-align:center">${km} km</td>
                <td style="padding:10px;text-align:right">${parseFloat(kosten).toFixed(2)} €</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div style="padding:16px 24px;border-top:1px solid #eee;font-size:12px;color:#888">
          Bitte überweise den Betrag an die Mitarbeiter:in.<br>
          PhysioPro Lübeck · Segeberger Str. 1 · 23617 Stockelsdorf
        </div>
      </div>`;

    const token = await getAccessToken();
    const result = await sendEmail(
      token,
      'physioproluebeck@getmyinvoices.net',
      `Fahrtkostenabrechnung ${name} – ${datum}`,
      htmlBody
    );

    if (result.status === 202) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    } else {
      return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: result.body }) };
    }
  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
