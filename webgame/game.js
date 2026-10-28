/* XueZhan mahjong UI logic — shared by index.html (desktop, backed by
   server.py over HTTP) and app.html (offline PWA, backed by a Pyodide
   Web Worker). Neither entry duplicates this file; each only supplies
   `window.__transport(path, body) -> Promise<json-or-null>` before this
   script runs, matching the same shape server.py's HTTP API returns. */
const SUITS = ['条','万','筒'];
const NAMES = {0:'你 (南)', 1:'AI·下家 (西)', 2:'AI·对家 (北)', 3:'AI·上家 (东)'};
let S = null;          // last state from the transport
let hintTile = null;
let handMathData = null, handMathViewKey = null, handMathBusy = false;
let exchangeSelection = [];
let exchangeGame = null;
let actionBusy = false;

function showError(message){
  const el = document.getElementById('errorBox');
  el.textContent = message;
  el.classList.toggle('hidden', !message);
}

function tileHTML(t, cls='', clickable=false){
  if(!t) return '';
  const c = t[0], n = t[1];
  return `<div class="tile c${c} ${cls}" data-c="${c}" data-n="${n}">
            <span class="num">${n}</span><span class="suit">${SUITS[c]}</span></div>`;
}
function backHTML(cls='small'){ return `<div class="tile back ${cls}"></div>`; }
function riverHTML(info){
  if(!info) return '<p class="river-note">当前记录版本不含四家归属，请更新并重新开局。</p>';
  const names=['自己','下家','对家','上家'];
  const zones=[2,3,1,0].map(seat=>{
    const rows=info.discards.filter(r=>r.seat===seat);
    const live=rows.filter(r=>!['pong','kong'].includes(r.status)).length;
    return `<section class="river river-${seat}" data-seat="${seat}"><h3>${names[seat]}弃牌 <small>${live}张 / 共出${rows.length}</small></h3><div class="river-cards">`+
      rows.map(r=>{
        const last=r.id===info.latest_discard?' latest-discard':'';
        const claim=r.claims.map(i=>names[i]).join('、');
        const title=`第${r.event_index+1}步 ${tileCN(r.tile)}`;
        if(['pong','kong'].includes(r.status))
          return `<span class="river-taken${last}" data-discard="${r.id}" title="${title}">${tileCN(r.tile)}→${claim}${r.status==='pong'?'碰':'杠'}</span>`;
        return `<span class="river-entry${last}" data-discard="${r.id}" title="${title}${r.status==='hu'?'，'+claim+'胡':''}">${tileHTML(r.tile,'mini river-tile')}${r.status==='hu'?'<b class="claim-mark">胡</b>':''}</span>`;
      }).join('')+`</div></section>`;
  }).join('');
  const wins=info.winning_tiles.map(r=>`<span class="win-tile" data-win="${r.id}">${tileHTML(r.tile,'mini')}<small>${r.kind==='zimo'?names[r.seat]+'自摸':names[r.seat]+'被抢杠'}${r.resolving?' · 响应中':''}</small></span>`).join('');
  return zones+`<section class="winning-tiles"><span>胡牌亮张</span>${wins||'<small>—</small>'}</section>`+
    (info.consistent?'':'<p class="river-note">公开记录与牌桌不一致，待核对。</p>');
}
function sameTile(a,b){ return a && b && a[0]===b[0] && a[1]===b[1]; }

async function api(path, body){
  try {
    const result = await window.__transport(path, body);
    if(!result) throw new Error('操作失败，请检查本地服务或网络连接');
    if(result.error && !result.stage) throw new Error(result.error);
    showError(result.error || '');
    return result;
  } catch(e) {
    showError(e.message || String(e));
    return null;
  }
}

async function newGame(){
  if(actionBusy || document.body.classList.contains('busy')) return;
  document.getElementById('openingMode').value = 'true';
  document.getElementById('cancelNewGame').disabled = !S || S.stage === 'none';
  document.getElementById('newGameOverlay').classList.remove('hidden');
}

async function startGame(){
  if(actionBusy || document.body.classList.contains('busy')) return;
  actionBusy = true;
  hintTile = null;
  const body = {ai: document.getElementById('aiSel').value,
                exchange_enabled: document.getElementById('openingMode').value === 'true'};
  try {
    const st = await api('/api/new', body);
    if(st) { S = st; document.getElementById('newGameOverlay').classList.add('hidden'); render(); }
  } finally { actionBusy = false; syncHandMath(); }
}

async function dailyGame(){
  hintTile = null;
  S = await api('/api/new', {daily: true});
  render();
}

let dailyPar = {};   // daily seed -> AI par score (null while fetching)
function dailyLine(){
  if(!S.daily) return '';
  const seed = S.daily;
  if(dailyPar[seed] === undefined){
    dailyPar[seed] = null;
    api('/api/daily_par', {}).then(r=>{
      if(r && r.par !== undefined){
        dailyPar[seed] = r.par;
        if(S && S.stage === 'over') render();
      }
    });
  }
  const par = dailyPar[seed];
  const my = S.you.score;
  const cmp = (par === null || par === undefined) ? 'AI基准计算中…' :
    (my > par ? `🎉 你比AI多 ${my-par} 分!` :
     my === par ? '与AI打平' : `比AI少 ${par-my} 分`);
  return `<p style="margin-top:10px;font-size:14px"><b>每日挑战 #${seed}</b>
     — 你: ${my>=0?'+':''}${my} · AI替你打这副牌:
     ${par===null||par===undefined?'…':(par>=0?'+':'')+par}<br>${cmp}</p>`;
}

const sleep = ms => new Promise(r=>setTimeout(r,ms));

async function stepLoop(){
  /* replay AI turns one engine action at a time, pausing on visible moves */
  document.body.classList.add('busy');
  try{
    while(S && S.stage === 'play' && !S.pending){
      const before = S.history.length;
      const st = await api('/api/step', {});
      if(!st) break;
      S = st; render();
      if(!st.stepped) break;
      const delay = +document.getElementById('speedSel').value;
      if(delay && S.history.length > before) await sleep(delay);
    }
  } finally {
    document.body.classList.remove('busy');
    render();
  }
}

async function act(body){
  if(actionBusy || document.body.classList.contains('busy')) return;
  actionBusy = true;
  hintTile = null;
  try {
    const st = await api('/api/act', body);
    if(st) { S = st; render(); await stepLoop(); }
  } finally { actionBusy = false; syncHandMath(); }
}

async function hint(){
  if(!S || !S.pending) return;
  const h = await api('/api/hint');
  if(!h || !('action' in h)) return;
  const a = h.action;
  if(Array.isArray(a) && a.length===2 && typeof a[0]==='number'){
    hintTile = a;                       // a tile to discard
    render(true);
    renderHintPanel(h);
  } else {
    const pr = document.getElementById('prompt');
    if(!pr.querySelector('.ai-adv'))
      pr.innerHTML += ` <span class="badge ai-adv" style="background:#6a5416">AI建议: ${actHTML(a)}</span>`;
    if(h.why) document.getElementById('hintDetail').innerHTML = `💡 ${h.why}`;
  }
  renderCoach(h.opps);
}

function handMathKey(){
  return JSON.stringify([S?.game_id,S?.stage,S?.pending,S?.you?.hand,S?.you?.pile,
    S?.you?.daque,S?.public_table?.physical_tiles,S?.opponents?.map(p=>p.pile),S?.wall,S?.rules]);
}
function mathEsc(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function mathWaitHTML(rows){
  if(!rows?.length)return '<p>未听牌：本阶段没有可列出的单张成牌。</p>';
  return '<div class="math-waits">'+rows.map(r=>`<span>${tileHTML(r.tile,'small')}<b>未见 ${r.unseen} 张</b>${r.unseen===0?'<em>结构待牌，未见为0</em>':''}</span>`).join('')+'</div>';
}
function showMathDiscard(index){
  const row=handMathData?.analysis.discards[Number(index)];if(!row)return;
  document.getElementById('mathDiscardDetail').innerHTML=`<p>假设打出 ${tileCN(row.tile)}：${row.is_tenpai?'结构听牌':'未听牌'}，待牌 ${row.wait_types} 种，基础未见合计 ${row.unseen_total} 张。</p>`+mathWaitHTML(row.waits)+
    '<p class="math-note">打出的牌转入公开区，不会使它的未见张数增加。此选择只用于比较，不会替你出牌。</p>';
}
function renderHandMath(){
  const box=document.getElementById('handMathResults'),r=handMathData?.analysis;if(!r)return;
  if(r.status!=='ok'){box.textContent=(r.errors||['此状态尚不支持分析']).join('；');return;}
  const cur=r.current,context=handMathData.context;
  box.innerHTML=`<h4>A · 确定性牌型结果</h4><p>${cur.is_complete?'当前暗手与副露已组成合法胡牌形状':cur.is_tenpai===null?'当前是出牌前张数，尚未成胡；是否听牌须看各弃牌后的结果':cur.is_tenpai?'当前结构听牌，补一张可完成':'当前待补一张，尚未听牌'}。当前规则是否提供胡牌动作：${context.legal_win_available?'是':'否'}。</p>`+
    (cur.wins_with_claim?'<p>当前已经公开的响应牌可以使你成牌；未见为0不妨碍胡这张已摆出的牌。</p>':'')+
    (r.missing_suit_remaining?`<p>还剩 ${r.missing_suit_remaining} 张缺门牌，必须先打光，不能违规打其他花色。</p>`:'')+
    (cur.is_tenpai?mathWaitHTML(cur.waits):'')+
    (r.discards.length?`<label class="math-compare-label" for="mathDiscardSelect">比较合法弃牌<select id="mathDiscardSelect">${r.discards.map((row,i)=>`<option value="${i}">${tileCN(row.tile)} → ${row.is_tenpai?'听'+row.wait_types+'种':'未听'}，未见合计${row.unseen_total}</option>`).join('')}</select></label><div id="mathDiscardDetail"></div>`:'<p>当前尚未进入弃牌动作，不比较假设出牌。</p>')+
    `<h4>B · 公开信息的数量边界</h4><p>牌墙公开剩余总数：${r.wall_count??'未提供'} 张。以上基础未见数包含对手暗牌，无法确定某种牌在墙内还剩几张，不能换成摸牌概率。</p><details><summary>怎样计数及当前限制</summary><p>${mathEsc(r.count_basis)}</p>${r.information_limits.map(x=>`<p>${mathEsc(x)}</p>`).join('')}</details>`+
    `<h4>C · 单一指标的经验取向</h4><p>${mathEsc(r.suggestion.message)}</p>`+
    (r.suggestion.tiles.length?`<p>指标靠前：${r.suggestion.tiles.map(tileCN).join('、')}。</p>`:'')+
    `<p class="math-note">未考虑：${r.suggestion.not_considered.map(mathEsc).join('、')}。不提供数学最优结论；本阶段不计算多步精确向听。</p>`+
    `<p class="math-note">本局${context.rules.exchange_enabled?'换三张':'不换三张'}；计算耗时 ${handMathData.elapsed_ms} ms（当前设备本次测量）。</p>`;
  const select=document.getElementById('mathDiscardSelect');
  if(select){select.onchange=()=>showMathDiscard(select.value);showMathDiscard(0);}
}
function syncHandMath(){
  const key=handMathKey();
  if(handMathViewKey!==key){handMathData=null;handMathViewKey=key;document.getElementById('handMathResults').innerHTML='<p>结果只对当前局面有效。点击计算后可比较合法弃牌。</p>';}
  const btn=document.getElementById('handMathBtn');
  btn.disabled=handMathBusy||actionBusy||document.body.classList.contains('busy')||!S?.pending||S.stage!=='play'||S.you.winning;
  btn.textContent=handMathBusy?'计算中…':'计算手牌与弃牌比较';
}
async function runHandMath(){
  if(handMathBusy||actionBusy||document.body.classList.contains('busy')||!S?.pending||S.stage!=='play')return;
  const key=handMathKey();handMathBusy=true;syncHandMath();
  try{
    const response=await api('/api/hand_math');
    if(response&&key===handMathKey()&&(!response.context||
      (response.context.game_id===S.game_id&&response.context.n_history===S.history.length&&response.context.phase===S.pending?.valid_act))){
      handMathData=response;handMathViewKey=key;renderHandMath();
    }
  }finally{handMathBusy=false;syncHandMath();}
}

/* ---------------- sound effects (no assets: WebAudio + speech) --------- */
let soundOn = localStorage.getItem('sound') !== '0';
let AC = null;
function ac(){
  if(!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
  if(AC.state === 'suspended') AC.resume();
  return AC;
}
// browsers only allow audio after a user gesture: warm the context up early
document.addEventListener('pointerdown', ()=>{ if(soundOn) try{ac();}catch(e){} });

function tileClick(){          // short "tile hits the table" tick
  if(!soundOn) return;
  try{
    const ctx = ac(), t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1750, t);
    o.frequency.exponentialRampToValueAtTime(650, t + .06);
    g.gain.setValueAtTime(.22, t);
    g.gain.exponentialRampToValueAtTime(.001, t + .09);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + .1);
  }catch(e){}
}
function winChime(){           // rising arpeggio for a win
  if(!soundOn) return;
  try{
    const ctx = ac(), t0 = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i)=>{
      const t = t0 + i * .11;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(.18, t);
      g.gain.exponentialRampToValueAtTime(.001, t + .3);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + .32);
    });
  }catch(e){}
}
function speak(txt){           // voiced call: 碰 / 杠 / 胡 / 自摸
  if(!soundOn || typeof speechSynthesis === 'undefined') return;
  try{
    const u = new SpeechSynthesisUtterance(txt);
    u.lang = 'zh-CN'; u.rate = 1.15; u.pitch = 1.1; u.volume = 1;
    const v = speechSynthesis.getVoices().find(v=>/^zh/i.test(v.lang));
    if(v) u.voice = v;
    speechSynthesis.cancel();  // a fresh call preempts a stale one
    speechSynthesis.speak(u);
  }catch(e){}
}

const VOICE = {pong:'碰', kong:'杠', ankong:'杠', jiakong:'杠',
               hu:'胡', zimo:'自摸', robkong:'抢杠，胡'};
let sndGame = null, sndSeen = 0;
function playNewSounds(){
  /* voice/effects for history entries added since the last render; on a new
     game (or page load) just sync the cursor so nothing replays */
  if(!S || !S.history) return;
  if(S.game_id !== sndGame){ sndGame = S.game_id; sndSeen = S.history.length; return; }
  const fresh = S.history.slice(sndSeen);
  sndSeen = S.history.length;
  if(!fresh.length || !soundOn) return;
  let clicked = false, voice = null, won = false;
  for(const e of fresh){
    const a = e[1];
    if(a === 'discard') clicked = true;
    if(VOICE[a]) voice = VOICE[a];
    if(a === 'hu' || a === 'zimo' || a === 'robkong') won = true;
  }
  if(clicked) tileClick();     // one tick per batch, not a burst
  if(voice) speak(voice);
  if(won) winChime();
}

/* ---------------- coach mode: auto-hint + opponent read ---------------- */
let coachOn = localStorage.getItem('coach') === '1';
let lastCoachKey = null;

function maybeAutoHint(){
  if(!coachOn || !S || S.stage !== 'play' || !S.pending) return;
  const key = `${S.game_id}:${S.history.length}:${S.pending.valid_act}`;
  if(key === lastCoachKey) return;
  lastCoachKey = key;
  hint();
}

function readyLabel(t){
  return t >= 0.75 ? ['高', 'dgr-hi'] : (t >= 0.5 ? ['中', 'dgr-mid'] : ['低', 'dgr-lo']);
}

function renderCoach(opps){
  const box = document.getElementById('coachBox');
  if(!box) return;
  if(!opps || !opps.length){ box.innerHTML = ''; return; }
  box.innerHTML =
    `<div class="coach-title">对手威胁估计（启发式评分，未经概率校准）</div>` +
    opps.map(o=>{
      const who = NAMES[o.id];
      if(o.winning) return `<div class="coach-line">${who}：已胡牌，无威胁</div>`;
      const [lbl, cls] = readyLabel(o.threat);
      const hot = (o.hot && o.hot.length)
        ? '对其危险: ' + o.hot.map(h=>
            `<span class="mini-inline">${tileHTML(h[0],'mini')}</span>`).join('')
        : '你手中暂无明显危险牌';
      const flush = (o.flush !== undefined)
        ? ` · <span class="dgr-hi">⚠️疑似清一色(${SUITS[o.flush]})</span>` : '';
      return `<div class="coach-line">${who}：威胁等级 <b class="${cls}">${lbl}</b>
        (评分 ${o.threat.toFixed(2)}) · 副露${o.n_melds}组${flush}
        · 缺${SUITS[o.daque]}(打${SUITS[o.daque]}对其安全) · ${hot}</div>`;
    }).join('');
}

function dangerCls(d){ return d>=2.5?'dgr-hi':(d>=1.2?'dgr-mid':'dgr-lo'); }

let hintData = null;
function tileCN(t){ return `${t[1]}${SUITS[t[0]]}`; }

function renderHintPanel(h){
  /* ranked discard analysis: effective draws, dfncy effect, deal-in danger */
  hintData = h;
  const box = document.getElementById('hintPanel');
  if(!h.rows){ box.innerHTML=''; return; }
  const head = h.forced_daque
    ? `<div style="width:100%;font-size:12px;opacity:.85">必须先打缺色牌 — 按点炮危险度排序 (点击查看分析):</div>`
    : `<div style="width:100%;font-size:12px;opacity:.85">旧AI经验建议（不是数学最优）— 有效牌数含对手暗牌中的未见牌，不等于牌墙余张或摸到概率；危险度是启发式评分。点击查看原因:</div>`;
  const shown = h.rows.slice(0,8);
  let bestIdx = shown.findIndex(r=>sameTile(r.tile, h.action));
  if(bestIdx < 0) bestIdx = 0;
  box.innerHTML = head + shown.map((r,i)=>{
    let cls = sameTile(r.tile, h.action) ? 'hcand best' : 'hcand';
    if(i===bestIdx) cls += ' selected';
    let meta;
    if(h.forced_daque){
      meta = `<span class="${dangerCls(r.danger)}">危险 ${r.danger}</span>`;
    } else {
      meta = (r.keeps ? `进张 <b>${r.eff}</b>`
                      : `<span class="dgr-hi">拆牌→缺张数${r.after}</span>`) +
             `<br><span class="${dangerCls(r.danger)}">危险 ${r.danger}</span>`;
    }
    return `<div class="${cls}" data-i="${i}">${tileHTML(r.tile,'small')}<div class="meta">${meta}</div></div>`;
  }).join('');
  box.querySelectorAll('.hcand').forEach(el=>{
    el.onclick = ()=>{
      box.querySelectorAll('.hcand').forEach(x=>x.classList.remove('selected'));
      el.classList.add('selected');
      showHintDetail(+el.dataset.i);
    };
  });
  showHintDetail(bestIdx);
}

function showHintDetail(i){
  const el = document.getElementById('hintDetail');
  if(!hintData || !hintData.rows || !hintData.rows[i]){ el.innerHTML=''; return; }
  const r = hintData.rows[i];
  const isAI = sameTile(r.tile, hintData.action);
  let parts = [];
  if(hintData.forced_daque){
    parts.push(`缺色牌必须先打，此牌点炮危险度 ${r.danger}`);
  } else if(!r.keeps){
    parts.push(`拆牌：打出后缺张数从 ${hintData.cur_dfncy} 退到 ${r.after}，通常不划算`);
  } else {
    parts.push(`打出后保持缺张数 ${hintData.cur_dfncy}`);
    if(r.detail && r.detail.length){
      const lst = r.detail.map(d=>`${tileCN(d[0])}×${d[1]}`).join('、');
      parts.push(`未见区域中有 <b>${r.eff}</b> 张有效牌可减少缺张数（含对手暗牌，不是摸到概率）：${lst}`);
    } else {
      parts.push('本提示指标下，没有直接降低旧dfncy的进张；不等于无法改善或数学死型');
    }
    parts.push(`点炮危险度 <span class="${dangerCls(r.danger)}">${r.danger}</span>`);
  }
  if(r.notes && r.notes.length) parts.push(r.notes.join('；'));
  el.innerHTML = `${isAI?'⭐ AI选择 · ':''}打 <b>${tileCN(r.tile)}</b>：` + parts.join('；');
}

function seatHTML(p){
  const daque = p.daque===null? '' : `<span class="badge daque">缺${SUITS[p.daque]}</span>`;
  const sc = `<span class="badge ${p.score>=0?'score-pos':'score-neg'}">${p.score>=0?'+':''}${p.score}</span>`;
  const win = p.winning ? `<span class="winner">🏆已胡</span>` : '';
  let html = `<div class="name">${NAMES[p.id]} ${daque} ${sc} ${win}</div>`;
  html += `<div class="tilerow seat-melds">`;
  for(const meld of p.pile){
    html += `<span class="meld">` + meld.map(t=>tileHTML(t,'mini')).join('') + `</span>`;
  }
  html += `</div>`;
  if('hand' in p){        // revealed at game over
    html += `<div class="tilerow concealed" style="margin-top:5px">` +
            p.hand.map(t=>tileHTML(t,'small')).join('') + `</div>`;
  } else if('n_hand' in p){
    html += `<div class="tilerow concealed" style="margin-top:5px">` +
            backHTML('mini').repeat(p.n_hand) + `</div>`;
  }
  return html;
}

function historyText(e){
  const who = NAMES[e[0]].split(' ')[0];
  const a = e[1];
  const t = e[2];
  const tl = t ? `<span class="mini-inline">${tileHTML(t,'mini')}</span>` : '';
  const map = {draw:'摸牌', discard:'打出', pong:'碰', kong:'明杠', ankong:'暗杠',
               jiakong:'加杠', zimo:'自摸', hu:'胡', robkong:'抢杠胡'};
  let s = `${who} ${map[a]||a} ${a==='draw'?'':tl}`;
  if(a==='hu') s += ` (点炮: ${NAMES[e[3]].split(' ')[0]})`;
  if(a==='robkong') s += ` (被抢: ${NAMES[e[3]].split(' ')[0]})`;
  return s;
}

const VA_LBL = {exchange:'换三张', daque:'定缺', discard:'出牌', pong:'碰', kong:'杠', zikong:'自杠',
                hu:'胡', zimo:'自摸', robkong:'抢杠'};
const HU_CN = {pinghu:'平胡', zimo:'自摸', robkong:'抢杠胡', kongshanghua:'杠上花',
               kongshangpao:'杠上炮', qingyise:'清一色', pengpenghu:'碰碰胡',
               qidui:'七对', jingoudiao:'金钩钓', longqidui:'龙七对',
               shibaluohan:'十八罗汉', tianhu:'天胡', dihu:'地胡'};
const HU_MULT = {zimo:2, robkong:2, kongshanghua:2, kongshangpao:2,
                 pengpenghu:2, qidui:4, jingoudiao:4, qingyise:4};
function huWayCN(w){
  const m = /^(\d+) gen$/.exec(w);
  return m ? `${m[1]}根` : (HU_CN[w] || w);
}
function fanText(hu_way){
  /* mirrors utils/xzscore.py compute_hu_score */
  if(!hu_way || !hu_way.length) return '';
  if(hu_way.includes('tianhu')) return '天胡 = 32番';
  if(hu_way.includes('dihu')) return '地胡 = 32番';
  let fan = 1; const parts = ['1番'];
  for(const w of hu_way){
    const m = /^(\d+) gen$/.exec(w);
    if(m){ const k = Math.pow(2, +m[1]); fan *= k; parts.push(`×${k}(${m[1]}根)`); }
    else if(HU_MULT[w]){ fan *= HU_MULT[w]; parts.push(`×${HU_MULT[w]}(${HU_CN[w]})`); }
  }
  return parts.length > 1 ? `${parts.join('')} = ${fan}番` : '1番';
}
const KINDMAP = {
  hu:e=>`胡牌 ${e.fan}番 (${NAMES[e.others[0]].split(' ')[0]}点炮)`,
  zimo:e=>`自摸 ${e.fan}番 ×${e.others.length}家`,
  dianpao:e=>`点炮给${NAMES[e.others[0]].split(' ')[0]}`,
  beizimo:e=>`被${NAMES[e.others[0]].split(' ')[0]}自摸 ${e.fan}番`,
  tianhu:e=>`天胡 ${e.fan}番`, dihu:e=>`地胡 ${e.fan}番`,
  beitiandihu:e=>`被天胡/地胡`,
  chadajiao:e=>`查大叫 (${e.others.length}家未听牌赔付)`,
  beichadajiao:e=>`被查大叫 (流局时未听牌)`,
  chahuazhu:e=>`查花猪`,
  beichahuazhu:e=>`被查花猪 (手中仍有缺色牌)`,
  kong:e=>(e.amount>=0?'杠牌收入':'杠牌支出') +
          (e.tile?` (${e.tile[1]}${SUITS[e.tile[0]]})`:''),
  zhuanyi_in:e=>'呼叫转移收入 (杠上炮)',
  zhuanyi_out:e=>'呼叫转移 — 杠钱转给胡家',
  tuishui_out:e=>'退税 — 流局未听牌退还杠钱',
  tuishui_back:e=>'退税收回',
};
function settleHTML(p){
  if(!p.settle || !p.settle.length) return '';
  const lines = p.settle.map(e=>{
    const f = KINDMAP[e.kind];
    return `<div class="line"><span>${f?f(e):e.kind}</span>
            <b>${e.amount>=0?'+':''}${e.amount}</b></div>`;
  }).join('');
  return `<details class="settle"><summary>${NAMES[p.id]} 结算明细
          (${p.score>=0?'+':''}${p.score})</summary>${lines}</details>`;
}
function actHTML(a){
  if(Array.isArray(a) && a.length === 3 && a.every(Array.isArray))
    return a.map(t=>`<span class="mini-inline">${tileHTML(t,'mini')}</span>`).join('');
  if(Array.isArray(a) && a.length===2 && typeof a[0]==='number')
    return `<span class="mini-inline">${tileHTML(a,'mini')}</span>`;
  if(Array.isArray(a))
    return `${VA_LBL[a[0]]||a[0]} <span class="mini-inline">${tileHTML(a[1],'mini')}</span>`;
  if(typeof a==='number') return `缺${SUITS[a]}`;
  return VA_LBL[a] || ({stand:'过', pong:'碰', kong:'杠', ankong:'暗杠',
                        jiakong:'加杠'})[a] || a;
}
function reviewHTML(decs){
  if(!decs || !decs.length) return '';
  const dis = decs.filter(d=>!d.agree);
  if(!dis.length) return `<p style="margin-top:10px">本局所有决策与当前AI策略一致；这不是决策正确率，策略质量仍需实验验证。</p>`;
  const lines = dis.slice(0,15).map(d=>
    `<div class="line"><span class="badge">第${d.n_history}手</span>
     <span>${VA_LBL[d.valid_act]||d.valid_act}:</span>
     <span>你 ${actHTML(d.human)}</span> <span>· AI ${actHTML(d.strategy)}</span>
     ${(d.deficiency!==null && d.deficiency!==undefined)
        ? `<span class="badge">缺张数${d.deficiency}</span>` : ''}</div>`).join('');
  return `<p style="margin-top:10px;font-weight:600;color:#ffd964">决策回顾 —
          与AI不同的 ${dis.length} 手</p><div id="reviewList">${lines}</div>`;
}

function render(keepHint=false){
  if(!keepHint){
    hintTile = null;
    hintData = null;
    const hp = document.getElementById('hintPanel');
    if(hp) hp.innerHTML = '';
    const hd = document.getElementById('hintDetail');
    if(hd) hd.innerHTML = '';
    const cb = document.getElementById('coachBox');
    if(cb) cb.innerHTML = '';
  }
  if(!S || S.stage==='none'){ return; }

  playNewSounds();

  const ex = document.getElementById('exchangeOverlay');
  ex.classList.toggle('hidden', S.stage !== 'choose_exchange');
  const direction = {left:'左换：送给下家（座位 +1）',right:'右换：送给上家（座位 -1）',across:'对换：送给对家（座位 +2）'};
  if(S.stage === 'choose_exchange'){
    if(exchangeGame !== S.game_id){ exchangeGame = S.game_id; exchangeSelection = []; }
    const hand = S.you.hand;
    document.getElementById('exchangeDirection').textContent = direction[S.exchange.direction];
    document.getElementById('exchangeHand').innerHTML = hand.map((t,i)=>
      `<button class="exchange-tile ${exchangeSelection.includes(i)?'selected':''}" data-index="${i}" aria-pressed="${exchangeSelection.includes(i)}">${tileHTML(t)}</button>`).join('');
    document.querySelectorAll('#exchangeHand button').forEach(b=>{
      b.onclick = ()=>{
        const i = +b.dataset.index;
        if(exchangeSelection.includes(i)) exchangeSelection = exchangeSelection.filter(x=>x!==i);
        else if(exchangeSelection.length < 3) exchangeSelection.push(i);
        render();
      };
    });
    const legal = exchangeSelection.length === 3 && new Set(exchangeSelection.map(i=>hand[i][0])).size === 1;
    const confirm = document.getElementById('exchangeConfirm');
    confirm.disabled = !legal;
    confirm.onclick = ()=>act({type:'exchange',tiles:exchangeSelection.map(i=>hand[i])});
    document.getElementById('exchangeStatus').textContent = legal ? '已选好同花色三张，可以提交' : `已选 ${exchangeSelection.length}/3 张，请选择同一花色`;
    document.getElementById('exchangeSuggest').onclick = ()=>{
      const used = new Set();
      exchangeSelection = S.exchange.suggestion.map(t=>{
        const i = hand.findIndex((x,j)=>!used.has(j) && sameTile(x,t)); used.add(i); return i;
      });
      render();
    };
  }
  const personal = S.exchange.personal;
  document.getElementById('exchangeInfo').textContent = personal ?
    `本局${direction[personal.direction]}；送出 ${personal.sent.map(tileCN).join('、')}；收到 ${personal.received.map(tileCN).join('、')}。这是你的个人已知信息。` :
    (S.rules?.exchange_enabled === false ? '本局不换三张：直接定缺，没有送出或收到交换牌。' : '本局换三张，交换完成后展示个人记录。');

  // daque overlay
  const dq = document.getElementById('daqueOverlay');
  if(S.stage==='choose_daque'){
    dq.classList.remove('hidden');
    document.getElementById('daqueButtons').innerHTML =
      [0,1,2].map(c=>`<button onclick="act({type:'daque',color:${c}})">打缺 ${SUITS[c]}</button>`).join('');
    document.getElementById('daqueHint').textContent =
      `AI 策略建议：缺${SUITS[S.daque_suggestion]}`;
    // show hand in background too
  } else {
    dq.classList.add('hidden');
  }

  // seats 1..3 (highlight whoever acted last while AI turns replay)
  const lastActor = S.history.length ? S.history[S.history.length-1][0] : null;
  for(const p of S.opponents){
    const el = document.getElementById('seat'+p.id);
    el.innerHTML = seatHTML(p);
    el.classList.toggle('active', S.stage==='play' && !S.pending && p.id===lastActor);
  }
  // my seat header
  const me = S.you;
  document.getElementById('myName').innerHTML =
    `${NAMES[0]} ${me.daque!==null?`<span class="badge daque">缺${SUITS[me.daque]}</span>`:''}
     <span class="badge ${me.score>=0?'score-pos':'score-neg'}">${me.score>=0?'+':''}${me.score}</span>
     ${me.winning?'<span class="winner">🏆已胡</span>':''}`;
  document.getElementById('myPile').innerHTML =
    me.pile.map(meld=>`<span class="meld">`+meld.map(t=>tileHTML(t,'mini')).join('')+`</span>`).join('');

  // deficiency badge
  const dfb = document.getElementById('dfncyBox');
  dfb.textContent = (me.deficiency===null || me.deficiency===undefined) ? '' :
      `旧dfncy参考：${me.deficiency}（严格听牌见手牌数学）`;

  // current-move banner: the latest action + whose turn, always visible
  const nb = document.getElementById('nowBar');
  const lastE = S.history.length ? S.history[S.history.length-1] : null;
  let turn = '';
  if(S.stage === 'over') turn = `<span class="turn">本局结束</span>`;
  else if(S.pending) turn = `<span class="turn">→ ${S.pending.prompt}</span>`;
  else if(S.stage === 'play') turn = `<span class="turn">AI 行动中…</span>`;
  nb.innerHTML = (lastE ? `<span>${historyText(lastE)}</span>` :
                  `<span>对局开始</span>`) + turn;

  // wall + discards
  document.getElementById('wall').textContent =
    `牌墙剩余 ${S.wall} 张 · 公开留桌 ${S.table.length} 张（含胡牌亮张）`;
  const disc = document.getElementById('discards');
  disc.innerHTML = riverHTML(S.public_table);
  const newest = disc.querySelector('.latest-discard');
  const river = newest?.closest('.river-cards');
  if(river) river.scrollTop += Math.max(0,newest.getBoundingClientRect().bottom-river.getBoundingClientRect().bottom);

  // my hand
  const pend = S.pending;
  const discarding = pend && pend.type==='discard';
  const allowed = discarding ? pend.allowed : [];
  document.getElementById('myhand').innerHTML = me.hand.map(t=>{
    let cls = '';
    if(me.daque!==null && t[0]===me.daque) cls += ' daqued';
    if(discarding){
      cls += allowed.some(a=>sameTile(a,t)) ? ' clickable' : ' disabled';
    }
    if(hintTile && sameTile(hintTile,t)) cls += ' hint';
    return tileHTML(t, cls, true);
  }).join('');
  if(discarding){
    document.querySelectorAll('#myhand .tile.clickable').forEach(el=>{
      el.onclick = ()=>{
        if(mobileTable.matches){
          const index = [...el.parentElement.children].indexOf(el);
          selectedDiscard = selectedDiscard === index ? null : index;
          paintDiscardSelection();
        } else act({type:'discard', tile:[+el.dataset.c, +el.dataset.n]});
      };
    });
  }

  // action buttons
  const LBL = {pong:'碰', kong:'杠', hu:'胡', zimo:'自摸', robkong:'抢杠胡',
               pass:'过', ankong:'暗杠', jiakong:'加杠'};
  const btns = document.getElementById('buttons');
  const promptEl = document.getElementById('prompt');
  if(pend && pend.type==='choice'){
    promptEl.innerHTML = pend.prompt +
      (pend.tile?` <span class="mini-inline">${tileHTML(pend.tile,'mini')}</span>`:'');
    btns.innerHTML = pend.options.map((o,i)=>{
      const label = (LBL[o.label]||o.label) +
        (o.tile?` ${o.tile[1]}${SUITS[o.tile[0]]}`:'');
      return `<button data-i="${i}">${label}</button>`;
    }).join(' ');
    btns.querySelectorAll('button').forEach(b=>{
      b.onclick = ()=>act({type:'action', action:pend.options[+b.dataset.i].action});
    });
  } else if(discarding){
    promptEl.textContent = pend.prompt;
    btns.innerHTML = '';
  } else {
    promptEl.textContent = S.stage==='over' ? '本局结束' : '';
    btns.innerHTML = '';
  }
  document.getElementById('seat0').classList.toggle('active', !!pend);
  document.getElementById('hintBtn').disabled = !pend;

  // history log, newest entry on top — no scrolling needed
  document.getElementById('log').innerHTML =
    S.history.slice().reverse().map(e=>`<div>${historyText(e)}</div>`).join('');

  // game over overlay
  if(S.stage==='over'){
    const rows = [S.you, ...S.opponents].map(p=>
      `<tr><td>${NAMES[p.id]}</td><td>${p.score>=0?'+':''}${p.score}</td>
       <td>${p.winning
          ? '🏆 '+(p.hu_way||[]).map(huWayCN).join('·') +
            `<br><span style="opacity:.75;font-size:12px">${fanText(p.hu_way)}</span>`
          : '未胡'}</td></tr>`).join('');
    const dv = S.divergence || {n:0, agree:0};
    const dvLine = dv.n ? `<p style="margin-top:10px; font-size:13.5px">你的决策与AI策略一致:
        <b>${dv.agree}/${dv.n}</b> (${Math.round(100*dv.agree/dv.n)}%)</p>` : '';
    document.getElementById('finalScores').innerHTML =
      `<table class="scores"><tr><th>玩家</th><th>得分</th><th>结果</th></tr>${rows}</table>
       ${dailyLine()}
       ${dvLine}
       ${S.error?`<p style="color:#f88">${S.error}</p>`:''}`;
    const everyone = [S.you, ...S.opponents];
    const kinds = [].concat(...everyone.map(p=>(p.settle||[]).map(e=>e.kind)));
    let expl = '';
    if(kinds.includes('chadajiao')||kinds.includes('beichadajiao'))
      expl += '<div>· 查大叫：流局时未听牌者按听牌者可胡的最大番数赔付。</div>';
    if(kinds.includes('chahuazhu')||kinds.includes('beichahuazhu'))
      expl += '<div>· 查花猪：流局时手中仍有缺色牌者赔付16番。</div>';
    if(kinds.includes('tuishui_out'))
      expl += '<div>· 退税：流局时未听牌者退还杠牌所得。</div>';
    if(kinds.includes('zhuanyi_in')||kinds.includes('zhuanyi_out'))
      expl += '<div>· 呼叫转移：杠后打出的牌被胡（杠上炮），该杠的收入转给胡家。</div>';
    document.getElementById('settleBox').innerHTML =
      everyone.map(settleHTML).join('') +
      (expl?`<div style="margin-top:8px;font-size:12.5px;opacity:.85">${expl}</div>`:'');
    document.getElementById('reviewBox').innerHTML = reviewHTML(S.decisions);
    document.getElementById('overOverlay').classList.remove('hidden');
  } else {
    document.getElementById('overOverlay').classList.add('hidden');
  }

  maybeAutoHint();
  updateMobileTable();
}

document.getElementById('newBtn').onclick = newGame;
document.getElementById('startGameBtn').onclick = startGame;
document.getElementById('cancelNewGame').onclick = ()=>document.getElementById('newGameOverlay').classList.add('hidden');
const dailyBtn = document.getElementById('dailyBtn');
if(dailyBtn) dailyBtn.onclick = dailyGame;
document.getElementById('hintBtn').onclick = hint;
document.getElementById('handMathBtn').onclick = runHandMath;
const sndBtn = document.getElementById('sndBtn');
if(sndBtn){
  const paint = ()=>{ sndBtn.textContent = soundOn ? '🔊' : '🔇';
                      sndBtn.title = soundOn ? '关闭音效' : '打开音效'; };
  paint();
  sndBtn.onclick = ()=>{
    soundOn = !soundOn;
    localStorage.setItem('sound', soundOn ? '1' : '0');
    if(soundOn){ try{ac();}catch(e){} tileClick(); }
    else if(typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    paint();
  };
}
const coachChk = document.getElementById('coachChk');
if(coachChk){
  coachChk.checked = coachOn;
  coachChk.onchange = ()=>{
    coachOn = coachChk.checked;
    localStorage.setItem('coach', coachOn ? '1' : '0');
    lastCoachKey = null;
    if(S) render();          // on: auto-hint fires; off: panels clear
  };
}

// phones are landscape-only: mark touch devices so the portrait rotate
// prompt (style.css #rotateOverlay) also works where pointer:coarse lies
if('ontouchstart' in window || navigator.maxTouchPoints > 0)
  document.body.classList.add('touch');

/* Presentation only: the same DOM controls and transport remain in use.
   Drawers never request extra engine state or inspect another player's hand. */
const mobileTable = window.matchMedia('(max-width: 1024px) and (max-height: 600px), (max-width: 600px)');
let selectedDiscard = null;
let discardViewKey = '';
let drawerReturnFocus = null;
const uiPortals = [];
const drawer = document.getElementById('mobileDrawer');

function portal(element, target){
  const marker = document.createComment('desktop position');
  element.before(marker);
  uiPortals.push({element, target, marker});
}
for(const id of ['aiSel', 'speedSel'])
  portal(document.getElementById(id).closest('label'), 'controlsDock');
portal(document.querySelector('.coach-toggle'), 'controlsDock');
for(const id of ['sndBtn', 'rulesBtn', 'newBtn']) portal(document.getElementById(id), 'controlsDock');
portal(document.getElementById('exchangeMemory'), 'drawerHistory');
portal(document.getElementById('log'), 'drawerHistory');
for(const id of ['handMathSection', 'hintPanel', 'hintDetail', 'coachBox']) portal(document.getElementById(id), 'drawerTeach');

function closeDrawer(){
  drawer.classList.add('hidden');
  document.querySelector('#layout').inert = false;
  document.querySelector('header').inert = false;
  if(drawerReturnFocus?.isConnected && drawerReturnFocus.getClientRects().length) drawerReturnFocus.focus();
}

function openDrawer(name='menu'){
  if(!mobileTable.matches) return;
  if(drawer.classList.contains('hidden')) drawerReturnFocus = document.activeElement;
  const titles = {menu:'游戏菜单', history:'操作记录', teach:'教学分析', public:'四家公开信息'};
  for(const [key, id] of Object.entries({menu:'drawerMenu', history:'drawerHistory', teach:'drawerTeach', public:'drawerPublic'}))
    document.getElementById(id).classList.toggle('hidden', key !== name);
  document.getElementById('drawerTitle').textContent = titles[name];
  drawer.classList.remove('hidden');
  document.querySelector('#layout').inert = true;
  document.querySelector('header').inert = true;
  document.getElementById('drawerClose').focus();
}

function paintDiscardSelection(){
  const allowed = S?.pending?.type === 'discard' ? S.pending.allowed : [];
  const tile = selectedDiscard === null ? null : S?.you.hand[selectedDiscard];
  const legal = tile && allowed.some(t=>sameTile(t, tile));
  const confirm = document.getElementById('discardConfirm');
  confirm.disabled = !legal || document.body.classList.contains('busy');
  confirm.classList.toggle('hidden', S?.pending?.type !== 'discard');
  confirm.textContent = legal ? `出 ${tileCN(tile)}` : '先选一张牌';
  document.querySelectorAll('#myhand .tile').forEach((el,i)=>{
    const clickable = el.classList.contains('clickable');
    el.classList.toggle('picked', mobileTable.matches && legal && i === selectedDiscard);
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', tileCN(S.you.hand[i]) + (clickable ? '' : '，当前不可出'));
    el.setAttribute('aria-disabled', String(!clickable));
    el.setAttribute('aria-pressed', String(!!(mobileTable.matches && legal && i === selectedDiscard)));
    el.tabIndex = clickable ? 0 : -1;
    el.onkeydown = ev=>{
      if(clickable && (ev.key === 'Enter' || ev.key === ' ')){ ev.preventDefault(); el.click(); }
    };
  });
}

function updateMobileTable(){
  if(!S) return;
  syncHandMath();
  const key = `${S.game_id}:${S.stage}:${S.history.length}:${S.pending?.valid_act}`;
  if(key !== discardViewKey){ selectedDiscard = null; discardViewKey = key; }
  document.body.dataset.stage = S.stage;
  const phase = {choose_exchange:'换三张', choose_daque:'定缺', over:'本局结束'}[S.stage] ||
    (S.pending ? '轮到你' : 'AI行动中');
  document.getElementById('mobileStatus').textContent = `余 ${S.wall} 张 · ${phase} · ${S.rules?.exchange_enabled === false?'不换':'换三张'}`;
  document.getElementById('showResults').disabled = S.stage !== 'over';
  document.getElementById('daqueHandPreview').innerHTML = S.stage === 'choose_daque'
    ? S.you.hand.map(t=>tileHTML(t,'small')).join('') : '';
  // Explicit public fields only, including in presentation-only test fixtures.
  document.getElementById('publicInfo').innerHTML = [S.you,...S.opponents].map(p=>
    `<section class="public-seat">${seatHTML({id:p.id,daque:p.daque,score:p.score,
      winning:p.winning,pile:p.pile,n_hand:p.n_hand ?? S.you.hand.length})}</section>`).join('') +
    `<h3>四家弃牌 · 按出牌顺序</h3><div class="full-rivers">${riverHTML(S.public_table)}</div>`;
  for(const p of S.opponents){
    const el = document.getElementById('seat'+p.id);
    let count = el.querySelector('.public-count');
    if(!count){
      count = document.createElement('div');
      count.className = 'mobile-only public-count';
      el.querySelector('.name').after(count);
    }
    count.textContent = `暗牌 ${p.n_hand} · 副露 ${p.pile.length}组`;
    el.setAttribute('aria-label', `${NAMES[p.id]}公开信息，副露较多时可在此滑动或从菜单展开`);
  }
  paintDiscardSelection();
}

function resizeTable(){
  const mobile = mobileTable.matches;
  closeDrawer();
  document.body.classList.toggle('mobile-table', mobile);
  for(const {element, target, marker} of uiPortals){
    if(mobile) document.getElementById(target).append(element);
    else marker.after(element);
  }
  document.getElementById('exchangeMemory').open = !mobile;
  document.getElementById('hintBtn').textContent = mobile ? '教学' : '提示 Hint';
  const pwa = !!document.querySelector('script[src="transport_pyodide.js"]');
  const standalone = navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
  document.getElementById('entryInfo').textContent = `界面 P1-A 预览1 · ${pwa ? '本机计算（app.html，联网加载）' : '电脑计算（index.html，电脑需在线）'} · ${standalone ? '主屏幕模式' : '浏览器模式'}`;
  selectedDiscard = null;
  if(S) updateMobileTable();
}

document.getElementById('menuBtn').onclick = ()=>openDrawer('menu');
document.getElementById('drawerClose').onclick = closeDrawer;
drawer.onclick = ev=>{ if(ev.target === drawer) closeDrawer(); };
drawer.querySelectorAll('[data-drawer]').forEach(b=>b.onclick=()=>openDrawer(b.dataset.drawer));
document.getElementById('hintBtn').addEventListener('click', ()=>openDrawer('teach'));
document.getElementById('rulesBtn').addEventListener('click', closeDrawer);
document.getElementById('newBtn').addEventListener('click', closeDrawer);
document.getElementById('showResults').onclick = ()=>{
  closeDrawer(); document.getElementById('overOverlay').classList.remove('hidden');
};
document.getElementById('discardConfirm').onclick = ()=>{
  const tile = selectedDiscard === null ? null : S?.you.hand[selectedDiscard];
  if(tile && S?.pending?.type === 'discard' && S.pending.allowed.some(t=>sameTile(t,tile)))
    act({type:'discard',tile});
};
drawer.addEventListener('keydown', ev=>{
  if(ev.key === 'Escape'){ ev.preventDefault(); closeDrawer(); }
  if(ev.key !== 'Tab') return;
  const items = [...drawer.querySelectorAll('button,select,input,summary,[tabindex="0"]')]
    .filter(e=>!e.disabled && e.getClientRects().length);
  const first = items[0], last = items[items.length-1];
  if(ev.shiftKey && document.activeElement === first){ ev.preventDefault(); last.focus(); }
  else if(!ev.shiftKey && document.activeElement === last){ ev.preventDefault(); first.focus(); }
});
mobileTable.addEventListener('change', resizeTable);
function fitVisualViewport(){
  if(!window.visualViewport || window.visualViewport.scale === 1)
    document.documentElement.style.setProperty('--table-height', `${window.visualViewport?.height || innerHeight}px`);
}
window.visualViewport?.addEventListener('resize', fitVisualViewport);
window.addEventListener('resize', fitVisualViewport);
fitVisualViewport();
resizeTable();

(async function init(){
  S = await api('/api/state');
  if(!S || S.stage==='none') await newGame(); else render();
})();
