/* ==================================================================
   ACTIVATION & FOLLOW-UP — OPS CONSOLE
   Logic: Google Sheet ("Str" tab) mapping sync + CSV ticket
   processing into an Hour x (Group > Leader > Agent) tree.
 ================================================================== */

const SHEET_URL = "https://script.google.com/macros/s/AKfycbytna6gz9sE31tX_i00k1v9MAp9QyvKZwGYTao_r9B8qIVW1DcXUdyOl_Zb_kmcsFO2/exec";
const COL_USER = 3;
const COL_GROUP = 5;
const COL_LEADER = 12;
const COOR = ["AZ217162","AA138951","AS93748","KE144207","FA236380","MO222804","SM195261"];
const GROUP_PALETTE = ["#ff9d3d","#2dd6c4","#9b8cfb","#f472b6","#60a5fa","#34d399","#f0b429"];

let STR_MAP = {};
let RAW_ROWS = [];
let GLOBAL_DATA = {};
let GLOBAL_HOURS = [];

// IDs in the CSV are not consistently cased (for example ke144207 vs KE144207).
// Normalize only the lookup key; displayed names and all calculations stay unchanged.
function normalizeAgentId(value){
  return (value ?? '').toString().trim().replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, '').toUpperCase();
}

function cleanValue(value){ return (value ?? '').toString().trim(); }

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
      const user = cleanValue(vals[COL_USER]);
      const key = normalizeAgentId(user);
      if(!key) return;
      const group = cleanValue(vals[COL_GROUP]) || 'Unmapped';
      const leader = cleanValue(vals[COL_LEADER]) || 'Unmapped';
      STR_MAP[key] = { group, leader };
    });

    const n = Object.keys(STR_MAP).length;
    setStatus('ok', `Synced — ${n} agents mapped from "${tab}" — ${new Date().toLocaleTimeString()}`);
    if(RAW_ROWS.length) process(RAW_ROWS);
  }catch(err){
    setStatus('err', `Couldn't reach the sheet (${err.message}) — falling back to the CSV's own mapping columns`);
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
  Papa.parse(document.getElementById("pasteArea").value,{header:true,skipEmptyLines:true,complete:res=>process(res.data)});
}

function process(data){
  RAW_ROWS = data;
  GLOBAL_DATA = {};
  let hoursSet = new Set();

  data.forEach(r=>{
    const user = cleanValue(r.added_by);
    if(!user) return;
    const action = cleanValue(r.case_action);
    const status = cleanValue(r.ticket_status);
    const hourDate = new Date(r.added_on);
    if(isNaN(hourDate.getTime())) return;
    const hour = hourDate.getHours();

    // Match the CSV agent to the Structure sheet case-insensitively.
    const mapped = STR_MAP[normalizeAgentId(user)];
    const leader = mapped ? mapped.leader : (cleanValue(r.added_by_leader) || cleanValue(r.leader) || "Unmapped");
    const group = mapped ? mapped.group : (cleanValue(r.task_group) || cleanValue(r.taskGroup) || cleanValue(r.group) || cleanValue(r.taskGroupName) || "Unmapped");

    if(!GLOBAL_DATA[group]) GLOBAL_DATA[group] = {};
    if(!GLOBAL_DATA[group][leader]) GLOBAL_DATA[group][leader] = {};
    if(!GLOBAL_DATA[group][leader][user]) GLOBAL_DATA[group][leader][user] = {hours:{},total:0,reached:0,notReached:0,points:0};

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

function groupColor(name){
  let h=0;
  for(let i=0;i<name.length;i++) h=name.charCodeAt(i)+((h<<5)-h);
  return GROUP_PALETTE[Math.abs(h)%GROUP_PALETTE.length];
}
function aggregate(obj){
  let total=0,reached=0,notReached=0,points=0;
  for(const k in obj) if(obj[k].total!==undefined){total+=obj[k].total;reached+=obj[k].reached;notReached+=obj[k].notReached;points+=obj[k].points;}
  return {total,reached,notReached,points};
}
function reachPct(r,n){return (r/(r+n)*100||0).toFixed(1);}
function expandAll(open){document.querySelectorAll('#dashboard details').forEach(d=>d.open=open);}
function flattenGroup(leaders){const flat={};for(const l in leaders)for(const a in leaders[l])flat[a]=leaders[l][a];return flat;}

function renderFiltered(){
  const search=document.getElementById("searchInput").value.toLowerCase();
  const dashboard=document.getElementById("dashboard");
  dashboard.innerHTML="";
  if(Object.keys(GLOBAL_DATA).length===0){dashboard.innerHTML=`<div class="empty-state"><div class="big">No tickets loaded yet</div>Sync the mapping, then paste or upload the ticket export to build the board.</div>`;return;}

  let total=0,reached=0,nr=0,agentCount=0,maxCell=1;
  for(const g in GLOBAL_DATA)for(const l in GLOBAL_DATA[g])for(const a in GLOBAL_DATA[g][l]){const d=GLOBAL_DATA[g][l][a];total+=d.total;reached+=d.reached;nr+=d.notReached;agentCount++;GLOBAL_HOURS.forEach(h=>{if((d.hours[h]||0)>maxCell)maxCell=d.hours[h];});}
  dashboard.innerHTML+=`<div class="readout"><div class="cell"><div class="num">${total}</div><div class="label">Total tickets</div></div><div class="cell"><div class="num">${reachPct(reached,nr)}%</div><div class="label">Reachability</div></div><div class="cell"><div class="num">${(total/(GLOBAL_HOURS.length||1)).toFixed(1)}</div><div class="label">Productivity / hour</div></div><div class="cell"><div class="num">${(total/agentCount||0).toFixed(1)}</div><div class="label">Avg tickets / agent</div></div></div>`;

  const groupNames=Object.keys(GLOBAL_DATA).sort((a,b)=>aggregate(flattenGroup(GLOBAL_DATA[b])).total-aggregate(flattenGroup(GLOBAL_DATA[a])).total);
  let summary=`<div class="table-wrap"><table class="group-summary"><thead><tr><th>Task group</th><th>Total</th><th>Reach</th><th>Leaders</th><th>Agents</th><th>Points</th></tr></thead><tbody>`;
  let summaryTotal={total:0,reached:0,notReached:0,points:0,leaders:0,agents:0};
  groupNames.forEach(g=>{const flat=flattenGroup(GLOBAL_DATA[g]),agg=aggregate(flat),leaderCount=Object.keys(GLOBAL_DATA[g]).length,agentCountG=Object.keys(flat).length;summaryTotal.total+=agg.total;summaryTotal.reached+=agg.reached;summaryTotal.notReached+=agg.notReached;summaryTotal.points+=agg.points;summaryTotal.leaders+=leaderCount;summaryTotal.agents+=agentCountG;summary+=`<tr><td class="name-cell"><span class="swatch" style="background:${groupColor(g)};color:${groupColor(g)}"></span>${g}</td><td>${agg.total}</td><td>${reachPct(agg.reached,agg.notReached)}%</td><td>${leaderCount}</td><td>${agentCountG}</td><td>${agg.points.toFixed(1)}</td></tr>`;});
  summary+=`</tbody><tfoot><tr class="total-row"><th>Total</th><th>${summaryTotal.total}</th><th>${reachPct(summaryTotal.reached,summaryTotal.notReached)}%</th><th>${summaryTotal.leaders}</th><th>${summaryTotal.agents}</th><th>${summaryTotal.points.toFixed(1)}</th></tr></tfoot></table></div>`;
  dashboard.innerHTML+=summary;

  groupNames.forEach(g=>{
    const leaders=GLOBAL_DATA[g],flat=flattenGroup(leaders),agg=aggregate(flat),color=groupColor(g);
    if(search&&!Object.keys(flat).some(a=>a.toLowerCase().includes(search)))return;
    const groupEl=document.createElement('details');groupEl.className='group';groupEl.style.borderLeftColor=color;groupEl.open=!!search;
    groupEl.innerHTML=`<summary><span class="swatch" style="background:${color};color:${color}"></span>${g}<span class="meta"><span>${agg.total} tickets</span><span>${reachPct(agg.reached,agg.notReached)}% reach</span><span>${Object.keys(leaders).length} leaders</span></span></summary>`;
    const body=document.createElement('div');body.className='group-body';
    const leaderNames=Object.keys(leaders).sort((a,b)=>aggregate(leaders[b]).total-aggregate(leaders[a]).total);
    let topLeader=null,topLeaderPts=-1;leaderNames.forEach(l=>{const p=aggregate(leaders[l]).points;if(p>topLeaderPts){topLeaderPts=p;topLeader=l;}});
    leaderNames.forEach(l=>{
      const agents=leaders[l],agentIds=Object.keys(agents).filter(a=>!search||a.toLowerCase().includes(search));if(search&&!agentIds.length)return;
      const lAgg=aggregate(agents),leaderEl=document.createElement('details');leaderEl.className='leader';leaderEl.open=!!search;leaderEl.innerHTML=`<summary>${l===topLeader?'<span class="crown">👑</span>':''}${l}<span class="lmeta"><span>${lAgg.total} tickets</span><span>${reachPct(lAgg.reached,lAgg.notReached)}% reach</span><span>${lAgg.points.toFixed(1)} pts</span><span>${Object.keys(agents).length} agents</span></span></summary>`;
      const wrap=document.createElement('div');wrap.className='agents-wrap';const table=document.createElement('table');table.className='agents';let head=`<thead><tr><th>Agent</th>`;GLOBAL_HOURS.forEach(h=>head+=`<th>${h}:00</th>`);head+=`<th>Total</th><th>Points</th><th>Reach %</th></tr></thead><tbody>`;table.innerHTML=head;
      const hourTotals={};GLOBAL_HOURS.forEach(h=>hourTotals[h]=0);
      agentIds.sort((a,b)=>agents[b].total-agents[a].total).forEach(a=>{const u=agents[a],userReach=reachPct(u.reached,u.notReached),reachClass=u.reached+u.notReached===0?'':userReach>=60?'reach-good':'reach-bad';let row=`<tr><td>${a}${COOR.includes(normalizeAgentId(a))?' <span class="badge">COOR</span>':''}</td>`;GLOBAL_HOURS.forEach(h=>{const v=u.hours[h]||0;hourTotals[h]+=v;const alpha=v===0?0:0.14+0.62*(v/maxCell);row+=`<td class="hour-cell${alpha>0.5?' hot':''}" style="background:rgba(45,214,196,${alpha})">${v||''}</td>`;});row+=`<td class="total">${u.total}</td><td class="points">${u.points.toFixed(1)}</td><td class="${reachClass}">${userReach}%</td></tr>`;table.innerHTML+=row;});
      let totalRow=`<tfoot><tr class="total-row"><th>Total</th>`;GLOBAL_HOURS.forEach(h=>totalRow+=`<th>${hourTotals[h]||''}</th>`);totalRow+=`<th>${lAgg.total}</th><th>${lAgg.points.toFixed(1)}</th><th>${reachPct(lAgg.reached,lAgg.notReached)}%</th></tr></tfoot>`;table.innerHTML+=totalRow;
      wrap.appendChild(table);leaderEl.appendChild(wrap);body.appendChild(leaderEl);
    });
    groupEl.appendChild(body);dashboard.appendChild(groupEl);
  });
}

function copyAsImage(){html2canvas(document.querySelector('.shell'),{backgroundColor:"#0a0e1a"}).then(canvas=>canvas.toBlob(blob=>{navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);alert("Copied ✅");}));}

document.addEventListener('DOMContentLoaded',()=>{document.getElementById("fileInput").addEventListener("change",e=>Papa.parse(e.target.files[0],{header:true,skipEmptyLines:true,complete:res=>process(res.data)}));document.getElementById("searchInput").addEventListener("keyup",renderFiltered);syncMapping();});
