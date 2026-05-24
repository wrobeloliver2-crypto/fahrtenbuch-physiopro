const https = require('https');
const crypto = require('crypto');

const SHEET_ID = '1e5U3sTeNW27KX4jfQY_yaO9Pu2XvKo9IJZZKn6nvgQo';
const CLIENT_EMAIL = 'physiopro-zeiterfassung@drop-in-ticket-umwandeln.iam.gserviceaccount.com';
const PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDXtnLzE3mL6jHc\nyGPS2XzOFCV8HZIvT3tSU7ui74vEZXnECmNlD7SVFWphozL2VyQt6F/17yduO+j6\nN96/GVS90CJgUrt7SbCfxYVxrac779QCPbiWLMJjBGG7evlWOcqrojMVyqadAJe2\n42nbuPdvLUS5ZRDh7WKuujGs4DK4RaeVQLt7mRtsZgEmjw/3yTiFM5Ls5GLplb2y\njbvlAKZ6VV5Pn9F26wmFKp7otqzP5uS1oBp6AKHxg3F+w81IHN/S/44sgo/My2c0\nRhsZQEyfwd5Rck1rFqiEwN1Z7vFtMLPbNibfDyzfpYenB2a+1cjYVYL+7lcjMnMW\ncHQHWuBtAgMBAAECggEAA+XzbYw7MyM/YiJjiwgspStZvESeVqLWU1f/74aDzVlz\nHTvKoFhe3R6m6A6zT7g/7ZRCBbECeQ+PZ7qYpY+MFHKqNSweYL1ybTsin/nXwf5h\nyhktvu/Rb6/A1creLifhtbI68s7q4P8r5R12ruz72PAlvYvDkn2mfddcdfR53iwb\n+YNrq6UZWqCYVe0FMencnTdek+cxZSWt86uq3I74x4OHf9K8vn10CfwzOkqD2JJL\nYRzJS4dIpjdYqwrKcSZ78qzEw5hz028u9MW5ZifecquZwYH1mPFmcKvSiiffha8X\ngYfzQprFXBBIqLdTSq0IoLmCwwjRm9d/LlbzEdxkEQKBgQD0/LF8fBlexIGyXruI\nZnPYE0XyNF+y0WtoBPWiw3gs3j6ywJ/Fnbk4HqmHaCJn3hnEW0LjKUTA3pnZOojb\nN7vElfm3whCsbzbfZmYdpDp9oCWEVJA4vzWKrHSNlk6+mYLdCcIsk6TFqY08xtd6\nY1qJjD2b/1c2UtjEXiWmbebdXQKBgQDhaN3XsgwgyyK6zxk5Lv5ZC+svw/hMHYKD\npJOQFbaSeGkmquiJNfqCVZp/a12K1x6NAB39anBhyub7lIdm7bw5zOPkqwGJ0QZv\nG4gsbm0Yn03tAIWhnO7VyTJ33XmOJlJl5/QBsl+BisCa+1bchh9vjSshyvjlNSQV\nJYdrxwbOUQKBgQCKzhGRwo5tT1FcyqfeZI4GQwVCccI3AsikKwsxqSaR5WoIxXLA\n+NhUn6rV+X5k80YOJtcC9gLqdDUfCzc3XaCZhY/zOZVQ3cJtWQtKiB5Lx0z6aR89\nx7iCVavD/QGopDmtGzZVI2IcTDCl2tODmH9Xp4nQtR+ou8/tkpoqbeJ8UQKBgQDW\ny6pSp2zdNxWSNFVR45EmY7Aq5TDPv3MmZQbkz3wZ2TpCSayrS8+6sT43W6VY76NC\nM7FgUjRjTAmOBTx9/d9WqQMlXTtrC894wyChTl0RkISeatfsaHJDMKWyCU+TALuW\nNlGT6FkQRZtCVG2yWPDNyRUn75X8PQZ0TD3em1rF8QKBgFIjLiynoK9kFKAYIl9y\nmZMQTMuCfxikRlN+HZMyrbfOphMxqlwaB4iqpNIk/E3BZ99hfmFVd/yHLQJcriJm\n+u26BkFlDQGsC147E5Sg7Jnr+nCUP8p1FIZK4e0ZilKCLxS8PZ2Z9zM7XQ2VOdCG\n9EKgccifGgYt9y4nutlYh7j1\n-----END PRIVATE KEY-----\n";

const SHEET_FAHRTEN    = 'Fahrten';
const SHEET_ABSCHLUSS  = 'Abschluesse';

// ── JWT & Token ──────────────────────────────────────────────
function createJWT() {
  const now = Math.floor(Date.now()/1000);
  const header  = Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
  const payload = Buffer.from(JSON.stringify({iss:CLIENT_EMAIL,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',exp:now+3600,iat:now})).toString('base64url');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  return `${header}.${payload}.${sign.sign(PRIVATE_KEY,'base64url')}`;
}

function getToken() {
  return new Promise((resolve,reject) => {
    const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${createJWT()}`;
    const req = https.request({hostname:'oauth2.googleapis.com',path:'/token',method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':body.length}},(res)=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d).access_token);}catch(e){reject(new Error('Token: '+d));} });
    }); req.on('error',reject); req.write(body); req.end();
  });
}

// ── Sheet lesen ──────────────────────────────────────────────
function readSheet(token, range) {
  return new Promise((resolve,reject) => {
    const path = `/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}`;
    https.get({hostname:'sheets.googleapis.com',path,headers:{Authorization:`Bearer ${token}`}},(res)=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d));}catch(e){reject(new Error('Parse: '+d));} });
    }).on('error',reject);
  });
}

function rowsToObjects(data) {
  if (!data.values||data.values.length<2) return [];
  const h = data.values[0];
  return data.values.slice(1).map(r=>{ const o={}; h.forEach((k,i)=>o[k]=r[i]||''); return o; });
}

// ── Sheet schreiben ──────────────────────────────────────────
function appendRow(token, sheet, values) {
  return new Promise((resolve,reject) => {
    const body = JSON.stringify({values:[values]});
    const path = `/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(sheet)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const req = https.request({hostname:'sheets.googleapis.com',path,method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},(res)=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(d));
    }); req.on('error',reject); req.write(body); req.end();
  });
}

function ensureHeaders(token, sheet, headers) {
  return new Promise(async (resolve,reject) => {
    try {
      const data = await readSheet(token, sheet+'!1:1');
      if (!data.values||!data.values[0]||data.values[0].length===0) {
        await appendRow(token, sheet, headers);
      }
      resolve();
    } catch(e) { resolve(); }
  });
}

// ── Batch Update (Status) ────────────────────────────────────
function batchUpdate(token, updates) {
  return new Promise((resolve,reject) => {
    const body = JSON.stringify({valueInputOption:'RAW',data:updates});
    const req = https.request({hostname:'sheets.googleapis.com',path:`/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`,method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},(res)=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(JSON.parse(d)));
    }); req.on('error',reject); req.write(body); req.end();
  });
}

// ── Handler ─────────────────────────────────────────────────
exports.handler = async (event) => {
  const CORS = {'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
  if (event.httpMethod==='OPTIONS') return {statusCode:200,headers:CORS,body:''};

  try {
    const token = await getToken();
    const isPost = event.httpMethod==='POST';
    const body   = isPost ? JSON.parse(event.body||'{}') : {};
    const action = (event.queryStringParameters?.action || body.action || '');

    // ── GET: Fahrten laden ──
    if (action==='getEntries') {
      const mit = event.queryStringParameters?.mitarbeiter||'';
      await ensureHeaders(token, SHEET_FAHRTEN, ['Mitarbeiter','Name','Datum','Abfahrt','Ziel','km','Kosten (€)','Fahrzeit','Zweck','Eingetragen am','ID']);
      const data = await readSheet(token, SHEET_FAHRTEN);
      let entries = rowsToObjects(data);
      if (mit) entries = entries.filter(e=>e['Mitarbeiter']===mit);
      return {statusCode:200,headers:CORS,body:JSON.stringify({entries})};
    }

    // ── GET: Abrechnungen laden ──
    if (action==='getSubmissions') {
      await ensureHeaders(token, SHEET_ABSCHLUSS, ['Mitarbeiter','Name','Monat','Status','Fahrten','km gesamt','Kosten gesamt','Eingereicht am','Genehmigt am','Ausgezahlt am','Kommentar','Eintraege (JSON ID)','ID']);
      const data = await readSheet(token, SHEET_ABSCHLUSS);
      const submissions = rowsToObjects(data);
      return {statusCode:200,headers:CORS,body:JSON.stringify({submissions})};
    }

    // ── POST: Fahrt hinzufügen ──
    if (action==='addEntry') {
      await ensureHeaders(token, SHEET_FAHRTEN, ['Mitarbeiter','Name','Datum','Abfahrt','Ziel','km','Kosten (€)','Fahrzeit','Zweck','Eingetragen am','ID']);
      await appendRow(token, SHEET_FAHRTEN, [
        body.mitarbeiter, body.mitarbeiterName||'',
        body.datum, body.von, body.nach,
        body.km, body.kosten, body.dauer||'', body.zweck||'',
        new Date().toLocaleDateString('de-DE'), String(body.id||Date.now())
      ]);
      return {statusCode:200,headers:CORS,body:JSON.stringify({ok:true})};
    }

    // ── POST: Abrechnung einreichen ──
    if (action==='addSubmission') {
      await ensureHeaders(token, SHEET_ABSCHLUSS, ['Mitarbeiter','Name','Monat','Status','Fahrten','km gesamt','Kosten gesamt','Eingereicht am','Genehmigt am','Ausgezahlt am','Kommentar','Eintraege (JSON ID)','ID']);
      const subId = body.mitarbeiter+'_'+new Date().toISOString().substring(0,10);
      await appendRow(token, SHEET_ABSCHLUSS, [
        body.mitarbeiter, body.mitarbeiterName||'',
        new Date().toISOString().substring(0,7),
        'pending', body.fahrten, body.km, body.kosten,
        new Date().toLocaleDateString('de-DE'),
        '','','', JSON.stringify(body.entries||[]), subId
      ]);
      return {statusCode:200,headers:CORS,body:JSON.stringify({ok:true})};
    }

    // ── POST: Status updaten ──
    if (action==='updateStatus') {
      const data = await readSheet(token, SHEET_ABSCHLUSS);
      const rows = data.values||[];
      if (rows.length<2) return {statusCode:200,headers:CORS,body:JSON.stringify({ok:true,msg:'leer'})};
      const headers = rows[0];
      const mitCol  = headers.indexOf('Mitarbeiter');
      const statCol = headers.indexOf('Status');
      const apprCol = headers.indexOf('Genehmigt am');
      const paidCol = headers.indexOf('Ausgezahlt am');
      const commCol = headers.indexOf('Kommentar');
      const idCol   = headers.indexOf('ID');
      const col = n => String.fromCharCode(65+n);
      const target = body.mitarbeiter||'';
      const updates = [];
      for (let i=1;i<rows.length;i++) {
        const rowMit = String(rows[i][mitCol]||'').split('_')[0];
        const rowId  = String(rows[i][idCol]||'');
        const match  = rowMit===target || rowId===body.rowId;
        if (!match) continue;
        const r = i+1;
        if (statCol>=0) updates.push({range:`${SHEET_ABSCHLUSS}!${col(statCol)}${r}`,values:[[body.status]]});
        if (body.comment && commCol>=0) updates.push({range:`${SHEET_ABSCHLUSS}!${col(commCol)}${r}`,values:[[body.comment]]});
        if (body.status==='approved'&&apprCol>=0) updates.push({range:`${SHEET_ABSCHLUSS}!${col(apprCol)}${r}`,values:[[new Date().toLocaleDateString('de-DE')]]});
        if (body.status==='paid'&&paidCol>=0)     updates.push({range:`${SHEET_ABSCHLUSS}!${col(paidCol)}${r}`,values:[[new Date().toLocaleDateString('de-DE')]]});
        if (body.status==='rejected'&&commCol>=0&&body.comment) updates.push({range:`${SHEET_ABSCHLUSS}!${col(commCol)}${r}`,values:[[body.comment]]});
      }
      if (updates.length) await batchUpdate(token, updates);
      return {statusCode:200,headers:CORS,body:JSON.stringify({ok:true,updated:updates.length})};
    }

    return {statusCode:200,headers:CORS,body:JSON.stringify({status:'Fahrtenbuch API'})};

  } catch(e) {
    return {statusCode:500,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:JSON.stringify({error:e.message})};
  }
};
