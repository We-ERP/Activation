/* ==================================================================
   ACTIVATION & FOLLOW-UP — OPS CONSOLE
   Logic: Google Sheet ("Str" tab) mapping sync + CSV ticket
   processing into an Hour x (Group > Leader > Agent) tree.
================================================================== */

/* ============================================================
   CONFIG
============================================================ */
const SHEET_URL = "https://script.google.com/macros/s/AKfycbytna6gz9sE31tX_i00k1v9MAp9QyvKZwGYTao_r9B8qIVW1DcXUdyOl_Zb_kmcsFO2/exec";

// 0-indexed column positions inside the "Str" tab
const COL_USER   = 3;  // column D — agent id
const COL_GROUP  = 5;  // column F — task group
const COL_LEADER = 12; // column M — leader name

// coordinator IDs get a small badge next to their name
const COOR = ["AZ217162","AA138951","AS93748","KE144207","FA236380","MO222804","SM195261"];

const GROUP_PALETTE = ["#ff9d3d","#2dd6c4","#9b8cfb","#f472b6","#60a5fa","#34d399","#f0b429"];

/* ============================================================
   STATE
============================================================ */
let STR_MAP = {};      // { agentId: { group, leader } }
let RAW_ROWS = [];      // last parsed CSV rows (so we can re-run after a re-sync)
let GLOBAL_DATA = {};   // { group: { leader: { agent: stats } } }
let GLOBAL_HOURS = [];

/* ============================================================
   SHEET SYNC
============================================================ */
function setStatus(kind, text){
  const pill = document.getElementById('syncPill');
  pill.className = 'sync-pill ' + kind;
  document.getElementById('syncText').textContent = text;
}

async function syncMapping(){
  const tab = document.getElementById('tabName').value.trim() || 'Str';
  setStatus('busy', `Connecting to "${tab}"...`);
  try{
    const res = await fetch(`${SHEET_URL}?tab=${encodeURIComponent(tab)}`);
    const json = await res.json();
    if(json.status !== 'success') throw new Error(json.message || 'Unknown error from script');

    STR_MAP = {};
    json.data.forEach(record=>{
      const vals = Object.values(record);
      const user = (vals[COL_USER] ?? '').toString().trim();
      if(!user) return;
      const group = (vals[COL_GROUP] ?? '').toString().trim() || 'Unmapped';
      const leader = (vals[COL_LEADER] ?? '').toString().trim() || 'Unmapped';
      STR_MAP[user] = { group, leader };
    });

    const n = Object.keys(STR_MAP).length;
    setStatus('ok', `Synced — ${n} agents mapped from "${tab}" — ${new Date().toLocaleTimeString()}`);

    if(RAW_ROWS.length) process(RAW_ROWS); // re-run with fresh mapping if we already have tickets

  }catch(err){
    setStatus('err', `Couldn't reach the sheet (${err.message}) — falling back to the CSV's own added_by_leader column, grouped as "Unmapped"`);
  }
}

/* ============================================================
   LOAD TICKETS
============================================================ */
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

/* ============================================================
   PROCESS — build group -> leader -> agent tree
============================================================ */
function process(data){

  RAW_ROWS = data;
  GLOBAL_DATA = {};
  let hoursSet = new Set();

  data.forEach(r=>{

    const user = (r.added_by || "").toString().trim();
    if(!user) return;

    const action = (r.case_action || "").toString().trim();
    const status = (r.ticket_status || "").toString().trim();
    const hourDate = new Date(r.added_on);
    if(isNaN(hourDate.getTime())) return;
    const hour = hourDate.getHours();

    const mapped = STR_MAP[user];
    const leader = mapped ? mapped.leader : ((r.added_by_leader || "").trim() || "Unmapped");
    const group  = mapped ? mapped.group  : "Unmapped";

    if(!GLOBAL_DATA[group]) GLOBAL_DATA[group] = {};
    if(!GLOBAL_DATA[group][leader]) GLOBAL_DATA[group][leader] = {};
    if(!GLOBAL_DATA[group][leader][user]){
      GLOBAL_DATA[group][leader][user] = {
        hours:{}, total:0, reached:0, notReached:0, points:0
      };
    }

    const u = GLOBAL_DATA[group][leader][user];
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

/* ============================================================
   HELPERS
============================================================ */
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

/* ============================================================
   RENDER
============================================================ */
function renderFiltered(){

  const search = document.getElementById("searchInput").value.toLowerCase();
  const dashboard = document.getElementById("dashboard");
  dashboard.innerHTML = "";

  if(Object.keys(GLOBAL_DATA).length === 0){
    dashboard.innerHTML = `<div class="empty-state">
      <div class="big">No tickets loaded yet</div>
      Sync the mapping, then paste or upload the ticket export to build the board.
    </div>`;
    return;
  }

  // ---- overall KPIs ----
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

  // ---- group summary table ----
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

  // ---- group accordions ----
  groupNames.forEach(g=>{

    const leaders = GLOBAL_DATA[g];
    const flat = flattenGroup(leaders);
    const agg = aggregate(flat);
    const color = groupColor(g);

    const hasMatch = !search || Object.keys(flat).some(a => a.toLowerCase().includes(search));
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
      const agentIds = Object.keys(agents).filter(a => !search || a.toLowerCase().includes(search));
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

        let row = `<tr><td>${a}${COOR.includes(a) ? ' <span class="badge">COOR</span>' : ''}</td>`;

        GLOBAL_HOURS.forEach(h=>{
          const v = u.hours[h] || 0;
          const alpha = v === 0 ? 0 : 0.14 + 0.62 * (v / maxCell);
          const hot = alpha > 0.5;
          row += `<td class="hour-cell${hot?' hot':''}" style="background:rgba(45,214,196,${alpha})">${v||''}</td>`;
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

/* ============================================================
   EXPORT
============================================================ */
function copyAsImage(){
  html2canvas(document.querySelector('.shell'), {backgroundColor:"#0a0e1a"}).then(canvas=>{
    canvas.toBlob(blob=>{
      navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
      alert("Copied ✅");
    });
  });
}

/* ============================================================
   INIT
============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById("fileInput").addEventListener("change", e=>{
    Papa.parse(e.target.files[0],{
      header:true,
      skipEmptyLines:true,
      complete: res => process(res.data)
    });
  });

  document.getElementById("searchInput").addEventListener("keyup", renderFiltered);

  syncMapping(); // try to connect to the sheet automatically on load
});
