const https = require('https');

exports.handler = async (event) => {
  const { action, mitarbeiter } = event.queryStringParameters || {};
  const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzgAg4IfoQP_BJHpQ8iD92r6lfr-TDcp1gelbbmxiN_qJEjjTeczgjMVKjq4EuOS9sm/exec';
  
  let url = `${SCRIPT_URL}?action=${action||'getSubmissions'}`;
  if (mitarbeiter) url += `&mitarbeiter=${encodeURIComponent(mitarbeiter)}`;

  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        // JSONP unwrappen falls nötig
        let json = data;
        const match = data.match(/^[^(]+\((.*)\)$/s);
        if (match) json = match[1];
        resolve({
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          },
          body: json
        });
      });
    }).on('error', (e) => {
      resolve({
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: e.message })
      });
    });
  });
};
