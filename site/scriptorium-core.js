(function (global) {
  "use strict";

  const STORAGE_KEYS = {
    webhookUrl: "othello_apps_script_webhook_url",
    stagedLore: "othello_local_lore_staging",
    triageOverrides: "othello_triage_overrides",
    synodSealKey: "othello_synod_seal_key",
    synodLocalMode: "othello_synod_local_mode",
    unsealedItems: "othello_unsealed_items",
    clockMode: "othello_clock_mode"
  };

  const CATEGORY_META = {
    Canticle_Or_Hymn: {
      label: "Canticle or Hymn",
      rubric: "Antiphonal psalms, bell-chants, and night-watch melodies sung across bronze stalls."
    },
    Canon_Precept: {
      label: "Canon Precept",
      rubric: "Binding rules of shared tables, labor allotments, fasts, and silent reconciliation."
    },
    Rite_Or_Sacrament: {
      label: "Rite or Sacrament",
      rubric: "Ceremonies of vow-taking, bread-breaking, ash-grinding, or sanctuary sealing."
    },
    Hagiography_Or_Martyr: {
      label: "Hagiography or Martyr",
      rubric: "Lives, trials, and final utterances of remembered founders and watchkeepers."
    },
    Relic_Or_Vestment: {
      label: "Relic or Vestment",
      rubric: "Consecrated bronze, ash-wood shrines, shrouds, iron spoons, and foundry artifacts."
    },
    Commune_Chronicle: {
      label: "Commune Chronicle",
      rubric: "Historical annals of synods, famines, fires, schisms, and reconciliations."
    },
    Apocrypha_Or_Heresy: {
      label: "Apocrypha or Heresy",
      rubric: "Suppressed marginalia, omitted stanzas, and unorthodox claims preserved under wax seal."
    }
  };

  const HOUR_ORDER = [
    "Vigils",
    "Lauds",
    "Prime",
    "Sext",
    "Vespers",
    "Compline",
    "Great_Fast",
    "Feast_Of_Ashes",
    "Ordinary_Time"
  ];

  const HOUR_LABELS = {
    Vigils: "Vigils — 3rd Hour Before Dawn",
    Lauds: "Lauds — First Light",
    Prime: "Prime — Sunrise",
    Sext: "Sext — High Noon",
    Vespers: "Vespers — Dusk",
    Compline: "Compline — Nightfall",
    Great_Fast: "Great Fast — Forty Days Before Equinox",
    Feast_Of_Ashes: "Feast of Ashes — Autumn Equinox",
    Ordinary_Time: "Ordinary Time — Standard Calendar"
  };

  const STATUS_META = {
    Pending_Synod: { label: "Pending Synod" },
    Canonized: { label: "Canonized" },
    Disputed: { label: "Disputed" },
    Sealed_Apocrypha: { label: "Sealed Apocrypha" }
  };

  const ALLOWED_STATUSES = Object.keys(STATUS_META);

  const SCHEMA_FIELDS = [
    "lore_id",
    "submitted_at",
    "scribe_or_order",
    "title",
    "liturgical_category",
    "canonical_hour_or_season",
    "commune_house_or_choir",
    "epigraph_or_antiphon",
    "lore_body",
    "cross_references",
    "synod_status"
  ];

  const runtime = {
    remoteEntries: null,
    lastSyncedAt: null,
    lastSyncError: null,
    triageConfigured: null,
    onDataChangedCallbacks: []
  };

  function getBaselineLore() {
    return Array.isArray(global.OTHELLO_LORE) ? global.OTHELLO_LORE : [];
  }

  function getSuite() {
    return global.OTHELLO_SUITE || {};
  }

  function getCodex() {
    return global.OTHELLO_CODEX || {
      orders: [],
      personae: [],
      calendar: [],
      charter_md: "",
      commune_md: ""
    };
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function safeHref(url) {
    const raw = String(url || "").trim();
    if (!raw) return "#";
    if (/^(https?:\/\/|#|\/|\.\.?\/)/i.test(raw)) {
      return raw;
    }
    return "#";
  }

  function formatLabel(value) {
    return String(value || "").replace(/_/g, " ");
  }

  function formatCategoryLabel(cat) {
    return (CATEGORY_META[cat] && CATEGORY_META[cat].label) || formatLabel(cat);
  }

  function formatHourLabel(hr) {
    return HOUR_LABELS[hr] || formatLabel(hr);
  }

  function formatStatusLabel(st) {
    return (STATUS_META[st] && STATUS_META[st].label) || formatLabel(st);
  }

  function formatInlineMarkdown(text) {
    let html = escapeHtml(text);
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, label, url) {
      const href = safeHref(url);
      const ext = /^https?:\/\//i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : "";
      return '<a href="' + escapeHtml(href) + '"' + ext + ">" + label + "</a>";
    });
    return html;
  }

  function renderMarkdown(md) {
    const lines = String(md || "").replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        i += 1;
        continue;
      }

      if (/^---+$/.test(trimmed)) {
        out.push("<hr />");
        i += 1;
        continue;
      }

      const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        out.push("<h" + level + ">" + formatInlineMarkdown(headingMatch[2]) + "</h" + level + ">");
        i += 1;
        continue;
      }

      if (trimmed.startsWith(">")) {
        const quoteLines = [];
        while (i < lines.length && lines[i].trim().startsWith(">")) {
          quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
          i += 1;
        }
        out.push("<blockquote>" + formatInlineMarkdown(quoteLines.join(" ")) + "</blockquote>");
        continue;
      }

      if (trimmed.startsWith("|") && i + 1 < lines.length && /^\|[\s:|-]+\|?$/.test(lines[i + 1].trim())) {
        const parseCells = function (rowStr) {
          return rowStr
            .trim()
            .replace(/^\|/, "")
            .replace(/\|$/, "")
            .split("|")
            .map(function (c) { return c.trim(); });
        };
        const headers = parseCells(trimmed);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim().startsWith("|")) {
          rows.push(parseCells(lines[i].trim()));
          i += 1;
        }
        let tbl = '<div class="markdown-table-wrap"><table><thead><tr>';
        headers.forEach(function (h) {
          tbl += "<th>" + formatInlineMarkdown(h) + "</th>";
        });
        tbl += "</tr></thead><tbody>";
        rows.forEach(function (r) {
          tbl += "<tr>";
          headers.forEach(function (_, idx) {
            tbl += "<td>" + formatInlineMarkdown(r[idx] || "") + "</td>";
          });
          tbl += "</tr>";
        });
        tbl += "</tbody></table></div>";
        out.push(tbl);
        continue;
      }

      if (/^[-*]\s+/.test(trimmed)) {
        const items = [];
        while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
          items.push("<li>" + formatInlineMarkdown(lines[i].trim().replace(/^[-*]\s+/, "")) + "</li>");
          i += 1;
        }
        out.push("<ul>" + items.join("") + "</ul>");
        continue;
      }

      if (/^\d+\.\s+/.test(trimmed)) {
        const items = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
          items.push("<li>" + formatInlineMarkdown(lines[i].trim().replace(/^\d+\.\s+/, "")) + "</li>");
          i += 1;
        }
        out.push("<ol>" + items.join("") + "</ol>");
        continue;
      }

      const paraLines = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^(#{1,3}\s+|>\s?|[-*]\s+|\d+\.\s+|\||---+$)/.test(lines[i].trim())
      ) {
        paraLines.push(lines[i].trim());
        i += 1;
      }
      out.push("<p>" + formatInlineMarkdown(paraLines.join(" ")) + "</p>");
    }

    return out.join("\n");
  }

  function showToast(title, message, tone) {
    const stack = document.getElementById("toast-stack");
    if (!stack) return;
    const toast = document.createElement("div");
    toast.className = "toast" + (tone ? " is-" + tone : "");
    toast.innerHTML =
      '<div class="toast-title">' + escapeHtml(title) + "</div>" +
      '<div class="toast-msg">' + escapeHtml(message) + "</div>";
    stack.appendChild(toast);
    setTimeout(function () {
      toast.remove();
    }, 4200);
  }

  function showBanner(title, text, tone) {
    const banner = document.getElementById("inline-banner");
    if (!banner) return;
    banner.className = "inline-banner is-visible is-" + (tone || "info");
    const tEl = document.getElementById("inline-banner-title");
    const mEl = document.getElementById("inline-banner-text");
    if (tEl) tEl.textContent = title;
    if (mEl) mEl.textContent = text;
  }

  function dismissBanner() {
    const banner = document.getElementById("inline-banner");
    if (banner) banner.classList.remove("is-visible");
  }

  global.dismissBanner = dismissBanner;

  function readStorageJson(storage, key, fallback) {
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function writeStorageJson(storage, key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch (err) {
      /* ignore storage restrictions */
    }
  }

  function getConfiguredWebhookUrl() {
    try {
      const saved = (localStorage.getItem(STORAGE_KEYS.webhookUrl) || "").trim();
      if (saved) return saved;
    } catch (err) {
      /* ignore */
    }
    const formCfg = getSuite().suite && getSuite().suite.liturgical_lore_form;
    return (formCfg && formCfg.webhook_url) ? String(formCfg.webhook_url).trim() : "";
  }

  function setConfiguredWebhookUrl(url) {
    const clean = String(url || "").trim();
    try {
      if (clean) {
        localStorage.setItem(STORAGE_KEYS.webhookUrl, clean);
      } else {
        localStorage.removeItem(STORAGE_KEYS.webhookUrl);
      }
    } catch (err) {
      /* ignore */
    }
  }

  function getNativeFormUrl() {
    const formCfg = getSuite().suite && getSuite().suite.liturgical_lore_form;
    return (formCfg && formCfg.form_url) ? String(formCfg.form_url).trim() : "";
  }

  function getStagedEntries() {
    const data = readStorageJson(localStorage, STORAGE_KEYS.stagedLore, []);
    return Array.isArray(data) ? data : [];
  }

  function saveStagedEntries(entries) {
    writeStorageJson(localStorage, STORAGE_KEYS.stagedLore, entries);
  }

  function stageEntryLocally(entry) {
    const list = getStagedEntries().filter(function (item) {
      return item && item.lore_id !== entry.lore_id;
    });
    list.push(cleanSchemaEntry(entry));
    saveStagedEntries(list);
  }

  function getTriageOverrides() {
    const data = readStorageJson(localStorage, STORAGE_KEYS.triageOverrides, {});
    return data && typeof data === "object" ? data : {};
  }

  function saveTriageOverrides(map) {
    writeStorageJson(localStorage, STORAGE_KEYS.triageOverrides, map);
  }

  function cleanSchemaEntry(entry) {
    const out = {};
    SCHEMA_FIELDS.forEach(function (field) {
      out[field] = entry && entry[field] != null ? String(entry[field]) : "";
    });
    if (!out.synod_status) out.synod_status = "Pending_Synod";
    return out;
  }

  function getMergedEntriesWithMeta() {
    const byId = new Map();
    const sources = new Map();
    const overrides = getTriageOverrides();

    getBaselineLore().forEach(function (item) {
      if (!item || !item.lore_id) return;
      byId.set(item.lore_id, cleanSchemaEntry(item));
      sources.set(item.lore_id, "canon");
    });

    if (Array.isArray(runtime.remoteEntries)) {
      runtime.remoteEntries.forEach(function (item) {
        if (!item || !item.lore_id) return;
        byId.set(item.lore_id, cleanSchemaEntry(item));
        sources.set(item.lore_id, "remote");
      });
    }

    const activeStaged = getStagedEntries();
    const cleanedStaged = [];
    activeStaged.forEach(function (item) {
      if (!item || !item.lore_id) return;
      const alreadyConfirmed = Array.from(byId.values()).some(function (existing) {
        return existing.lore_id === item.lore_id ||
          (existing.title.toLowerCase() === String(item.title || "").toLowerCase() &&
           existing.scribe_or_order.toLowerCase() === String(item.scribe_or_order || "").toLowerCase());
      });
      if (!alreadyConfirmed) {
        cleanedStaged.push(item);
        byId.set(item.lore_id, cleanSchemaEntry(item));
        sources.set(item.lore_id, "staged");
      }
    });
    if (cleanedStaged.length !== activeStaged.length) {
      saveStagedEntries(cleanedStaged);
    }

    const entries = Array.from(byId.values()).map(function (entry) {
      const ov = overrides[entry.lore_id];
      if (ov && ALLOWED_STATUSES.indexOf(ov) !== -1) {
        if (sources.get(entry.lore_id) === "remote" && entry.synod_status === ov) {
          delete overrides[entry.lore_id];
          saveTriageOverrides(overrides);
        } else {
          entry.synod_status = ov;
        }
      }
      return entry;
    });

    entries.sort(function (a, b) {
      return a.lore_id.localeCompare(b.lore_id, undefined, { numeric: true });
    });

    return { entries: entries, sources: sources };
  }

  function getMergedEntries() {
    return getMergedEntriesWithMeta().entries;
  }

  function nextLoreId(entries) {
    const list = entries || getMergedEntries();
    let maxNum = 0;
    list.forEach(function (item) {
      const m = String((item && item.lore_id) || "").match(/^LC-(\d+)$/);
      if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
    });
    return "LC-" + String(maxNum + 1).padStart(3, "0");
  }

  function notifyDataChanged() {
    runtime.onDataChangedCallbacks.forEach(function (fn) {
      try {
        fn();
      } catch (err) {
        /* ignore subscriber errors */
      }
    });
    renderWatchStrip();
  }

  function onDataChanged(fn) {
    if (typeof fn === "function") {
      runtime.onDataChangedCallbacks.push(fn);
    }
  }

  async function fetchRemoteLore(silent) {
    const url = getConfiguredWebhookUrl();
    if (!url) {
      runtime.lastSyncError = null;
      return { ok: false, unconfigured: true, entries: getMergedEntries() };
    }
    const sep = url.indexOf("?") === -1 ? "?" : "&";
    try {
      const res = await fetch(url + sep + "action=list", {
        method: "GET",
        redirect: "follow"
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (!data || !data.ok) {
        throw new Error((data && data.error) || "Apps Script returned an error.");
      }
      runtime.remoteEntries = Array.isArray(data.entries) ? data.entries : [];
      runtime.lastSyncedAt = data.synced_at || new Date().toISOString();
      runtime.triageConfigured = Boolean(data.triage_configured);
      runtime.lastSyncError = null;
      notifyDataChanged();
      return { ok: true, entries: getMergedEntries(), syncedAt: runtime.lastSyncedAt };
    } catch (err) {
      runtime.lastSyncError = err.message || String(err);
      renderWatchStrip();
      if (!silent) {
        showToast("Sync Notice", "Live Sheet sync unavailable (" + runtime.lastSyncError + "). Using compiled & local cache.", "error");
      }
      return { ok: false, error: runtime.lastSyncError, entries: getMergedEntries() };
    }
  }

  async function pingWebhook(urlOverride) {
    const url = String(urlOverride || getConfiguredWebhookUrl() || "").trim();
    if (!url) return { ok: false, error: "No webhook URL configured." };
    const sep = url.indexOf("?") === -1 ? "?" : "&";
    const res = await fetch(url + sep + "action=ping", {
      method: "GET",
      redirect: "follow"
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (!data || !data.ok) {
      throw new Error((data && data.error) || "Ping failed.");
    }
    runtime.triageConfigured = Boolean(data.triage_configured);
    return data;
  }

  async function submitLoreEntry(entry, hpValue) {
    const payload = cleanSchemaEntry(entry);
    const webhookUrl = getConfiguredWebhookUrl();
    if (!webhookUrl) {
      stageEntryLocally(payload);
      notifyDataChanged();
      return { ok: true, mode: "local", entry: payload };
    }

    const body = Object.assign({ action: "submit_lore", _hp: hpValue || "" }, payload);
    const response = await fetch(webhookUrl, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      parsed = null;
    }
    if (!response.ok || (parsed && parsed.ok === false)) {
      throw new Error((parsed && parsed.error) || ("HTTP " + response.status));
    }
    if (parsed && parsed.lore_id) payload.lore_id = parsed.lore_id;
    if (parsed && parsed.submitted_at) payload.submitted_at = parsed.submitted_at;
    if (parsed && parsed.synod_status) payload.synod_status = parsed.synod_status;

    if (Array.isArray(runtime.remoteEntries)) {
      runtime.remoteEntries = runtime.remoteEntries.filter(function (x) {
        return x.lore_id !== payload.lore_id;
      }).concat([payload]);
    }
    stageEntryLocally(payload);
    notifyDataChanged();
    return { ok: true, mode: "remote", entry: payload };
  }

  function getSynodSealKey() {
    try {
      return sessionStorage.getItem(STORAGE_KEYS.synodSealKey) || "";
    } catch (err) {
      return "";
    }
  }

  function isLocalTriageEnabled() {
    try {
      return sessionStorage.getItem(STORAGE_KEYS.synodLocalMode) === "1";
    } catch (err) {
      return false;
    }
  }

  function isSynodUnlocked() {
    return Boolean(getSynodSealKey()) || isLocalTriageEnabled();
  }

  function lockSynodMode() {
    try {
      sessionStorage.removeItem(STORAGE_KEYS.synodSealKey);
      sessionStorage.removeItem(STORAGE_KEYS.synodLocalMode);
    } catch (err) {
      /* ignore */
    }
    notifyDataChanged();
  }

  async function unlockSynodMode(passphrase) {
    const clean = String(passphrase || "").trim();
    const webhookUrl = getConfiguredWebhookUrl();

    if (!webhookUrl) {
      try {
        sessionStorage.setItem(STORAGE_KEYS.synodLocalMode, "1");
        if (clean) sessionStorage.setItem(STORAGE_KEYS.synodSealKey, clean);
      } catch (err) {
        /* ignore */
      }
      notifyDataChanged();
      return { ok: true, mode: "local", message: "Local Synod Triage Workbench unlocked (export JSON to commit changes)." };
    }

    if (!clean) {
      throw new Error("Enter the Synod Seal passphrase configured in Apps Script Properties.");
    }

    const res = await fetch(webhookUrl, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "verify_synod_seal",
        synod_seal_key: clean
      })
    });
    const parsed = await res.json();
    if (!res.ok || !parsed || !parsed.ok) {
      throw new Error((parsed && parsed.error) || ("HTTP " + res.status));
    }
    if (!parsed.authorized) {
      throw new Error("Synod Seal passphrase rejected by the Scriptorium endpoint.");
    }
    try {
      sessionStorage.setItem(STORAGE_KEYS.synodSealKey, clean);
      sessionStorage.removeItem(STORAGE_KEYS.synodLocalMode);
    } catch (err) {
      /* ignore */
    }
    notifyDataChanged();
    return { ok: true, mode: "remote", message: "Synod Seal authenticated against Google Sheets." };
  }

  async function updateSynodStatus(loreId, newStatus) {
    if (ALLOWED_STATUSES.indexOf(newStatus) === -1) {
      throw new Error("Unsupported Synod status: " + newStatus);
    }
    const webhookUrl = getConfiguredWebhookUrl();
    const sealKey = getSynodSealKey();
    let remoteUpdated = false;

    if (webhookUrl && sealKey) {
      const res = await fetch(webhookUrl, {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "update_status",
          lore_id: loreId,
          synod_status: newStatus,
          synod_seal_key: sealKey
        })
      });
      const parsed = await res.json();
      if (!res.ok || !parsed || !parsed.ok) {
        throw new Error((parsed && parsed.error) || ("HTTP " + res.status));
      }
      remoteUpdated = true;
      if (Array.isArray(runtime.remoteEntries)) {
        runtime.remoteEntries = runtime.remoteEntries.map(function (item) {
          return item.lore_id === loreId ? Object.assign({}, item, { synod_status: newStatus }) : item;
        });
      }
    }

    const staged = getStagedEntries();
    let touchedStaged = false;
    const nextStaged = staged.map(function (item) {
      if (item.lore_id === loreId) {
        touchedStaged = true;
        return Object.assign({}, item, { synod_status: newStatus });
      }
      return item;
    });
    if (touchedStaged) {
      saveStagedEntries(nextStaged);
    }

    if (!remoteUpdated && !touchedStaged) {
      const overrides = getTriageOverrides();
      overrides[loreId] = newStatus;
      saveTriageOverrides(overrides);
    }

    notifyDataChanged();
    return { ok: true, remoteUpdated: remoteUpdated, lore_id: loreId, synod_status: newStatus };
  }

  function exportCompiledLoreJson() {
    const entries = getMergedEntries().map(cleanSchemaEntry);
    const blob = new Blob([JSON.stringify(entries, null, 2) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "liturgical_lore.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Archive Exported", "Downloaded liturgical_lore.json (" + entries.length + " entries).", "success");
  }

  /* Wax Seal Controls */
  function getUnsealedMap() {
    return readStorageJson(sessionStorage, STORAGE_KEYS.unsealedItems, {});
  }

  function isUnsealed(itemId) {
    return Boolean(getUnsealedMap()[itemId]);
  }

  function setUnsealed(itemId, value) {
    const map = getUnsealedMap();
    if (value) {
      map[itemId] = true;
    } else {
      delete map[itemId];
    }
    writeStorageJson(sessionStorage, STORAGE_KEYS.unsealedItems, map);
  }

  function renderWaxSealBlock(itemId, buttonLabel, caption, innerHtml) {
    const open = isUnsealed(itemId);
    return (
      '<div class="wax-seal-box' + (open ? " is-unsealed" : "") + '" data-wax-id="' + escapeHtml(itemId) + '">' +
        '<div class="wax-reseal-bar">' +
          "<span>Wax Seal Broken &mdash; Restricted Marginalia Revealed</span>" +
          '<button type="button" class="wax-reseal-link" data-wax-toggle="' + escapeHtml(itemId) + '">Re-seal</button>' +
        "</div>" +
        '<div class="wax-secret-content">' + innerHtml + "</div>" +
        '<div class="wax-seal-overlay">' +
          '<button type="button" class="wax-seal-btn" data-wax-toggle="' + escapeHtml(itemId) + '">' +
            "&#128308; " + escapeHtml(buttonLabel || "Break Wax Seal") +
          "</button>" +
          (caption ? '<div class="wax-seal-caption">' + escapeHtml(caption) + "</div>" : "") +
        "</div>" +
      "</div>"
    );
  }

  function bindWaxSealDelegation(rootEl) {
    const target = rootEl || document;
    if (target.dataset && target.dataset.waxBound) return;
    if (target.dataset) target.dataset.waxBound = "1";
    target.addEventListener("click", function (event) {
      const btn = event.target.closest("[data-wax-toggle]");
      if (!btn) return;
      const id = btn.getAttribute("data-wax-toggle");
      const box = btn.closest(".wax-seal-box");
      const nextState = !isUnsealed(id);
      setUnsealed(id, nextState);
      if (box) {
        box.classList.toggle("is-unsealed", nextState);
      }
      const escapedId = (typeof CSS !== "undefined" && CSS.escape) ? CSS.escape(id) : id;
      document.querySelectorAll('.wax-seal-box[data-wax-id="' + escapedId + '"]').forEach(function (el) {
        el.classList.toggle("is-unsealed", nextState);
      });
    });
  }

  /* Live Canonical Hour Watch */
  function getClockMode() {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.clockMode);
      return saved === "venice" ? "venice" : "local";
    } catch (err) {
      return "local";
    }
  }

  function toggleClockMode() {
    const next = getClockMode() === "venice" ? "local" : "venice";
    try {
      localStorage.setItem(STORAGE_KEYS.clockMode, next);
    } catch (err) {
      /* ignore */
    }
    renderWatchStrip();
  }

  function getClockParts(now, mode) {
    const date = now || new Date();
    if (mode === "venice") {
      try {
        const parts = new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/Rome",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false
        }).formatToParts(date);
        const h = parseInt(parts.find(function (p) { return p.type === "hour"; }).value, 10) % 24;
        const m = parseInt(parts.find(function (p) { return p.type === "minute"; }).value, 10);
        return {
          hours: h,
          minutes: m,
          formattedTime: String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0"),
          zoneLabel: "Venice (CET/CEST)"
        };
      } catch (err) {
        /* fallback below */
      }
    }
    const h = date.getHours();
    const m = date.getMinutes();
    return {
      hours: h,
      minutes: m,
      formattedTime: String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0"),
      zoneLabel: "Local Watch"
    };
  }

  function getActiveCanonicalHour(now, modeOverride) {
    const mode = modeOverride || getClockMode();
    const clock = getClockParts(now || new Date(), mode);
    const totalMin = clock.hours * 60 + clock.minutes;

    let hour = "Compline";
    if (totalMin >= 120 && totalMin < 300) hour = "Vigils";
    else if (totalMin >= 300 && totalMin < 420) hour = "Lauds";
    else if (totalMin >= 420 && totalMin < 690) hour = "Prime";
    else if (totalMin >= 690 && totalMin < 900) hour = "Sext";
    else if (totalMin >= 900 && totalMin < 1200) hour = "Vespers";

    const calendar = getCodex().calendar || [];
    const match = calendar.find(function (row) {
      return row.Hour_Or_Season === hour;
    }) || {};

    return {
      hour: hour,
      bellToll: match.Bell_Toll || "",
      observance: match.Communal_Observance || "",
      permittedSpeech: match.Permitted_Speech || "",
      presidingOrder: match.Presiding_Order || "",
      formattedTime: clock.formattedTime,
      mode: mode,
      zoneLabel: clock.zoneLabel
    };
  }

  function renderWatchStrip(targetId) {
    const strip = document.getElementById(targetId || "canonical-watch-strip");
    if (!strip) return;
    const active = getActiveCanonicalHour();
    const webhookUrl = getConfiguredWebhookUrl();
    const stagedCount = getStagedEntries().length;
    const unlocked = isSynodUnlocked();

    let syncBadge = '<span class="sync-pill">Archive: Compiled Only</span>';
    if (webhookUrl && runtime.lastSyncedAt) {
      syncBadge = '<span class="sync-pill is-live">Live Sheet Synced</span>';
    } else if (webhookUrl && runtime.lastSyncError) {
      syncBadge = '<span class="sync-pill">Sheet Offline (Cached)</span>';
    } else if (webhookUrl) {
      syncBadge = '<span class="sync-pill">Webhook Ready</span>';
    }
    if (stagedCount > 0) {
      syncBadge += ' <span class="sync-pill">' + stagedCount + " Staged</span>";
    }
    if (unlocked) {
      syncBadge += ' <span class="sync-pill is-synod">Synod Seal Open</span>';
    }

    strip.innerHTML =
      '<div class="watch-inner">' +
        '<div class="watch-status-group">' +
          '<span class="sanctuary-lamp" aria-hidden="true"></span>' +
          '<span class="watch-hour-pill">Hour of ' + escapeHtml(active.hour) + "</span>" +
          (active.presidingOrder
            ? '<span class="watch-meta"><strong>Presiding:</strong> ' + escapeHtml(active.presidingOrder) + "</span>"
            : "") +
          (active.permittedSpeech
            ? '<span class="watch-meta"><strong>Rule:</strong> ' + escapeHtml(active.permittedSpeech) + "</span>"
            : "") +
        "</div>" +
        '<div class="watch-controls">' +
          '<button type="button" id="watch-clock-toggle" class="watch-clock-btn" title="Toggle Local vs Venice (Europe/Rome) time">' +
            escapeHtml(active.formattedTime + " · " + active.zoneLabel) +
          "</button>" +
          syncBadge +
          '<button type="button" id="open-settings-modal-btn" class="btn btn-subtle btn-sm">Synod Seal &amp; Sync</button>' +
        "</div>" +
      "</div>";

    const clockBtn = document.getElementById("watch-clock-toggle");
    if (clockBtn) clockBtn.addEventListener("click", toggleClockMode);
    const modalBtn = document.getElementById("open-settings-modal-btn");
    if (modalBtn) modalBtn.addEventListener("click", openSettingsModal);
  }

  /* Shared Settings & Synod Seal Modal */
  function ensureSettingsModal() {
    let backdrop = document.getElementById("scriptorium-settings-modal");
    if (backdrop) return backdrop;

    backdrop = document.createElement("div");
    backdrop.id = "scriptorium-settings-modal";
    backdrop.className = "modal-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-labelledby", "settings-modal-title");
    backdrop.innerHTML =
      '<div class="modal-dialog is-compact">' +
        '<div class="modal-head">' +
          '<div>' +
            '<p class="brand-eyebrow">Scriptorium Infrastructure</p>' +
            '<h2 id="settings-modal-title" style="margin:0.2rem 0 0;color:var(--amber);">Synod Seal &amp; Live Sheet Sync</h2>' +
          "</div>" +
          '<button type="button" id="close-settings-modal-btn" class="modal-close" aria-label="Close settings">&times;</button>' +
        "</div>" +

        '<div class="settings-section">' +
          "<h3>1. Apps Script Web App Endpoint</h3>" +
          '<p class="field-hint" style="margin:0;">Connects submissions, live reads, and Synod triage with <code>Lore_Submissions</code>.</p>' +
          '<input id="settings-webhook-input" type="url" placeholder="https://script.google.com/macros/s/.../exec" />' +
          '<div class="form-actions">' +
            '<button type="button" id="settings-save-webhook" class="btn btn-primary btn-sm">Save Endpoint</button>' +
            '<button type="button" id="settings-ping-webhook" class="btn btn-sm">Test Connection</button>' +
            '<button type="button" id="settings-sync-now" class="btn btn-subtle btn-sm">Sync Archive Now</button>' +
            '<button type="button" id="settings-clear-webhook" class="btn btn-subtle btn-sm">Reset</button>' +
          "</div>" +
          '<div id="settings-webhook-status" class="field-hint"></div>' +
        "</div>" +

        '<div class="settings-section">' +
          "<h3>2. Synod Triage Mode</h3>" +
          '<p class="field-hint" style="margin:0;">Enter the Synod Seal passphrase configured in Apps Script Properties to ratify, dispute, or seal entries from the Folio Reader. When no webhook is configured, unlocking enables Local Triage Workbench mode.</p>' +
          '<div id="settings-synod-state" class="field-hint"></div>' +
          '<input id="settings-synod-passphrase" type="password" placeholder="Synod Seal passphrase (leave blank for local-only mode if unconfigured)" autocomplete="off" />' +
          '<div class="form-actions">' +
            '<button type="button" id="settings-unlock-synod" class="btn btn-primary btn-sm">Unlock Synod Triage</button>' +
            '<button type="button" id="settings-lock-synod" class="btn btn-subtle btn-sm">Lock Triage Mode</button>' +
          "</div>" +
        "</div>" +

        '<div class="settings-section">' +
          "<h3>3. Archive Export &amp; Local Cache</h3>" +
          '<div class="form-actions">' +
            '<button type="button" id="settings-export-json" class="btn btn-sm">Export compiled liturgical_lore.json</button>' +
            '<button type="button" id="settings-clear-staged" class="btn btn-subtle btn-sm">Clear Staged Drafts</button>' +
          "</div>" +
        "</div>" +
      "</div>";

    document.body.appendChild(backdrop);

    backdrop.addEventListener("click", function (event) {
      if (event.target === backdrop) closeSettingsModal();
    });
    document.getElementById("close-settings-modal-btn").addEventListener("click", closeSettingsModal);

    document.getElementById("settings-save-webhook").addEventListener("click", function () {
      const val = document.getElementById("settings-webhook-input").value.trim();
      setConfiguredWebhookUrl(val);
      renderSettingsModalState();
      renderWatchStrip();
      showToast("Endpoint Updated", val ? "Apps Script webhook URL saved locally." : "Cleared custom webhook override.", "success");
      if (val) fetchRemoteLore(true);
    });

    document.getElementById("settings-clear-webhook").addEventListener("click", function () {
      setConfiguredWebhookUrl("");
      document.getElementById("settings-webhook-input").value = getConfiguredWebhookUrl();
      runtime.remoteEntries = null;
      runtime.lastSyncedAt = null;
      renderSettingsModalState();
      notifyDataChanged();
      showToast("Endpoint Reset", "Reverted to repository default endpoint.", "info");
    });

    document.getElementById("settings-ping-webhook").addEventListener("click", async function () {
      const statusEl = document.getElementById("settings-webhook-status");
      const val = document.getElementById("settings-webhook-input").value.trim() || getConfiguredWebhookUrl();
      if (!val) {
        statusEl.textContent = "Enter a deployed https://script.google.com/macros/s/.../exec URL first.";
        return;
      }
      statusEl.textContent = "Pinging Scriptorium Web App...";
      try {
        const res = await pingWebhook(val);
        statusEl.textContent =
          "Connected (" + (res.service || "Apps Script") + ") — Synod Seal configured: " +
          (res.triage_configured ? "Yes" : "No");
        showToast("Webhook Online", "Connected to Apps Script endpoint.", "success");
      } catch (err) {
        statusEl.textContent = "Connection error: " + err.message;
        showToast("Ping Failed", err.message, "error");
      }
    });

    document.getElementById("settings-sync-now").addEventListener("click", async function () {
      const statusEl = document.getElementById("settings-webhook-status");
      statusEl.textContent = "Synchronizing with Lore_Submissions...";
      const res = await fetchRemoteLore(false);
      if (res.ok) {
        statusEl.textContent = "Synced " + res.entries.length + " entries at " + res.syncedAt;
        showToast("Archive Synced", "Loaded " + res.entries.length + " entries.", "success");
      } else {
        statusEl.textContent = res.unconfigured ? "No webhook URL configured." : ("Sync error: " + res.error);
      }
      renderSettingsModalState();
    });

    document.getElementById("settings-unlock-synod").addEventListener("click", async function () {
      const input = document.getElementById("settings-synod-passphrase");
      const stateEl = document.getElementById("settings-synod-state");
      try {
        const res = await unlockSynodMode(input.value);
        input.value = "";
        stateEl.textContent = res.message;
        renderSettingsModalState();
        showToast("Synod Triage Unlocked", res.message, "success");
      } catch (err) {
        stateEl.textContent = "Error: " + err.message;
        showToast("Synod Authentication Failed", err.message, "error");
      }
    });

    document.getElementById("settings-lock-synod").addEventListener("click", function () {
      lockSynodMode();
      renderSettingsModalState();
      showToast("Synod Seal Locked", "Triage controls hidden.", "info");
    });

    document.getElementById("settings-export-json").addEventListener("click", exportCompiledLoreJson);

    document.getElementById("settings-clear-staged").addEventListener("click", function () {
      saveStagedEntries([]);
      saveTriageOverrides({});
      notifyDataChanged();
      renderSettingsModalState();
      showToast("Local Staging Cleared", "Removed local staged entries and triage overrides.", "info");
    });

    return backdrop;
  }

  function renderSettingsModalState() {
    const urlInput = document.getElementById("settings-webhook-input");
    const urlStatus = document.getElementById("settings-webhook-status");
    const synodState = document.getElementById("settings-synod-state");
    if (!urlInput) return;

    const currentUrl = getConfiguredWebhookUrl();
    urlInput.value = currentUrl;
    if (currentUrl && runtime.lastSyncedAt) {
      urlStatus.textContent = "Active endpoint synced at " + runtime.lastSyncedAt;
    } else if (currentUrl) {
      urlStatus.textContent = "Endpoint configured (" + currentUrl.slice(0, 56) + (currentUrl.length > 56 ? "..." : "") + ")";
    } else {
      urlStatus.textContent = "No webhook configured yet; working from compiled archive + localStorage staging.";
    }

    if (getSynodSealKey()) {
      synodState.textContent = currentUrl
        ? "Status: UNLOCKED (Remote Google Sheets Triage active)"
        : "Status: UNLOCKED (Local Triage Workbench active)";
    } else if (isLocalTriageEnabled()) {
      synodState.textContent = "Status: UNLOCKED (Local Triage Workbench active)";
    } else {
      synodState.textContent = "Status: LOCKED (Read-only mode)";
    }
  }

  function openSettingsModal() {
    const backdrop = ensureSettingsModal();
    renderSettingsModalState();
    backdrop.classList.add("is-open");
  }

  function closeSettingsModal() {
    const backdrop = document.getElementById("scriptorium-settings-modal");
    if (backdrop) backdrop.classList.remove("is-open");
  }

  function initCanonicalWatch(targetId) {
    renderWatchStrip(targetId);
    setInterval(function () {
      renderWatchStrip(targetId);
    }, 30000);
  }

  global.OthelloScriptorium = {
    STORAGE_KEYS: STORAGE_KEYS,
    CATEGORY_META: CATEGORY_META,
    HOUR_ORDER: HOUR_ORDER,
    HOUR_LABELS: HOUR_LABELS,
    STATUS_META: STATUS_META,
    ALLOWED_STATUSES: ALLOWED_STATUSES,
    getBaselineLore: getBaselineLore,
    getSuite: getSuite,
    getCodex: getCodex,
    escapeHtml: escapeHtml,
    safeHref: safeHref,
    formatLabel: formatLabel,
    formatCategoryLabel: formatCategoryLabel,
    formatHourLabel: formatHourLabel,
    formatStatusLabel: formatStatusLabel,
    renderMarkdown: renderMarkdown,
    showToast: showToast,
    showBanner: showBanner,
    dismissBanner: dismissBanner,
    getConfiguredWebhookUrl: getConfiguredWebhookUrl,
    setConfiguredWebhookUrl: setConfiguredWebhookUrl,
    getNativeFormUrl: getNativeFormUrl,
    getMergedEntries: getMergedEntries,
    getMergedEntriesWithMeta: getMergedEntriesWithMeta,
    nextLoreId: nextLoreId,
    fetchRemoteLore: fetchRemoteLore,
    pingWebhook: pingWebhook,
    submitLoreEntry: submitLoreEntry,
    stageEntryLocally: function (entry) {
      const clean = cleanSchemaEntry(entry);
      stageEntryLocally(clean);
      notifyDataChanged();
      return clean;
    },
    isSynodUnlocked: isSynodUnlocked,
    unlockSynodMode: unlockSynodMode,
    lockSynodMode: lockSynodMode,
    updateSynodStatus: updateSynodStatus,
    exportCompiledLoreJson: exportCompiledLoreJson,
    isUnsealed: isUnsealed,
    setUnsealed: setUnsealed,
    renderWaxSealBlock: renderWaxSealBlock,
    bindWaxSealDelegation: bindWaxSealDelegation,
    getActiveCanonicalHour: getActiveCanonicalHour,
    initCanonicalWatch: initCanonicalWatch,
    openSettingsModal: openSettingsModal,
    closeSettingsModal: closeSettingsModal,
    onDataChanged: onDataChanged
  };
})(window);
