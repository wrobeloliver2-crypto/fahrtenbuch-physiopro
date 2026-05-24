// ══════════════════════════════════════════════════════════════
// FAHRTENBUCH PHYSIOPRO – Google Apps Script Backend v2
// ══════════════════════════════════════════════════════════════
// Nach Änderungen: Deployen → Neue Version der bestehenden Bereitstellung

var SHEET_ID        = '1e5U3sTeNW27KX4jfQY_yaO9Pu2XvKo9IJZZKn6nvgQo';
var SHEET_FAHRTEN   = 'Fahrten';
var SHEET_ABSCHLUSS = 'Abschluesse';

// ── GET: Daten lesen ──────────────────────────────────────────
function doGet(e) {
  try {
    var action = e.parameter.action || '';
    var ss = SpreadsheetApp.openById(SHEET_ID);

    var callback = e.parameter.callback || '';
    if (action === 'getSubmissions') {
      return jsonResponse(getSubmissions(ss), callback);
    }
    if (action === 'getEntries') {
      var mitarbeiter = e.parameter.mitarbeiter || '';
      return jsonResponse(getEntries(ss, mitarbeiter), callback);
    }
    return jsonResponse({status: 'Fahrtenbuch API v2 aktiv'}, callback);
  } catch(err) {
    return jsonResponse({ok: false, error: err.message});
  }
}

// ── POST: Daten schreiben ─────────────────────────────────────
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.openById(SHEET_ID);

    if (data.type === 'entry') {
      writeEntry(ss, data);
    } else if (data.type === 'submission') {
      writeSubmission(ss, data);
    } else if (data.type === 'updateStatus') {
      updateSubmissionStatus(ss, data);
    }

    return jsonResponse({ok: true});
  } catch(err) {
    return jsonResponse({ok: false, error: err.message});
  }
}

// ── LESEN: Alle Submissions ───────────────────────────────────
function getSubmissions(ss) {
  var sheet = ss.getSheetByName(SHEET_ABSCHLUSS);
  if (!sheet) return {submissions: []};
  var rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return {submissions: []};
  var headers = rows[0];
  var submissions = [];
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = row[j];
    }
    // Normalisierung: verschiedene Spaltennamen vereinheitlichen
    obj['Status'] = obj['Status'] || 'pending';
    obj['Mitarbeiter'] = obj['Mitarbeiter'] || obj['mitarbeiter'] || '';
    obj['Name'] = obj['Name'] || obj['Mitarbeitername'] || '';
    // ID: aus ID-Spalte oder zusammengebaut
    obj['ID'] = obj['ID'] || obj['Mitarbeiter'] + '_' + String(obj['Eingereicht am']).substring(0,10);
    // Einträge JSON
    obj['Einträge (JSON)'] = obj['Einträge (JSON)'] || obj['Eintraege'] || '[]';
    submissions.push(obj);
  }
  return {submissions: submissions};
}

// ── LESEN: Fahrten eines Mitarbeiters ────────────────────────
function getEntries(ss, mitarbeiter) {
  var sheet = ss.getSheetByName(SHEET_FAHRTEN);
  if (!sheet) return {entries: []};
  var rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return {entries: []};
  var headers = rows[0];
  var entries = [];
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (!mitarbeiter || row[0] === mitarbeiter) {
      var obj = {};
      for (var j = 0; j < headers.length; j++) {
        obj[headers[j]] = row[j];
      }
      entries.push(obj);
    }
  }
  return {entries: entries};
}

// ── SCHREIBEN: Einzelne Fahrt ─────────────────────────────────
function writeEntry(ss, data) {
  var sheet = getOrCreateSheet(ss, SHEET_FAHRTEN, [
    'Mitarbeiter', 'Name', 'Datum', 'Abfahrt', 'Ziel',
    'km', 'Kosten (€)', 'Fahrzeit', 'Zweck',
    'Eingetragen am', 'ID'
  ]);
  sheet.appendRow([
    data.mitarbeiter, data.mitarbeiterName || '',
    data.datum, data.von, data.nach,
    data.km, data.kosten, data.dauer || '',
    data.zweck || '', new Date(data.timestamp), data.id
  ]);
}

// ── SCHREIBEN: Einreichung ────────────────────────────────────
function writeSubmission(ss, data) {
  var sheet = getOrCreateSheet(ss, SHEET_ABSCHLUSS, [
    'Mitarbeiter', 'Name', 'Monat', 'Status',
    'Fahrten', 'km gesamt', 'Kosten gesamt', 'Eingereicht am',
    'Genehmigt am', 'Ausgezahlt am', 'Kommentar', 'Einträge (JSON)', 'ID'
  ]);
  var totalKm = data.entries.reduce(function(s,e){return s+(parseFloat(String(e.km).replace(',','.'))||0);}, 0);
  var totalKosten = data.entries.reduce(function(s,e){return s+(parseFloat(String(e.kosten).replace(',','.'))||0);}, 0);
  var subId = data.mitarbeiter + '_' + data.submittedAt.substring(0,10);
  sheet.appendRow([
    data.mitarbeiter, data.mitarbeiterName,
    data.submittedAt.substring(0,7),
    'pending', data.entries.length,
    Math.round(totalKm*10)/10, totalKosten.toFixed(2),
    new Date(data.submittedAt), '', '', '',
    JSON.stringify(data.entries), subId
  ]);
}

// ── UPDATE: Status ändern (approve / reject / paid) ───────────
function updateSubmissionStatus(ss, data) {
  var sheet = ss.getSheetByName(SHEET_ABSCHLUSS);
  if (!sheet) return;
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0];
  var idCol    = headers.indexOf('ID');
  var statCol  = headers.indexOf('Status');
  var apprCol  = headers.indexOf('Genehmigt am');
  var paidCol  = headers.indexOf('Ausgezahlt am');
  var commCol  = headers.indexOf('Kommentar');

  for (var i = 1; i < rows.length; i++) {
    // ID kann in verschiedenen Spalten stehen, oder aus Mitarbeiter+Datum zusammengebaut
    var rowId = idCol >= 0 ? rows[i][idCol] : '';
    var mitCol = headers.indexOf('Mitarbeiter');
    var datCol = headers.indexOf('Eingereicht am');
    if (!rowId && mitCol >= 0 && datCol >= 0) {
      rowId = rows[i][mitCol] + '_' + String(rows[i][datCol]).substring(0,10);
    }
    if (rowId === data.submissionId) {
      sheet.getRange(i+1, statCol+1).setValue(data.status);
      if (data.comment) sheet.getRange(i+1, commCol+1).setValue(data.comment);
      if (data.status === 'approved') sheet.getRange(i+1, apprCol+1).setValue(new Date());
      if (data.status === 'paid')     sheet.getRange(i+1, paidCol+1).setValue(new Date());
      return;
    }
  }
}

// ── UTILS ─────────────────────────────────────────────────────
function jsonResponse(obj, callback) {
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + JSON.stringify(obj) + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    var r = sheet.getRange(1, 1, 1, headers.length);
    r.setValues([headers]);
    r.setFontWeight('bold').setBackground('#2c2825').setFontColor('#faf8f4');
    sheet.setFrozenRows(1);
  }
  return sheet;
}
