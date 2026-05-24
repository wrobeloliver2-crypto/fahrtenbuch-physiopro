const https = require('https');
const crypto = require('crypto');

const SHEET_ID = '1e5U3sTeNW27KX4jfQY_yaO9Pu2XvKo9IJZZKn6nvgQo';
const CLIENT_EMAIL = 'physiopro-zeiterfassung@drop-in-ticket-umwandeln.iam.gserviceaccount.com';
const PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDXtnLzE3mL6jHc\nyGPS2XzOFCV8HZIvT3tSU7ui74vEZXnECmNlD7SVFWphozL2VyQt6F/17yduO+j6\nN96/GVS90CJgUrt7SbCfxYVxrac779QCPbiWLMJjBGG7evlWOcqrojMVyqadAJe2\n42nbuPdvLUS5ZRDh7WKuujGs4DK4RaeVQLt7mRtsZgEmjw/3yTiFM5Ls5GLplb2y\njbvlAKZ6VV5Pn9F26wmFKp7otqzP5uS1oBp6AKHxg3F+w81IHN/S/44sgo/My2c0\nRhsZQEyfwd5Rck1rFqiEwN1Z7vFtMLPbNibfDyzfpYenB2a+1cjYVYL+7lcjMnMW\ncHQHWuBtAgMBAAECggEAA+XzbYw7MyM/YiJjiwgspStZvESeVqLWU1f/74aDzVlz\nHTvKoFhe3R6m6A6zT7g/7ZRCBbECeQ+PZ7qYpY+MFHKqNSweYL1ybTsin/nXwf5h\nyhktvu/Rb6/A1creLifhtbI68s7q4P8r5R12ruz72PAlvYvDkn2mfddcdfR53iwb\n+YNrq6UZWqCYVe0FMencnTdek+cxZSWt86uq3I74x4OHf9K8vn10CfwzOkqD2JJL\nYRzJS4dIpjdYqwrKcSZ78qzEw5hz028u9MW5ZifecquZwYH1mPFmcKvSiiffha8X\ngYfzQprFXBBIqLdTSq0IoLmCwwjRm9d/LlbzEdxkEQKBgQD0/LF8fBlexIGyXruI\nZnPYE0XyNF+y0WtoBPWiw3gs3j6ywJ/Fnbk4HqmHaCJn3hnEW0LjKUTA3pnZOojb\nN7vElfm3whCsbzbfZmYdpDp9oCWEVJA4vzWKrHSNlk6+mYLdCcIsk6TFqY08xtd6\nY1qJjD2b/1c2UtjEXiWmbebdXQKBgQDhaN3XsgwgyyK6zxk5Lv5ZC+svw/hMHYKD\npJOQFbaSeGkmquiJNfqCVZp/a12K1x6NAB39anBhyub7lIdm7bw5zOPkqwGJ0QZv\nG4gsbm0Yn03tAIWhnO7VyTJ33XmOJlJl5/QBsl+BisCa+1bchh9vjSshyvjlNSQV\nJYdrxwbOUQKBgQCKzhGRwo5tT1FcyqfeZI4GQwVCccI3AsikKwsxqSaR5WoIxXLA\n+NhUn6rV+X5k80YOJtcC9gLqdDUfCzc3XaCZhY/zOZVQ3cJtWQtKiB5Lx0z6aR89\nx7iCVavD/QGopDmtGzZVI2IcTDCl2tODmH9Xp4nQtR+ou8/tkpoqbeJ8UQKBgQDW\ny6pSp2zdNxWSNFVR45EmY7Aq5TDPv3MmZQbkz3wZ2TpCSayrS8+6sT43W6VY76NC\nM7FgUjRjTAmOBTx9/d9WqQMlXTtrC894wyChTl0RkISeatfsaHJDMKWyCU+TALuW\nNlGT6FkQRZtCVG2yWPDNyRUn75X8PQZ0TD3em1rF8QKBgFIjLiynoK9kFKAYIl9y\nmZMQTMuCfxikRlN+HZMyrbfOphMxqlwaB4iqpNIk/E3BZ99hfmFVd/yHLQJcriJm\n+u26BkFlDQGsC147E5Sg7Jnr+nCUP8p1FIZK4e0ZilKCLxS8PZ2Z9zM7XQ2VOdCG\n9EKgccifGgYt9y4nutlYh7j1\n-----END PRIVATE KEY-----\n";

// JWT erstellen für Google API Auth
function createJWT() {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  })).toString('base64url');
  
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(PRIVATE_KEY, 'base64url');
  return `${header}.${payload}.${signature}`;
}

// Access Token holen
function getAccessToken() {
  return new Promise((resolve, reject) => {
    const jwt = createJWT();
    const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': body.length }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data).access_token); }
        catch(e) { reject(new Error('Token parse error: ' + data)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Sheet Daten lesen
function readSheet(token, range) {
  return new Promise((resolve, reject) => {
    const path = `/v4/spreadsheets/${SHEET_ID}/values/${range.includes('%') ? range : encodeURIComponent(range)}`;
    https.get({
      hostname: 'sheets.googleapis.com',
      path,
      headers: { Authorization: `Bearer ${token}` }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Parse error: ' + data)); }
      });
    }).on('error', reject);
  });
}

// Rows zu Objekte umwandeln
function rowsToObjects(data) {
  if (!data.values || data.values.length < 2) return [];
  const headers = data.values[0];
  return data.values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i] || '');
    return obj;
  });
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  const { action, mitarbeiter } = event.queryStringParameters || {};

  try {
    const token = await getAccessToken();

    if (action === 'getEntries') {
      const data = await readSheet(token, 'Fahrten!A:K');
      let entries = rowsToObjects(data);
      if (mitarbeiter) entries = entries.filter(e => e['Mitarbeiter'] === mitarbeiter);
      return { statusCode: 200, headers, body: JSON.stringify({ entries }) };
    }

    if (action === 'getSubmissions') {
      const data = await readSheet(token, 'Abschluesse');
      const submissions = rowsToObjects(data);
      return { statusCode: 200, headers, body: JSON.stringify({ submissions }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ status: 'Fahrtenbuch API aktiv' }) };

  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
