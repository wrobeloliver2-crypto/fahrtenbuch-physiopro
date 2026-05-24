const https = require('https');
const crypto = require('crypto');

const SHEET_ID = '1e5U3sTeNW27KX4jfQY_yaO9Pu2XvKo9IJZZKn6nvgQo';
const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL || 'physiopro-zeiterfassung@drop-in-ticket-umwandeln.iam.gserviceaccount.com';
const PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

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
      const submissions = rowsToObjects(data).map((s,i)=>({...s,_rowIdx:i+2})); // +2 weil Header = Zeile 1
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
      const subId = body.mitarbeiter+'_'+new Date().toISOString().substring(0,19).replace(/[:T]/g,'-');
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
      const statCol = headers.indexOf('Status');
      const apprCol = headers.indexOf('Genehmigt am');
      const paidCol = headers.indexOf('Ausgezahlt am');
      const commCol = headers.indexOf('Kommentar');
      const idCol   = headers.indexOf('ID');
      const col = n => String.fromCharCode(65+n);
      const updates = [];
      for (let i=1;i<rows.length;i++) {
        // Exaktes Match auf rowId UND rowIdx
        const rowId = String(rows[i][idCol]||'');
        const rowIdx = i + 1; // 1-basiert
        // rowIdx hat Vorrang wenn übergeben, sonst rowId
        const matchByIdx = body.rowIdx && rowIdx === body.rowIdx;
        const matchById  = body.rowId && rowId === body.rowId;
        if (!matchByIdx && !matchById) continue;
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
