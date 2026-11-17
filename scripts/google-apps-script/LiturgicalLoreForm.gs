/**
 * Othello — Liturgical Commune Lore Intake Form, Web App API & Synod Triage Bridge
 *
 * Setup:
 * 1) Paste into Extensions -> Apps Script of the Othello Intake Sheet.
 * 2) In Project Settings -> Script Properties, set SYNOD_SEAL_KEY to your private Synod passphrase
 *    (or run setSynodSealKey('your-passphrase') once from the Apps Script editor).
 * 3) Run createLiturgicalCommuneLoreForm() once to create/link the native Google Form inside
 *    00_Liturgical_Intake_And_Forms and attach the onGoogleFormSubmit bridge trigger.
 * 4) Deploy -> New deployment -> Web app (Execute as: Me, Who has access: Anyone) to enable
 *    live two-way sync and Synod triage for site/index.html and site/form.html.
 */

const OTHELLO_CONFIG = {
  INTAKE_SHEET_ID: '1iPjlmIWB_Zg_MBm4ApvJdxD_AEE8GV2tVfXvNtm4cpA',
  INTAKE_FOLDER_ID: '1Frn4_InrnVcqaWfNrR_kd0kKmuwOHXK7',
  SUBMISSIONS_TAB: 'Lore_Submissions',
  FORM_TITLE: 'Othello — Liturgical Commune Lore Submission',
  CATEGORIES: [
    'Canticle_Or_Hymn',
    'Canon_Precept',
    'Rite_Or_Sacrament',
    'Hagiography_Or_Martyr',
    'Relic_Or_Vestment',
    'Commune_Chronicle',
    'Apocrypha_Or_Heresy',
  ],
  CANONICAL_HOURS: [
    'Vigils',
    'Lauds',
    'Prime',
    'Sext',
    'Vespers',
    'Compline',
    'Great_Fast',
    'Feast_Of_Ashes',
    'Ordinary_Time',
  ],
  SYNOD_STATUSES: [
    'Pending_Synod',
    'Canonized',
    'Disputed',
    'Sealed_Apocrypha',
  ],
  MAX_TITLE_LEN: 200,
  MAX_BODY_LEN: 12000,
  MAX_META_LEN: 500,
};

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function getSubmissionsSheet_() {
  const ss = SpreadsheetApp.openById(OTHELLO_CONFIG.INTAKE_SHEET_ID);
  const sheet = ss.getSheetByName(OTHELLO_CONFIG.SUBMISSIONS_TAB);
  if (!sheet) {
    throw new Error('Missing sheet tab: ' + OTHELLO_CONFIG.SUBMISSIONS_TAB);
  }
  return sheet;
}

function setSynodSealKey(passphrase) {
  const clean = String(passphrase || '').trim();
  if (!clean) {
    throw new Error('Passphrase cannot be empty.');
  }
  PropertiesService.getScriptProperties().setProperty('SYNOD_SEAL_KEY', clean);
  return { ok: true, message: 'SYNOD_SEAL_KEY stored in Script Properties.' };
}

function verifySynodSeal_(candidate) {
  const configured = String(
    PropertiesService.getScriptProperties().getProperty('SYNOD_SEAL_KEY') || ''
  ).trim();
  if (!configured) {
    return false;
  }
  return String(candidate || '').trim() === configured;
}

function isSynodSealConfigured_() {
  return Boolean(
    String(
      PropertiesService.getScriptProperties().getProperty('SYNOD_SEAL_KEY') || ''
    ).trim()
  );
}

function nextLoreId_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 'LC-001';
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  let maxNum = 0;
  ids.forEach((val) => {
    const m = String(val || '').match(/^LC-(\d+)$/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  });
  return 'LC-' + String(maxNum + 1).padStart(3, '0');
}

function trimBounded_(value, maxLen) {
  const str = String(value || '').trim();
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

function readEntries_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const rows = sheet.getRange(1, 1, lastRow, 11).getValues();
  const headers = rows[0].map((h) =>
    String(h || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
  );

  const entries = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const record = {};
    for (let c = 0; c < headers.length; c += 1) {
      const key = headers[c];
      if (!key) continue;
      const val = row[c];
      record[key] =
        val instanceof Date ? val.toISOString() : String(val == null ? '' : val).trim();
    }
    if (!record.title) continue;
    entries.push({
      lore_id: record.lore_id || '',
      submitted_at: record.submitted_at || '',
      scribe_or_order: record.scribe_or_order || '',
      title: record.title || '',
      liturgical_category: record.liturgical_category || 'Commune_Chronicle',
      canonical_hour_or_season: record.canonical_hour_or_season || 'Ordinary_Time',
      commune_house_or_choir: record.commune_house_or_choir || '',
      epigraph_or_antiphon: record.epigraph_or_antiphon || '',
      lore_body: record.lore_body || '',
      cross_references: record.cross_references || '',
      synod_status: record.synod_status || 'Pending_Synod',
    });
  }
  return entries;
}

function doGet(e) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || 'list').trim();
    const syncedAt = new Date().toISOString();
    if (action === 'ping') {
      return jsonOutput_({
        ok: true,
        service: 'Othello Scriptorium Intake',
        triage_configured: isSynodSealConfigured_(),
        synced_at: syncedAt,
      });
    }
    const sheet = getSubmissionsSheet_();
    return jsonOutput_({
      ok: true,
      entries: readEntries_(sheet),
      triage_configured: isSynodSealConfigured_(),
      synced_at: syncedAt,
    });
  } catch (err) {
    return jsonOutput_({ ok: false, error: err.message || String(err) });
  }
}

function handleSubmitLore_(payload) {
  if (String(payload._hp || payload.website || '').trim() !== '') {
    return jsonOutput_({ ok: true, ignored: true });
  }

  const scribe = trimBounded_(payload.scribe_or_order, OTHELLO_CONFIG.MAX_META_LEN);
  const title = trimBounded_(payload.title, OTHELLO_CONFIG.MAX_TITLE_LEN);
  const category = String(payload.liturgical_category || '').trim();
  const hour = String(payload.canonical_hour_or_season || '').trim();
  const house = trimBounded_(payload.commune_house_or_choir, OTHELLO_CONFIG.MAX_META_LEN);
  const epigraph = trimBounded_(payload.epigraph_or_antiphon, OTHELLO_CONFIG.MAX_BODY_LEN);
  const body = trimBounded_(payload.lore_body, OTHELLO_CONFIG.MAX_BODY_LEN);
  const xrefs = trimBounded_(payload.cross_references, OTHELLO_CONFIG.MAX_META_LEN);

  if (!scribe || !title || !body) {
    return jsonOutput_({
      ok: false,
      error: 'Scribe or Order, Title, and Full Lore Text are required.',
    });
  }
  if (OTHELLO_CONFIG.CATEGORIES.indexOf(category) === -1) {
    return jsonOutput_({
      ok: false,
      error: 'Invalid liturgical_category: ' + category,
    });
  }
  if (OTHELLO_CONFIG.CANONICAL_HOURS.indexOf(hour) === -1) {
    return jsonOutput_({
      ok: false,
      error: 'Invalid canonical_hour_or_season: ' + hour,
    });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSubmissionsSheet_();
    const loreId = nextLoreId_(sheet);
    const submittedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

    sheet.appendRow([
      loreId,
      submittedAt,
      scribe,
      title,
      category,
      hour,
      house,
      epigraph,
      body,
      xrefs,
      'Pending_Synod',
    ]);

    return jsonOutput_({
      ok: true,
      lore_id: loreId,
      submitted_at: submittedAt,
      synod_status: 'Pending_Synod',
    });
  } finally {
    lock.releaseLock();
  }
}

function handleUpdateStatus_(payload) {
  if (!isSynodSealConfigured_()) {
    return jsonOutput_({
      ok: false,
      error: 'SYNOD_SEAL_KEY is not configured in Script Properties.',
    });
  }
  if (!verifySynodSeal_(payload.synod_seal_key)) {
    return jsonOutput_({
      ok: false,
      error: 'Invalid or missing Synod Seal passphrase.',
    });
  }

  const loreId = String(payload.lore_id || '').trim();
  const nextStatus = String(payload.synod_status || '').trim();
  if (!/^LC-\d{3,}$/.test(loreId)) {
    return jsonOutput_({ ok: false, error: 'Invalid lore_id format.' });
  }
  if (OTHELLO_CONFIG.SYNOD_STATUSES.indexOf(nextStatus) === -1) {
    return jsonOutput_({ ok: false, error: 'Invalid synod_status: ' + nextStatus });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSubmissionsSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return jsonOutput_({ ok: false, error: 'Entry not found: ' + loreId });
    }
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    let targetRow = -1;
    for (let i = 0; i < ids.length; i += 1) {
      if (String(ids[i] || '').trim() === loreId) {
        targetRow = i + 2;
        break;
      }
    }
    if (targetRow === -1) {
      return jsonOutput_({ ok: false, error: 'Entry not found: ' + loreId });
    }

    sheet.getRange(targetRow, 11).setValue(nextStatus);
    return jsonOutput_({
      ok: true,
      lore_id: loreId,
      synod_status: nextStatus,
    });
  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  try {
    const raw = (e && e.postData && e.postData.contents) || '{}';
    const payload = JSON.parse(raw);
    const action = String((payload && payload.action) || 'submit_lore').trim();

    if (action === 'submit_lore') {
      return handleSubmitLore_(payload);
    }
    if (action === 'verify_synod_seal') {
      if (!isSynodSealConfigured_()) {
        return jsonOutput_({
          ok: false,
          error: 'SYNOD_SEAL_KEY is not configured in Script Properties.',
        });
      }
      return jsonOutput_({
        ok: true,
        authorized: verifySynodSeal_(payload.synod_seal_key),
      });
    }
    if (action === 'update_status') {
      return handleUpdateStatus_(payload);
    }
    return jsonOutput_({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonOutput_({ ok: false, error: err.message || String(err) });
  }
}

function createLiturgicalCommuneLoreForm() {
  const folder = DriveApp.getFolderById(OTHELLO_CONFIG.INTAKE_FOLDER_ID);
  const existing = folder.getFilesByName(OTHELLO_CONFIG.FORM_TITLE);
  let form;

  if (existing.hasNext()) {
    const file = existing.next();
    form = FormApp.openById(file.getId());
  } else {
    form = FormApp.create(OTHELLO_CONFIG.FORM_TITLE);
    form.setDescription(
      'Submit canonical or apocryphal lore, canticles, precepts, rites, hagiographies, and relics of the Liturgical Commune into the Othello World Codex.'
    );
    form.setConfirmationMessage(
      'Your parchment has been received by the Scriptorium of the Ash-Ink and queued for Synod review.'
    );

    form.addTextItem().setTitle('Scribe or Order').setRequired(true);
    form.addTextItem().setTitle('Lore Entry Title').setRequired(true);
    form
      .addListItem()
      .setTitle('Liturgical Category')
      .setChoiceValues(OTHELLO_CONFIG.CATEGORIES)
      .setRequired(true);
    form
      .addListItem()
      .setTitle('Canonical Hour or Season')
      .setChoiceValues(OTHELLO_CONFIG.CANONICAL_HOURS)
      .setRequired(true);
    form.addTextItem().setTitle('Commune House or Choir').setRequired(false);
    form.addParagraphTextItem().setTitle('Epigraph or Antiphon').setRequired(false);
    form.addParagraphTextItem().setTitle('Full Lore Text').setRequired(true);
    form.addTextItem().setTitle('Cross-References').setRequired(false);

    form.setDestination(
      FormApp.DestinationType.SPREADSHEET,
      OTHELLO_CONFIG.INTAKE_SHEET_ID
    );

    const formFile = DriveApp.getFileById(form.getId());
    formFile.moveTo(folder);
  }

  const ss = SpreadsheetApp.openById(OTHELLO_CONFIG.INTAKE_SHEET_ID);
  const hasTrigger = ScriptApp.getProjectTriggers().some(
    (t) => t.getHandlerFunction() === 'onGoogleFormSubmit'
  );
  if (!hasTrigger) {
    ScriptApp.newTrigger('onGoogleFormSubmit')
      .forSpreadsheet(ss)
      .onFormSubmit()
      .create();
  }

  Logger.log('Form Edit URL: ' + form.getEditUrl());
  Logger.log('Form Published URL: ' + form.getPublishedUrl());
  return {
    id: form.getId(),
    editUrl: form.getEditUrl(),
    publishedUrl: form.getPublishedUrl(),
  };
}

function onGoogleFormSubmit(e) {
  if (!e || !e.namedValues) return;
  const values = e.namedValues;
  const pick = (key) => {
    const arr = values[key];
    return arr && arr.length ? String(arr[0] || '').trim() : '';
  };

  const title = trimBounded_(pick('Lore Entry Title'), OTHELLO_CONFIG.MAX_TITLE_LEN);
  const body = trimBounded_(pick('Full Lore Text'), OTHELLO_CONFIG.MAX_BODY_LEN);
  if (!title || !body) return;

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSubmissionsSheet_();
    const loreId = nextLoreId_(sheet);
    const submittedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const category = pick('Liturgical Category');
    const hour = pick('Canonical Hour or Season');

    sheet.appendRow([
      loreId,
      submittedAt,
      trimBounded_(pick('Scribe or Order') || 'Anonymous Novice', OTHELLO_CONFIG.MAX_META_LEN),
      title,
      OTHELLO_CONFIG.CATEGORIES.indexOf(category) !== -1 ? category : 'Commune_Chronicle',
      OTHELLO_CONFIG.CANONICAL_HOURS.indexOf(hour) !== -1 ? hour : 'Ordinary_Time',
      trimBounded_(pick('Commune House or Choir'), OTHELLO_CONFIG.MAX_META_LEN),
      trimBounded_(pick('Epigraph or Antiphon'), OTHELLO_CONFIG.MAX_BODY_LEN),
      body,
      trimBounded_(pick('Cross-References'), OTHELLO_CONFIG.MAX_META_LEN),
      'Pending_Synod',
    ]);
  } finally {
    lock.releaseLock();
  }
}
