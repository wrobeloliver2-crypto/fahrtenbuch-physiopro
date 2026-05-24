const https = require('https');

exports.handler = async (event) => {
  const { action, mitarbeiter } = event.queryStringParameters || {};
  const SCRIPT_ID = 'AKfycbzgAg4IfoQP_BJHpQ8iD92r6lfr-TDcp1gelbbmxiN_qJEjjTeczgjMVKjq4EuOS9sm';
  const SCRIPT_URL = `https://script.google.com/macros/s/${SCRIPT_ID}/exec`;
  
  let url = `${SCRIPT_URL}?action=${action||'getSubmissions'}`;
  if (mitarbeiter) url += `&mitarbeiter=${encodeURIComponent(mitarbeiter)}`;

  console.log('Fetching:', url);

  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Netlify Function)',
        'Accept': 'application/json, text/javascript, */*',
      },
      followRedirects: true
    }, (res) => {
      console.log('Status:', res.statusCode);
      console.log('Headers:', JSON.stringify(res.headers));
      
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('Response:', data.substring(0, 200));
        resolve({
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          },
          body: JSON.stringify({ raw: data, status: res.statusCode })
        });
      });
    });
    req.on('error', (e) => {
      console.error('Error:', e.message);
      resolve({
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: e.message })
      });
    });
  });
};
