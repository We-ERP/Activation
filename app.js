/* ==================================================================
   ACTIVATION & FOLLOW-UP — PERFORMANCE OPS CONSOLE
   Logic: Google Sheet ("Str" tab) mapping sync + CSV/XLSX uploads
   for Compensation / IR / UTL / Structure Master performance reports.
   ================================================================== */

const SHEET_URL = "https://script.google.com/macros/s/AKfycbytna6gz9sE31tX_i00k1v9MAp9QyvKZwGYTao_r9B8qIVW1DcXUdyOl_Zb_kmcsFO2/exec";
const COL_USER = 3;
const COL_GROUP = 5;
const COL_LEADER = 12;

const GROUP_PALETTE = ["#ff9d3d", "#2dd6c4", "#9b8cfb", "#f472b6", "#60a5fa", "#34d399", "#f0b429"];
const EXCEL_SYSTEM_FACTOR = 0.00104166666666667;
const DAY_MS = 24 * 60 * 60 * 1000;

const DATA_SOURCES = {
  comp: { inputId: "compInput", statusId: "compStatus", label: "Compensation Log" },
  ir: { inputId: "irInput", statusId: "irStatus", label: "IR Tickets File" },
  utl: { inputId: "utlInput", statusId: "utlStatus", label: "UTL Logs" },
  str: { inputId: "strInput", statusId: "strStatus", label: "Structure Master Sheet" }
};

const IGNORED_USERS = new Set([
  "AS93748",
  "ZEINABAHMED",
  "GS98056",
  "MM07371"
]);

const HEADER_ALIASES = {
  compId: ["Comp_ID"],
  compDate: ["Comp_Da"],
  compDuration: ["Comp_Du"],
  irAddedBy: ["added_by"],
  irAddedOn: ["added_on"],
  irAssignedTo: ["assigned_to"],
  irTicketOwner: ["IR_L_E"],
  irLeaderFallback: ["added_by_leader", "leader"],
  irGroupFallback: ["task_group", "taskGroup", "group", "taskGroupName"],
  utlLogin: ["UL_lo", "Login_ID", "Login ID"],
  utlDate: ["UL_Date"],
  utlTalk: ["UL_T"],
  holdTime: ["Hold Time"],
  otherTime: ["Other Time"],
  auxOutOffTime: ["AUXOUTOFFTIME"],
  acwOutOffTime: ["ACWOUTOFFTIME"],
  stId: ["ST_ID"],
  stDuration: ["ST_Du"],
  stDate: ["ST_D"],
  stGroup: ["Group", "Group Name", "Team Group", "Task Group", "Group_1", "Group 1"],
  stLeader: ["TL_Name", "TL Name", "Leader", "Team Leader"],
  stTtsUser: ["TTS_User", "TTS User", "User", "Agent ID"],
  stAgentName: ["Agent_Name", "Agent Name", "Name"],
  stLoginId: ["Login_ID", "Login ID", "UL_lo"],
  stTeleoptiId: ["Teleopti_ID", "Teleopti ID"],
  stStatus: ["Status", "Agent_Status", "Agent Status"],
  stGroup2: ["Group_2", "Group 2"]
};

const STATE = {
  mappingSheet: {},
  uploads: {
    comp: [],
    ir: [],
    utl: [],
    str: []
  },
  report: null,
  activeGroup: null,
  activeDateIndex: 0,
  showAllDates: false,
  sort: { key: "agentName", dir: "asc" }
};

function normalizeAgentId(value) {
  return String(value ?? "")
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function normalizeLookup(value) {
  return String(value ?? "")
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function cleanValue(value) {
  return (value ?? "").toString().trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isIgnoredUser(value) {
  return IGNORED_USERS.has(normalizeAgentId(value));
}

function normalizedHeaderName(value) {
  return cleanValue(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pickValue(row, aliases) {
  const keys = Object.keys(row || {});
  for (const alias of aliases) {
    const direct = row?.[alias];
    if (cleanValue(direct) !== "") return direct;
    const normalizedAlias = normalizedHeaderName(alias);
    const matchingKey = keys.find(key => normalizedHeaderName(key) === normalizedAlias);
    if (matchingKey && cleanValue(row[matchingKey]) !== "") return row[matchingKey];
  }
  return "";
}

function setStatus(kind, text) {
  const pill = document.getElementById("syncPill");
  pill.className = "sync-pill " + kind;
  document.getElementById("syncText").textContent = text;
}

function setSourceStatus(kind, text, tone = "") {
  const config = DATA_SOURCES[kind];
  if (!config) return;
  const el = document.getElementById(config.statusId);
  el.className = "upload-status" + (tone ? ` ${tone}` : "");
  el.textContent = text;
}

function groupColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return GROUP_PALETTE[Math.abs(hash) % GROUP_PALETTE.length];
}

function excelSerialToDate(serial) {
  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * DAY_MS;
  const dateInfo = new Date(utcValue);
  return new Date(dateInfo.getUTCFullYear(), dateInfo.getUTCMonth(), dateInfo.getUTCDate(), 12);
}

function parseDateValue(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12);
  }

  const text = cleanValue(value);
  if (!text) return null;

  const isoDateOnly = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoDateOnly) {
    const [, year, month, day] = isoDateOnly;
    return new Date(Number(year), Number(month) - 1, Number(day), 12);
  }

  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 20000 && numeric < 80000) {
    return excelSerialToDate(numeric);
  }

  const match = text.match(/^(\d{1,4})[\/\-](\d{1,2})[\/\-](\d{1,4})(?:\s+(.*))?$/);

  if (match) {
    let [, p1, p2, p3, tail = ""] = match;
    let year;
    let month;
    let day;

    if (p1.length === 4) {
      year = Number(p1);
      month = Number(p2);
      day = Number(p3);
    } else {
      const a = Number(p1);
      const b = Number(p2);
      const c = Number(p3.length === 2 ? `20${p3}` : p3);
      year = c;
      if (a > 12) {
        day = a;
        month = b;
      } else if (b > 12) {
        month = a;
        day = b;
      } else {
        month = a;
        day = b;
      }
    }

    const parsed = new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T12:00:00`);
    if (!isNaN(parsed.getTime())) return parsed;

    const retry = new Date(`${year}/${month}/${day} ${tail}`.trim());
    if (!isNaN(retry.getTime())) {
      return new Date(retry.getFullYear(), retry.getMonth(), retry.getDate(), 12);
    }
  }

  const isIsoLike = /^\d{4}[\/-]\d{1,2}[\/-]\d{1,2}(?:[T\s].*)?$/.test(text);
  if (!isIsoLike) return null;

  const direct = new Date(text);
  return isNaN(direct.getTime()) ? null : new Date(direct.getFullYear(), direct.getMonth(), direct.getDate(), 12);
}

function toDateKey(value) {
  const date = parseDateValue(value);
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateKeyToDate(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function dateLabel(dateKey) {
  return dateKey
    ? dateKeyToDate(dateKey).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })
    : "—";
}

function parseDurationDays(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const text = cleanValue(value).replace(/,/g, "");
  if (!text) return 0;

  if (/^\d+:\d{1,2}(:\d{1,2})?$/.test(text)) {
    const parts = text.split(":").map(Number);
    const hours = parts[0] || 0;
    const minutes = parts[1] || 0;
    const seconds = parts[2] || 0;
    return ((hours * 3600) + (minutes * 60) + seconds) / 86400;
  }

  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseSecondsValue(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const text = cleanValue(value).replace(/,/g, "");
  if (!text) return 0;

  if (/^\d+:\d{1,2}(:\d{1,2})?$/.test(text)) {
    const parts = text.split(":").map(Number);
    return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
  }

  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatDurationDays(value) {
  if (typeof value === "string") return value;
  const totalSeconds = Math.max(0, Math.round((value || 0) * 86400));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function mapIncrement(map, key, amount) {
  map.set(key, (map.get(key) || 0) + amount);
}

function buildRangeFromDates(dateKeys) {
  if (!dateKeys.length) return [];
  const sorted = [...new Set(dateKeys)].sort();
  const range = [];
  let cursor = dateKeyToDate(sorted[0]);
  const end = dateKeyToDate(sorted[sorted.length - 1]);
  while (cursor <= end) {
    range.push(toDateKey(cursor));
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1, 12);
  }
  return range;
}

function parseDelimitedText(text) {
  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      complete: result => resolve(result.data || []),
      error: reject
    });
  });
}

async function parseFileRows(file, kind) {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const preferredSheet = kind === "str"
      ? workbook.SheetNames.find(name => cleanValue(name).toLowerCase() === (document.getElementById("tabName").value.trim() || "Str").toLowerCase())
      : null;
    const sheetName = preferredSheet || workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
  }

  const text = await file.text();
  return parseDelimitedText(text);
}

async function loadRowsIntoSource(kind, rows, sourceLabel) {
  STATE.uploads[kind] = Array.isArray(rows) ? rows : [];
  setSourceStatus(kind, `${DATA_SOURCES[kind].label}: ${STATE.uploads[kind].length} rows from ${sourceLabel}`, "ok");
}

async function handleFileSelection(kind, file) {
  if (!file) return;
  setSourceStatus(kind, `Loading ${file.name}...`, "busy");
  try {
    const rows = await parseFileRows(file, kind);
    await loadRowsIntoSource(kind, rows, file.name);
  } catch (error) {
    setSourceStatus(kind, `Couldn't parse ${file.name}: ${error.message}`, "err");
  }
}

async function syncMapping() {
  const tab = document.getElementById("tabName").value.trim() || "Str";
  setStatus("busy", `Connecting to "${tab}"...`);
  try {
    const response = await fetch(`${SHEET_URL}?tab=${encodeURIComponent(tab)}`);
    const json = await response.json();
    if (json.status !== "success") throw new Error(json.message || "Unknown error from script");

    STATE.mappingSheet = {};
    json.data.forEach(record => {
      const values = Object.values(record);
      const user = cleanValue(values[COL_USER]);
      const agentId = normalizeAgentId(user);
      if (!agentId || isIgnoredUser(agentId)) return;
      STATE.mappingSheet[agentId] = {
        group: cleanValue(values[COL_GROUP]) || "Unmapped",
        leader: cleanValue(values[COL_LEADER]) || "Unmapped"
      };
    });

    const count = Object.keys(STATE.mappingSheet).length;
    setStatus("ok", `Synced — ${count} agents mapped from "${tab}" — ${new Date().toLocaleTimeString()}`);

    if (STATE.report) generateReport();
  } catch (error) {
    setStatus("err", `Couldn't reach the "${tab}" sheet (${error.message}) — report will rely on uploaded STR Loss or fallback grouping`);
  }
}

function ensureProfile(profileMap, agentId) {
  const normalizedAgentId = normalizeAgentId(agentId);
  if (!normalizedAgentId) return null;
  if (!profileMap.has(normalizedAgentId)) {
    const mapping = STATE.mappingSheet[normalizedAgentId] || {};
    profileMap.set(normalizedAgentId, {
      agentId: normalizedAgentId,
      group: mapping.group || "Unmapped",
      leader: mapping.leader || "Unmapped",
      ttsUser: normalizedAgentId,
      agentName: normalizedAgentId,
      loginId: "",
      teleoptiId: "",
      statusByDate: {}
    });
  }
  return profileMap.get(normalizedAgentId);
}

function assignProfileValue(profile, key, value, { overwrite = false } = {}) {
  const cleaned = cleanValue(value);
  if (!cleaned) return;
  if (overwrite || !cleanValue(profile[key])) profile[key] = cleaned;
}

function assignFallbackProfile(profile, leader, group) {
  if (!cleanValue(profile.leader) || profile.leader === "Unmapped") {
    assignProfileValue(profile, "leader", leader, { overwrite: true });
  }
  if (!cleanValue(profile.group) || profile.group === "Unmapped") {
    assignProfileValue(profile, "group", group, { overwrite: true });
  }
}

function buildReportModel() {
  const profileMap = new Map();
  const agentIdByLogin = new Map();
  const dateKeys = [];

  const compByAgentDate = new Map();
  const assigningByAgentDate = new Map();
  const tktByAgentDate = new Map();
  const talkByLoginDate = new Map();
  const teleSchSourceByAgentDate = new Map();

  const touchDate = value => {
    const dateKey = toDateKey(value);
    if (dateKey) dateKeys.push(dateKey);
    return dateKey;
  };

  Object.keys(STATE.mappingSheet).forEach(agentId => ensureProfile(profileMap, agentId));

  STATE.uploads.str.forEach(row => {
    const agentId = normalizeAgentId(pickValue(row, HEADER_ALIASES.stId));
    if (!agentId || isIgnoredUser(agentId)) return;

    const profile = ensureProfile(profileMap, agentId);
    const dateKey = touchDate(pickValue(row, HEADER_ALIASES.stDate));
    const statusValue = cleanValue(pickValue(row, HEADER_ALIASES.stStatus)) || "Active";

    assignProfileValue(profile, "group", pickValue(row, HEADER_ALIASES.stGroup), { overwrite: true });
    assignProfileValue(profile, "leader", pickValue(row, HEADER_ALIASES.stLeader), { overwrite: true });
    assignProfileValue(profile, "ttsUser", pickValue(row, HEADER_ALIASES.stTtsUser), { overwrite: true });
    assignProfileValue(profile, "agentName", pickValue(row, HEADER_ALIASES.stAgentName), { overwrite: true });
    assignProfileValue(profile, "loginId", pickValue(row, HEADER_ALIASES.stLoginId), { overwrite: true });
    assignProfileValue(profile, "teleoptiId", pickValue(row, HEADER_ALIASES.stTeleoptiId), { overwrite: true });

    if (cleanValue(pickValue(row, HEADER_ALIASES.stGroup2))) {
      profile.group = cleanValue(pickValue(row, HEADER_ALIASES.stGroup2));
    }

    if (dateKey) {
      profile.statusByDate[dateKey] = statusValue;
      mapIncrement(
        teleSchSourceByAgentDate,
        `${agentId}__${dateKey}`,
        parseDurationDays(pickValue(row, HEADER_ALIASES.stDuration))
      );
    }

    const loginKey = normalizeLookup(profile.loginId);
    if (loginKey) agentIdByLogin.set(loginKey, agentId);
  });

  STATE.uploads.comp.forEach(row => {
    const agentId = normalizeAgentId(pickValue(row, HEADER_ALIASES.compId));
    if (!agentId || isIgnoredUser(agentId)) return;
    const dateKey = touchDate(pickValue(row, HEADER_ALIASES.compDate));
    if (!dateKey) return;

    ensureProfile(profileMap, agentId);
    mapIncrement(
      compByAgentDate,
      `${agentId}__${dateKey}`,
      parseDurationDays(pickValue(row, HEADER_ALIASES.compDuration))
    );
  });

  STATE.uploads.ir.forEach(row => {
    const addedBy = normalizeAgentId(pickValue(row, HEADER_ALIASES.irAddedBy));
    const dateKey = touchDate(pickValue(row, HEADER_ALIASES.irAddedOn));
    if (!dateKey) return;
    const leaderFallback = pickValue(row, HEADER_ALIASES.irLeaderFallback);
    const groupFallback = pickValue(row, HEADER_ALIASES.irGroupFallback);

    if (addedBy && !isIgnoredUser(addedBy)) {
      const profile = ensureProfile(profileMap, addedBy);
      assignFallbackProfile(profile, leaderFallback, groupFallback);
    }

    const assignedTo = normalizeAgentId(pickValue(row, HEADER_ALIASES.irAssignedTo));
    if (assignedTo && !isIgnoredUser(assignedTo)) {
      const profile = ensureProfile(profileMap, assignedTo);
      assignFallbackProfile(profile, leaderFallback, groupFallback);
      mapIncrement(assigningByAgentDate, `${assignedTo}__${dateKey}`, 1);
    }

    const ticketOwner = normalizeAgentId(pickValue(row, HEADER_ALIASES.irTicketOwner));
    if (ticketOwner && !isIgnoredUser(ticketOwner)) {
      const profile = ensureProfile(profileMap, ticketOwner);
      assignFallbackProfile(profile, leaderFallback, groupFallback);
      mapIncrement(tktByAgentDate, `${ticketOwner}__${dateKey}`, 1);
    }
  });

  STATE.uploads.utl.forEach(row => {
    const rawLogin = cleanValue(pickValue(row, HEADER_ALIASES.utlLogin));
    const loginKey = normalizeLookup(rawLogin);
    const dateKey = touchDate(pickValue(row, HEADER_ALIASES.utlDate));
    if (!loginKey || !dateKey) return;

    let agentId = agentIdByLogin.get(loginKey);
    if (!agentId) {
      agentId = normalizeAgentId(rawLogin);
      if (!agentId) return;
      const profile = ensureProfile(profileMap, agentId);
      assignProfileValue(profile, "loginId", rawLogin, { overwrite: true });
      assignProfileValue(profile, "ttsUser", rawLogin);
      assignProfileValue(profile, "agentName", rawLogin);
      agentIdByLogin.set(loginKey, agentId);
    }

    const profile = ensureProfile(profileMap, agentId);
    assignProfileValue(profile, "loginId", rawLogin, { overwrite: true });

    const rawTalkInputs = [
      pickValue(row, HEADER_ALIASES.holdTime),
      pickValue(row, HEADER_ALIASES.otherTime),
      pickValue(row, HEADER_ALIASES.auxOutOffTime),
      pickValue(row, HEADER_ALIASES.acwOutOffTime)
    ];
    const hasRawTalkInputs = rawTalkInputs.some(value => cleanValue(value) !== "");
    const computedTalkSeconds = rawTalkInputs.reduce((sum, value) => sum + parseSecondsValue(value), 0);
    const fallbackTalkSeconds = parseSecondsValue(pickValue(row, HEADER_ALIASES.utlTalk));
    const talkSeconds = hasRawTalkInputs ? computedTalkSeconds : fallbackTalkSeconds;

    mapIncrement(talkByLoginDate, `${loginKey}__${dateKey}`, talkSeconds / 86400);
  });

  const dates = buildRangeFromDates(dateKeys);
  const profiles = [...profileMap.values()].map(profile => ({
    ...profile,
    group: cleanValue(profile.group) || "Unmapped",
    leader: cleanValue(profile.leader) || "Unmapped",
    ttsUser: cleanValue(profile.ttsUser) || profile.agentId,
    agentName: cleanValue(profile.agentName) || profile.agentId,
    loginId: cleanValue(profile.loginId),
    teleoptiId: cleanValue(profile.teleoptiId)
  }));

  const groups = [...new Set(profiles.map(profile => profile.group || "Unmapped"))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
  );

  return {
    profiles,
    groups,
    dates,
    metrics: {
      compByAgentDate,
      assigningByAgentDate,
      tktByAgentDate,
      talkByLoginDate,
      teleSchSourceByAgentDate
    }
  };
}

function computeMetrics(profile, dateKey, metrics) {
  const agentKey = `${profile.agentId}__${dateKey}`;
  const loginKey = normalizeLookup(profile.loginId || profile.ttsUser || profile.agentId);
  const talkKey = `${loginKey}__${dateKey}`;

  const status = cleanValue(profile.statusByDate[dateKey]) || "Active";
  const isActive = status.toLowerCase() === "active";

  // Excel: COUNTIFS(assigned_to,$D5,Date,G$3)
  const assigningTkts = metrics.assigningByAgentDate.get(agentKey) || 0;

  // Excel: COUNTIFS(IR_L_E,$D5,Date,G$3)
  const tkt = metrics.tktByAgentDate.get(agentKey) || 0;

  // Excel: COUNTIFS(IR_L_E,$D5,Date,G$3) * 0.00104166666666667
  const system = tkt * EXCEL_SYSTEM_FACTOR;

  // Excel: SUMIFS(UL_T,UL_lo,$B5,UL_Date,G$3) / 3600 / 24
  const talkTime = metrics.talkByLoginDate.get(talkKey) || 0;

  // Excel: SUMIFS(ST_Du,ST_ID,$A5,ST_D,G$3) * 0.9
  const teleSch = (metrics.teleSchSourceByAgentDate.get(agentKey) || 0) * 0.9;

  // Excel: SUMIFS(Comp_Du,Comp_ID,$A5,Comp_Da,G$3)
  const comp = metrics.compByAgentDate.get(agentKey) || 0;

  // Excel: IF($F5<>"Active",$F5,IF(K5-SUM(I5,J5,L5)<=0,0,K5-SUM(I5,J5,L5)))
  // In the legacy workbook this subtracts Comp + Talk Time + System from Tele-SCH,
  // and returns the status text instead of a duration when the row is not Active.
  const lossTime = !isActive
    ? status
    : Math.max(0, teleSch - (comp + talkTime + system));

  return { status, isActive, assigningTkts, tkt, system, talkTime, teleSch, comp, lossTime };
}

function getCurrentDateKey() {
  return STATE.report?.dates?.[STATE.activeDateIndex] || "";
}

function getVisibleDateKeys() {
  if (!STATE.report) return [];
  if (STATE.showAllDates) return STATE.report.dates;
  const current = getCurrentDateKey();
  return current ? [current] : [];
}

function sortRows(rows) {
  const { key, dir } = STATE.sort;
  const direction = dir === "desc" ? -1 : 1;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

  return [...rows].sort((a, b) => {
    const left = a[key];
    const right = b[key];

    if (typeof left === "number" && typeof right === "number") return (left - right) * direction;
    return collator.compare(String(left ?? ""), String(right ?? "")) * direction;
  });
}

function buildDisplayRows(groupName, dateKey) {
  if (!STATE.report) return [];

  const query = cleanValue(document.getElementById("searchInput").value).toLowerCase();
  const rows = STATE.report.profiles
    .filter(profile => profile.group === groupName)
    .map(profile => {
      const metrics = computeMetrics(profile, dateKey, STATE.report.metrics);
      return {
        ...profile,
        ...metrics,
        searchBlob: [
          profile.leader,
          profile.agentName,
          profile.loginId,
          profile.teleoptiId,
          profile.ttsUser,
          profile.agentId
        ].join(" ").toLowerCase()
      };
    })
    .filter(row => !query || row.searchBlob.includes(query));

  return sortRows(rows);
}

function renderReadout() {
  const dashboard = document.getElementById("dashboard");
  if (!STATE.report) return;

  const currentDateKey = getCurrentDateKey();
  const currentRows = STATE.report.groups.flatMap(group => buildDisplayRows(group, currentDateKey));
  const totalAssigning = currentRows.reduce((sum, row) => sum + row.assigningTkts, 0);
  const totalTkt = currentRows.reduce((sum, row) => sum + row.tkt, 0);
  const activeRows = currentRows.filter(row => row.status === "Active").length;

  dashboard.innerHTML += `
    <div class="readout">
      <div class="cell"><div class="num">${STATE.report.groups.length}</div><div class="label">Groups loaded</div></div>
      <div class="cell"><div class="num">${STATE.report.dates.length}</div><div class="label">Report days</div></div>
      <div class="cell"><div class="num">${totalAssigning}</div><div class="label">Assigning Tkts (${dateLabel(currentDateKey)})</div></div>
      <div class="cell"><div class="num">${totalTkt}</div><div class="label">TKT (${dateLabel(currentDateKey)}) · Active rows ${activeRows}</div></div>
    </div>
  `;
}

function renderDayStrip() {
  if (!STATE.report) return "";
  const currentDateKey = getCurrentDateKey();
  const dayButtons = STATE.report.dates.map((dateKey, index) => `
    <button class="tab-pill${dateKey === currentDateKey ? " active" : ""}" onclick="setActiveDate(${index})">${escapeHtml(dateLabel(dateKey))}</button>
  `).join("");

  return `
    <div class="report-toolbar">
      <div class="toolbar-title">Date range: ${dateLabel(STATE.report.dates[0])} → ${dateLabel(STATE.report.dates[STATE.report.dates.length - 1])}</div>
      <div class="toolbar-subtitle">${STATE.showAllDates ? "All report days expanded" : `Focused on ${dateLabel(currentDateKey)}`}</div>
    </div>
    <div class="tab-strip day-strip ${STATE.showAllDates ? "expanded" : ""}">
      ${dayButtons}
    </div>
  `;
}

function renderGroupStrip() {
  if (!STATE.report) return "";
  const tabs = STATE.report.groups.map(group => `
    <button class="tab-pill${group === STATE.activeGroup ? " active" : ""}" onclick='setActiveGroup(${JSON.stringify(group)})'>
      <span class="swatch" style="background:${groupColor(group)};color:${groupColor(group)}"></span>${escapeHtml(group)}
    </button>
  `).join("");
  return `<div class="tab-strip group-strip">${tabs}</div>`;
}

function renderGroupTable(groupName) {
  const visibleDates = getVisibleDateKeys();
  return visibleDates.map(dateKey => {
    const rows = buildDisplayRows(groupName, dateKey);
    const rowsHtml = rows.length
      ? rows.map(row => `
        <tr>
          <td>${escapeHtml(row.leader)}</td>
          <td>${escapeHtml(row.ttsUser)}</td>
          <td>${escapeHtml(row.agentName)}</td>
          <td>${row.loginId ? escapeHtml(row.loginId) : '<span class="muted">—</span>'}</td>
          <td>${row.teleoptiId ? escapeHtml(row.teleoptiId) : '<span class="muted">—</span>'}</td>
          <td><span class="status-pill${row.isActive ? " active" : " inactive"}">${escapeHtml(row.status)}</span></td>
          <td>${escapeHtml(row.assigningTkts)}</td>
          <td>${escapeHtml(row.tkt)}</td>
          <td>${escapeHtml(formatDurationDays(row.system))}</td>
          <td>${escapeHtml(formatDurationDays(row.talkTime))}</td>
          <td>${escapeHtml(formatDurationDays(row.teleSch))}</td>
          <td>${escapeHtml(formatDurationDays(row.comp))}</td>
          <td class="${typeof row.lossTime === "string" ? "loss-tag" : ""}">${escapeHtml(formatDurationDays(row.lossTime))}</td>
        </tr>
      `).join("")
      : `<tr><td colspan="13" class="muted empty-row">No matching rows for ${escapeHtml(dateLabel(dateKey))}.</td></tr>`;

    return `
      <div class="table-wrap performance-table">
        <div class="table-title">${escapeHtml(groupName)} · ${escapeHtml(dateLabel(dateKey))}</div>
        <div class="agents-wrap">
          <table class="performance-report">
            <thead>
              <tr>
                ${renderSortableHeader("leader", "TL Name")}
                ${renderSortableHeader("ttsUser", "TTS User")}
                ${renderSortableHeader("agentName", "Agent Name")}
                ${renderSortableHeader("loginId", "Login ID")}
                ${renderSortableHeader("teleoptiId", "Teleopti ID")}
                ${renderSortableHeader("status", "Status")}
                ${renderSortableHeader("assigningTkts", "Assigning Tkts")}
                ${renderSortableHeader("tkt", "TKT")}
                ${renderSortableHeader("system", "System")}
                ${renderSortableHeader("talkTime", "Talk Time")}
                ${renderSortableHeader("teleSch", "Tele-SCH")}
                ${renderSortableHeader("comp", "Comp")}
                ${renderSortableHeader("lossTime", "Loss Time")}
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>
    `;
  }).join("");
}

function renderSortableHeader(key, label) {
  const isActive = STATE.sort.key === key;
  const marker = isActive ? (STATE.sort.dir === "asc" ? " ▲" : " ▼") : "";
  return `<th class="sortable${isActive ? " active" : ""}" onclick='setSort(${JSON.stringify(key)})'>${escapeHtml(label + marker)}</th>`;
}

function renderDashboard() {
  const dashboard = document.getElementById("dashboard");
  dashboard.innerHTML = "";

  if (!STATE.report || !STATE.report.dates.length || !STATE.report.groups.length) {
    dashboard.innerHTML = `<div class="empty-state">
      <div class="big">No performance report yet</div>
      Upload one or more source files, optionally sync the Str tab, then click <strong>بحث وإنشاء التقرير</strong>.
    </div>`;
    return;
  }

  renderReadout();
  dashboard.innerHTML += renderDayStrip();
  dashboard.innerHTML += renderGroupStrip();
  dashboard.innerHTML += renderGroupTable(STATE.activeGroup);
}

function generateReport() {
  const previousDateKey = getCurrentDateKey();
  STATE.report = buildReportModel();
  STATE.activeGroup = STATE.report.groups.includes(STATE.activeGroup) ? STATE.activeGroup : STATE.report.groups[0] || null;
  const preservedDateIndex = STATE.report.dates.indexOf(previousDateKey);
  STATE.activeDateIndex = preservedDateIndex >= 0 ? preservedDateIndex : Math.max(STATE.report.dates.length - 1, 0);
  renderDashboard();
}

function resetData() {
  STATE.uploads = { comp: [], ir: [], utl: [], str: [] };
  STATE.report = null;
  STATE.activeGroup = null;
  STATE.activeDateIndex = 0;
  STATE.showAllDates = false;
  STATE.sort = { key: "agentName", dir: "asc" };

  Object.entries(DATA_SOURCES).forEach(([kind, config]) => {
    document.getElementById(config.inputId).value = "";
    setSourceStatus(kind, "No file loaded");
  });

  document.getElementById("pasteArea").value = "";
  document.getElementById("searchInput").value = "";
  renderDashboard();
}

async function handlePaste() {
  const source = document.getElementById("pasteSource").value;
  const text = document.getElementById("pasteArea").value;
  if (!cleanValue(text)) return;

  setSourceStatus(source, "Importing pasted CSV...", "busy");
  try {
    const rows = await parseDelimitedText(text);
    await loadRowsIntoSource(source, rows, "pasted CSV");
    document.getElementById("pasteArea").value = "";
  } catch (error) {
    setSourceStatus(source, `Couldn't import pasted CSV: ${error.message}`, "err");
  }
}

function setActiveGroup(group) {
  STATE.activeGroup = group;
  renderDashboard();
}

function setActiveDate(index) {
  if (!STATE.report) return;
  STATE.activeDateIndex = Math.max(0, Math.min(index, STATE.report.dates.length - 1));
  renderDashboard();
}

function stepActiveDate(step) {
  setActiveDate(STATE.activeDateIndex + step);
}

function toggleDateList() {
  STATE.showAllDates = !STATE.showAllDates;
  renderDashboard();
}

function setSort(key) {
  if (STATE.sort.key === key) {
    STATE.sort.dir = STATE.sort.dir === "asc" ? "desc" : "asc";
  } else {
    STATE.sort = { key, dir: "asc" };
  }
  renderDashboard();
}

async function copyAsImage() {
  try {
    const canvas = await html2canvas(document.querySelector(".shell"), { backgroundColor: "#0a0e1a" });
    const blob = await new Promise(resolve => canvas.toBlob(resolve));
    if (!blob) throw new Error("Couldn't convert the report to an image");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    alert("Copied ✅");
  } catch (error) {
    alert(`Copy failed: ${error.message}`);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  Object.entries(DATA_SOURCES).forEach(([kind, config]) => {
    document.getElementById(config.inputId).addEventListener("change", event => handleFileSelection(kind, event.target.files?.[0]));
    setSourceStatus(kind, "No file loaded");
  });

  document.getElementById("searchInput").addEventListener("input", renderDashboard);
  renderDashboard();
  syncMapping();
});
