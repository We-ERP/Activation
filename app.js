/* ==================================================================
   ACTIVATION & FOLLOW-UP — OPS CONSOLE
   Logic: agent mapping loaded from STR Loss.xlsx (in this repo) +
   CSV ticket processing into an Hour x (Group > Leader > Agent) tree.
 ================================================================== */

const STR_FILE = "STR Loss.xlsx";      // lives in the same repo folder as index.html
const STR_TAB = "Str";                 // falls back to the first sheet if not found
const STR_COL_USER = "TTS User";       // must match the header text exactly
const STR_COL_LEADER = "TL Name";
const COOR = ["AZ217162","AA138951","AS93748","KE144207","FA236380","MO222804","SM195261"];
const GROUP_PALETTE = ["#ff9d3d","#2dd6c4","#9b8cfb","#f472b6","#60a5fa","#34d399","#f0b429"];

let STR_MAP = {};
let RAW_ROWS = [];
let GLOBAL_DATA = {};
let GLOBAL_HOURS = [];

const IGNORED_USERS = new Set([
  "AS93748",
  "ZEINABAHMED",
  "GS98056",
  "MM07371"
]);

function normalizeAgentId(value) {
  return String(value ?? '')
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function cleanValue(value) {
  return (value ?? '').toString().trim();
}

function isIgnoredUser(value) {
  return IGNORED_USERS.has(normalizeAgentId(value));
}

function setStatus(kind, text){
  const pill = document.getElementById('syncPill');
  pill.className = 'sync-pill ' + kind;
  document.getElementById('syncText').textContent = text;
}

async function loadMapping(){
  setStatus('busy', 'Loading agent mapping...');
  try{
    // cache-busting query so a freshly uploaded file shows up right away
    const res = await fetch(`${encodeURIComponent(STR_FILE)}?v=${Date.now()}`, { cache: 'no-store' });
    if(!res.ok) throw new Error(`file not found (HTTP ${res.status})`);

    const wb = XLSX.read(await res.arrayBuffer(), { type: 'array' });
    const sheetName = wb.SheetNames.includes(STR_TAB) ? STR_TAB : wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
    if(!rows.length) throw new Error(`sheet "${sheetName}" is empty`);

    // find the two columns by header name (trimmed, so stray spaces don't break it)
    const headerOf = {};
    Object.keys(rows[0]).forEach(k => { headerOf[cleanValue(k)] = k; });
    const userCol = headerOf[STR_COL_USER];
    const leaderCol = headerOf[STR_COL_LEADER];
    if(!userCol || !leaderCol){
      throw new Error(`missing column "${!userCol ? STR_COL_USER : STR_COL_LEADER}"`);
    }

    const map = {};
    rows.forEach(r => {
      const key = normalizeAgentId(r[userCol]);
      if(!key || isIgnoredUser(key)) return;
      map[key] = { leader: cleanValue(r[leaderCol]) || 'Unmapped' };
    });

    STR_MAP = map;
    const n = Object.keys(STR_MAP).length;
    setStatus('ok', `Mapping loaded — ${n} agents from "${sheetName}" — ${new Date().toLocaleTimeString()}`);

    if(RAW_ROWS.length) process(RAW_ROWS);

  }catch(err){
    setStatus('err', `Couldn't load the mapping (${err.message}) — falling back to the CSV's own leader column, grouped as "Unmapped"`);
  }
}

function resetData(){
  GLOBAL_DATA = {};
  GLOBAL_HOURS = [];
  RAW_ROWS = [];
  document.getElementById("dashboard").innerHTML = "";
  document.getElementById("pasteArea").value = "";
  document.getElementById("searchInput").value = "";
  renderFiltered();
}

function handlePaste(){
  Papa.parse(document.getElementById("pasteArea").value,{
    header:true,
    skipEmptyLines:true,
    complete: res => process(res.data)
  });
}

function process(data){
  RAW_ROWS = data;
  GLOBAL_DATA = {};
  let hoursSet = new Set();

  data.forEach(r=>{
    const user = cleanValue(r.added_by);
    if(!user || isIgnoredUser(user)) return;

    const action = cleanValue(r.case_action);
    const status = cleanValue(r.ticket_status);
    const hourDate = new Date(r.added_on);
    if(isNaN(hourDate.getTime())) return;
    const hour = hourDate.getHours();

    const mapped = STR_MAP[normalizeAgentId(user)];
    const leader = mapped ? mapped.leader : (cleanValue(r.added_by_leader) || cleanValue(r.leader) || "Unmapped");
    const group  = cleanValue(r.task_group) || cleanValue(r.taskGroup) || cleanValue(r.group) || cleanValue(r.taskGroupName) || "Unmapped";

    const agentKey = normalizeAgentId(user);

    if(!GLOBAL_DATA[group]) GLOBAL_DATA[group] = {};
    if(!GLOBAL_DATA[group][leader]) GLOBAL_DATA[group][leader] = {};
    if(!GLOBAL_DATA[group][leader][agentKey]){
      GLOBAL_DATA[group][leader][agentKey] = {
        display: user, hours:{}, total:0, reached:0, notReached:0, points:0
      };
    }

    const u = GLOBAL_DATA[group][leader][agentKey];
    hoursSet.add(hour);
    u.hours[hour] = (u.hours[hour]||0) + 1;
    u.total++;

    if(action === "Reached") u.reached++;
    else if(action === "Not Reached - SMS Sent") u.notReached++;

    if(action === "Reached" && status === "New") u.points += 4;
    else if(action === "Reached") u.points += 3.5;
    else if(action === "Not Reached - SMS Sent") u.points += 3;
    else if(action.toLowerCase().includes("no call")) u.points += 1.5;

  });

  GLOBAL_HOURS = Array.from(hoursSet).sort((a,b)=>a-b);
  renderFiltered();
}

function groupColor(name){
  let h = 0;
  for(let i=0;i<name.length;i++) h = name.charCodeAt(i) + ((h<<5)-h);
  return GROUP_PALETTE[Math.abs(h) % GROUP_PALETTE.length];
}

function aggregate(obj){
  let total=0, reached=0, notReached=0, points=0;
  for(const k in obj){
    if(obj[k].total !== undefined){
      total += obj[k].total; reached += obj[k].reached;
      notReached += obj[k].notReached; points += obj[k].points;
    }
  }
  return {total, reached, notReached, points};
}

function reachPct(r,n){ return (r/(r+n)*100 || 0).toFixed(1); }

function expandAll(open){
  document.querySelectorAll('#dashboard details').forEach(d => d.open = open);
}

function flattenGroup(leaders){
  const flat = {};
  for(const l in leaders){
    for(const a in leaders[l]){
      flat[a] = leaders[l][a];
    }
  }
  return flat;
}

function renderFiltered(){
  const search = document.getElementById("searchInput").value.toLowerCase();
  const dashboard = document.getElementById("dashboard");
  dashboard.innerHTML = "";

  if(Object.keys(GLOBAL_DATA).length === 0){
    dashboard.innerHTML = `<div class="empty-state">
      <div class="big">No tickets loaded yet</div>
      Paste or upload the ticket export to build the board.
    </div>`;
    return;
  }

  let total=0, reached=0, nr=0, agentCount=0;
  let maxCell = 1;

  for(const g in GLOBAL_DATA){
    for(const l in GLOBAL_DATA[g]){
      for(const a in GLOBAL_DATA[g][l]){
        const d = GLOBAL_DATA[g][l][a];
        total += d.total; reached += d.reached; nr += d.notReached;
        agentCount++;
        GLOBAL_HOURS.forEach(h => { if((d.hours[h]||0) > maxCell) maxCell = d.hours[h]; });
      }
    }
  }

  const reach = reachPct(reached, nr);
  const prod = (total/(GLOBAL_HOURS.length||1)).toFixed(1);
  const avg = (total/agentCount || 0).toFixed(1);

  dashboard.innerHTML += `
  <div class="readout">
    <div class="cell"><div class="num">${total}</div><div class="label">Total tickets</div></div>
    <div class="cell"><div class="num">${reach}%</div><div class="label">Reachability</div></div>
    <div class="cell"><div class="num">${prod}</div><div class="label">Productivity / hour</div></div>
    <div class="cell"><div class="num">${avg}</div><div class="label">Avg tickets / agent</div></div>
  </div>`;

  const groupNames = Object.keys(GLOBAL_DATA).sort((a,b)=>{
    return aggregate(flattenGroup(GLOBAL_DATA[b])).total - aggregate(flattenGroup(GLOBAL_DATA[a])).total;
  });

  let summary = `<div class="table-wrap"><table class="group-summary"><tr>
    <th>Task group</th><th>Total</th><th>Reach</th><th>Leaders</th><th>Agents</th><th>Points</th></tr>`;

  groupNames.forEach(g=>{
    const flat = flattenGroup(GLOBAL_DATA[g]);
    const agg = aggregate(flat);
    const leaderCount = Object.keys(GLOBAL_DATA[g]).length;
    const agentCountG = Object.keys(flat).length;
    summary += `<tr>
      <td class="name-cell"><span class="swatch" style="background:${groupColor(g)};color:${groupColor(g)}"></span>${g}</td>
      <td>${agg.total}</td>
      <td>${reachPct(agg.reached, agg.notReached)}%</td>
      <td>${leaderCount}</td>
      <td>${agentCountG}</td>
      <td>${agg.points.toFixed(1)}</td>
    </tr>`;
  });
  summary += `</table></div>`;
  dashboard.innerHTML += summary;

  groupNames.forEach(g=>{
    const leaders = GLOBAL_DATA[g];
    const flat = flattenGroup(leaders);
    const agg = aggregate(flat);
    const color = groupColor(g);

    const hasMatch = !search || Object.keys(flat).some(a => (flat[a].display || a).toLowerCase().includes(search));
    if(!hasMatch) return;

    const groupEl = document.createElement('details');
    groupEl.className = 'group';
    groupEl.style.borderLeftColor = color;
    groupEl.open = !!search;

    groupEl.innerHTML = `<summary>
        <span class="swatch" style="background:${color};color:${color}"></span>${g}
        <span class="meta">
          <span>${agg.total} tickets</span>
          <span>${reachPct(agg.reached, agg.notReached)}% reach</span>
          <span>${Object.keys(leaders).length} leaders</span>
        </span>
      </summary>`;

    const groupCopyBtn = document.createElement('button');
    groupCopyBtn.type = 'button';
    groupCopyBtn.className = 'subtle';
    groupCopyBtn.textContent = '📋 Copy';
    groupCopyBtn.title = `Copy "${g}" metrics to clipboard`;
    groupCopyBtn.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      copyGroupData(g, null, groupCopyBtn);
    });
    groupEl.querySelector('summary').appendChild(groupCopyBtn);

    const body = document.createElement('div');
    body.className = 'group-body';

    const leaderNames = Object.keys(leaders).sort((a,b)=>{
      return aggregate(leaders[b]).total - aggregate(leaders[a]).total;
    });

    let topLeader = null, topLeaderPts = -1;
    leaderNames.forEach(l=>{
      const p = aggregate(leaders[l]).points;
      if(p > topLeaderPts){ topLeaderPts = p; topLeader = l; }
    });

    leaderNames.forEach(l=>{
      const agents = leaders[l];
      const agentIds = Object.keys(agents).filter(a => !search || (agents[a].display || a).toLowerCase().includes(search));
      if(search && agentIds.length === 0) return;

      const lAgg = aggregate(agents);

      const leaderEl = document.createElement('details');
      leaderEl.className = 'leader';
      leaderEl.open = !!search;

      leaderEl.innerHTML = `<summary>
          ${l === topLeader ? '<span class="crown">👑</span>' : ''}
          ${l}
          <span class="lmeta">
            <span>${lAgg.total} tickets</span>
            <span>${reachPct(lAgg.reached, lAgg.notReached)}% reach</span>
            <span>${lAgg.points.toFixed(1)} pts</span>
            <span>${Object.keys(agents).length} agents</span>
          </span>
        </summary>`;

      const leaderCopyBtn = document.createElement('button');
      leaderCopyBtn.type = 'button';
      leaderCopyBtn.className = 'subtle';
      leaderCopyBtn.textContent = '📋 Copy';
      leaderCopyBtn.title = `Copy "${l}" metrics to clipboard`;
      leaderCopyBtn.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        copyGroupData(g, l, leaderCopyBtn);
      });
      leaderEl.querySelector('summary').appendChild(leaderCopyBtn);

      const wrap = document.createElement('div');
      wrap.className = 'agents-wrap';

      const table = document.createElement('table');
      table.className = 'agents';

      let head = `<tr><th>Agent</th>`;
      GLOBAL_HOURS.forEach(h => head += `<th>${h}:00</th>`);
      head += `<th>Total</th><th>Points</th><th>Reach %</th></tr>`;
      table.innerHTML = head;

      const sortedAgents = agentIds.sort((a,b) => agents[b].total - agents[a].total);

      sortedAgents.forEach(a=>{
        const u = agents[a];
        const userReach = reachPct(u.reached, u.notReached);
        const reachClass = (u.reached + u.notReached === 0) ? '' : (userReach >= 60 ? 'reach-good' : 'reach-bad');

        const displayName = u.display || a;
        let row = `<tr><td>${displayName}${COOR.includes(normalizeAgentId(a)) ? ' <span class="badge">COOR</span>' : ''}</td>`;

        GLOBAL_HOURS.forEach(h=>{
          const v = u.hours[h] || 0;
          const alpha = v === 0 ? 0 : 0.14 + 0.62 * (v / maxCell);
          const hot = alpha > 0.5;
          const lowValue = v > 0 && v < 15;
          row += `<td class="hour-cell${hot?' hot':''}${lowValue?' low-value':''}" style="background:rgba(18,59,116,${alpha})">${v||''}</td>`;
        });

        row += `<td class="total">${u.total}</td>`;
        row += `<td class="points">${u.points.toFixed(1)}</td>`;
        row += `<td class="${reachClass}">${userReach}%</td></tr>`;

        table.innerHTML += row;
      });

      wrap.appendChild(table);
      leaderEl.appendChild(wrap);
      body.appendChild(leaderEl);
    });

    groupEl.appendChild(body);
    dashboard.appendChild(groupEl);
  });
}

function copyAsImage(){
  html2canvas(document.querySelector('.shell'), {backgroundColor:"#0a0e1a"}).then(canvas=>{
    canvas.toBlob(blob=>{
      navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
      alert("Copied ✅");
    });
  });
}

/* ---------- Per-group / per-TL clipboard copy (UI-only; no data logic) ---------- */
function copyGroupData(groupName, leaderName, btn){
  const group = GLOBAL_DATA[groupName];
  if(!group) return;

  const search = document.getElementById("searchInput").value.toLowerCase();
  const header = ['Agent', ...GLOBAL_HOURS.map(h => `${h}:00`), 'Total', 'Points', 'Reach %'];
  const lines = [];

  const appendLeader = l => {
    const agents = group[l];
    if(!agents) return;
    const agentIds = Object.keys(agents).filter(a => !search || (agents[a].display || a).toLowerCase().includes(search));
    if(agentIds.length === 0) return;
    const lAgg = aggregate(agents);
    if(lines.length) lines.push('');
    lines.push(`${groupName} — ${l}`);
    lines.push(`${lAgg.total} tickets · ${reachPct(lAgg.reached, lAgg.notReached)}% reach · ${lAgg.points.toFixed(1)} pts · ${Object.keys(agents).length} agents`);
    lines.push(header.join('\t'));
    agentIds.sort((a,b) => agents[b].total - agents[a].total).forEach(a => {
      const u = agents[a];
      const row = [u.display || a];
      GLOBAL_HOURS.forEach(h => row.push(u.hours[h] || ''));
      row.push(u.total, u.points.toFixed(1), `${reachPct(u.reached, u.notReached)}%`);
      lines.push(row.join('\t'));
    });
  };

  if(leaderName) appendLeader(leaderName);
  else Object.keys(group).sort((a,b) => aggregate(group[b]).total - aggregate(group[a]).total).forEach(appendLeader);

  const text = lines.join('\n');
  const done = ok => flashCopied(btn, ok);

  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(() => done(true)).catch(() => fallbackCopyText(text, done));
  }else{
    fallbackCopyText(text, done);
  }
}

function fallbackCopyText(text, done){
  try{
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    done(ok);
  }catch(e){
    done(false);
  }
}

function flashCopied(btn, ok){
  if(!btn) return;
  const original = btn.textContent;
  btn.textContent = ok ? 'Copied ✓' : 'Copy failed';
  setTimeout(() => { btn.textContent = original; }, 1400);
}

/* ---------- Excel export (.xlsx) with theme colors; reads in-memory data only ---------- */
function exportToExcel(){
  if(typeof XLSX === 'undefined'){
    alert("Excel export library is still loading — please try again in a moment.");
    return;
  }
  if(Object.keys(GLOBAL_DATA).length === 0){
    alert("No data to export — run performance first.");
    return;
  }

  const NAVY = "123B74", WHITE = "FFFFFF", DIM = "4F6383", INK = "172235";
  const GOOD = "0B6A4A", BAD = "B42336", LOW_BG = "8C1D2F", LEADER_BG = "E7EDF5";
  const thin = { style:"thin", color:{ rgb:"C7D2E2" } };
  const border = { top:thin, bottom:thin, left:thin, right:thin };
  const base = { border, alignment:{ horizontal:"center", vertical:"center" } };
  const headerStyle = { ...base, font:{ bold:true, color:{ rgb:WHITE } }, fill:{ fgColor:{ rgb:NAVY } } };
  const leaderStyle = { ...base, font:{ bold:true, color:{ rgb:INK } }, fill:{ fgColor:{ rgb:LEADER_BG } }, alignment:{ horizontal:"left", vertical:"center" } };
  const nameStyle = { ...base, alignment:{ horizontal:"left", vertical:"center" }, font:{ bold:true } };

  let total=0, reached=0, nr=0, agentCount=0, maxCell=1;
  for(const g in GLOBAL_DATA){
    for(const l in GLOBAL_DATA[g]){
      for(const a in GLOBAL_DATA[g][l]){
        const d = GLOBAL_DATA[g][l][a];
        total += d.total; reached += d.reached; nr += d.notReached; agentCount++;
        GLOBAL_HOURS.forEach(h => { if((d.hours[h]||0) > maxCell) maxCell = d.hours[h]; });
      }
    }
  }

  /* Heat color: same rgba(18,59,116,alpha) the UI uses, flattened over white */
  const heatFill = v => {
    const alpha = 0.14 + 0.62 * (v / maxCell);
    const mix = c => Math.round(255*(1-alpha) + c*alpha);
    const hex = n => n.toString(16).padStart(2,"0").toUpperCase();
    return hex(mix(18)) + hex(mix(59)) + hex(mix(116));
  };
  const hourStyle = v => {
    if(!v) return base;
    if(v < 15) return { ...base, fill:{ fgColor:{ rgb:LOW_BG } }, font:{ bold:true, color:{ rgb:WHITE } } };
    const alpha = 0.14 + 0.62 * (v / maxCell);
    return { ...base, fill:{ fgColor:{ rgb:heatFill(v) } }, font: alpha > 0.5 ? { bold:true, color:{ rgb:WHITE } } : { color:{ rgb:DIM } } };
  };
  const reachStyle = (r, n) => {
    if(r + n === 0) return base;
    const pct = +(r/(r+n)*100).toFixed(1);
    return { ...base, font:{ bold:true, color:{ rgb: pct >= 60 ? GOOD : BAD } } };
  };
  const styleCell = (ws, r, c, style) => {
    const addr = XLSX.utils.encode_cell({ r, c });
    if(!ws[addr]) ws[addr] = { t:"s", v:"" };
    ws[addr].s = style;
  };
  const safeSheetName = (name, taken) => {
    const baseName = (String(name).replace(/[\\\/\?\*\[\]\:]/g, " ").trim() || "Group").slice(0, 28);
    let candidate = baseName, i = 1;
    while(taken.has(candidate)) candidate = `${baseName.slice(0,25)}_${i++}`;
    taken.add(candidate);
    return candidate;
  };

  const wb = XLSX.utils.book_new();
  const groupNames = Object.keys(GLOBAL_DATA).sort((a,b)=>{
    return aggregate(flattenGroup(GLOBAL_DATA[b])).total - aggregate(flattenGroup(GLOBAL_DATA[a])).total;
  });

  /* ----- Sheet 1: Summary (readout + group summary table) ----- */
  const summaryRows = [
    ["Activation & Follow-up — Performance Export"],
    [`Generated: ${new Date().toLocaleString()}`],
    [],
    ["Total tickets", "Reachability", "Productivity / hour", "Avg tickets / agent"],
    [total, `${reachPct(reached, nr)}%`, +(total/(GLOBAL_HOURS.length||1)).toFixed(1), +(total/agentCount || 0).toFixed(1)],
    [],
    ["Task group", "Total", "Reach", "Leaders", "Agents", "Points"]
  ];
  groupNames.forEach(g=>{
    const flat = flattenGroup(GLOBAL_DATA[g]);
    const agg = aggregate(flat);
    summaryRows.push([g, agg.total, `${reachPct(agg.reached, agg.notReached)}%`, Object.keys(GLOBAL_DATA[g]).length, Object.keys(flat).length, +agg.points.toFixed(1)]);
  });

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet["!cols"] = [{wch:28},{wch:14},{wch:20},{wch:20},{wch:10},{wch:10}];
  styleCell(summarySheet, 0, 0, { font:{ bold:true, sz:14, color:{ rgb:NAVY } } });
  styleCell(summarySheet, 1, 0, { font:{ color:{ rgb:DIM } } });
  for(let c=0;c<4;c++) styleCell(summarySheet, 3, c, headerStyle);
  for(let c=0;c<4;c++) styleCell(summarySheet, 4, c, { ...base, font:{ bold:true, sz:12, color:{ rgb:NAVY } } });
  for(let c=0;c<6;c++) styleCell(summarySheet, 6, c, headerStyle);
  groupNames.forEach((g, i)=>{
    const r = 7 + i;
    styleCell(summarySheet, r, 0, { ...nameStyle, fill:{ fgColor:{ rgb:groupColor(g).replace('#','').toUpperCase() } } });
    for(let c=1;c<6;c++) styleCell(summarySheet, r, c, base);
  });
  XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");

  /* ----- One sheet per task group: TL sections + agent x hour grid ----- */
  const taken = new Set(["Summary"]);
  groupNames.forEach(g=>{
    const leaders = GLOBAL_DATA[g];
    const color = groupColor(g).replace('#','').toUpperCase();

    const leaderNames = Object.keys(leaders).sort((a,b)=>aggregate(leaders[b]).total - aggregate(leaders[a]).total);
    let topLeader = null, topPts = -1;
    leaderNames.forEach(l=>{ const p = aggregate(leaders[l]).points; if(p > topPts){ topPts = p; topLeader = l; } });

    const rows = [[`Group: ${g}`], []];
    leaderNames.forEach(l=>{
      const agents = leaders[l];
      const lAgg = aggregate(agents);
      rows.push([`${l === topLeader ? "👑 " : ""}${l}`, `${lAgg.total} tickets`, `${reachPct(lAgg.reached, lAgg.notReached)}% reach`, `${lAgg.points.toFixed(1)} pts`, `${Object.keys(agents).length} agents`]);
      rows.push(["Agent", ...GLOBAL_HOURS.map(h=>`${h}:00`), "Total", "Points", "Reach %"]);
      Object.keys(agents).sort((a,b)=>agents[b].total - agents[a].total).forEach(a=>{
        const u = agents[a];
        rows.push([u.display || a, ...GLOBAL_HOURS.map(h=>u.hours[h] || null), u.total, +u.points.toFixed(1), `${reachPct(u.reached, u.notReached)}%`]);
      });
      rows.push([]);
    });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{wch:26}, ...GLOBAL_HOURS.map(()=>({wch:7})), {wch:9}, {wch:9}, {wch:10}];

    let r = 0;
    styleCell(ws, r, 0, { font:{ bold:true, sz:13, color:{ rgb:INK } }, fill:{ fgColor:{ rgb:color } }, alignment:{ horizontal:"left", vertical:"center" } });
    r += 2;
    leaderNames.forEach(l=>{
      for(let c=0;c<5;c++) styleCell(ws, r, c, leaderStyle);
      r++;
      const colCount = 1 + GLOBAL_HOURS.length + 3;
      for(let c=0;c<colCount;c++) styleCell(ws, r, c, headerStyle);
      r++;
      const agents = leaders[l];
      Object.keys(agents).sort((a,b)=>agents[b].total - agents[a].total).forEach(a=>{
        const u = agents[a];
        styleCell(ws, r, 0, nameStyle);
        GLOBAL_HOURS.forEach((h, i)=> styleCell(ws, r, 1+i, hourStyle(u.hours[h] || 0)));
        const totalCol = 1 + GLOBAL_HOURS.length;
        styleCell(ws, r, totalCol, { ...base, font:{ bold:true, color:{ rgb:INK } } });
        styleCell(ws, r, totalCol+1, { ...base, font:{ bold:true, color:{ rgb:NAVY } } });
        styleCell(ws, r, totalCol+2, reachStyle(u.reached, u.notReached));
        r++;
      });
      r++;
    });

    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(g, taken));
  });

  const now = new Date();
  const pad = n => String(n).padStart(2,'0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  XLSX.writeFile(wb, `activation-performance-${stamp}.xlsx`);
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById("fileInput").addEventListener("change", e=>{
    Papa.parse(e.target.files[0],{
      header:true,
      skipEmptyLines:true,
      complete: res => process(res.data)
    });
  });

  document.getElementById("searchInput").addEventListener("keyup", renderFiltered);

  loadMapping();
});
