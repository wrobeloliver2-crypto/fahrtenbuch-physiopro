// Fahrtenbuch – Fachlogik auf Neon Postgres (Fahrten, Abrechnungen).
// Ein Endpunkt, Aktionen über {action, data, token}.
//
// Login und PIN laufen über den zentralen Mitarbeiter-Dienst (mitarbeiter-api).
// Der dort ausgestellte Token wird hier mit demselben ZEIT_TOKEN_SECRET geprüft.
//
// Umgebungsvariablen (Netlify): DATABASE_URL, ZEIT_TOKEN_SECRET,
// AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET (Mails über Graph)
//
// Aktionen:
//   laden          – meine offenen Fahrten, meine Abrechnungen; Verwaltung: alle Abrechnungen
//   fahrtAnlegen   – { datum, von, nach, km, kosten, fahrzeit, zweck }
//   fahrtLoeschen  – { id }  (nur eigene, noch nicht eingereichte)
//   einreichen     – alle offenen Fahrten zu einer Abrechnung zusammenfassen (Mail an Verwaltung)
//   entscheiden    – (Verwaltung) { id, status: genehmigt|abgelehnt|ausgezahlt, kommentar }
//   buchhaltung    – (Verwaltung) { id } Beleg per Mail an die Buchhaltung
//   importSheet    – (Admin) Altdaten aus dem alten Google Sheet übernehmen (einmalig, idempotent)

const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');
const mail = require('./sendmail');

const sql = neon(process.env.DATABASE_URL);
const SECRET = process.env.ZEIT_TOKEN_SECRET || '';
const KM_SATZ = 0.30;
const FIRMA_ID = 1; // Physio Pro Lübeck – das Fahrtenbuch gibt es nur dort
const BUCHHALTUNG = 'physioproluebeck@getmyinvoices.net';
const VERWALTUNG_MAIL = 'hanna.wrobel@pilatescompany.de';

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
const ok  = (body) => ({ statusCode: 200, headers: HEADERS, body: JSON.stringify(body) });
const err = (code, msg) => ({ statusCode: code, headers: HEADERS, body: JSON.stringify({ error: msg }) });

// ── Token (ausgestellt vom Mitarbeiter-Dienst) ──────────────────────────────
function tokenPruefen(token) {
  if (!token || typeof token !== 'string' || !SECRET) return null;
  const teile = token.split('.');
  if (teile.length !== 2) return null;
  const soll = crypto.createHmac('sha256', SECRET).update(teile[0]).digest('base64url');
  const a = Buffer.from(soll), b = Buffer.from(teile[1]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(teile[0], 'base64url').toString()); } catch { return null; }
  if (!p.exp || p.exp < Date.now()) return null;
  return p;
}

async function ichLaden(mfId) {
  const rows = await sql`
    select mf.id, mf.mitarbeiter_id, mf.firma_id, mf.rolle, mf.aktiv,
           m.vorname || ' ' || m.nachname as name, m.vorname, m.email
    from mitarbeiter_firma mf join mitarbeiter m on m.id = mf.mitarbeiter_id
    where mf.id = ${mfId}`;
  return rows[0] || null;
}
const darfEntscheiden = (rolle) => rolle === 'admin' || rolle === 'genehmiger';

// ── Hilfen ───────────────────────────────────────────────────────────────────
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(n) ? 0 : n; };
const ms = (v) => (v ? new Date(v).getTime() : null);
const iso = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');
const esc = (v) => String(v || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const de = (d) => (d ? new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');

function fahrtRaus(f) {
  return {
    id: Number(f.id), mfId: String(f.mitarbeiter_firma_id), datum: iso(f.datum), von: f.von, nach: f.nach,
    km: Number(f.km), kosten: Number(f.kosten), fahrzeit: f.fahrzeit || '', zweck: f.zweck || '',
    abrechnungId: f.abrechnung_id, erstelltAm: ms(f.erstellt_am),
  };
}
function abrechnungRaus(a, fahrten) {
  return {
    id: a.id, mfId: String(a.mitarbeiter_firma_id), name: a.name || '', status: a.status,
    anzahl: Number(a.anzahl), km: Number(a.km), kosten: Number(a.kosten), kommentar: a.kommentar || '',
    eingereichtAm: ms(a.eingereicht_am), entschiedenAm: ms(a.entschieden_am), ausgezahltAm: ms(a.ausgezahlt_am),
    entschiedenVon: a.entschieden_von_name || '',
    fahrten: (fahrten || []).map(fahrtRaus),
  };
}

async function abrechnungenLaden(where) {
  const abr = await sql`
    select a.*, m.vorname || ' ' || m.nachname as name,
           (select e.vorname || ' ' || e.nachname from mitarbeiter e where e.id = a.entschieden_von) as entschieden_von_name
    from fb_abrechnungen a
    join mitarbeiter_firma mf on mf.id = a.mitarbeiter_firma_id
    join mitarbeiter m on m.id = mf.mitarbeiter_id
    where (${where.mf}::int is null or a.mitarbeiter_firma_id = ${where.mf})
      and mf.firma_id = ${FIRMA_ID}
    order by a.eingereicht_am desc limit 300`;
  if (!abr.length) return [];
  const ids = abr.map((a) => a.id);
  const fahrten = await sql`select * from fb_fahrten where abrechnung_id = any(${ids}) and geloescht_am is null order by datum, id`;
  const nachAbr = {};
  fahrten.forEach((f) => { (nachAbr[f.abrechnung_id] = nachAbr[f.abrechnung_id] || []).push(f); });
  return abr.map((a) => abrechnungRaus(a, nachAbr[a.id]));
}

// Hinweis im persönlichen Bereich (Portal / Zeiterfassung) – über den zentralen Dialog
async function hinweis(betreff, text, empfaengerMitarbeiterId, vonMitarbeiterId, quelle) {
  try {
    await sql`select dialog_eroeffnen(${betreff}, ${text}, ${[empfaengerMitarbeiterId]}::int[], ${vonMitarbeiterId}, ${FIRMA_ID}, 'system', ${quelle}, 'fahrtenbuch', 'system')`;
  } catch (e) { console.error('Hinweis fehlgeschlagen:', e.message); }
}

function belegTabelle(a) {
  const rows = a.fahrten.map((e) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${de(e.datum)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(e.von)} → ${esc(e.nach)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">${e.km} km</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${e.kosten.toFixed(2)} €</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(e.zweck) || '–'}</td>
      </tr>`).join('');
  return `
      <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;color:#2c2825">
        <div style="background:#2c2825;padding:20px 24px;border-radius:8px 8px 0 0">
          <h1 style="color:#faf8f4;font-size:20px;margin:0">PhysioPro Lübeck</h1>
          <p style="color:rgba(250,248,244,0.6);margin:4px 0 0;font-size:12px">FAHRTKOSTENABRECHNUNG</p>
        </div>
        <div style="background:#f5f5f0;padding:16px 24px">
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:4px 0;color:#888;font-size:12px">Mitarbeiter:in</td><td style="font-weight:bold">${esc(a.name)}</td></tr>
            <tr><td style="padding:4px 0;color:#888;font-size:12px">Eingereicht am</td><td>${de(a.eingereichtAm)}</td></tr>
            <tr><td style="padding:4px 0;color:#888;font-size:12px">Genehmigt am</td><td>${a.entschiedenAm ? de(a.entschiedenAm) : '–'}</td></tr>
            <tr><td style="padding:4px 0;color:#888;font-size:12px">Km-Pauschale</td><td>0,30 € / km</td></tr>
          </table>
        </div>
        <div style="padding:20px 24px">
          <table style="width:100%;border-collapse:collapse">
            <thead><tr style="background:#2c2825;color:#faf8f4">
              <th style="padding:8px 10px;text-align:left;font-size:12px">Datum</th>
              <th style="padding:8px 10px;text-align:left;font-size:12px">Route</th>
              <th style="padding:8px 10px;text-align:center;font-size:12px">km</th>
              <th style="padding:8px 10px;text-align:right;font-size:12px">Betrag</th>
              <th style="padding:8px 10px;text-align:left;font-size:12px">Zweck</th>
            </tr></thead>
            <tbody>${rows}</tbody>
            <tfoot><tr style="background:#e8f0ea;font-weight:bold">
              <td colspan="2" style="padding:10px">Gesamt (${a.anzahl} Fahrten)</td>
              <td style="padding:10px;text-align:center">${a.km} km</td>
              <td style="padding:10px;text-align:right">${a.kosten.toFixed(2)} €</td><td></td>
            </tr></tfoot>
          </table>
        </div>
        <div style="padding:16px 24px;border-top:1px solid #eee;font-size:12px;color:#888">
          Bitte überweise den Betrag an die Mitarbeiter:in.<br>
          PhysioPro Lübeck · Segeberger Str. 1 · 23617 Stockelsdorf
        </div>
      </div>`;
}

// ── Import aus dem alten Google Sheet (einmalig) ────────────────────────────
const SHEET_PERSON = { hanna: 33, anna: 7, julia: 8, tuana: 9, maike: 6, annika: 1, finn: 15, phillip: 10, imo: 14, nico: 11 };
const SHEET_STATUS = { pending: 'eingereicht', approved: 'genehmigt', rejected: 'abgelehnt', paid: 'ausgezahlt' };
function sheetDatum(s) {
  const t = String(s || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(t); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
async function importSheet() {
  const sheet = require('./sheet');
  const lesen = async (action) => JSON.parse((await sheet.handler({ httpMethod: 'GET', queryStringParameters: { action } })).body);
  const entries = (await lesen('getEntries')).entries || [];
  const subs = (await lesen('getSubmissions')).submissions || [];
  let fahrten = 0, abrechnungen = 0, uebersprungen = 0;
  for (const e of entries) {
    const mf = SHEET_PERSON[String(e.Mitarbeiter || '').trim()];
    const datum = sheetDatum(e.Datum);
    const sid = String(e.ID || '').trim();
    if (!mf || !datum || !sid || !e.Abfahrt || !e.Ziel) { uebersprungen++; continue; }
    const km = num(e.km); const kosten = num(e['Kosten (€)'] || e.Kosten) || Math.round(km * KM_SATZ * 100) / 100;
    const r = await sql`insert into fb_fahrten (mitarbeiter_firma_id, datum, von, nach, km, kosten, fahrzeit, zweck, sheet_id, erstellt_am)
      values (${mf}, ${datum}, ${e.Abfahrt}, ${e.Ziel}, ${km}, ${kosten}, ${e.Fahrzeit || ''}, ${e.Zweck || ''}, ${sid}, ${sheetDatum(e['Eingetragen am']) || datum})
      on conflict (sheet_id) do nothing returning id`;
    if (r.length) fahrten++;
  }
  for (const s of subs) {
    const mf = SHEET_PERSON[String(s.Mitarbeiter || '').split('_')[0].trim()];
    const sid = String(s.ID || '').trim();
    const status = SHEET_STATUS[String(s.Status || '').trim()];
    if (!mf || !sid || !status) { uebersprungen++; continue; }
    let ids = [];
    Object.values(s).forEach((v) => { const sv = String(v || '').trim(); if (sv.includes('[{')) { try { ids = JSON.parse(sv.slice(sv.indexOf('['))).map((x) => String(x.id)); } catch {} } });
    const eing = sheetDatum(s['Eingereicht am']) || new Date().toISOString().slice(0, 10);
    const gen = sheetDatum(s['Genehmigt am']); const bez = sheetDatum(s['Ausgezahlt am']);
    const r = await sql`insert into fb_abrechnungen (mitarbeiter_firma_id, status, anzahl, km, kosten, kommentar, eingereicht_am, entschieden_am, ausgezahlt_am, sheet_id)
      values (${mf}, ${status}, ${Number(s.Fahrten) || ids.length}, ${num(s['km gesamt'])}, ${num(s['Kosten gesamt'])}, ${s.Kommentar || null},
              ${eing}, ${gen}, ${bez}, ${sid})
      on conflict (sheet_id) do nothing returning id`;
    if (!r.length) continue;
    abrechnungen++;
    if (ids.length && status !== 'abgelehnt') {
      await sql`update fb_fahrten set abrechnung_id = ${r[0].id} where sheet_id = any(${ids}) and abrechnung_id is null`;
    }
  }
  // Alte Sheet-Fahrten, die zu keiner Abrechnung gehören, bleiben als "offen" bei der Person.
  return { fahrten, abrechnungen, uebersprungen, gelesen: { fahrten: entries.length, abrechnungen: subs.length } };
}

// ── Handler ─────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return err(405, 'Nur POST');
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return err(400, 'Ungültiges JSON'); }
  const { action, data = {} } = body;

  try {
    const sitz = tokenPruefen(body.token);
    if (!sitz) return ok({ error: 'abgemeldet' });
    const ich = await ichLaden(sitz.mf);
    if (!ich || !ich.aktiv) return ok({ error: 'abgemeldet' });
    if (ich.firma_id !== FIRMA_ID) return ok({ error: 'nicht_erlaubt' });
    const verwaltung = darfEntscheiden(ich.rolle);

    if (action === 'laden') {
      const offen = await sql`select * from fb_fahrten where mitarbeiter_firma_id = ${ich.id} and abrechnung_id is null and geloescht_am is null order by datum desc, id desc`;
      const meine = await abrechnungenLaden({ mf: ich.id });
      const alle = verwaltung ? await abrechnungenLaden({ mf: null }) : [];
      return ok({ offen: offen.map(fahrtRaus), meine, alle, verwaltung });
    }

    if (action === 'fahrtAnlegen') {
      const datum = String(data.datum || '').slice(0, 10);
      const km = Math.round(num(data.km) * 10) / 10;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || !data.von || !data.nach) return ok({ error: 'unvollstaendig' });
      if (!(km > 0)) return ok({ error: 'km_fehlt' });
      const kosten = Math.round(km * KM_SATZ * 100) / 100;
      const r = await sql`insert into fb_fahrten (mitarbeiter_firma_id, datum, von, nach, km, kosten, fahrzeit, zweck)
        values (${ich.id}, ${datum}, ${String(data.von).trim()}, ${String(data.nach).trim()}, ${km}, ${kosten}, ${String(data.fahrzeit || '').slice(0, 40)}, ${String(data.zweck || '').slice(0, 300)})
        returning *`;
      return ok({ ok: true, fahrt: fahrtRaus(r[0]) });
    }

    if (action === 'fahrtLoeschen') {
      const r = await sql`update fb_fahrten set geloescht_am = now()
        where id = ${Number(data.id)} and mitarbeiter_firma_id = ${ich.id} and abrechnung_id is null and geloescht_am is null returning id`;
      return ok(r.length ? { ok: true } : { error: 'nicht_moeglich' });
    }

    if (action === 'einreichen') {
      const offen = await sql`select * from fb_fahrten where mitarbeiter_firma_id = ${ich.id} and abrechnung_id is null and geloescht_am is null`;
      if (!offen.length) return ok({ error: 'keine_fahrten' });
      const km = Math.round(offen.reduce((s, f) => s + Number(f.km), 0) * 10) / 10;
      const kosten = Math.round(offen.reduce((s, f) => s + Number(f.kosten), 0) * 100) / 100;
      const a = (await sql`insert into fb_abrechnungen (mitarbeiter_firma_id, status, anzahl, km, kosten)
        values (${ich.id}, 'eingereicht', ${offen.length}, ${km}, ${kosten}) returning id`)[0];
      await sql`update fb_fahrten set abrechnung_id = ${a.id} where id = any(${offen.map((f) => f.id)})`;
      // Verwaltung informieren (E-Mail, wie bisher)
      try {
        const token = await mail.getAccessToken();
        await mail.sendEmail(token, VERWALTUNG_MAIL, 'Neue Abrechnung: ' + ich.name,
          '<div style="font-family:Arial,sans-serif;padding:20px"><h2 style="color:#2c2825">Neue Fahrtkostenabrechnung</h2>'
          + `<p><b>${esc(ich.name)}</b> hat eine Abrechnung eingereicht:</p><ul><li>Fahrten: ${offen.length}</li><li>Kilometer: ${km} km</li><li>Betrag: ${kosten.toFixed(2)} €</li></ul>`
          + '<p>Bitte im Fahrtenbuch unter <b>Verwaltung</b> prüfen und genehmigen.</p><p style="color:#888;font-size:12px">physiofahrtenbuch.netlify.app</p></div>');
      } catch (e) { console.error('Mail an Verwaltung fehlgeschlagen:', e.message); }
      return ok({ ok: true, id: a.id, anzahl: offen.length, km, kosten });
    }

    if (action === 'entscheiden') {
      if (!verwaltung) return ok({ error: 'nicht_erlaubt' });
      const status = String(data.status || '');
      if (!['genehmigt', 'abgelehnt', 'ausgezahlt'].includes(status)) return ok({ error: 'status_ungueltig' });
      const kommentar = String(data.kommentar || '').trim().slice(0, 500) || null;
      const alt = (await sql`select a.*, mf.mitarbeiter_id from fb_abrechnungen a join mitarbeiter_firma mf on mf.id = a.mitarbeiter_firma_id where a.id = ${Number(data.id)}`)[0];
      if (!alt) return ok({ error: 'unbekannt' });
      if (status === 'ausgezahlt' && alt.status !== 'genehmigt') return ok({ error: 'erst_genehmigen' });
      if (status !== 'ausgezahlt' && alt.status !== 'eingereicht') return ok({ error: 'bereits_entschieden' });
      if (status === 'abgelehnt' && !kommentar) return ok({ error: 'kommentar_fehlt' });
      if (status === 'ausgezahlt') {
        await sql`update fb_abrechnungen set status = 'ausgezahlt', ausgezahlt_am = now(), kommentar = coalesce(${kommentar}, kommentar) where id = ${alt.id}`;
      } else {
        await sql`update fb_abrechnungen set status = ${status}, entschieden_am = now(), entschieden_von = ${ich.mitarbeiter_id}, kommentar = coalesce(${kommentar}, kommentar) where id = ${alt.id}`;
        // Abgelehnt: Fahrten wieder freigeben, damit die Person korrigieren und neu einreichen kann
        if (status === 'abgelehnt') await sql`update fb_fahrten set abrechnung_id = null where abrechnung_id = ${alt.id}`;
      }
      const betrag = Number(alt.kosten).toFixed(2).replace('.', ',') + ' €';
      const texte = {
        genehmigt: `Deine Fahrtkostenabrechnung vom ${de(alt.eingereicht_am)} (${alt.anzahl} Fahrten, ${betrag}) wurde genehmigt.`,
        abgelehnt: `Deine Fahrtkostenabrechnung vom ${de(alt.eingereicht_am)} (${alt.anzahl} Fahrten, ${betrag}) wurde zurückgesendet. Die Fahrten sind wieder offen – bitte prüfen und neu einreichen.`,
        ausgezahlt: `Deine Fahrtkostenabrechnung vom ${de(alt.eingereicht_am)} (${betrag}) wurde überwiesen.`,
      };
      await hinweis('Fahrtkosten: ' + status, texte[status] + (kommentar ? '\n\nKommentar: ' + kommentar : ''), alt.mitarbeiter_id, ich.mitarbeiter_id, 'fb_abrechnungen:' + alt.id + ':' + status);
      return ok({ ok: true });
    }

    if (action === 'buchhaltung') {
      if (!verwaltung) return ok({ error: 'nicht_erlaubt' });
      const a = (await abrechnungenLaden({ mf: null })).find((x) => x.id === Number(data.id));
      if (!a) return ok({ error: 'unbekannt' });
      if (!a.fahrten.length) return ok({ error: 'keine_fahrten' });
      const token = await mail.getAccessToken();
      const r = await mail.sendEmail(token, BUCHHALTUNG, `Fahrtkostenabrechnung ${a.name} – ${de(a.eingereichtAm)}`, belegTabelle(a));
      return ok(r.status === 202 ? { ok: true } : { error: 'mail_fehlgeschlagen', detail: String(r.body).slice(0, 200) });
    }

    if (action === 'importSheet') {
      if (ich.rolle !== 'admin') return ok({ error: 'nicht_erlaubt' });
      return ok(await importSheet());
    }

    return err(400, 'Unbekannte Aktion: ' + action);
  } catch (e) {
    console.error(e);
    return err(500, e.message);
  }
};
