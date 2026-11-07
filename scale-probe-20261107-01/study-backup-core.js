/* Local study records. Pure projections + IndexedDB; no engine, network or AI access. */
const MahjongStudy = (()=>{
  'use strict';
  const VERSION='study-record-v2', APP='formal-freeplay-candidate-1', HELP_VERSION='help-evidence-v1', FREEPLAY_VERSION='freeplay-v1';
  const FORMAL_FREEPLAY_PROTOCOL='formal-freeplay-baseline-v1';
  // Stable across releases and URL paths. Never discover/open the former shared database.
  const CHANNELS=Object.freeze({formal_learning:'chengdu-mahjong-study-formal-v1',device_acceptance:'chengdu-mahjong-study-device-v1',development_preview:'chengdu-mahjong-study-preview-v1'});
  const channelAllows=(channel,purpose,testing=false)=>testing||purpose==='legacy_unclassified'||(channel==='formal_learning'?['formal_diagnostic','formal_freeplay'].includes(purpose):purpose==='device_acceptance');
  const LEGACY_STORES=['sessions','games','decisions','answers','events'];
  const CHILDREN=['games','decisions','answers','events','legacy_quarantine'];
  const STORES=['plans',...CHILDREN,'app_meta','migrations'];
  const ASSIST=new Set(['ai_presented','math_presented','comparison_presented','opening_suggestion_presented','help_may_be_seen','help_presentation_unconfirmed']);
  const formalBuildReady=(b,scope='formal-baseline-20')=>!!(b?.verified&&b.working_tree_dirty===false&&b.formal_approval?.status==='approved'&&b.formal_approval.scope===scope&&b.formal_approval.approval_id&&b.formal_approval.source_commit===b.source_commit&&b.formal_approval.resource_manifest_sha256===b.resource_manifest_sha256&&b.resource_manifest_sha256);
  const formalFreeplayBuildReady=b=>b?.storage_channel==='formal_learning'&&b.formal_freeplay_protocol===FORMAL_FREEPLAY_PROTOCOL&&formalBuildReady(b,FORMAL_FREEPLAY_PROTOCOL);
  const LIVE=new Set(['starting','choose_exchange','choose_daque','play','interrupted']);
  const RECORD_PROTOCOL='p1-record-v1';
  const testName=n=>/^(mahjong-test-|chengdu-mahjong-study-contract-test)/.test(n)||n.endsWith('-automation');
  const copy=x=>JSON.parse(JSON.stringify(x));
  const id=()=>crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const now=()=>new Date().toISOString();
  const cn=t=>t?`${t[1]}${['条','万','筒'][t[0]]}`:'—';
  function actionLabel(a){if(a.type==='help_request')return '请求教学前的独立判断（尚未选择最终动作）';if(a.type==='exchange')return '换出 '+a.tiles.map(cn).join('、');
    if(a.type==='daque')return '定缺'+['条','万','筒'][a.color];if(a.type==='discard')return '打出 '+cn(a.tile);
    const x=Array.isArray(a.action)?a.action[0]:a.action;return ({stand:'过',pong:'碰',kong:'明杠',ankong:'暗杠',jiakong:'加杠',hu:'胡',zimo:'自摸',robkong:'抢杠胡'})[x]+(Array.isArray(a.action)&&Array.isArray(a.action[1])?' '+cn(a.action[1]):'');}
  const tile=t=>Array.isArray(t)&&t.length===2&&t.every(Number.isInteger)&&t[0]>=0&&t[0]<3&&t[1]>=1&&t[1]<=9 ? [t[0],t[1]] : null;
  const tiles=ts=>(Array.isArray(ts)?ts:[]).map(tile).filter(Boolean);
  const melds=ms=>(Array.isArray(ms)?ms:[]).map(tiles);
  const action=a=>typeof a==='string' ? a : tile(a)|| (Array.isArray(a)&&typeof a[0]==='string' ? [a[0],tile(a[1])||String(a[1])] : null);
  const publicKinds=new Set(['draw','discard','pong','kong','ankong','jiakong','hu','zimo','robkong']);
  const freeplay=()=>({version:FREEPLAY_VERSION,mode:'freeplay',question_status:'not_asked'});
  function publicSettlement(s){return [s.you,...(s.opponents||[])].filter(Boolean).map(p=>({seat:p.id,score:p.score,winning:!!p.winning,
    hu_way:(p.hu_way||[]).filter(x=>typeof x==='string'),entries:(p.settle||[]).map(e=>({kind:String(e.kind),
      others:(e.others||[]).filter(n=>Number.isInteger(n)&&n>=0&&n<4),amount:e.amount,
      ...(Number.isFinite(e.fan)?{fan:e.fan}:{}),...(tile(e.tile)?{tile:tile(e.tile)}:{})}))}));}
  function snapshot(s){
    // Explicit reconstruction: NEVER serialize the state or its nested objects wholesale.
    const me=s.you||{}, p=s.pending, pt=s.public_table||{};
    const history=(s.history||[]).filter(e=>Array.isArray(e)&&publicKinds.has(e[1])).map(e=>{
      const out=[Number(e[0]),e[1]];if(e[1]!=='draw'&&tile(e[2]))out.push(tile(e[2]));
      if(['hu','robkong','kong'].includes(e[1])&&Number.isInteger(e[3]))out.push(e[3]);return out;
    });
    const phase=s.stage==='choose_exchange'?'exchange':s.stage==='choose_daque'?'daque':p?.valid_act;
    return {schema:VERSION,engine_game:String(s.game_id),stage:s.stage,phase,seat:me.id,dealer:0,
      rules:{version:String(s.rules?.version||'unknown'),exchange_enabled:s.rules?.exchange_enabled===true},
      versions:{app:APP,build_identity:copy(globalThis.__mahjongBuild||{verified:false}),source_baseline:'160062196b7a12ea3de945073e9e7480248cb774',
        rules:'P0.2-frozen+p04-opening',math:'hand-math-v1',ai_code_baseline:'160062196b7a12ea3de945073e9e7480248cb774',
        rules_sources_sha256:'6d181a7c698f6dda20b9b3973820dc5e7201bd06e0a0aba5e05cc22a6dd42113',
        math_sources_sha256:'a348fa5109be040d9e66e3b6835f20cb11d859ea7bdd06e255aca4efeeb1025e',
        ai_sources_sha256:'8ecaacba6e4a89df5826dbb350c2368b2848069484e152fd28ad5cf0a095da6a'},
      own:{hand:tiles(me.hand),drawn:tile(me.drawn),melds:melds(me.pile),daque:me.daque??null,score:me.score,winning:!!me.winning},
      players:[me,...(s.opponents||[])].map(q=>({seat:q.id,melds:melds(q.pile),daque:q.daque??null,
        concealed_count:q.id===me.id?tiles(me.hand).length:q.n_hand,winning:!!q.winning,score:q.score})),
      public:{history,wall_total:s.wall,winners:(s.winners||[]).filter(Number.isInteger),physical_tiles:tiles(pt.physical_tiles),
        discards:(pt.discards||[]).map(d=>({id:String(d.id),event_index:d.event_index,seat:d.seat,tile:tile(d.tile),
          status:String(d.status),claims:(d.claims||[]).filter(Number.isInteger),resolving:!!d.resolving})),
        winning_tiles:(pt.winning_tiles||[]).map(d=>({id:String(d.id),seat:d.seat,kind:String(d.kind),tile:tile(d.tile),
          claims:(d.claims||[]).filter(Number.isInteger),resolving:!!d.resolving})),consistent:pt.consistent??null},
      exchange:{occurred:!!s.exchange?.complete,direction:s.exchange?.direction??null,
        personal:s.exchange?.personal?{sent:tiles(s.exchange.personal.sent),received:tiles(s.exchange.personal.received),
          to:s.exchange.personal.to,from:s.exchange.personal.from,direction:s.exchange.personal.direction}:null},
      legal:phase==='exchange'?{kind:'exchange',count:3,same_suit:true}:phase==='daque'?{kind:'daque',colors:[0,1,2]}:
        {kind:p?.type,response_tile:tile(p?.tile),prompt:typeof p?.prompt==='string'?p.prompt:null,
          allowed:tiles(p?.allowed),options:(p?.options||[]).map(o=>({action:action(o.action),label:String(o.label),tile:tile(o.tile)}))}};
  }
  function submitted(body){
    if(body.type==='exchange')return {type:'exchange',tiles:tiles(body.tiles)};
    if(body.type==='daque')return {type:'daque',color:body.color};
    if(body.type==='discard')return {type:'discard',tile:tile(body.tile)};
    return {type:'action',action:action(body.action)};
  }
  function triggers(v,used,policy){
    const t=[],n=v.public.history.filter(e=>e[1]==='discard').length;
    if(v.phase==='exchange'&&!used.exchange)t.push('exchange');
    if(v.phase==='daque'&&!used.daque)t.push('daque');
    if(v.legal.kind==='discard'){
      if(!used.clear&&!v.own.hand.some(t=>t[0]===v.own.daque))t.push('clear');
      if(!used.middle&&n>=12)t.push('middle');
      if(!used.response&&policy==='response-or-24'&&n>=24)t.push('late');
    }else if(v.legal.kind==='choice'&&!used.response)t.push('response');
    return t;
  }
  function progress(data,sid){
    const games=data.games.filter(g=>g.session_id===sid),complete=games.filter(g=>g.status==='completed');
    const exchange=Math.min(10,complete.filter(g=>g.exchange_enabled).length),skip=Math.min(10,complete.filter(g=>!g.exchange_enabled).length);
    const accepted=new Set(data.decisions.filter(d=>d.session_id===sid&&d.status==='accepted').map(d=>d.id));
    const answers=data.answers.filter(a=>a.session_id===sid&&a.revision===0&&a.valid_independent&&accepted.has(a.decision_id));
    return {exchange,skip,total:exchange+skip,independent:answers.length,math_candidates:answers.filter(a=>a.math_checkable).length,
      readiness:exchange===10&&skip===10&&answers.length>=60&&answers.filter(a=>a.math_checkable).length>=20};
  }
  // V1 helper above remains ONLY for legacy-format compatibility. V2 UI uses this strict path.
  function thresholds(p){return p.exchange>=10&&p.skip>=10&&p.independent>=60&&p.math_candidates>=20;}
  // These are unreviewed recording counters, never a declaration of valid human samples.
  function formalFreeplayProgress(data,pid){const p=data.plans.find(x=>x.plan_id===pid),games=data.games.filter(g=>g.plan_id===pid),done=games.filter(g=>g.status==='completed'&&g.record_status==='completed'&&g.integrity==='verified');
    return {recorded_games:done.length,exchange:done.filter(g=>g.exchange_enabled===true).length,skip:done.filter(g=>g.exchange_enabled===false).length,
      interrupted:games.length-done.length,protocol_matches:p?.purpose==='formal_freeplay'&&p.protocol?.id===FORMAL_FREEPLAY_PROTOCOL,
      audited_valid_games:null,automatic_score:false};}
  function planProgress(data,planId){
    const plan=data.plans.find(p=>p.plan_id===planId);if(!plan)return null;
    const games=data.games.filter(g=>g.plan_id===planId),finished=games.filter(g=>g.status==='completed');
    const formal=plan.purpose==='formal_diagnostic'&&plan.provenance==='human_self_report'&&plan.origin==='new';
    const validGames=new Set(finished.filter(g=>g.provenance==='human_self_report').map(g=>g.id));
    const decisions=new Map(data.decisions.filter(d=>d.plan_id===planId&&d.status==='accepted'&&validGames.has(d.game_id)).map(d=>[d.id,d]));
    const independent=data.answers.filter(a=>{
      const d=decisions.get(a.decision_id);if(!formal||!d||d.interaction?.mode==='freeplay'||a.plan_id!==planId||a.game_id!==d.game_id||a.provenance!=='human_self_report'||
        a.revision!==0||a.skipped||!a.valid_independent||a.classification!=='independent'||!(a.seq<d.submitted_seq))return false;
      if(d.teaching_evidence_version===HELP_VERSION&&(a.independence_evidence?.version!==HELP_VERSION||a.independence_evidence.state!=='none'))return false;
      if(!data.events.some(e=>e.plan_id===planId&&e.decision_id===d.id&&e.kind==='answer_submitted'&&e.seq===a.seq)||
        !data.events.some(e=>e.plan_id===planId&&e.decision_id===d.id&&e.kind==='action_submitted'&&e.seq===d.submitted_seq))return false;
      return !data.events.some(e=>e.plan_id===planId&&e.game_id===d.game_id&&e.seq<a.seq&&ASSIST.has(e.kind)&&
        (e.decision_id===d.id||e.information_key&&e.information_key===d.information_key));
    });
    const eligible=finished.filter(g=>formal&&g.provenance==='human_self_report');
    return {recorded_games:finished.length,raw_exchange:finished.filter(g=>g.exchange_enabled).length,raw_skip:finished.filter(g=>!g.exchange_enabled).length,
      exchange:Math.min(10,eligible.filter(g=>g.exchange_enabled).length),skip:Math.min(10,eligible.filter(g=>!g.exchange_enabled).length),
      independent:independent.length,math_candidates:independent.filter(a=>a.math_checkable).length,formal};
  }
  // Legacy counters remain readable. New UI/exports never promote unverified V2 rows.
  function reliableProgress(data,planId){const ids=new Set(data.games.filter(g=>g.plan_id===planId&&g.record_protocol===RECORD_PROTOCOL&&g.record_status==='completed'&&g.integrity==='verified').map(g=>g.id));
    const out=planProgress({...data,games:data.games.filter(g=>ids.has(g.id))},planId);
    return out&&{...out,legacy_unverified_games:data.games.filter(g=>g.plan_id===planId&&!g.record_protocol).length};}
  const informationKey=v=>canonical({own:v.own,players:v.players,public:v.public,exchange:v.exchange});
  // Canonical JSON defines the exact SHA-256 preimage; insertion order is irrelevant.
  function canonical(x){if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';
    if(x&&typeof x==='object')return '{'+Object.keys(x).sort().filter(k=>x[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
    return JSON.stringify(x);}
  async function envelope(data){const payload={schema:VERSION,app:APP,exported_at:now(),...copy(data)};
    const text=canonical(payload);let checksum={algorithm:'unavailable',value:null,preimage:'UTF-8 canonical(payload); recursively sorted object keys'};
    if(crypto.subtle)checksum={...checksum,algorithm:'SHA-256',value:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(b=>b.toString(16).padStart(2,'0')).join('')};
    return {payload,checksum};}
  const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const digest=async x=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(x))))).map(b=>b.toString(16).padStart(2,'0')).join('');
  const pick=(x,keys)=>Object.fromEntries(keys.filter(k=>x?.[k]!==undefined).map(k=>[k,copy(x[k])]));
  function helpPayload(kind,x){
    // Only actual player-facing response fields; never serialize a runtime/player object.
    if(kind==='ai'||kind==='ai_candidate')return {kind,...pick(x,['action','why','forced_daque','cur_dfncy','exchange_occurred']),
      rows:(x.rows||[]).slice(0,8).map(r=>({...pick(r,['tile','danger','notes','keeps','after','eff']),...(r.detail?{detail:r.detail.map(d=>[tile(d[0]),Number(d[1])])}:{})})),
      opponents:(x.opps||[]).map(r=>({...pick(r,['id','winning','daque','n_melds','n_discards','threat','flush']),hot:(r.hot||[]).map(d=>[tile(d[0]),Number(d[1])])})),risk_model:{kind:'heuristic',calibrated:false},...pick(x,['candidate'])};
    if(kind==='math'||kind==='comparison'){const a=x.analysis||{},describe=r=>({...pick(r,['is_complete','is_tenpai','has_unseen_wait','wait_types','unseen_total','wins_with_claim','tile']),waits:(r.waits||[]).map(w=>pick(w,['tile','unseen']))});
      return {kind,analysis:{...pick(a,['status','version','errors','unseen','missing_suit_remaining','wall_count','count_basis','information_limits','unsupported']),...(a.suggestion?{suggestion:pick(a.suggestion,['kind','metric','tiles','optimality_proven','message','not_considered'])}:{}),...(a.current?{current:describe(a.current)}:{}),discards:(a.discards||[]).map(describe)},context:{...pick(x.context,['game_id','n_history','phase','legal_win_available']),...(x.context?.rules?{rules:pick(x.context.rules,['version','exchange_enabled'])}:{})},...pick(x,['elapsed_ms','candidate'])};}
    if(kind==='exchange')return {kind,suggestion:tiles(x.suggestion)};
    if(kind==='daque')return {kind,color:Number(x.color)};
    if(kind==='dfncy')return {kind,value:Number(x.value),interpretation:'legacy heuristic reference, not exact tenpai'};
    throw Error('未审核的教学帮助类型');
  }
  function helpFollowups(data,pid){return data.events.filter(e=>e.plan_id===pid&&e.kind==='help_may_be_seen').map(e=>{
    const related=data.answers.filter(a=>a.plan_id===pid&&a.game_id===e.game_id&&a.decision_id===e.decision_id&&a.revision>0&&a.seq>e.seq),
      provided=related.filter(a=>!a.skipped),
      specific=provided.filter(a=>a.help_response?.scope==='specific'&&a.responds_to_help_ids?.length===1&&a.responds_to_help_ids[0]===e.detail.help_id),
      combined=provided.filter(a=>a.help_response?.scope==='combined'&&a.help_response.context_help_ids.includes(e.detail.help_id)),
      legacy=provided.filter(a=>!a.help_response&&a.responds_to_help_ids?.includes(e.detail.help_id));
    return {help_id:e.detail.help_id,decision_id:e.decision_id,status:specific.length?'已提供':combined.length?'仅综合补充':legacy.length?'历史归属待确认':'未提供',
      answer_ids:specific.map(a=>a.id),combined_answer_ids:combined.map(a=>a.id),legacy_answer_ids:legacy.map(a=>a.id),
      skipped_answer_ids:related.filter(a=>a.skipped&&(a.help_response?.context_help_ids||a.responds_to_help_ids||[]).includes(e.detail.help_id)).map(a=>a.id)};
  });}
  function validateHelpResponse(a,releases){
    const r=a.help_response;if(!r)return; // Keep legacy raw fields; never infer an explicit user selection.
    exactKeys(r,['version','scope','context_help_ids'],'补充归属');
    if(r.version!=='help-followup-v1'||!['none','specific','combined'].includes(r.scope)||!(a.revision>0)||!Array.isArray(r.context_help_ids)||
      new Set(r.context_help_ids).size!==r.context_help_ids.length||r.context_help_ids.some(id=>typeof id!=='string'))throw Error('补充归属格式无效');
    const links=a.responds_to_help_ids||[];
    if(r.scope==='none'&&(r.context_help_ids.length||links.length)||r.scope==='specific'&&(r.context_help_ids.length!==1||canonical(links)!==canonical(r.context_help_ids))||
      r.scope==='combined'&&(!r.context_help_ids.length||links.length))throw Error('补充范围与帮助关联矛盾');
    if(r.context_help_ids.some(id=>{const e=releases.get(id);return !e||e.seq>=a.seq||['plan_id','game_id','decision_id'].some(k=>e[k]!==a[k]);}))throw Error('补充帮助上下文无效或已过期');
  }
  async function validateTeaching(data){
    for(const d of data.decisions)if(d.interaction!==undefined){
      if(canonical(d.interaction)!==canonical(freeplay()))throw Error('自由对局记录语义无效');
      if(data.answers.some(a=>a.plan_id===d.plan_id&&a.decision_id===d.id))throw Error('未提问的自由对局不得伪造问卷回答');
    }
    const releases=new Map();
    for(const e of data.events){const h=e.detail;if(h?.evidence_version!==HELP_VERSION)continue;
      if(e.kind==='visible_facts'){if(!h.payload||h.payload_sha256!==await digest(h.payload)||hiddenFields(h.payload))throw Error('本人可见事实校验失败');continue;}
      if(!h.help_id||h.payload_sha256!==await digest(h.payload)||hiddenFields(h.payload))throw Error('教学内容哈希或字段无效');
      if(e.kind==='help_may_be_seen'){if(releases.has(h.help_id))throw Error('重复帮助ID');releases.set(h.help_id,e);}
    }
    const confirmations=new Set();
    for(const e of data.events){const h=e.detail;if(h?.evidence_version!==HELP_VERSION||e.kind==='visible_facts'||e.kind==='help_may_be_seen')continue;
      const before=releases.get(h.help_id);if(!before||before.seq>=e.seq||['plan_id','game_id','decision_id','information_key'].some(k=>canonical(before[k])!==canonical(e[k])))throw Error('帮助呈现关联或顺序错误');
      if(h.semantic_sha256!==before.detail.payload_sha256||canonical(h.payload.semantic)!==canonical(before.detail.payload)||canonical(h.versions)!==canonical(before.detail.versions))throw Error('实际帮助与展示前内容不一致');
      if(ASSIST.has(e.kind)&&e.kind!=='help_presentation_unconfirmed'){if(confirmations.has(h.help_id))throw Error('重复帮助呈现');confirmations.add(h.help_id);}
    }
    for(const a of data.answers){validateHelpResponse(a,releases);if(a.independence_evidence?.version!==HELP_VERSION)continue;
      const d=data.decisions.find(d=>d.id===a.decision_id);
      if(!d||a.valid_independent&&(a.independence_evidence.state!=='none'||data.events.some(e=>e.plan_id===a.plan_id&&e.game_id===a.game_id&&e.seq<a.seq&&ASSIST.has(e.kind)&&(e.decision_id===d.id||e.information_key===d.information_key))))throw Error('独立回答与帮助边界矛盾');
      if((a.responds_to_help_ids||[]).some(id=>!releases.has(id)||releases.get(id).seq>=a.seq||['plan_id','game_id','decision_id'].some(k=>releases.get(id)[k]!==a[k])))throw Error('补充回答帮助关联无效');
    }
  }
  // Backup is a data-only archive. It never restores a live binding or replays an engine command.
  const BACKUP_FORMAT='mahjong-single-plan', BACKUP_VERSION=2;
  const BACKUP_TABLES=['plans',...CHILDREN,'app_meta'];
  const ROW_KEYS={
    plans:'id plan_id purpose status title created_at updated_at plan_version origin schema app provenance policy next_seq targets storage_channel build_identity protocol',
    games:'id plan_id engine_game exchange_enabled configuration started_at status record_status record_protocol integrity triggered provenance start_command start_ticket command_ids worker_id worker_revision result_checkpoint active_command last_command terminal terminal_pending ended_at end_reason missing_triggers error_reason interrupted_command',
    decisions:'id plan_id game_id key information_key ordinal at snapshot tags status provenance acknowledged_at action_assisted command final_action submitted_at submitted_seq error_reason teaching_evidence_version interaction',
    answers:'id plan_id game_id decision_id at fields planned_action provenance revision seq skipped valid_independent classification math_checkable independence_evidence responds_to_help_ids answer_stage help_response',
    events:'id plan_id game_id decision_id at detail information_key kind provenance seq',
    app_meta:'id record_type plan_id game_id decision_id command fingerprint phase ticket provenance result result_sha256 result_persisted presentation_confirmed error_reason',
    legacy_quarantine:''
  };
  function exactKeys(value,allowed,where){if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(k=>!allowed.includes(k)))throw Error(where+' 含未知字段或格式错误');}
  function hiddenFields(x){if(!x||typeof x!=='object')return false;return Object.entries(x).some(([k,v])=>['__proto__','constructor','prototype','seed','deck','rng','random_state','future_wall','opponent_hand','hidden_hand'].includes(k)||k==='opponents'&&Array.isArray(v)&&v.some(q=>q&&'hand'in q)||hiddenFields(v));}
  function ordered(data){return Object.fromEntries(BACKUP_TABLES.map(n=>[n,[...data[n]].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)]));}
  const frozenBackupNodes=new WeakSet(),backupHashCache=new WeakMap(),orderedBackupCache=new WeakMap();
  function orderedBackup(data){let result=orderedBackupCache.get(data);if(!result){result=ordered(data);freezeBackup(result);if(frozenBackupNodes.has(data))orderedBackupCache.set(data,result);}return result;}
  // Exact legacy canonical byte order, without concatenating every nested subtree.
  // A token is never split, so UTF-16 surrogate pairs remain intact before UTF-8 encoding.
  function* backupTokens(x){
    if(Array.isArray(x)){yield '[';for(let i=0;i<x.length;i++){if(i)yield ',';yield* backupTokens(x[i]);}yield ']';}
    else if(x&&typeof x==='object'){yield '{';let first=true;for(const k of Object.keys(x).sort())if(x[k]!==undefined){if(!first)yield ',';first=false;yield JSON.stringify(k);yield ':';yield* backupTokens(x[k]);}yield '}';}
    else{const token=JSON.stringify(x);if(token===undefined)throw Error('备份只能包含JSON值');yield token;}
  }
  async function backupChunks(x){
    const clock=()=>globalThis.performance?.now?.()??Date.now(),encoder=new TextEncoder(),chunks=[];let parts=[],units=0,total=0,slice=clock();
    const flush=()=>{const b=encoder.encode(parts.join(''));chunks.push(b);total+=b.length;parts=[];units=0;};
    for(const token of backupTokens(x)){parts.push(token);units+=token.length;if(units>=65536){flush();if(clock()-slice>=8){if(typeof setTimeout==='function')await new Promise(r=>setTimeout(r,0));else await Promise.resolve();slice=clock();}}}
    if(parts.length)flush();return {chunks,total};
  }
  async function backupBytes(x){
    const {chunks,total}=await backupChunks(x),bytes=new Uint8Array(total);let offset=0;
    for(let i=0;i<chunks.length;i++){bytes.set(chunks[i],offset);offset+=chunks[i].length;chunks[i]=null;}
    return bytes;
  }
  async function backupHash(x){
    const cacheable=x&&typeof x==='object'&&frozenBackupNodes.has(x);
    if(cacheable&&backupHashCache.has(x))return backupHashCache.get(x);
    let bytes=await backupBytes(x);const pending=crypto.subtle.digest('SHA-256',bytes);bytes=null;
    const result=Array.from(new Uint8Array(await pending)).map(b=>b.toString(16).padStart(2,'0')).join('');
    if(cacheable)backupHashCache.set(x,result);return result;
  }
  // Ownership is private to the backup path. Never trust a caller's shallow freeze.
  const ownedBackups=new WeakSet(),validatedBackups=new WeakSet();
  function freezeBackup(value,seen=new WeakSet(),active=new WeakSet()){
    if(value===null||typeof value!=='object'){if(value===undefined||typeof value==='function'||typeof value==='bigint'||typeof value==='number'&&!Number.isFinite(value))throw Error('备份只能包含JSON值');return;}
    if(active.has(value))throw Error('备份含循环引用');if(seen.has(value)||frozenBackupNodes.has(value))return;
    const proto=Object.getPrototypeOf(value);if(!Array.isArray(value)&&proto!==Object.prototype&&proto!==null)throw Error('备份含非JSON对象');
    active.add(value);for(const x of Object.values(value))freezeBackup(x,seen,active);active.delete(value);seen.add(value);Object.freeze(value);frozenBackupNodes.add(value);
  }
  function sameBackupJSON(a,b){
    if(a===b)return true;if(a===null||b===null||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
    const keys=Object.keys(a),other=Object.keys(b);if(keys.length!==other.length)return false;
    return keys.every(k=>Object.prototype.hasOwnProperty.call(b,k)&&sameBackupJSON(a[k],b[k]));
  }
  function backupCompatible(db,source,plan){
    if(!CHANNELS[source.storage_channel]||source.storage_channel!==db.channel)throw Error('备份通道不匹配；禁止把测试/验收档案导入正式通道');
    if(source.automated_test!==db.testing||db.testing&&plan.provenance!=='automated_test'||!db.testing&&plan.provenance==='automated_test')throw Error('自动化测试来源不匹配');
    if(!channelAllows(db.channel,plan.purpose,db.testing)||plan.storage_channel&&plan.storage_channel!==db.channel)throw Error('计划用途或存储通道不匹配');
  }
  async function readBackupTree(db,pid){return new Promise((resolve,reject)=>{
    const tx=db.db.transaction(BACKUP_TABLES),out=Object.fromEntries(BACKUP_TABLES.map(n=>[n,[]]));
    tx.onabort=()=>reject(tx.error||Error('备份快照读取失败'));tx.oncomplete=()=>resolve(ordered(out));
    const p=tx.objectStore('plans').get(pid);p.onsuccess=()=>{if(p.result)out.plans=[p.result];};
    for(const n of CHILDREN){const q=tx.objectStore(n).index('by_plan').getAll(IDBKeyRange.only(pid));q.onsuccess=()=>{
      out[n]=q.result;if(n==='games')for(const cid of new Set(q.result.flatMap(g=>g.command_ids||[]))){const r=tx.objectStore('app_meta').get('command:'+cid);r.onsuccess=()=>{if(r.result)out.app_meta.push(r.result);};}
    };}
  });}
  const Backup={
    async validate(input,db){
      const out=typeof input==='string'?JSON.parse(input):ownedBackups.has(input)?input:typeof structuredClone==='function'?structuredClone(input):copy(input);
      if(!ownedBackups.has(out)){freezeBackup(out);ownedBackups.add(out);}
      exactKeys(out,['payload','checksum'],'备份');exactKeys(out.checksum,['algorithm','value','preimage'],'校验信息');
      if(out.checksum.algorithm!=='SHA-256'||out.checksum.value!==await backupHash(out.payload))throw Error('文件SHA-256校验失败');
      const p=out.payload;
      // Old v2 exports can be checked, but are never silently promoted into restorable backups.
      if(p.schema===VERSION&&!p.backup_format)return {restorable:false,reason:'旧版证据导出：校验通过，但不支持直接恢复',payload:p};
      exactKeys(p,['backup_format','backup_version','schema','exported_at','source','dataset','counts','content_sha256','semantics','teaching_evidence_version'],'备份内容');
      if(p.backup_format!==BACKUP_FORMAT||![1,BACKUP_VERSION].includes(p.backup_version)||p.schema!==VERSION||p.backup_version===2&&p.teaching_evidence_version!==HELP_VERSION)throw Error('不支持的备份版本');
      exactKeys(p.source,['storage_channel','automated_test','build_identity'],'备份来源');
      if(typeof p.source.automated_test!=='boolean'||typeof p.exported_at!=='string'||p.semantics!=='archive-only; no live binding; no command replay')throw Error('备份来源或恢复语义无效');
      exactKeys(p.dataset,BACKUP_TABLES,'数据表');exactKeys(p.counts,BACKUP_TABLES,'表数量');
      const data=p.dataset;
      for(const n of BACKUP_TABLES){if(!Array.isArray(data[n])||p.counts[n]!==data[n].length)throw Error('表数量不一致：'+n);
        const ids=new Set();for(const r of data[n]){exactKeys(r,ROW_KEYS[n].split(' '),n);if(typeof r.id!=='string'||!r.id||ids.has(r.id))throw Error('记录ID无效或重复：'+n);ids.add(r.id);}}
      if(data.plans.length!==1||data.legacy_quarantine.length)throw Error('仅支持一个v2计划；旧资料隔离原件不支持此恢复格式');
      if(hiddenFields(data))throw Error('备份含禁存隐藏信息或危险字段');
      const plan=data.plans[0],pid=plan.plan_id;
      if(plan.id!==pid||plan.schema!==VERSION||plan.plan_version!==2||!['in_progress','completed','archived'].includes(plan.status)||!['device_acceptance','formal_diagnostic','formal_freeplay'].includes(plan.purpose)||!Number.isSafeInteger(plan.next_seq)||plan.next_seq<0)throw Error('计划格式无效');
      if(plan.purpose==='formal_diagnostic'&&canonical(plan.targets)!==canonical({exchange:10,skip:10,independent:60,math_checkable:20}))throw Error('正式诊断门槛不匹配');
      if(plan.purpose==='formal_freeplay'&&(canonical(plan.protocol)!==canonical({id:FORMAL_FREEPLAY_PROTOCOL,version:1,questions:'not_asked'})||canonical(plan.targets)!==canonical({completed:20,exchange:10,skip:10})))throw Error('正式自由对局协议不匹配');
      backupCompatible(db,p.source,plan);
      const games=new Map(data.games.map(r=>[r.id,r])),decisions=new Map(data.decisions.map(r=>[r.id,r])),commands=new Map(data.app_meta.map(r=>[r.command?.id,r]));
      const sequences=new Set(),answers=new Set();
      for(const n of BACKUP_TABLES)for(const r of data[n]){
        if(r.plan_id!==pid||r.provenance!==plan.provenance)throw Error('记录计划或来源不一致');
        if(r.game_id&&(!games.has(r.game_id)||games.get(r.game_id).plan_id!==pid))throw Error('对局父记录缺失');
        if(r.decision_id&&(!decisions.has(r.decision_id)||decisions.get(r.decision_id).game_id!==r.game_id))throw Error('决策父记录缺失');
        if(['decisions','answers'].includes(n)&&!r.game_id||n==='answers'&&!r.decision_id)throw Error('记录缺少父ID');
        if(n==='events'){if(!Number.isSafeInteger(r.seq)||r.seq<1||r.seq>plan.next_seq||sequences.has(r.seq))throw Error('事件序号无效或重复');sequences.add(r.seq);if(!r.game_id&&!['plan_completed','plan_archived'].includes(r.kind))throw Error('事件缺少对局');}
        if(n==='answers'){const key=r.decision_id+':'+r.revision;if(!Number.isSafeInteger(r.revision)||r.revision<0||answers.has(key))throw Error('回答修订无效或重复');answers.add(key);}
        if(n==='decisions'&&(!r.snapshot||r.snapshot.schema!==VERSION||r.snapshot.own?.hand?.length>14))throw Error('决策快照无效');
        const cs=n==='games'?[r.start_command,r.active_command,r.last_command,r.interrupted_command]:[r.command];
        for(const c of cs.filter(Boolean)){if(c.protocol!==2||!c.intent||c.fingerprint!==await digest(c.intent)||c.id!==c.intent.command_id||c.intent.plan_id!==pid||c.intent.game_id!==(n==='games'?r.id:r.game_id)||canonical(c.payload)!==canonical(c.intent.payload)||c.worker_id!==c.intent.worker_id||c.expected_revision!==c.intent.expected_revision)throw Error('命令身份/配置指纹无效');}
        if(n==='games'){
          if(!['completed','incomplete','cancelled'].includes(r.status)||r.active_command||r.terminal_pending)throw Error('未结束的牌局仅可导出应急证据，不能备份恢复');
          if(r.start_command?.intent&&(canonical(r.configuration)!==canonical(r.start_command.intent.configuration)||r.exchange_enabled!==r.configuration.rules.exchange_enabled))throw Error('对局配置不一致');
          if(!Array.isArray(r.command_ids)||new Set(r.command_ids).size!==r.command_ids.length||r.command_ids.some(cid=>commands.get(cid)?.game_id!==r.id))throw Error('命令索引缺失或重复');
          if(r.status==='completed'&&r.command_ids.some(cid=>commands.get(cid).phase!=='confirmed'||!commands.get(cid).presentation_confirmed))throw Error('完整局存在未确认命令');
          if(r.result_checkpoint){const cp=r.result_checkpoint;if(await digest(cp.result)!==cp.sha256||cp.result.game_id!==r.engine_game||!r.command_ids.includes(cp.command_id)||cp.ticket?.game_id!==r.id||cp.ticket?.plan_id!==pid)throw Error('对局结果校验失败');}
        }
        if(n==='app_meta'){
          if(r.record_type!=='command_v2'||r.id!=='command:'+r.command?.id||r.fingerprint!==r.command?.fingerprint||!games.get(r.game_id)?.command_ids.includes(r.command.id)||r.ticket?.plan_id!==pid||r.ticket?.game_id!==r.game_id||!['confirmed','needs_review','cancelled'].includes(r.phase))throw Error('命令账本无效或仍待恢复');
          if(r.result&&await digest(r.result)!==r.result_sha256)throw Error('命令结果校验失败');
        }
      }
      await validateTeaching(data);
      if(await backupHash(orderedBackup(data))!==p.content_sha256)throw Error('稳定内容SHA-256不一致');
      validatedBackups.add(out);return {restorable:true,payload:p,envelope:out,plan_id:pid,counts:copy(p.counts),content_sha256:p.content_sha256};
    },
    async file(out){if(!validatedBackups.has(out))throw Error('先建立或校验不可变备份快照');return new Blob((await backupChunks(out)).chunks,{type:'application/json'});},
    async make(controller,pid){
      controller.assertIdle();if(!controller.writer||!controller.available)throw Error('当前档案只读或不可用');
      return controller.queue(async()=>{controller.assertIdle();const data=await readBackupTree(controller.db,pid);if(!data.plans.length)throw Error('计划不存在');freezeBackup(data);
        const payload={backup_format:BACKUP_FORMAT,backup_version:BACKUP_VERSION,schema:VERSION,exported_at:now(),teaching_evidence_version:HELP_VERSION,
          source:{storage_channel:controller.channel,automated_test:controller.testing,build_identity:copy(globalThis.__mahjongBuild||{verified:false,app_release:APP})},dataset:data,
          counts:Object.fromEntries(BACKUP_TABLES.map(n=>[n,data[n].length])),content_sha256:await backupHash(orderedBackup(data)),semantics:'archive-only; no live binding; no command replay'};
        freezeBackup(payload);const out={payload,checksum:{algorithm:'SHA-256',value:await backupHash(payload),preimage:'UTF-8 canonical(payload); recursively sorted object keys'}};
        freezeBackup(out);ownedBackups.add(out);await Backup.validate(out,controller.db);return out;
      });
    },
    async restore(db,checked,fault=null){
      if(fault&&!db.testing)throw Error('故障注入仅限虚构数据库');
      const v=await Backup.validate(checked.envelope||checked,db);if(!v.restorable)throw Error('此文件不支持恢复');
      const data=v.payload.dataset,pid=v.plan_id,generation=db.generation;
      if(!db.lockHeld)throw Error('没有独占写锁，禁止恢复');
      return new Promise((resolve,reject)=>{
        const tx=db.db.transaction(STORES,'readwrite'),found={},collisions=new Map();let remaining=BACKUP_TABLES.length+2,why,result;
        const abort=e=>{why=e;try{tx.abort();}catch{}};
        const inject=phase=>{if(fault===phase)throw Error('合成事务故障：'+phase);};
        const ready=()=>{if(--remaining)return;try{
          const gate=found.gate,live=found.live;
          if(db.db.version!==2||!db.lockHeld||!gate||gate.protocol!==RECORD_PROTOCOL||gate.state!=='ready'||gate.generation!==generation)throw Error('恢复时库版本/迁移闸门/写锁改变');
          if(!db.testing&&db.channel==='formal_learning'&&!formalFreeplayBuildReady(globalThis.__mahjongBuild))throw Error('正式恢复写入需要新协议的已批准构建；未批准候选只读');
          if(LIVE.has(live?.stage)||found.liveGame?.status==='playing'||found.liveGame?.active_command||found.liveGame?.terminal_pending||Object.values(found).flat().some(r=>r&&r.record_type==='command_v2'&&!['confirmed','needs_review','cancelled'].includes(r.phase)))throw Error('存在活动局或待恢复命令');
          backupCompatible(db,v.payload.source,data.plans[0]);
          const current=Object.fromEntries(BACKUP_TABLES.map(n=>[n,found[n]]));
          if(current.plans.length){if(!sameBackupJSON(ordered(current),ordered(data)))throw Error('相同计划ID内容冲突，拒绝覆盖或合并');result={status:'identical',plan_id:pid,content_sha256:v.content_sha256,inserted:0};return;}
          if(Object.values(current).some(a=>a.length))throw Error('发现无主子记录，拒绝恢复');
          for(const [key,row]of collisions)if(row)throw Error('已有记录ID冲突：'+key.split('|')[0]);
          inject('first');let count=0;
          for(const n of BACKUP_TABLES)for(const r of data[n]){tx.objectStore(n).add(copy(r));if(++count===Math.ceil(Object.values(data).reduce((n,a)=>n+a.length,0)/2))inject('middle');}
          // Read back actual rows before the receipt. Both verification and receipt share the write transaction.
          let pending=BACKUP_TABLES.length;const actual={};
          for(const n of BACKUP_TABLES){let q;
            if(n==='plans')q=tx.objectStore(n).get(pid);
            else if(n==='app_meta'){const ids=data[n].map(r=>r.id),rows=[];if(!ids.length){actual[n]=[];done();continue;}
              let left=ids.length;for(const k of ids){const r=tx.objectStore(n).get(k);r.onsuccess=()=>{if(r.result)rows.push(r.result);if(!--left){actual[n]=rows;done();}};}continue;
            }else q=tx.objectStore(n).index('by_plan').getAll(IDBKeyRange.only(pid));
            q.onsuccess=()=>{actual[n]=n==='plans'?(q.result?[q.result]:[]):q.result;done();};
          }
          function done(){if(--pending)return;try{inject('verify');if(!sameBackupJSON(ordered(actual),ordered(data)))throw Error('写入后逐字段核对失败');inject('receipt');
            tx.objectStore('app_meta').add({id:'restore:'+pid,record_type:'backup_restore',plan_id:pid,content_sha256:v.content_sha256,restored_at:now(),counts:v.counts,source:copy(v.payload.source),no_engine_replay:true});
            result={status:'restored',plan_id:pid,content_sha256:v.content_sha256,inserted:count};
          }catch(e){abort(e);}}
        }catch(e){abort(e);}};
        tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(why||tx.error||Error('恢复事务完整回滚'));tx.onerror=()=>{};
        for(const [field,key]of [['gate','recording_gate'],['live','live']]){const q=tx.objectStore('app_meta').get(key);q.onsuccess=()=>{found[field]=q.result;
          if(field==='live'&&q.result?.game_id){remaining++;const g=tx.objectStore('games').get(q.result.game_id);g.onsuccess=()=>{found.liveGame=g.result;ready();};}ready();};}
        for(const n of BACKUP_TABLES){if(n==='app_meta'){
            // No full-database export/read: retrieve only this plan's command IDs.
            const ids=data[n].map(r=>r.id);found[n]=[];if(!ids.length){ready();continue;}
            let left=ids.length;for(const k of ids){const q=tx.objectStore(n).get(k);q.onsuccess=()=>{collisions.set(n+'|'+k,q.result);if(q.result?.plan_id===pid)found[n].push(q.result);if(!--left)ready();};}
          }else if(n==='plans'){const q=tx.objectStore(n).get(pid);q.onsuccess=()=>{found[n]=q.result?[q.result]:[];ready();};}
          else{const q=tx.objectStore(n).index('by_plan').getAll(IDBKeyRange.only(pid));q.onsuccess=()=>{found[n]=q.result;ready();};}
          if(n!=='plans'&&n!=='app_meta')for(const r of data[n]){remaining++;const q=tx.objectStore(n).get(r.id);q.onsuccess=()=>{collisions.set(n+'|'+r.id,q.result);ready();};}
        }
      });
    }
  };
  class Database{
    constructor(name=CHANNELS.development_preview,testing=false){if(testing&&!testName(name))throw Error('测试禁止打开真实数据库');this.name=name;this.testing=testing;this.timings=[];this.lockHeld=false;}
    async open(){this.db=await new Promise((resolve,reject)=>{const r=indexedDB.open(this.name,2);
      r.onupgradeneeded=()=>{for(const name of STORES){const st=r.result.createObjectStore(name,{keyPath:'id'});
        if(CHILDREN.includes(name))st.createIndex('by_plan','plan_id');
        if(name==='answers')st.createIndex('by_revision',['plan_id','decision_id','revision'],{unique:true});
        if(name==='events')st.createIndex('by_sequence',['plan_id','seq'],{unique:true});
      }};
      r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('请关闭其他旧记录页面后重试'));});
      this.db.onversionchange=()=>{this.db.close();this.lockHeld=false;};return this;}
    get(name,key){return request(this.db.transaction(name).objectStore(name).get(key));}
    async boot(){const tx=this.db.transaction(['plans','app_meta','migrations']);const [plans,migrations,meta]=await Promise.all([request(tx.objectStore('plans').getAll()),request(tx.objectStore('migrations').getAll()),Promise.all(['selection','live','recording_gate','presentation'].map(k=>request(tx.objectStore('app_meta').get(k))))]);return {plans,migrations,app_meta:meta.filter(Boolean)};}
    async readCommands(games){const ids=[...new Set(games.flatMap(g=>g.command_ids||[]))];if(!ids.length)return [];const st=this.db.transaction('app_meta').objectStore('app_meta');return (await Promise.all(ids.map(k=>request(st.get('command:'+k))))).filter(Boolean);}
    async readPlan(planId){
      const tx=this.db.transaction(['plans',...CHILDREN]),out={plans:[],games:[],decisions:[],answers:[],events:[],legacy_quarantine:[]};
      await Promise.all([request(tx.objectStore('plans').get(planId)).then(p=>{if(p)out.plans=[p];}),
        ...CHILDREN.map(async n=>{out[n]=await request(tx.objectStore(n).index('by_plan').getAll(IDBKeyRange.only(planId)));})]);return out;
    }
    async ensureGate(){if(!this.lockHeld)throw Error('未持有写锁');return new Promise((resolve,reject)=>{
      const tx=this.db.transaction('app_meta','readwrite'),st=tx.objectStore('app_meta');let gate,why;
      const q=st.get('recording_gate');q.onsuccess=()=>{gate=q.result;if(gate&&(gate.protocol!==RECORD_PROTOCOL||gate.state!=='ready')){why=Error('记录库协议不兼容或迁移未完成；暂停写入');tx.abort();return;}
        if(!gate){gate={id:'recording_gate',protocol:RECORD_PROTOCOL,state:'ready',generation:0};st.add(gate);}};
      tx.oncomplete=()=>{this.generation=gate.generation;resolve(gate);};tx.onabort=()=>reject(why||tx.error||Error('记录闸门初始化失败'));});}
    async migrationGate(lease=null){if(!this.lockHeld)throw Error('未持有写锁');return new Promise((resolve,reject)=>{
      const tx=this.db.transaction(['app_meta','games'],'readwrite'),st=tx.objectStore('app_meta');let next,why;
      const q=st.get('recording_gate');q.onsuccess=()=>{const g=q.result;if(this.db.version!==2||!g||g.protocol!==RECORD_PROTOCOL||!this.lockHeld||
        (lease?g.state!=='migration'||g.lease!==lease:g.state!=='ready')){why=Error('迁移闸门或版本不匹配');tx.abort();return;}
        const l=st.get('live');l.onsuccess=()=>{const live=l.result,apply=game=>{if(!lease&&(LIVE.has(live?.stage)||game?.status==='playing'||game?.active_command||game?.terminal_pending)){why=Error('牌局或命令未结束，禁止启动迁移');tx.abort();return;}
          next={...g,state:lease?'ready':'migration',lease:lease?null:id(),generation:g.generation+1};st.put(next);};
          if(live?.game_id){const qg=tx.objectStore('games').get(live.game_id);qg.onsuccess=()=>apply(qg.result);}else apply(null);};};
      tx.oncomplete=()=>{this.generation=next.generation;resolve(next.lease);};tx.onabort=()=>reject(why||tx.error||Error('迁移闸门失败'));});}
    async write(rows,options={}){if(!this.lockHeld)throw Error('未持有新版写锁，禁止写入');
      if(!this.testing&&this.channel==='formal_learning'&&!formalFreeplayBuildReady(globalThis.__mahjongBuild))throw Error('候选/未提交/未批准构建：正式档案只读，禁止正式20局写入');
      const start=performance.now(),generation=this.generation;let ok=false;try{rows=copy(rows);
      for(const [name,list]of Object.entries(rows))for(const row of list){const commands=name==='games'?[row.start_command,row.active_command,row.last_command]:[row.command];
        if(name==='events'&&row.detail?.evidence_version===HELP_VERSION&&(row.detail.payload_sha256!==await digest(row.detail.payload)||hiddenFields(row.detail.payload)))throw Error('教学记录内容校验失败');
        for(const c of commands){if(c?.intent&&c.protocol!==2)throw Error('已封存命令协议不可降级');if(c?.protocol===2&&(!c.intent||await digest(c.intent)!==c.fingerprint||['id','kind','worker_id','expected_revision','created_at'].some(k=>c[k]!==c.intent[k==='id'?'command_id':k])||canonical(c.payload)!==canonical(c.intent.payload)))throw Error('命令内容指纹无效，禁止写入');}
        if(row.record_type==='command_v2'&&row.result&&await digest(row.result)!==row.result_sha256)throw Error('命令结果校验失败');
        if(name==='games'&&row.result_checkpoint&&await digest(row.result_checkpoint.result)!==row.result_checkpoint.sha256)throw Error('对局保存结果校验失败');}

      await new Promise((resolve,reject)=>{
        const tx=this.db.transaction(STORES,'readwrite'),found=new Map();let pending=0,abortReason;
        const abort=e=>{abortReason=e;try{tx.abort();}catch{}};
        tx.oncomplete=()=>{ok=true;resolve();};tx.onabort=()=>reject(abortReason||tx.error||Error('事务中止'));tx.onerror=()=>{};
        const key=(n,k)=>n+'|'+k,need=new Map();
        const add=(n,k)=>{if(k!==undefined&&k!==null)need.set(key(n,k),[n,k]);};
        add('app_meta','live');add('app_meta','selection');
        add('app_meta','recording_gate');
        for(const [n,list]of Object.entries(rows))for(const r of list){add(n,r.id);if(r.plan_id)add('plans',r.plan_id);if(r.game_id)add('games',r.game_id);if(r.decision_id)add('decisions',r.decision_id);}
        const proposed=(n,k)=>rows[n]?.find(r=>r.id===k)||found.get(key(n,k));
        const finish=()=>{try{
          if(!this.lockHeld)throw Error('新版写锁已失效');
          if(!this.testing&&this.channel==='formal_learning'&&!formalFreeplayBuildReady(globalThis.__mahjongBuild))throw Error('正式构建批准状态已改变，拒绝写入');
          const gate=found.get(key('app_meta','recording_gate'));
          if(this.db.version!==2||!gate||gate.protocol!==RECORD_PROTOCOL||gate.state!=='ready'||gate.generation!==generation)throw Error('记录库版本或迁移状态改变，禁止写入');
          if(rows.app_meta?.some(r=>r.id==='recording_gate'))throw Error('普通写入不得修改迁移闸门');
          if(options.expected){const d=found.get(key('decisions',options.expected.id));
            if(!d||d.status!==options.expected.status||options.expected.command_id&&d.command?.id!==options.expected.command_id)throw Error('决策状态已改变，拒绝并发或重复命令');}
          const live=found.get(key('app_meta','live')),liveGame=live?.game_id&&found.get(key('games',live.game_id));
          const active=LIVE.has(live?.stage)||liveGame?.active_command||liveGame?.terminal_pending||liveGame?.record_status==='preparing';
          if(['switch','complete','archive'].includes(options.op)&&active)throw Error('牌局或命令未结束，禁止切换或结束计划');
          const selection=rows.app_meta?.find(r=>r.id==='selection');
          if(selection&&selection.plan_id!==found.get(key('app_meta','selection'))?.plan_id&&active)throw Error('牌局或命令未结束，禁止更改计划绑定');
          if(rows.app_meta?.some(r=>r.id==='live'&&r.stage==='starting')&&LIVE.has(found.get(key('app_meta','live'))?.stage))throw Error('当前牌局未结束，禁止启动第二个记录局');
          for(const [n,list]of Object.entries(rows))for(const r of list){const old=found.get(key(n,r.id));
            if(n==='plans'){
              if(r.id!==r.plan_id||!['device_acceptance','formal_diagnostic','formal_freeplay','legacy_unclassified'].includes(r.purpose))throw Error('无效计划');
              if(!channelAllows(this.channel||'development_preview',r.purpose,this.testing)||r.storage_channel&&r.storage_channel!==this.channel)throw Error('计划与固定存储通道不匹配');
              if(old&&(old.purpose!==r.purpose||old.plan_id!==r.plan_id))throw Error('计划用途及ID不可修改');
              if(old&&['origin','provenance','created_at','plan_version','storage_channel','build_identity','protocol'].some(k=>canonical(old[k])!==canonical(r[k])))throw Error('计划来源及初始版本不可修改');
              if(r.purpose==='formal_freeplay'&&(canonical(r.protocol)!==canonical({id:FORMAL_FREEPLAY_PROTOCOL,version:1,questions:'not_asked'})||canonical(r.targets)!==canonical({completed:20,exchange:10,skip:10})))throw Error('正式自由对局协议不可变');
              if(old&&old.status!==r.status&&!['complete','archive'].includes(options.op))throw Error('生命周期变更必须使用专用事务');
              if(old&&old.status!==r.status&&!(options.op==='complete'&&old.status==='in_progress'&&r.status==='completed'||options.op==='archive'&&['in_progress','completed'].includes(old.status)&&r.status==='archived'))throw Error('非法计划状态转换');
              if(old&&(canonical(old.targets)!==canonical(r.targets)||old.policy!==r.policy))throw Error('计划统计门槛和采样口径不可修改');
              if(old?.status==='archived')throw Error('归档计划只读');
              if(this.testing&&r.provenance!=='automated_test')throw Error('测试资料来源必须标记自动化');
            }
            if(CHILDREN.includes(n)){
              const p=proposed('plans',r.plan_id);if(!p||!r.plan_id)throw Error('记录缺少明确计划');
              const lifecycle=n==='events'&&['plan_completed','plan_archived'].includes(r.kind)&&rows.plans?.some(x=>x.plan_id===r.plan_id)&&['complete','archive'].includes(options.op);
              if(['decisions','answers','events'].includes(n)&&!lifecycle&&!r.game_id)throw Error('牌局记录必须具有game_id');
              if(n==='answers'&&!r.decision_id)throw Error('回答必须具有decision_id');
              if(p.status!=='in_progress'&&!lifecycle)throw Error('计划已结束或归档，禁止写入');
              if(!this.testing&&p.purpose==='formal_diagnostic'&&!lifecycle)throw Error('旧问卷协议已退役，历史资料保留，请创建正式自由对局计划');
              if(old&&old.plan_id!==r.plan_id)throw Error('禁止迁移历史记录到其他计划');
              if(old&&['game_id','decision_id','provenance'].some(k=>canonical(old[k])!==canonical(r[k])))throw Error('历史父记录及来源不可修改');
              if(n==='games'&&old&&old.status!=='playing'&&canonical(old)!==canonical(r))throw Error('已结束对局只读');
              if(n==='games'&&old&&(old.engine_game!==r.engine_game&&!(options.op==='bind_start'&&old.record_status==='preparing'&&!old.engine_game)||old.exchange_enabled!==r.exchange_enabled))throw Error('对局引擎ID及开局模式不可修改');
              if(n==='games'&&old){for(const k of ['start_command','active_command','last_command']){const a=old[k],b=r[k];if(a?.intent&&a.id===b?.id&&['intent','fingerprint','payload'].some(f=>canonical(a[f])!==canonical(b[f])))throw Error('已保存命令内容不可改写');}
                if(old.active_command&&old.active_command.id!==r.active_command?.id&&!['ui_confirm','recover'].includes(options.op))throw Error('尚未确认命令不得被后续命令覆盖');
                if(old.result_checkpoint?.command_id===r.result_checkpoint?.command_id&&canonical(old.result_checkpoint)!==canonical(r.result_checkpoint))throw Error('同一命令已保存结果不可改写');}
              if(n==='games'&&r.start_command?.intent&&(canonical(r.configuration)!==canonical(r.start_command.intent.configuration)||r.exchange_enabled!==r.configuration.rules.exchange_enabled))throw Error('对局配置与命令快照不一致');
              if(n==='games'&&old?.configuration&&canonical(old.configuration)!==canonical(r.configuration))throw Error('新局配置快照不可修改');
              if(n==='games'&&old?.start_command?.intent&&['id','intent','fingerprint','payload'].some(k=>canonical(old.start_command[k])!==canonical(r.start_command?.[k])))throw Error('新局原始命令不可修改');
              if(n==='games'&&options.op==='cancel_start'&&(old?.start_command?.phase!=='intent'||old.start_command.dispatched_at||old.engine_game))throw Error('已派发或执行状态不明，禁止取消替代');
              if(n==='games'&&old?.command_ids&&(old.command_ids.some((v,i)=>r.command_ids?.[i]!==v)))throw Error('历史命令列表不可缩减或替换');
              if(n==='games'&&old?.record_status==='completed'&&canonical(old)!==canonical(r))throw Error('完整记录已关闭');
              if(this.testing&&r.provenance!=='automated_test')throw Error('测试记录不得冒充真人');
              if(r.game_id){const g=proposed('games',r.game_id);if(!g||g.plan_id!==r.plan_id)throw Error('局与计划归属冲突');}
              if(r.decision_id){const d=proposed('decisions',r.decision_id);if(!d||d.plan_id!==r.plan_id||d.game_id!==r.game_id)throw Error('决策父记录归属冲突');}
              if(n==='decisions'&&old&&canonical(old.snapshot)!==canonical(r.snapshot))throw Error('前态快照不可覆盖');
              if(n==='decisions'&&old&&old.teaching_evidence_version!==r.teaching_evidence_version)throw Error('教学记录版本不可改变');
              if(n==='decisions'&&old&&canonical(old.interaction)!==canonical(r.interaction))throw Error('历史提问语义不可覆盖');
              if(n==='decisions'&&old?.command?.id){
                if(['id','kind','worker_id','expected_revision','payload','intent','fingerprint'].some(k=>canonical(old.command[k])!==canonical(r.command?.[k])))throw Error('命令身份及前态不可覆盖');
                const rank={intent:0,dispatched:1,persisted:2,confirmed:3};
                if(rank[r.command?.phase]<rank[old.command.phase]&&!(options.op==='retry_unsent'&&old.command.phase==='dispatched'&&!old.command.worker_accepted&&r.command.phase==='intent'))throw Error('已执行命令不得退回或重发');
              }
              if(n==='decisions'&&old?.final_action&&canonical(old.final_action)!==canonical(r.final_action)&&options.op!=='retry_unsent')throw Error('已经提交的动作不可覆盖');
              if(n==='events'&&old&&canonical(old)!==canonical(r))throw Error('历史事件不可覆盖');
              if(n==='answers'&&old&&canonical(old)!==canonical(r))throw Error('原始回答不可覆盖');
            }
            if(n==='app_meta'&&r.record_type==='command_v2'){
              const g=proposed('games',r.game_id),p=proposed('plans',r.plan_id);if(!g||g.plan_id!==r.plan_id||p?.status!=='in_progress'||r.id!=='command:'+r.command?.id||!g.command_ids?.includes(r.command.id))throw Error('命令记录归属不匹配');
              if(this.testing&&r.provenance!=='automated_test')throw Error('测试命令不得冒充真人');
              if(old){if(['plan_id','game_id','decision_id','fingerprint','provenance'].some(k=>canonical(old[k])!==canonical(r[k]))||canonical(old.command.intent)!==canonical(r.command.intent)||canonical(old.ticket)!==canonical(r.ticket))throw Error('命令身份或配置不可覆盖');
                const rank={intent:0,dispatched:1,persisted:2,confirmed:3,needs_review:4,cancelled:5};
                if(!(r.phase in rank)||rank[r.phase]<rank[old.phase]&&!(options.op==='retry_unsent'&&old.phase==='dispatched'&&!old.result_persisted&&r.phase==='intent'))throw Error('命令状态不可回退');
                if(old.result_sha256&&old.result_sha256!==r.result_sha256)throw Error('已保存结果指纹不可改变');
              }
              if(r.fingerprint!==r.command.fingerprint||r.command.intent?.game_id!==r.game_id||r.command.intent?.plan_id!==r.plan_id||r.command.intent?.decision_id!==r.decision_id)throw Error('命令指纹归属不匹配');
            }
            if(n==='app_meta'&&r.id==='selection'&&r.plan_id){const p=proposed('plans',r.plan_id);if(!p||p.status!=='in_progress'||p.purpose==='legacy_unclassified')throw Error('该计划不能用于新对局');}
            if(n==='app_meta'&&r.id==='live'&&r.game_id){const g=proposed('games',r.game_id),preparing=r.stage==='starting'&&g?.record_status==='preparing'&&!g.engine_game&&g.start_ticket?.token===r.token;
              if(!g||g.plan_id!==r.plan_id||!preparing&&g.engine_game!==String(r.engine_game))throw Error('当前牌局绑定归属冲突');}
          }
          for(const [n,list]of Object.entries(rows))for(const r of list)tx.objectStore(n).put(copy(r));
        }catch(e){abort(e);}};
        pending=need.size;for(const [k,[n,v]]of need){const q=tx.objectStore(n).get(v);q.onsuccess=()=>{found.set(k,q.result);
          if(n==='app_meta'&&v==='live'&&q.result?.game_id&&!need.has(key('games',q.result.game_id))){const k2=key('games',q.result.game_id);need.set(k2,['games',q.result.game_id]);pending++;const g=tx.objectStore('games').get(q.result.game_id);g.onsuccess=()=>{found.set(k2,g.result);if(!--pending)finish();};g.onerror=()=>abort(g.error);}
          if(!--pending)finish();};q.onerror=()=>abort(q.error);}
      });}finally{this.timings.push({at:now(),ms:performance.now()-start,ok,operation:options.op||'record',records:Object.values(rows).reduce((n,a)=>n+a.length,0)});}}
  }
  // This readonly fence stabilizes only one snapshot; it cannot freeze old pages after release.
  // V1's cooperative Web Lock is deliberately NOT used as the safety proof.
  async function legacyFence(name,testing){
    if(testing&&!testName(name))throw Error('测试禁止访问真实旧库');
    if(!indexedDB.databases)throw Error('此浏览器无法安全预检旧库；未打开或创建源库');
    if(!(await indexedDB.databases()).some(d=>d.name===name))return null;
    const db=await new Promise((resolve,reject)=>{const q=indexedDB.open(name);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);q.onupgradeneeded=()=>{q.transaction.abort();reject(Error('源库状态改变，请重新预检'));};});
    if(db.version!==1||LEGACY_STORES.some(n=>!db.objectStoreNames.contains(n))){db.close();throw Error('旧库结构不是受支持的v1；源库保持不变');}
    const tx=db.transaction(LEGACY_STORES,'readonly'),tasks=[];let active=true,releasing=false,onLost=()=>{};
    let finish;const finished=new Promise(r=>finish=r);
    const end=()=>{active=false;clearTimeout(timer);db.close();if(!releasing)onLost();finish();};
    tx.oncomplete=end;tx.onabort=end;tx.onerror=()=>{};
    const timer=setTimeout(()=>{if(active){onLost();tx.abort();}},20000);
    const pump=()=>{const q=tx.objectStore('sessions').count();q.onsuccess=()=>{for(const task of tasks.splice(0))task();if(!releasing)pump();};};pump();
    const read=()=>new Promise((resolve,reject)=>{if(!active)return reject(Error('源库只读屏障已结束'));tasks.push(()=>{
      const out={};let pending=LEGACY_STORES.length;for(const n of LEGACY_STORES){const q=tx.objectStore(n).getAll();q.onerror=()=>reject(q.error);q.onsuccess=()=>{out[n]=q.result;if(!--pending)resolve(out);};}
    });});
    return {read,get active(){return active;},onLost:fn=>onLost=fn,release:async()=>{releasing=true;await finished;}};
  }
  function legacyBundle(data,sourceName,sourceHash,source){
    const plans=[],records=[],mapping=[],bySession=new Map(),gameMap=new Map(data.games.map(g=>[g.id,g])),decisionMap=new Map(data.decisions.map(d=>[d.id,d]));
    const stamp=now(),prefix='legacy:'+sourceHash.slice(0,20)+':';
    for(const s of data.sessions){const pid=prefix+s.id;bySession.set(s.id,pid);plans.push({id:pid,plan_id:pid,purpose:'legacy_unclassified',status:'archived',created_at:s.created_at||stamp,updated_at:stamp,
      plan_version:2,origin:'legacy_copy',provenance:source,next_seq:0,legacy_source:{database:sourceName,session_id:s.id,fingerprint:sourceHash}});}
    const quarantine=prefix+'unresolved';
    for(const store of LEGACY_STORES)for(const raw of data[store]){
      const candidates=new Set(),reasons=[];const add=s=>{if(s&&bySession.has(s))candidates.add(s);else if(s)reasons.push('missing_session:'+s);};
      if(store==='sessions')add(raw.id);else add(raw.session_id);
      if(raw.game_id){const g=gameMap.get(raw.game_id);if(g)add(g.session_id);else reasons.push('missing_game');}
      if(raw.decision_id){const d=decisionMap.get(raw.decision_id);if(d){add(d.session_id);if(raw.game_id&&d.game_id!==raw.game_id)reasons.push('decision_game_conflict');}else reasons.push('missing_decision');}
      if(candidates.size!==1)reasons.push(candidates.size?'conflicting_plan_paths':'no_parent_plan');
      const pid=reasons.length?quarantine:bySession.get([...candidates][0]),rid=prefix+store+':'+raw.id;
      records.push({id:rid,plan_id:pid,source_store:store,source_id:raw.id,raw_record:copy(raw),anomaly_reasons:reasons,
        origin:'legacy_copy',provenance:source});mapping.push({source_store:store,source_id:raw.id,target_id:rid,plan_id:pid});
    }
    if(records.some(r=>r.plan_id===quarantine))plans.push({id:quarantine,plan_id:quarantine,purpose:'legacy_unclassified',status:'archived',created_at:stamp,updated_at:stamp,plan_version:2,origin:'legacy_copy',provenance:source,next_seq:0});
    return {plans,records,mapping};
  }
  class LegacyMigration{
    constructor(target,sourceName,source){this.target=target;this.sourceName=sourceName;this.source=source;}
    async preflight(){const fence=await legacyFence(this.sourceName,this.target.testing);if(!fence)return {source_exists:false,counts:{},confirmation_required:false};
      try{const data=await fence.read(),fingerprint=await digest(data),counts=Object.fromEntries(LEGACY_STORES.map(n=>[n,data[n].length]));
        const previous=await this.target.get('migrations','copy:'+this.sourceName);
        if(previous)return {source_exists:true,already_migrated:true,source_changed:previous.source_fingerprint!==fingerprint,counts,previous};
        this.preview={id:id(),at:Date.now(),source_exists:true,source_name:this.sourceName,fingerprint,counts,confirmation_required:true};return copy(this.preview);
      }finally{await fence.release();}}
    async migrate(token,confirmed,faultStage=null){
      if(!this.target.testing)throw Error('真实旧库仅允许只读预检；本轮禁止复制迁移，旧页面仍可能续写。需单独授权安全交接方案');
      if(!confirmed||!this.preview||token!==this.preview.id)throw Error('必须先预检并由本人明确确认迁移');
      if(Date.now()-this.preview.at>600000)throw Error('预检已过期，请重新预检');
      if(!this.target.lockHeld)throw Error('未持有新版写锁');if(faultStage&&!this.target.testing)throw Error('生产环境不允许故障注入');
      const previous=await this.target.get('migrations','copy:'+this.sourceName);if(previous)return previous;
      const lease=await this.target.migrationGate();let fence;
      try{fence=await legacyFence(this.sourceName,this.target.testing);if(!fence)throw Error('源库已改变，未进行迁移');}catch(e){await this.target.migrationGate(lease);throw e;}
      let tx;fence.onLost(()=>{try{tx?.abort();}catch{}});
      try{const original=await fence.read(),fingerprint=await digest(original);if(fingerprint!==this.preview.fingerprint)throw Error('预检后旧资料发生变化，请重新确认');
        // V1 records are JSON-shaped. Refuse exotic/cyclic values rather than silently normalizing raw history.
        const seen=new Set(),jsonSafe=x=>{if(x===null||['string','boolean'].includes(typeof x))return true;if(typeof x==='number')return Number.isFinite(x);
          if(typeof x!=='object'||seen.has(x)||!Array.isArray(x)&&Object.getPrototypeOf(x)!==Object.prototype)return false;
          seen.add(x);const ok=Object.values(x).every(jsonSafe);seen.delete(x);return ok;};
        if(!jsonSafe(original))throw Error('旧资料不是无损可导出的JSON结构，源库保留；暂停复制');
        // Never import a forbidden engine object into a new database, even as legacy data.
        const forbidden=x=>x&&typeof x==='object'&&Object.entries(x).some(([k,v])=>['seed','deck','rng','future_wall','ai_inference','opponent_hand'].includes(k)||forbidden(v));
        if(forbidden(original))throw Error('旧资料含禁存字段，源库保留；暂停复制，需独立审查');
        const bundle=legacyBundle(original,this.sourceName,fingerprint,this.source),counts=this.preview.counts;
        const report={id:'copy:'+this.sourceName,source_name:this.sourceName,status:'completed',at:now(),source_fingerprint:fingerprint,source_counts:counts,
          copied_counts:Object.fromEntries(LEGACY_STORES.map(n=>[n,bundle.records.filter(r=>r.source_store===n).length])),mapping:bundle.mapping,
          source_readonly_barrier:true,source_unchanged:true,target_records:bundle.records.length};
        const start=performance.now();await new Promise((resolve,reject)=>{
          tx=this.target.db.transaction(['plans','legacy_quarantine','migrations','app_meta'],'readwrite');let reason;
          const abort=stage=>{reason=Error('Injected migration abort: '+stage);tx.abort();};
          tx.oncomplete=resolve;tx.onabort=()=>reject(reason||tx.error||Error('迁移事务已完整回滚'));tx.onerror=()=>{};
          const gateRequest=tx.objectStore('app_meta').get('recording_gate');gateRequest.onsuccess=()=>{
          if(this.target.db.version!==2||gateRequest.result?.protocol!==RECORD_PROTOCOL||gateRequest.result?.state!=='migration'||gateRequest.result?.lease!==lease){reason=Error('迁移事务执行时闸门或版本失效');tx.abort();return;}
          if(!fence.active){reason=Error('只读屏障失效');tx.abort();return;}
          if(faultStage==='first'){abort('first');return;}
          for(const p of bundle.plans)tx.objectStore('plans').add(p);
          for(let i=0;i<bundle.records.length;i++){tx.objectStore('legacy_quarantine').add(bundle.records[i]);if(faultStage==='middle'&&i===Math.floor(bundle.records.length/2)){abort('middle');return;}}
          if(faultStage==='middle'){abort('middle');return;}
          let remaining=bundle.plans.length+bundle.records.length;
          const verify=(name,row)=>{const q=tx.objectStore(name).get(row.id);q.onsuccess=()=>{
            if(canonical(q.result)!==canonical(row)){reason=Error('迁移读回校验不一致');tx.abort();return;}
            if(!--remaining){
              if(faultStage==='verify'){abort('verify');return;}
              if(!fence.active||!this.target.lockHeld){reason=Error('源库屏障或新版写锁失效');tx.abort();return;}
              if(faultStage==='marker'){abort('marker');return;}
              tx.objectStore('migrations').add(report);
            }
          };};
          for(const p of bundle.plans)verify('plans',p);for(const r of bundle.records)verify('legacy_quarantine',r);
          if(!remaining){if(faultStage==='marker'||faultStage==='verify')abort(faultStage);else tx.objectStore('migrations').add(report);}
          };
        });
        report.duration_ms=performance.now()-start;
        if(await digest(await fence.read())!==fingerprint)throw Error('源库指纹异常，暂停启用迁移结果');
        return report;
      }finally{await fence.release();await this.target.migrationGate(lease);}}
  }
  class Controller{
    constructor(options={}){
      this.testing=options.source==='automated_test';
      this.channel=options.channel||globalThis.__mahjongBuild?.storage_channel||'development_preview';
      if(!CHANNELS[this.channel])throw Error('未知存储通道');
      if(!this.testing&&options.database)throw Error('非测试页面禁止自选数据库');
      this.db=new Database(options.database||CHANNELS[this.channel],this.testing);
      this.db.channel=this.channel;
      this.source=this.testing?'automated_test':this.channel==='development_preview'?'development_preview':'human_self_report';
      this.legacyName=options.legacyDatabase||(this.testing?'chengdu-mahjong-p1a-study-v1-automation':'chengdu-mahjong-p1a-study-v1');
      if(this.testing&&!testName(this.legacyName))throw Error('测试禁止访问真实旧库');
      this.data=Object.fromEntries(STORES.map(n=>[n,[]]));this.tail=Promise.resolve();this.owner=id();
      this.gameId=null;this.decisionId=null;this.selectedPlanId=null;this.viewPlanId=null;
      this.presentation=new Set();this.hooks={};this.status='未选择计划';this.available=false;this.formOpen=false;
      this.commandRecoveries=new Map();this.pendingWrites=new Map();this.readOnlyView=false;
      this.helpInFlight=0;
      this.migration=new LegacyMigration(this.db,this.legacyName,this.testing?'automated_test':'unknown_legacy');
    }
    queue(fn){const p=this.tail.catch(()=>{}).then(fn);this.tail=p;return p;}
    get plan(){return this.data.plans.find(p=>p.plan_id===this.selectedPlanId);}
    get session(){return this.plan;} // UI compatibility only; never used to assign historical ownership.
    get game(){return this.data.games.find(g=>g.id===this.gameId);}
    get decision(){return this.data.decisions.find(d=>d.id===this.decisionId);}
    context(d=this.decision){return d?{plan_id:d.plan_id,game_id:d.game_id,decision_id:d.id,information_key:d.information_key}:null;}
    firstAnswer(d=this.decision){return this.data.answers.find(a=>a.decision_id===d?.id&&a.plan_id===d?.plan_id&&a.revision===0);}
    // A single product flow. Legacy questionnaire code stays readable for rollback, with no UI entry.
    questionsRequired(){return false;}
    locked(){return this.questionsRequired()&&!!(this.game?.status==='playing'&&this.decision?.tags.length&&!this.firstAnswer());}
    apply(rows){for(const [n,list]of Object.entries(rows))for(const r of list){const i=this.data[n].findIndex(x=>x.id===r.id);if(i<0)this.data[n].push(copy(r));else this.data[n][i]=copy(r);}
      this.selectedPlanId=this.data.app_meta.find(x=>x.id==='selection')?.plan_id||null;}
    async loadPlan(pid){if(pid)this.apply(await this.db.readPlan(pid));}
    async commit(rows,options={}){
      if(this.failed)throw Error('先处理待恢复的保存失败');this.status='待保存';this.paint();
      const job={id:id(),rows:copy(rows),options:copy(options),plan_ids:[...new Set(Object.values(rows).flat().map(r=>r.plan_id).filter(Boolean))]};
      this.pendingWrites.set(job.id,job);this.pendingRows=job;
      try{await this.db.write(job.rows,job.options);this.apply(job.rows);this.pendingWrites.delete(job.id);this.pendingRows=[...this.pendingWrites.values()][0]||null;this.status=this.commandRecoveries.size?'命令尚待确认':'已保存';}
      catch(e){this.failed=String(e.message||e);this.recordState='failed';job.error_reason=this.failed;this.status='保存失败，采集已暂停';throw e;}finally{this.paint();}
    }
    rememberResult(ticket,state){this.checkTicket(ticket.command,ticket);const key=ticket.command.id,previous=this.commandRecoveries.get(key);
      if(previous&&canonical(previous.state)!==canonical(state))throw Error('同一命令出现不同结果，须人工核验');
      const context={ticket:copy(ticket),state:this.publicResult(state),stage:'executed_waiting_save',execution_known:true,persisted:false,received_at:previous?.received_at||now()};this.commandRecoveries.set(key,context);this.recoveryState=context;return context;}
    markResultSaved(cid){const c=this.commandRecoveries.get(cid);if(c){c.stage='persisted_waiting_presentation';c.persisted=true;}}
    forgetResult(cid){this.commandRecoveries.delete(cid);if(this.recoveryState?.ticket.command.id===cid)this.recoveryState=[...this.commandRecoveries.values()][0]||null;if(!this.commandRecoveries.size&&!this.pendingWrites.size&&!this.failed&&!this.interruption)this.status='已保存';}
    checkTicket(command,ticket){const i=command.intent;if(ticket.untracked){if(i?.plan_id)throw Error('正式命令不得改成不记录模式');return;}if(i&&(i.game_id!==ticket.game_id||i.plan_id!==(ticket.plan_id||null)||i.decision_id!==(ticket.id||ticket.decision_id||null)))throw Error('命令票据与冻结的牌局/计划/决策ID不一致');}
    ledger(command,ticket,phase,extra={}){return {id:'command:'+command.id,record_type:'command_v2',plan_id:ticket.plan_id,game_id:ticket.game_id,decision_id:ticket.id||ticket.decision_id||null,
      command:copy(command),fingerprint:command.fingerprint,phase,ticket:copy(Object.fromEntries(Object.entries(ticket).filter(([k])=>k!=='command'))),provenance:this.source,...extra};}
    async seal(command,ctx,s){if(s?._recording_protocol?.version<2)return command;
      const cfg=ctx.configuration||this.game?.configuration||{ai:s.ai||'initial',rules:copy(s.rules)};
      command.intent={version:2,command_id:command.id,kind:command.kind,game_id:ctx.game_id,plan_id:ctx.plan_id||null,decision_id:ctx.decision_id||null,
        worker_id:command.worker_id,expected_revision:command.expected_revision,created_at:command.created_at,exchange_enabled:cfg.rules.exchange_enabled,
        configuration:copy(cfg),payload:copy(command.payload),app_version:APP,record_protocol:RECORD_PROTOCOL,rules_baseline:'P0.2-frozen+p04-opening'};command.fingerprint=await digest(command.intent);command.protocol=2;const freeze=x=>{if(x&&typeof x==='object'&&!Object.isFrozen(x)){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};return freeze(command);}
    publicResult(state){const keys=new Set(['stage','rules','ai','game_id','wall','table','public_table','winners','history','daque_suggestion','pending','error','exchange','risk_model','divergence','you','opponents','decisions','stepped','_recording_protocol','_receipt','_build_identity']);
      if(Object.keys(state).some(k=>!keys.has(k)))throw Error('结果包含未审核字段，暂停保存');
      const forbidden=x=>x&&typeof x==='object'&&Object.entries(x).some(([k,v])=>['seed','deck','rng','future_wall','opponent_hand'].includes(k)||forbidden(v));
      if(forbidden(state)||(state.opponents||[]).some(p=>p.hand))throw Error('结果包含禁止记录的隐藏字段');return copy(state);}
    async checkpoint(command,ticket,state){this.checkTicket(command,ticket);const result=this.publicResult(state);return {command_id:command.id,fingerprint:command.fingerprint,sha256:await digest(result),result,ticket:copy({...ticket,command}),at:now()};}
    async storedResult(ticket){const rec=await this.db.get('app_meta','command:'+ticket.command.id),g=await this.db.get('games',ticket.game_id),checkpoint=g?.result_checkpoint;
      const state=rec?.result||(checkpoint?.command_id===ticket.command.id?checkpoint.result:null),hash=rec?.result_sha256||(checkpoint?.command_id===ticket.command.id?checkpoint.sha256:null);
      if(!state||await digest(state)!==hash||rec?.fingerprint!==ticket.command.fingerprint)throw Error('已保存结果缺失或指纹不符，须人工核验');this.receipt(ticket.command,state);return copy(state);}
    live(){return this.data.app_meta.find(x=>x.id==='live');}
    assertIdle(){if(this.helpInFlight||this.inFlight||this.recoveryState||this.commandRecoveries.size||this.game?.active_command||this.game?.terminal_pending||this.starting||this.failed||this.pendingRows||this.unsavedBackup||this.formOpen||!this.readOnlyView&&LIVE.has(this.hooks.state?.()?.stage)||LIVE.has(this.live()?.stage))throw Error('牌局或命令进行中或有待恢复记录，不能切换、结束、归档或迁移');}
    async eventBundle(ctx,kind,detail={}){
      const p=await this.db.get('plans',ctx.plan_id);if(!p||p.status!=='in_progress')throw Error('计划已结束或归档');
      const e={id:id(),...copy(ctx),kind,detail:copy(detail),at:now(),seq:p.next_seq+1,provenance:this.source};
      return {event:e,plan:{...p,next_seq:e.seq,updated_at:e.at}};
    }
    async event(kind,detail={},context=this.context()){
      const captured=typeof context==='string'?context:context&&copy(context);if(!captured)return;
      return this.queue(async()=>{
        const d=typeof captured==='string'?await this.db.get('decisions',captured):await this.db.get('decisions',captured.decision_id);
        if(!d||d.id!==this.decisionId||d.status!=='pending'||d.game_id!==this.gameId)return {ignored:true,reason:'stale_context'};
        const ctx=this.context(d);if(typeof captured!=='string'&&captured.plan_id!==ctx.plan_id)throw Error('事件归属冲突');
        const b=await this.eventBundle(ctx,kind,detail);await this.commit({events:[b.event],plans:[b.plan]});return b.event;
      });
    }
    async init(){try{
      await this.db.open();this.apply(await this.db.boot());this.available=true;
      if(!this.testing&&this.channel==='formal_learning'&&!formalFreeplayBuildReady(globalThis.__mahjongBuild)){this.status='候选构建未提交或未批准：正式档案只读，禁止开始20局';return;}
      if(!navigator.locks){this.status='记录不可用：浏览器不支持写入锁';return;}
      let ready;const acquired=new Promise(r=>ready=r);
      this.lockTask=navigator.locks.request(this.db.name,{ifAvailable:true},async lock=>{
        this.writer=!!lock;this.db.lockHeld=!!lock;ready();if(lock)try{await new Promise(r=>this.releaseLock=r);}finally{this.writer=false;this.db.lockHeld=false;}
      });await acquired;
      if(!this.writer){this.status='此标签只读：其他标签正在记录';return;}
      await this.db.ensureGate();this.apply(await this.db.boot());
      // Only the durable live binding is recovered; no source V1 database is opened here.
      const live=this.live(),gid=live?.game_id||this.data.app_meta.find(x=>x.id==='presentation')?.game_id,bound=gid?await this.db.get('games',gid):null;
      let saved=null;if(bound?.result_checkpoint){const cp=bound.result_checkpoint;
        if(await digest(cp.result)!==cp.sha256)throw Error('已保存结果内容校验失败，禁止恢复');saved=copy(cp);}
      const terminal=saved&&bound?.terminal_pending&&saved.result.stage==='over'&&bound.status==='playing';
      if(terminal){await this.loadPlan(bound.plan_id);this.gameId=bound.id;this.decisionId=saved.ticket.id||null;this.recordState='recording';this.readOnlyView=true;
        this.restoredPresentation={...saved,terminal:true};this.rememberResult(saved.ticket,saved.result);this.markResultSaved(saved.ticket.command.id);this.interruption='结算已保存，等待重新呈现并确认；不会重新执行原Worker';}
      else if(live&&(LIVE.has(live.stage)||bound?.status==='playing'||bound?.terminal_pending)){
        const rows={app_meta:[{id:'live',stage:'none',plan_id:null,game_id:null}]};
        if(live.interrupted_game){const old=await this.db.get('games',live.interrupted_game);if(old){await this.loadPlan(old.plan_id);this.recordState='interrupted';this.interruption=old.error_reason||'前次采集异常中断，未恢复原牌局';}}
        if(bound?.status==='playing'){await this.loadPlan(bound.plan_id);rows.games=[{...bound,status:'incomplete',record_status:'interrupted',integrity:'unverified',error_reason:saved?'原Worker已重建；已保存局面仅供只读查看，不能继续原局':'页面或Worker重开，未完成命令的结果不能确认',ended_at:now(),end_reason:'page_or_worker_reopened',missing_triggers:this.missing(bound),active_command:null,interrupted_command:bound.active_command||null}];
          const command=bound.active_command||bound.start_command;if(command?.intent){const rec=await this.db.get('app_meta','command:'+command.id);
            if(rec&&['intent','dispatched'].includes(rec.phase))rows.app_meta.push({...rec,phase:'needs_review',command:{...rec.command,phase:'needs_review'},error_reason:'页面或Worker重建，后续结果不明，禁止自动重发'});}
        }
        await this.commit(rows,{op:'recover'});if(rows.games?.length){this.recordState='interrupted';this.interruption=rows.games[0].error_reason;}
      }
      if(saved&&!terminal){this.restoredPresentation={...saved,terminal:saved.result.stage==='over',readonly:true};this.readOnlyView=true;}
      await this.loadPlan(this.selectedPlanId);this.viewPlanId=this.selectedPlanId;this.status=terminal?'结算已保存，待重新呈现确认':this.interruption?'旧局已中断，不能恢复原Worker或计为有效样本':this.plan?'已保存':'未选择计划';
    }catch(e){this.available=false;this.status='记录不可用：'+String(e.message||e);}finally{this.paint();}}
    async createPlan(purpose,title=''){
      if(!this.available||!this.writer)throw Error('当前不能写入学习档案');
      if(!['device_acceptance','formal_freeplay',...(this.testing?['formal_diagnostic']:[])].includes(purpose))throw Error('请选择设备验收或正式自由对局；旧问卷计划仅保留历史读取');
      if(!channelAllows(this.channel,purpose,this.testing))throw Error('当前存储通道不允许此计划用途');
      if(!this.testing&&this.channel==='formal_learning'&&!formalFreeplayBuildReady(globalThis.__mahjongBuild))throw Error('正式20局需要已提交、已批准且核实的构建');
      return this.queue(async()=>{
        const pid=id(),p={id:pid,plan_id:pid,purpose,status:'in_progress',title:String(title),created_at:now(),updated_at:now(),plan_version:2,
          origin:'new',schema:VERSION,app:APP,provenance:this.source,policy:'response-or-24',next_seq:0,
          storage_channel:this.channel,build_identity:copy(globalThis.__mahjongBuild||{verified:false,app_release:APP}),
          targets:purpose==='formal_diagnostic'?{exchange:10,skip:10,independent:60,math_checkable:20}:purpose==='formal_freeplay'?{completed:20,exchange:10,skip:10}:null,
          ...(purpose==='formal_freeplay'?{protocol:{id:FORMAL_FREEPLAY_PROTOCOL,version:1,questions:'not_asked'}}:{})};
        await this.commit({plans:[p]},{op:'create'});this.viewPlanId=pid;return p;
      });
    }
    async ensureFreeplayPlan(){
      if(this.plan)return this.plan;
      if(this.defaultPlanTask)return this.defaultPlanTask;
      this.defaultPlanTask=(async()=>{
        this.assertIdle();if(!this.available||!this.writer)throw Error('自动记录不可用，未开始对局；请先恢复记录');
        if(this.channel==='formal_learning')throw Error('自由对局不自动创建或批准正式20局计划');
        let p=this.data.plans.find(p=>p.purpose==='device_acceptance'&&p.status==='in_progress'&&p.title==='自由对局 · 自动记录'&&p.provenance===this.source);
        if(!p)p=await this.createPlan('device_acceptance','自由对局 · 自动记录');
        await this.switchPlan(p.plan_id);return p;
      })();
      try{return await this.defaultPlanTask;}finally{this.defaultPlanTask=null;}
    }
    async switchPlan(pid){this.assertIdle();return this.queue(async()=>{this.assertIdle();const p=await this.db.get('plans',pid);
      if(!p||p.status!=='in_progress'||p.purpose==='legacy_unclassified'||!this.testing&&p.purpose==='formal_diagnostic')throw Error('计划只读或不存在');
      await this.commit({app_meta:[{id:'selection',plan_id:pid}]},{op:'switch'});await this.loadPlan(pid);this.viewPlanId=pid;this.paint();});}
    async closePlan(pid,archive=false){this.assertIdle();return this.queue(async()=>{this.assertIdle();const p=await this.db.get('plans',pid);if(!p||p.status==='archived')throw Error('计划已归档或不存在');
      const ctx={plan_id:pid,game_id:null,decision_id:null},stamp=now();
      const e={id:id(),...ctx,seq:p.next_seq+1,at:stamp,kind:archive?'plan_archived':'plan_completed',detail:{},provenance:this.source};
      const rows={plans:[{...p,status:archive?'archived':'completed',updated_at:stamp,next_seq:e.seq}],events:[e]};
      if(this.selectedPlanId===pid)rows.app_meta=[{id:'selection',plan_id:null}];await this.commit(rows,{op:archive?'archive':'complete'});this.paint();});}
    command(kind,s,payload={}){const p=s?._recording_protocol;if(![1,2].includes(p?.version)||typeof p.worker_id!=='string'||!Number.isInteger(p.revision))throw Error('当前计算端缺少可靠命令协议，请刷新到同版本；暂停正式记录');
      return {id:id(),kind,worker_id:p.worker_id,expected_revision:p.revision,created_at:now(),phase:'intent',intent_created:true,worker_accepted:null,persisted:false,ui_confirmed:false,payload:copy(payload)};}
    descriptor(command){return {id:command.id,worker_id:command.worker_id,expected_revision:command.expected_revision,...(command.protocol===2?{protocol:2,fingerprint:command.fingerprint,intent:copy(command.intent)}:{})};}
    receipt(command,s){const r=s?._receipt,p=s?._recording_protocol;
      if(!r||!p||r.command_id!==command.id||r.kind!==command.kind||r.worker_id!==command.worker_id||r.expected_revision!==command.expected_revision||r.revision!==command.expected_revision+1||p.revision!==r.revision||p.worker_id!==r.worker_id||!r.accepted||r.engine_game!==s.game_id)throw Error('动作回执不匹配，暂停采集，禁止重发动作');
      if(command.protocol===2&&(r.fingerprint!==command.fingerprint||canonical(r.intent)!==canonical(command.intent)||canonical(r.actual_configuration)!==canonical(command.intent.configuration)||canonical({ai:s.ai,rules:s.rules})!==canonical(command.intent.configuration)))throw Error('实际配置与原始命令指纹不一致，暂停采集');return copy(r);}
    bind(){const live=this.live();if(live?.game_id){const g=this.data.games.find(g=>g.id===live.game_id&&g.plan_id===live.plan_id);if(g)this.gameId=g.id;}
      if(this.game&&!this.decisionId){const d=this.data.decisions.filter(d=>d.game_id===this.gameId&&['pending','submitting'].includes(d.status)).sort((a,b)=>b.ordinal-a.ordinal)[0];this.decisionId=d?.id||null;}}
    async prepareStart(s,config){if(!this.available||!this.writer){if(this.selectedPlanId)throw Error('学习计划当前不可记录；禁止静默开局');return {untracked:true};}return this.queue(async()=>{
      if(this.plan&&!this.testing&&(!channelAllows(this.channel,this.plan.purpose)||this.channel==='formal_learning'&&(!formalFreeplayBuildReady(globalThis.__mahjongBuild)||globalThis.__mahjongBuild.build_id!==s?._build_identity?.build_id)))throw Error('存储通道或正式构建批准/Worker身份不一致，暂停采集');
      if(this.failed||this.pendingRows||this.unsavedBackup||this.commandRecoveries.size||this.recoveryState||this.game?.active_command||this.game?.terminal_pending)throw Error('请先处理待恢复记录和未确认命令');
      const prepared=this.game;if(prepared?.record_status==='preparing'&&prepared.start_command?.phase==='intent')return copy(prepared.start_ticket);
      if(this.starting||this.plan&&(LIVE.has(s?.stage)||LIVE.has(this.live()?.stage)))throw Error('当前牌局未结束，不能另开记录局');
      const p=this.plan;if(p&&(p.status!=='in_progress'||p.purpose==='legacy_unclassified'))throw Error('当前计划只读');
      if(p&&!this.testing&&s?._recording_protocol?.version!==2)throw Error('计算端缺少可靠命令协议；正式记录不能使用旧端');
      const payload={ai:config?.ai??'initial',exchange_enabled:config?.exchange_enabled??(s?._recording_protocol?true:s?.rules?.exchange_enabled??false),...(config?.exchange_direction!==undefined?{exchange_direction:config.exchange_direction}:{})};
      if(typeof payload.ai!=='string'||!payload.ai||typeof payload.exchange_enabled!=='boolean')throw Error('无效的新局配置，未建立命令');
      const ticket={token:id(),plan_id:p?.plan_id||null,game_id:id(),kind:'new',untracked:!p};
      const configuration={ai:payload.ai,rules:{version:'p04-opening-v1',exchange_enabled:payload.exchange_enabled}};
      const command=s?._recording_protocol?await this.seal(this.command('new',s,payload),{...ticket,configuration},s):null;ticket.command=command;this.starting=true;
      const rows={app_meta:[{id:'live',stage:'starting',plan_id:ticket.plan_id,game_id:p?ticket.game_id:null,token:ticket.token}]};
      if(p){this.gameId=ticket.game_id;this.decisionId=null;this.recordState='preparing';rows.games=[{id:ticket.game_id,plan_id:p.plan_id,engine_game:null,exchange_enabled:payload.exchange_enabled,configuration,
        started_at:now(),status:'playing',record_status:'preparing',record_protocol:command?RECORD_PROTOCOL:null,integrity:'unverified',triggered:{},provenance:this.source,start_command:command,start_ticket:copy(ticket),command_ids:command?.intent?[command.id]:[]}];
        if(command?.intent)rows.app_meta.push(this.ledger(command,ticket,'intent'));}
      try{await this.commit(rows,{op:'prepare_start'});return ticket;}
      catch(e){this.starting=false;throw e;}
    });}
    async start(s,ticket){try{
      if(!this.available||!this.writer)return;
      await this.queue(async()=>{
        if(!ticket||this.live()?.token!==ticket.token)throw Error('新局绑定已过期');
        const rows={};let g=null;if(ticket.plan_id){g=await this.db.get('games',ticket.game_id);if(!g||g.plan_id!==ticket.plan_id||g.record_status!=='preparing')throw Error('新局准备记录不匹配');
          if(ticket.command&&(g.start_command?.id!==ticket.command.id||g.start_command?.phase!=='dispatched'))throw Error('新局命令未持久化发送状态');
          const proof=ticket.command?this.receipt(ticket.command,s):null;
          g={...g,engine_game:String(s.game_id),record_status:'recording',exchange_enabled:s.rules.exchange_enabled,worker_id:proof?.worker_id||null,worker_revision:proof?.revision??null,
            start_command:proof?{...g.start_command,phase:'persisted',worker_accepted:true,persisted:true,receipt:proof}:null};
          if(ticket.command?.intent)g.result_checkpoint=await this.checkpoint(ticket.command,ticket,s);rows.games=[g];}
        rows.app_meta=[{id:'live',stage:s.stage,engine_game:String(s.game_id),plan_id:ticket.plan_id,game_id:g?.id||null}];
        if(g?.result_checkpoint){const q=g.result_checkpoint;rows.app_meta.push(this.ledger(g.start_command,ticket,'persisted',{result:q.result,result_sha256:q.sha256,result_persisted:true}),{id:'presentation',plan_id:g.plan_id,game_id:g.id,command_id:ticket.command.id});}
        await this.commit(rows,{op:'bind_start'});this.markResultSaved(ticket.command?.id);this.gameId=g?.id||null;this.decisionId=null;this.interruption=null;this.recordState=g?'recording':null;this.untrackedGame=g?null:s.game_id;this.presentation.clear();this.readOnlyView=false;this.restoredPresentation=null;this.untrackedRecordGameId=ticket.game_id;
      });await this.observe(s);
    }finally{this.starting=false;}}
    missing(g){return ['exchange','daque','clear','middle','response'].filter(k=>(g.exchange_enabled||k!=='exchange')&&!g.triggered[k]);}
    async observe(s){if(!this.writer||this.failed||!s)return;return this.queue(async()=>{
      const g=this.game,live=this.live();
      if(live?.engine_game&&s.game_id&&live.engine_game!==String(s.game_id))return {ignored:true,reason:'stale_engine_state'};
      if(g?.status==='playing'&&g.engine_game===String(s.game_id))await this.visibleFacts(s,g);
      if(s.stage==='over'){
        const rows={app_meta:[{id:'live',stage:'over',plan_id:g?.plan_id||null,game_id:g?.id||null,engine_game:s.game_id}]};
        if(g?.status==='playing'&&g.engine_game===String(s.game_id))rows.games=[{...g,status:s.error?'incomplete':g.record_protocol?'playing':'completed',record_status:s.error?'interrupted':g.record_protocol?'recording':'completed',terminal_pending:!!g.record_protocol&&!s.error,integrity:s.error?'unverified':g.integrity,ended_at:now(),end_reason:s.error?'engine_error':'normal_terminal',missing_triggers:this.missing(g),
          terminal:{history_count:s.history.length,winners:[...s.winners],scores:[s.you,...s.opponents].map(p=>({seat:p.id,score:p.score})),settlement:publicSettlement(s)}}];
        if(LIVE.has(live?.stage)||rows.games)await this.commit(rows);this.decisionId=null;return;
      }
      if(!g||g.status!=='playing'||g.engine_game!==String(s.game_id)){
        if(LIVE.has(s.stage)&&(!live||live.engine_game!==String(s.game_id)))await this.commit({app_meta:[{id:'live',stage:s.stage,engine_game:String(s.game_id),plan_id:null,game_id:null}]});return;
      }
      if(!s.pending&&!['choose_exchange','choose_daque'].includes(s.stage))return;
      const v=snapshot(s),key=canonical(v);if(this.decision?.key===key)return;
      const p=await this.db.get('plans',g.plan_id),tags=triggers(v,g.triggered,p.policy),d={id:id(),plan_id:g.plan_id,game_id:g.id,at:now(),key,information_key:informationKey(v),
        ordinal:this.data.decisions.filter(d=>d.game_id===g.id).length+1,snapshot:v,tags,status:'pending',final_action:null,provenance:this.source,teaching_evidence_version:HELP_VERSION,interaction:freeplay()};
      const used={...g.triggered};for(const tag of tags)used[tag==='late'?'response':tag]=d.id;
      const b=await this.eventBundle(this.context(d),'decision_opened',{auto_coach_enabled:!!this.hooks.coach?.()});
      await this.commit({decisions:[d],games:[{...g,triggered:used}],events:[b.event],plans:[b.plan]});this.decisionId=d.id;
    });}
    async prepare(body,s){if(this.helpInFlight)throw Error('教学留证处理中，暂不能提交动作');if(this.readOnlyView)throw Error('已保存局面仅供查看，原Worker未恢复，请新开局');if(this.failed||this.pendingRows||this.recoveryState||this.commandRecoveries.size)throw Error('记录待恢复，禁止继续动作');
      if(!this.game||this.game.status!=='playing'){if(this.selectedPlanId&&this.untrackedGame!==s?.game_id)throw Error('学习局绑定缺失，禁止静默跳过记录');return {untracked:true,kind:'act',command:s?._recording_protocol?await this.seal(this.command('act',s,body),{game_id:this.untrackedRecordGameId||(this.untrackedRecordGameId=id()),plan_id:null},s):null};}
      await this.observe(s);return this.queue(async()=>{if(this.failed)throw Error('记录待恢复');const d=await this.db.get('decisions',this.decisionId),g=await this.db.get('games',this.gameId);
        if(g?.record_protocol&&(s?._recording_protocol?.worker_id!==g.worker_id||s._recording_protocol.revision!==g.worker_revision))throw Error('动作前态修订号不一致');
        if(d?.status==='submitting'&&d.game_id===g?.id&&d.command?.phase==='intent'&&d.command.retry_ready&&canonical(d.final_action)===canonical(submitted(body)))return {id:d.id,...this.context(d),kind:'act',command:copy(d.command)};
        if(!d||d.game_id!==g?.id||g.status!=='playing'||g.record_status!=='recording'||d.status!=='pending')throw Error('当前动作待确认，不能重复提交');
        if(this.questionsRequired()&&d.tags.length&&!this.firstAnswer(d)){this.openQuestion(submitted(body));return null;}
        if(g.active_command||g.record_protocol&&!g.start_command?.ui_confirmed)throw Error('上次命令尚未完整确认');
        const ctx=this.context(d),command=g.record_protocol?await this.seal(this.command('act',s,body),ctx,s):null,b=await this.eventBundle(ctx,'action_submitted',{command_id:command?.id||null,interaction:freeplay(),help_followups:helpFollowups(this.data,d.plan_id).filter(h=>h.decision_id===d.id)});
        const assisted=this.hasHelp(d,b.event.seq);await this.commit({decisions:[{...d,status:'submitting',command,final_action:submitted(body),submitted_at:b.event.at,submitted_seq:b.event.seq,action_assisted:assisted}],events:[b.event],plans:[b.plan],...(command?{games:[{...g,active_command:{...command,decision_id:d.id},command_ids:command.intent?[...(g.command_ids||[]),command.id]:g.command_ids}]}:{}),...(command?.intent?{app_meta:[this.ledger(command,{id:d.id,...ctx,kind:'act'},'intent')]}:{})},{op:'intent',expected:{id:d.id,status:'pending'}});
        return {id:d.id,...ctx,kind:'act',command};});
    }
    async acknowledge(ticket,ok,s){if(ticket?.command)return this.completeCommand(ticket,s);if(!ticket||ticket.untracked)return;return this.queue(async()=>{
      const d=await this.db.get('decisions',ticket.id);if(!d||d.plan_id!==ticket.plan_id||d.game_id!==ticket.game_id)throw Error('动作确认归属不符');if(d.status!=='submitting')return;
      const b=await this.eventBundle(this.context(d),ok?'action_accepted':'action_result_unknown');await this.commit({decisions:[{...d,status:ok?'accepted':'unknown',acknowledged_at:b.event.at}],events:[b.event],plans:[b.plan]});});}
    async prepareStep(s){if(this.readOnlyView)throw Error('已保存局面仅供查看，不能继续原局');if(this.failed||this.recoveryState||this.commandRecoveries.size)throw Error('记录待恢复，停止推进');if(!this.game){if(this.selectedPlanId&&this.untrackedGame!==s.game_id)throw Error('学习局未绑定');return {untracked:true,kind:'step',command:await this.seal(this.command('step',s),{game_id:this.untrackedRecordGameId||(this.untrackedRecordGameId=id()),plan_id:null},s)};}
      return this.queue(async()=>{const g=await this.db.get('games',this.gameId);
        if(g?.record_protocol&&(s?._recording_protocol?.worker_id!==g.worker_id||s._recording_protocol.revision!==g.worker_revision))throw Error('推进前态修订号不一致');
        if(g?.active_command?.phase==='intent'&&g.active_command.retry_ready)return {plan_id:g.plan_id,game_id:g.id,decision_id:null,kind:'step',command:copy(g.active_command)};
        if(!g||g.status!=='playing'||g.record_status!=='recording'||g.active_command||g.record_protocol&&!g.start_command?.ui_confirmed)throw Error('记录未确认，禁止推进');
        const ctx={plan_id:g.plan_id,game_id:g.id,decision_id:null},command=await this.seal(this.command('step',s),ctx,s),b=await this.eventBundle(ctx,'command_intent',{command_id:command.id,kind:'step'});
        await this.commit({games:[{...g,active_command:command,command_ids:command.intent?[...(g.command_ids||[]),command.id]:g.command_ids}],events:[b.event],plans:[b.plan],...(command.intent?{app_meta:[this.ledger(command,{...ctx,kind:'step'},'intent')]}:{})},{op:'intent'});return {...ctx,kind:'step',command};});}
    async dispatch(ticket){if(ticket.command)this.checkTicket(ticket.command,ticket);if(ticket.untracked)return ticket.command?this.descriptor(ticket.command):null;
      return this.queue(async()=>{const g=await this.db.get('games',ticket.game_id),d=ticket.id?await this.db.get('decisions',ticket.id):null;
        if(!g||g.plan_id!==ticket.plan_id)throw Error('命令归属改变');const command=ticket.kind==='new'?g.start_command:d?.command||g.active_command;
        if(command?.intent&&(command.fingerprint!==ticket.command.fingerprint||canonical(command.intent)!==canonical(ticket.command.intent)))throw Error('传入票据与已保存命令指纹不同');
        if(!command||command.id!==ticket.command.id||command.phase!=='intent'||this.failed)throw Error('命令已经发送或已过期，禁止重复发送');
        const next={...command,phase:'dispatched',dispatched_at:now()},ctx={plan_id:g.plan_id,game_id:g.id,decision_id:d?.id||null},b=await this.eventBundle(ctx,'command_dispatched',{command_id:next.id,kind:ticket.kind});
        const rows={games:[{...g,...(ticket.kind==='new'?{start_command:next}:{active_command:{...next,decision_id:d?.id||null}})}],events:[b.event],plans:[b.plan]};
        if(d)rows.decisions=[{...d,command:next}];if(next.intent)rows.app_meta=[this.ledger(next,ticket,'dispatched')];await this.commit(rows,{op:'dispatch',...(d?{expected:{id:d.id,status:'submitting',command_id:next.id}}:{})});return this.descriptor(next);});}
    async completeCommand(ticket,s){if(ticket.untracked)return;
      return this.queue(async()=>{const g=await this.db.get('games',ticket.game_id),d=ticket.id?await this.db.get('decisions',ticket.id):null;
        const command=d?.command||g?.active_command||g?.last_command;if(!g||g.plan_id!==ticket.plan_id||command?.id!==ticket.command.id)throw Error('回执归属已过期');
        if(command.phase==='persisted'||command.phase==='confirmed')return {ignored:true};if(command.phase!=='dispatched')throw Error('没有已发送命令');
        const proof=this.receipt(command,s),checkpoint=command.intent?await this.checkpoint(command,ticket,s):null,next={...command,phase:'persisted',worker_accepted:true,persisted:true,receipt:proof,persisted_at:now()},ctx={plan_id:g.plan_id,game_id:g.id,decision_id:d?.id||null};
        const b=await this.eventBundle(ctx,d?'action_accepted':'worker_accepted',{command_id:command.id,revision:proof.revision,receipt:proof});
        const rows={games:[{...g,worker_id:proof.worker_id,worker_revision:proof.revision,active_command:{...next,decision_id:d?.id||null},...(checkpoint?{result_checkpoint:checkpoint}:{})}],events:[b.event],plans:[b.plan]};
        if(checkpoint)rows.app_meta=[this.ledger(next,ticket,'persisted',{result:checkpoint.result,result_sha256:checkpoint.sha256,result_persisted:true}),{id:'presentation',plan_id:g.plan_id,game_id:g.id,command_id:next.id}];
        if(d)rows.decisions=[{...d,status:'accepted',command:next,acknowledged_at:b.event.at}];await this.commit(rows,{op:'command_complete',...(d?{expected:{id:d.id,status:'submitting',command_id:command.id}}:{})});this.markResultSaved(command.id);});}
    async confirmUI(ticket){if(ticket.untracked)return;
      return this.queue(async()=>{const g=await this.db.get('games',ticket.game_id),d=ticket.id?await this.db.get('decisions',ticket.id):null;
        if(!g||g.plan_id!==ticket.plan_id)throw Error('界面确认归属错误');const command=ticket.kind==='new'?g.start_command:d?.command||g.active_command||g.last_command;
        if(command?.id!==ticket.command.id)throw Error('过期界面确认');if(command.phase==='confirmed')return;if(command.phase!=='persisted')throw Error('结果未持久化，不能确认界面');
        if(g.terminal_pending&&command.intent){const prior=await this.db.readCommands([g]);if(prior.length!==g.command_ids.length||prior.some(r=>r.command.id!==command.id&&r.phase!=='confirmed'))throw Error('前序命令未确认，不能计完整局');}
        const next={...command,phase:'confirmed',ui_confirmed:true,ui_confirmed_at:now()},ctx={plan_id:g.plan_id,game_id:g.id,decision_id:d?.id||null},b=await this.eventBundle(ctx,'ui_confirmed',{command_id:next.id});
        const rows={games:[{...g,...(ticket.kind==='new'?{start_command:next}:{}),active_command:null,last_command:next,
          ...(g.terminal_pending?{status:'completed',record_status:'completed',integrity:'verified',terminal_pending:false}:{})}],events:[b.event],plans:[b.plan]};
        if(d)rows.decisions=[{...d,command:next}];if(next.intent){const rec=await this.db.get('app_meta','command:'+next.id);rows.app_meta=[{...rec,command:next,phase:'confirmed',result:null,presentation_confirmed:true}];}
        await this.commit(rows,{op:'ui_confirm'});this.recordState=g.terminal_pending?'completed':'recording';});}
    async interrupt(ticket,reason){this.recordState='interrupted';this.interruption=String(reason);if(ticket?.untracked)return;
      return this.queue(async()=>{const g=await this.db.get('games',ticket.game_id);if(!g||g.plan_id!==ticket.plan_id)return;
        const cmd=ticket.command?{...ticket.command,phase:'needs_review',execution_known:false}:null;
        await this.commit({games:[{...g,status:'incomplete',record_status:'interrupted',integrity:'unverified',error_reason:String(reason),ended_at:now()}],
          app_meta:[{id:'live',stage:'interrupted',plan_id:g.plan_id,game_id:null,interrupted_game:g.id},...(cmd?.intent?[this.ledger(cmd,ticket,'needs_review',{error_reason:String(reason)})]:[])]});this.forgetResult(ticket.command?.id);this.status='动作结果待核验，本局停止正式采集；请导出后刷新';this.paint();});}
    hasHelp(d,before=Infinity){return this.data.events.some(e=>e.plan_id===d.plan_id&&e.game_id===d.game_id&&e.seq<before&&ASSIST.has(e.kind)&&
      (e.decision_id===d.id||e.information_key&&e.information_key===d.information_key));}
    async visibleFacts(s,g){const v=snapshot(s),stateHash=await digest(v),last=this.data.events.filter(e=>e.game_id===g.id&&e.kind==='visible_facts').at(-1);
      if(last?.detail.state_sha256===stateHash)return;const offset=last?.detail.payload.history_count||0;
      if(offset>v.public.history.length)throw Error('公开事件历史倒退，暂停记录');
      const payload={stage:v.stage,own:v.own,players:v.players,exchange:v.exchange,legal:v.legal,public:pick(v.public,['wall_total','winners','physical_tiles','discards','winning_tiles','consistent']),history_from:offset,history_count:v.public.history.length,history_delta:v.public.history.slice(offset),...(v.stage==='over'?{settlement:publicSettlement(s)}:{})};
      const b=await this.eventBundle({plan_id:g.plan_id,game_id:g.id,decision_id:null},'visible_facts',{evidence_version:HELP_VERSION,state_sha256:stateHash,payload,payload_sha256:await digest(payload),source:'explicit player-visible projection; no hidden state'});
      await this.commit({events:[b.event],plans:[b.plan]});
    }
    helpContext(){return this.context();}
    async beginHelp(kind,semantic,context){const ctx=copy(context);return this.queue(async()=>{
      const d=await this.db.get('decisions',ctx.decision_id);if(this.failed||!d||d.status!=='pending'||d.id!==this.decisionId||d.game_id!==this.gameId||d.plan_id!==ctx.plan_id||d.information_key!==ctx.information_key)throw Error('教学请求已过期，禁止展示');
      if(this.questionsRequired()&&!this.firstAnswer(d))throw Error('先保存本人判断或明确跳过，再显示帮助');
      const payload=helpPayload(kind,semantic);if(hiddenFields(payload))throw Error('帮助含禁存字段');
      const ticket={...ctx,help_id:id(),kind,payload,payload_sha256:await digest(payload),evidence_version:HELP_VERSION,followup_at_release:'未提供',
        versions:{app:APP,renderer:'teaching-dom-v1',algorithm:kind==='math'||kind==='comparison'?'hand-math-v1':'retained-ai-heuristic',build:copy(globalThis.__mahjongBuild||{verified:false})}};
      const b=await this.eventBundle(ctx,'help_may_be_seen',{...ticket,certainty:'possible'});await this.commit({events:[b.event],plans:[b.plan]});return {...ticket,release_seq:b.event.seq};
    });}
    async confirmHelp(ticket,display,certainty='rendered'){return this.queue(async()=>{
      const prior=this.data.events.find(e=>e.kind==='help_may_be_seen'&&e.detail.help_id===ticket.help_id);
      if(!prior||['plan_id','game_id','decision_id','information_key'].some(k=>canonical(prior[k])!==canonical(ticket[k]))||prior.detail.payload_sha256!==ticket.payload_sha256)throw Error('帮助留证上下文不匹配');
      const existing=this.data.events.find(e=>e.detail?.help_id===ticket.help_id&&(['ai_presented','math_presented','comparison_presented','opening_suggestion_presented'].includes(e.kind)||certainty!=='rendered'&&e.kind==='help_presentation_unconfirmed'));if(existing)return existing;
      const kind=certainty!=='rendered'?'help_presentation_unconfirmed':({ai:'ai_presented',ai_candidate:'ai_presented',dfncy:'ai_presented',math:'math_presented',comparison:'comparison_presented',exchange:'opening_suggestion_presented',daque:'opening_suggestion_presented'})[ticket.kind];
      const payload={semantic:copy(ticket.payload),display:copy(display)},b=await this.eventBundle(pick(ticket,['plan_id','game_id','decision_id','information_key']),kind,{help_id:ticket.help_id,evidence_version:HELP_VERSION,payload,payload_sha256:await digest(payload),semantic_sha256:ticket.payload_sha256,versions:copy(ticket.versions),certainty});
      await this.commit({events:[b.event],plans:[b.plan]});return b.event;
    });}
    async saveAnswer(fields,planned,skip=false,revision=false,expected=this.decisionId,selection=null){
      // Capture at invocation, never rebind a delayed submission to help displayed later.
      const captured=expected,d0=this.decision,ids=this.data.events.filter(e=>e.plan_id===d0?.plan_id&&e.game_id===d0?.game_id&&e.decision_id===captured&&e.kind==='help_may_be_seen').map(e=>e.detail.help_id),
        response=copy(selection||{version:'help-followup-v1',scope:ids.length?'combined':'none',context_help_ids:ids});
      return this.queue(async()=>{
      const d=await this.db.get('decisions',captured);if(!d||d.id!==this.decisionId||d.game_id!==this.gameId||d.status!=='pending')throw Error('本次局面已过期或已经行动');
      if(d.interaction?.mode==='freeplay')throw Error('自由对局未提问，不采集或生成问卷回答；旧答案保持原样');
      const allowed=['shape','tenpai','waits','unseen','intended_discard','retain','next','suits','clear_plan','benefit','decline','risk','plan','reason','alternatives','danger_player','danger_reason','defend','confidence'];
      fields=Object.fromEntries(allowed.filter(k=>typeof fields[k]==='string').map(k=>[k,fields[k]]));
      const old=this.data.answers.filter(a=>a.plan_id===d.plan_id&&a.decision_id===d.id);if(old.length&&!revision)throw Error('首次回答已锁定');
      const required=['reason','alternatives','confidence'];if(d.snapshot.phase==='discard'){required.push('shape','tenpai');if(fields.tenpai==='yes')required.push('waits','unseen');if(planned.type==='help_request')required.push('intended_discard');}
      else required.push('plan',...(d.snapshot.phase==='exchange'?['retain','next']:d.snapshot.phase==='daque'?['suits','clear_plan']:['benefit','decline','risk']));
      if(d.tags.some(t=>['middle','late','response'].includes(t)))required.push('danger_player','danger_reason','defend');
      const complete=required.every(k=>typeof fields[k]==='string'&&fields[k].trim());if(!skip&&!complete)throw Error('请填写显示的问题，可明确填不知道或跳过');
      const b=await this.eventBundle(this.context(d),skip?'answer_skipped':revision?'answer_revision':'answer_submitted'),exposed=this.hasHelp(d,b.event.seq);
      const independent=!skip&&!exposed&&!old.length,known=x=>!!x?.trim()&&!/不知道|不确定|没考虑|跳过/.test(x);
      const intended=planned.type==='discard'?planned.tile:planned.type==='help_request'?(d.snapshot.legal.allowed||[]).find(t=>cn(t)===fields.intended_discard?.trim()):null;
      const a={id:id(),plan_id:d.plan_id,game_id:d.game_id,decision_id:d.id,at:b.event.at,seq:b.event.seq,revision:old.length,planned_action:copy(planned),skipped:skip,
        classification:old.length?'revision':exposed?'assisted':skip?'skipped':'independent',valid_independent:independent&&complete,
        math_checkable:independent&&complete&&!!intended&&d.snapshot.phase==='discard'&&['yes','no'].includes(fields.tenpai)&&(fields.tenpai==='no'||known(fields.waits)&&known(fields.unseen)),fields:copy(fields),provenance:this.source,
        independence_evidence:{version:HELP_VERSION,state:exposed?'possible_or_presented':'none',checked_seq:b.event.seq},responds_to_help_ids:old.length&&response.scope==='specific'?copy(response.context_help_ids):[],answer_stage:old.length?(exposed?'after_help':'supplement_before_help'):'first',...(old.length?{help_response:response}:{})};
      validateHelpResponse(a,new Map(this.data.events.filter(e=>e.kind==='help_may_be_seen').map(e=>[e.detail.help_id,e])));
      await this.commit({answers:[a],events:[b.event],plans:[b.plan]});return a;
    });}
    async presented(kind,detail={},decisionId=this.decisionId){if(!decisionId||decisionId!==this.decisionId||!this.game)return;
      const dedup=decisionId+':'+kind+':'+(detail.candidate??'');if(this.presentation.has(dedup))return;
      this.presentation.add(dedup);try{await this.event(kind,detail,decisionId);}catch(e){this.presentation.delete(dedup);throw e;}}
    canAdvise(){return !this.helpInFlight&&!this.locked()&&!this.failed&&!this.formOpen&&!this.inFlight&&!this.recoveryState&&!this.commandRecoveries.size&&!this.interruption&&!this.readOnlyView;}
    async recoverCommand(context){const t=context.ticket,g=await this.db.get('games',t.game_id),rec=await this.db.get('app_meta','command:'+t.command.id);
      if(!g||g.plan_id!==t.plan_id)throw Error('恢复命令归属不匹配');
      if(t.command.intent){
        if(this.gameId!==t.game_id&&rec?.phase!=='confirmed')throw Error('恢复命令不是当前绑定牌局，须核验，不得重绑');
        if(this.gameId!==t.game_id&&rec?.phase==='confirmed'){this.forgetResult(t.command.id);return null;}
        if(!rec||rec.fingerprint!==t.command.fingerprint)throw Error('恢复命令指纹不匹配');
        if(rec.phase==='needs_review')throw Error('命令结果待核验，不得重发');
        if(rec.phase==='dispatched'){
          if(t.kind==='new')await this.start(context.state,t);else await this.completeCommand(t,context.state);
        }else if(!['persisted','confirmed'].includes(rec.phase))throw Error('未派发命令不能冒充已执行结果');
        const result=await this.storedResult(t);context.stage='persisted_waiting_presentation';context.persisted=true;
        await this.observe(result);await this.hooks.acceptState?.(result);await this.confirmUI(t);this.forgetResult(t.command.id);
        if(this.restoredPresentation?.terminal){this.readOnlyView=true;this.interruption=null;this.restoredPresentation={...this.restoredPresentation,readonly:true};}
        return result;
      }
      // Read-only compatibility for pre-fingerprint synthetic/legacy test paths.
      if(t.kind==='new'&&!g.engine_game)await this.start(context.state,t);else if(t.kind!=='new')await this.completeCommand(t,context.state);
      await this.observe(context.state);await this.hooks.acceptState?.(context.state);await this.confirmUI(t);this.forgetResult(t.command.id);return context.state;
    }
    async retry(s){if(this.retryTask)return this.retryTask;
      this.retryTask=this.retryWork(s);try{return await this.retryTask;}finally{this.retryTask=null;}}
    async retryWork(s){
      // Older callers can supply the compatibility alias, but each command owns its context.
      if(this.recoveryState&&!this.commandRecoveries.has(this.recoveryState.ticket.command.id))this.rememberResult(this.recoveryState.ticket,this.recoveryState.state);
      const hadWork=this.pendingWrites.size||this.pendingRows||this.commandRecoveries.size||this.restoredPresentation;
      if(!hadWork)throw Error('没有待保存或待重新呈现的结果');
      await this.queue(async()=>{
        if(this.pendingRows&&!this.pendingWrites.size){const j=this.pendingRows;j.id=j.id||id();this.pendingWrites.set(j.id,j);}
        for(const [jid,job]of [...this.pendingWrites]){
          await this.db.write(job.rows,job.options);this.apply(job.rows);this.pendingWrites.delete(jid);this.pendingRows=[...this.pendingWrites.values()][0]||null;this.failed=null;
          this.bind();this.starting=false;
          if(!this.commandRecoveries.size&&['dispatch','intent'].includes(job.options.op)&&this.game){
            const g=await this.db.get('games',this.gameId),which=g.record_status==='preparing'?'start_command':'active_command',old=g[which];
            if(old&&!old.worker_accepted){const command={...old,phase:'intent',retry_ready:true},rows={games:[{...g,[which]:command}]};
              const did=old.decision_id||this.data.decisions.find(d=>d.game_id===g.id&&d.command?.id===old.id)?.id;
              if(did){const d=await this.db.get('decisions',did);rows.decisions=[{...d,command}];}
              if(command.intent){const rec=await this.db.get('app_meta','command:'+command.id);rows.app_meta=[{...rec,phase:'intent',command}];}
              await this.commit(rows,{op:'retry_unsent'});}
          }
        }
        const current=this.recoveryState?.state||s,d=current&&this.data.decisions.find(d=>d.game_id===this.gameId&&d.key===canonical(snapshot(current))&&['pending','submitting'].includes(d.status));
        if(d){this.decisionId=d.id;if(d.status==='submitting'&&!d.command){const b=await this.eventBundle(this.context(d),'action_not_sent_storage_retry');await this.commit({decisions:[{...d,status:'pending',unsent_intent:d.final_action,final_action:null}],events:[b.event],plans:[b.plan]},{op:'retry_unsent'});}}
        this.pendingRows=[...this.pendingWrites.values()][0]||null;this.failed=null;this.recordState=this.game?.record_status||this.recordState;
      });
      let result=null;for(const context of [...this.commandRecoveries.values()].sort((a,b)=>a.ticket.command.expected_revision-b.ticket.command.expected_revision))result=await this.recoverCommand(context);
      if(!result&&this.restoredPresentation){const cp=this.restoredPresentation;if(await digest(cp.result)!==cp.sha256)throw Error('呈现结果校验失败');await this.hooks.acceptState?.(copy(cp.result));await this.confirmReadOnlyPresentation(cp);result=cp.result;}
      if(!result&&s&&this.game?.engine_game===String(s.game_id))await this.observe(s);
      this.status=this.commandRecoveries.size?'命令尚待确认':this.readOnlyView?'已呈现保存结果（只读）':'已保存';this.inFlight=false;this.paint();return result;
    }
    async confirmReadOnlyPresentation(cp){return this.queue(async()=>{const t=cp.ticket,rec=await this.db.get('app_meta','command:'+t.command.id),p=await this.db.get('plans',t.plan_id);
      if(rec?.phase!=='persisted'||p?.status!=='in_progress')return;
      if(rec.result_sha256!==cp.sha256)throw Error('只读呈现结果指纹不匹配');
      const b=await this.eventBundle({plan_id:t.plan_id,game_id:t.game_id,decision_id:t.id||null},'saved_result_presented_after_restart',{command_id:t.command.id});
      await this.commit({app_meta:[{...rec,phase:'confirmed',command:{...rec.command,phase:'confirmed',ui_confirmed:true},presentation_confirmed:true,engine_lost:true,result:null}],events:[b.event],plans:[b.plan]},{op:'restored_ui_confirm'});
    });}
    async cancelPreparedStart(){return this.queue(async()=>{if(this.inFlight||this.failed||this.pendingRows||this.commandRecoveries.size)throw Error('须先处理在途命令或保存失败');
      const g=await this.db.get('games',this.gameId),cmd=g?.start_command;
      if(!g||g.record_status!=='preparing'||cmd?.phase!=='intent'||cmd.dispatched_at||g.engine_game)throw Error('仅从未派发的新局意图可以取消');
      const next={...cmd,phase:'cancelled'},ctx={plan_id:g.plan_id,game_id:g.id,decision_id:null},b=await this.eventBundle(ctx,'new_intent_cancelled',{command_id:cmd.id});
      await this.commit({games:[{...g,status:'cancelled',record_status:'interrupted',integrity:'unverified',start_command:next,end_reason:'cancelled_before_dispatch',ended_at:now()}],plans:[b.plan],events:[b.event],app_meta:[{id:'live',stage:'none',plan_id:null,game_id:null},...(cmd.intent?[this.ledger(next,g.start_ticket,'cancelled')]:[])]},{op:'cancel_start'});
      this.gameId=null;this.decisionId=null;this.starting=false;this.recordState=null;this.status='原意图已明确取消；下次开始将创建全新ID';this.paint();});}
    async stop(){return this.queue(async()=>{if(this.inFlight||this.recoveryState||this.commandRecoveries.size)throw Error('命令在途或结果待保存，须先恢复或核验');if(!this.game||this.game.status!=='playing')throw Error('当前没有可停止的记录中对局');
      this.unsavedBackup=this.pendingRows;this.pendingWrites.clear();this.pendingRows=null;this.failed=null;const g=this.game;
      await this.commit({games:[{...g,status:'incomplete',record_status:'interrupted',integrity:'unverified',ended_at:now(),end_reason:'user_stopped_recording',missing_triggers:this.missing(g)}],...(!g.engine_game?{app_meta:[{id:'live',stage:'none',plan_id:null,game_id:null}]}:{})});
      this.untrackedGame=g.engine_game;this.gameId=null;this.decisionId=null;this.starting=false;this.recordState='interrupted';this.status='已明确停止本局记录；本局不计有效样本，实际牌局结束前不能切换';this.paint();});}
    async export(planId){if(!planId)throw Error('必须指定唯一plan_id');await this.tail.catch(()=>{});
      const data=await this.db.readPlan(planId);if(!data.plans.length)throw Error('计划不存在');
      for(const n of CHILDREN)if(data[n].some(r=>r.plan_id!==planId))throw Error('导出归属冲突');
      data.events.sort((a,b)=>a.seq-b.seq);data.decisions.sort((a,b)=>a.game_id.localeCompare(b.game_id)||a.ordinal-b.ordinal);data.answers.sort((a,b)=>a.seq-b.seq);
      const buffers=[...this.pendingWrites.values()];if(!buffers.length&&this.pendingRows)buffers.push(this.pendingRows);if(this.unsavedBackup&&!buffers.includes(this.unsavedBackup))buffers.push(this.unsavedBackup);
      const recovery=[];for(const b of buffers)if(b){
        if(!b.plan_ids?.length)throw Error('恢复缓冲归属不明，禁止混入导出');
        if(b.plan_ids.length===1&&b.plan_ids[0]===planId)recovery.push({saved_in_database:false,job_id:b.id,operation:b.options?.op,error_reason:b.error_reason,commands:(b.rows.app_meta||[]).filter(r=>r.record_type==='command_v2'&&r.plan_id===planId),rows:Object.fromEntries(Object.entries(b.rows).filter(([n])=>n==='plans'||CHILDREN.includes(n)).map(([n,rs])=>[n,rs.filter(r=>r.plan_id===planId)]))});
      }
      const commands=await this.db.readCommands(data.games);if(commands.some(r=>r.plan_id!==planId))throw Error('命令导出归属冲突');
      const commandRecovery=[];for(const r of this.commandRecoveries.values())if(r.ticket.plan_id===planId){const rec=commands.find(c=>c.command.id===r.ticket.command.id),g=data.games.find(g=>g.id===r.ticket.game_id),stored=!!(rec?.result||g?.result_checkpoint?.command_id===r.ticket.command.id);
        commandRecovery.push({...copy(r),state:stored?await this.storedResult(r.ticket):copy(r.state),saved_in_database:stored,result_source:stored?'database':'memory_only'});}
      return envelope({commands,uncommitted_commands:commandRecovery,plan:data.plans[0],games:data.games,decisions:data.decisions,answers:data.answers,events:data.events,legacy_records:data.legacy_quarantine,teaching_evidence_version:HELP_VERSION,help_followups:helpFollowups(data,planId),
        counts:Object.fromEntries(CHILDREN.map(n=>[n,data[n].length])),progress_candidates:data.plans[0]?.purpose==='formal_freeplay'?formalFreeplayProgress(data,planId):reliableProgress(data,planId),legacy_progress_candidates:planProgress(data,planId),uncommitted_recovery:recovery,test_database:this.testing,
        recording_state:this.recordState||null,recording_error:this.failed||this.interruption||null,restore_supported:false,
        evaluation:{automatic_score:false,note:'仅为采集候选，必须独立核验。用途与来源不证明没有外部求助；SHA256不是身份签名。'}});
    }
    async preflightMigration(){this.assertIdle();return this.queue(async()=>{this.assertIdle();return this.migration.preflight();});}
    async backup(planId){return Backup.make(this,planId);}
    async previewBackup(text){this.assertIdle();return Backup.validate(text,this.db);}
    async restoreBackup(confirmed=false){if(!confirmed||!this.backupPreview?.restorable)throw Error('先选择、核验文件并明确确认');
      this.assertIdle();return this.queue(async()=>{this.assertIdle();if(!this.writer||!this.available)throw Error('当前档案只读');
        const result=await Backup.restore(this.db,this.backupPreview);this.apply(await this.db.boot());await this.loadPlan(result.plan_id);this.viewPlanId=result.plan_id;this.paint();return result;});}
    async confirmMigration(token,confirmed,fault=null){this.assertIdle();return this.queue(async()=>{this.assertIdle();const report=await this.migration.migrate(token,confirmed,fault);this.apply(await this.db.boot());this.paint();return report;});}
    paint(){if(!this.mounted)return;const p=this.plan,view=this.data.plans.find(p=>p.plan_id===this.viewPlanId),counts=view&&(view.purpose==='formal_freeplay'?formalFreeplayProgress(this.data,view.plan_id):reliableProgress(this.data,view.plan_id));
      const followup=document.getElementById('studySupplementStatus');if(followup){const rows=helpFollowups(this.data,this.game?.plan_id).filter(x=>x.decision_id===this.decisionId),count=status=>rows.filter(x=>x.status===status).length,combined=new Set(rows.flatMap(x=>x.combined_answer_ids)).size;
        followup.textContent=rows.length?`本次帮助后的追加判断：已提供逐项补充${count('已提供')}项；仅有综合补充${count('仅综合补充')}项；未提供${count('未提供')}项；历史归属待确认${count('历史归属待确认')}项。综合补充${combined}份，不代表逐项评价；跳过不算提供，不覆盖首次判断。`:'本次尚无已留证帮助；首次判断与补充回答分别保存。';}
      const readyStart=this.game?.record_status==='preparing'&&this.game.start_command?.phase==='intent';
      const begin=document.getElementById('startGameBtn');if(begin)begin.disabled=!!(this.failed||this.pendingRows||this.unsavedBackup||this.commandRecoveries.size||this.game?.active_command||this.game?.terminal_pending||!readyStart&&(this.starting||p&&LIVE.has(this.live()?.stage)));
      const cancel=document.getElementById('studyCancelStart');if(cancel)cancel.disabled=!!(this.inFlight||this.failed||this.pendingRows||!readyStart||this.game?.start_command.dispatched_at);
      const purpose=x=>({device_acceptance:'设备验收',formal_freeplay:'正式自由对局',formal_diagnostic:'旧问卷诊断（历史）',legacy_unclassified:'旧资料（未分类）'})[x];
      for(const b of document.querySelectorAll('.study-entry'))b.textContent=`我的学习档案 · ${p?purpose(p.purpose):'未选计划'} · ${this.status}`;
      const box=document.getElementById('studyProgress');if(box)box.textContent=view?`${view.title||purpose(view.purpose)} · ${view.status}。`+
        (view.purpose==='legacy_unclassified'?`保留旧资料原始记录${this.data.legacy_quarantine.filter(r=>r.plan_id===view.plan_id).length}条；不推断旧样本资格，不参与正式统计。`:view.purpose==='formal_freeplay'?`自由对局记录候选${counts.recorded_games}/20局，换三张${counts.exchange}/10，不换${counts.skip}/10；中断或未核实${counts.interrupted}局。有效局须经备份离线审计，不自动评分。`:view.purpose==='formal_diagnostic'?`历史问卷口径：换三张${counts.exchange}/10，不换${counts.skip}/10，独立回答${counts.independent}/60，数学${counts.math_candidates}/20（仅历史）。`:`记录完整对局${counts.recorded_games}局；不参与正式诊断统计。`):'请选择用途创建计划；创建后需明确设为当前记录计划。';
      if(box&&this.recordState)box.textContent+=' 当前记录：'+({preparing:'准备中',recording:'采集中',interrupted:'已中断待核验',completed:'已完整保存',failed:'保存失败，采集暂停'})[this.recordState]+'。';
      if(box&&counts?.legacy_unverified_games)box.textContent+=` 旧格式${counts.legacy_unverified_games}局保留可读，未按新协议核实，不自动计入新协议样本。`;
      if(box)box.textContent+=' 新协议formal-freeplay-baseline-v1：20局且两种模式各至少10局；不要求问卷。未提问不算答错，也不伪造理由或信心。正式采集仍须另行批准构建。';
      const badge=document.getElementById('recordingBadge');if(badge)badge.textContent='自由对局 · '+(this.failed||this.interruption?'记录待恢复':this.gameId?this.status:'开局自动记录');
      const notice=document.getElementById('studyNotice');if(notice){notice.textContent=this.failed?'保存失败，采集暂停：'+this.failed+'。只重试保存，不重发已执行动作。':this.interruption||'';notice.classList.toggle('hidden',!notice.textContent);}
      this.listGames();
    }
    open(){document.getElementById('studyOverlay').classList.remove('hidden');this.paint();}
    listGames(){const list=document.getElementById('studyPlans');if(!list)return;list.textContent='';
      const idle=!this.inFlight&&!this.recoveryState&&!this.commandRecoveries.size&&!this.game?.active_command&&!this.game?.terminal_pending&&!this.starting&&!this.failed&&!this.pendingRows&&!this.unsavedBackup&&(this.readOnlyView||!LIVE.has(this.hooks.state?.()?.stage))&&!LIVE.has(this.live()?.stage);
      for(const p of this.data.plans){const row=document.createElement('section');row.className='study-plan';const text=document.createElement('p');
        text.textContent=`${p.title||p.plan_id.slice(0,8)} · ${p.purpose} · ${p.status}${p.plan_id===this.selectedPlanId?' · 当前记录计划':''}`;row.append(text);
        const button=(label,fn,disabled=false)=>{const b=document.createElement('button');b.textContent=label;b.disabled=disabled;b.onclick=async()=>{try{await fn();this.paint();}catch(e){document.getElementById('studyMessage').textContent=e.message;}};row.append(b);};
        button('查看',async()=>{await this.loadPlan(p.plan_id);this.viewPlanId=p.plan_id;});
        button('设为当前计划',()=>this.switchPlan(p.plan_id),!idle||p.status!=='in_progress'||p.purpose==='legacy_unclassified');
        button('结束计划',()=>this.closePlan(p.plan_id),!idle||p.status!=='in_progress');
        button('归档',()=>this.closePlan(p.plan_id,true),!idle||p.status==='archived');list.append(row);
      }
      const games=document.getElementById('studyGames');games.textContent='';for(const g of this.data.games.filter(g=>g.plan_id===this.viewPlanId)){
        const el=document.createElement('p');el.textContent=`${g.exchange_enabled?'换三张':'不换'} · ${g.status} · ${g.started_at}`;games.append(el);}
    }
    openQuestion(planned,revision=false){
      if(!this.questionsRequired())return false;
      if(this.formOpen)return;this.formOpen=true;const d=this.decision,box=document.getElementById('studyQuestion');box.classList.remove('hidden');
      document.getElementById('studyQuestionTitle').textContent=revision?'追加补充（不覆盖首次回答）':'关键决策：先写自己的判断';
      const form=document.getElementById('studyForm');form.reset();form.dataset.revision=String(revision);form.dataset.decisionId=d.id;this.planned=copy(planned);
      const target=document.getElementById('studyFollowupTarget'),helps=this.data.events.filter(e=>e.plan_id===d.plan_id&&e.game_id===d.game_id&&e.decision_id===d.id&&e.kind==='help_may_be_seen');
      form.helpContextIds=helps.map(e=>e.detail.help_id);target.replaceChildren();document.getElementById('studyFollowupTargetRow').hidden=!revision;
      const option=(value,text)=>{const o=document.createElement('option');o.value=value;o.textContent=text;target.append(o);};
      option(helps.length?'combined':'none',helps.length?'综合补充（不代表逐项评价所有帮助）':'当前没有已留证帮助：一般补充');
      for(const [i,e] of helps.entries())option('help:'+e.detail.help_id,`只针对第${i+1}次帮助：${({ai:'AI建议',ai_candidate:'AI候选',math:'数学分析',comparison:'候选比较',exchange:'换牌建议',daque:'定缺建议',dfncy:'牌效参考'})[e.detail.kind]||'帮助'} · ${e.detail.help_id.slice(0,8)}`);
      document.getElementById('studyAnswerError').textContent='';
      document.getElementById('studyPlanned').textContent='本次准备动作：'+actionLabel(planned)+'；触发：'+d.tags.map(t=>({exchange:'换三张',daque:'定缺',clear:'首次清缺后出牌',middle:'中盘',response:'首次响应',late:'后期候补'})[t]).join('、');
      const v=d.snapshot;document.getElementById('studyOwnHand').textContent='你的手牌：'+v.own.hand.map(cn).join('、')+'。自己的副露：'+(v.own.melds.map(m=>m.map(cn).join(' ')).join('；')||'无')+'。定缺：'+(v.own.daque===null?'尚未选择':['条','万','筒'][v.own.daque]);
      const info=document.getElementById('studyPublicContext');info.textContent='';
      for(const q of v.players){const p=document.createElement('p');p.textContent=`${q.seat===v.seat?'自己':['自己','下家','对家','上家'][q.seat]}：${q.winning?'已胡；':''}缺${q.daque===null?'未公开':['条','万','筒'][q.daque]}；副露 ${q.melds.map(m=>m.map(cn).join(' ')).join('；')||'无'}；弃牌 `+
        (v.public.discards.filter(r=>r.seat===q.seat).map(r=>cn(r.tile)+(['pong','kong'].includes(r.status)?'（已被'+(r.status==='pong'?'碰':'杠')+'）':r.status==='hu'?'（被胡）':'')).join('、')||'无');info.append(p);}
      for(const el of form.querySelectorAll('[data-for]'))el.hidden=!el.dataset.for.split(' ').includes(d.snapshot.phase==='discard'?'discard':d.snapshot.phase==='exchange'?'exchange':d.snapshot.phase==='daque'?'daque':'choice');
      form.querySelector('[data-defense]').hidden=!d.tags.some(t=>['middle','late','response'].includes(t));
    }
    mount(hooks){this.hooks=hooks;this.mounted=true;
      const ui=document.createElement('div');ui.innerHTML=`<div id="studyNotice" class="study-notice hidden" role="status"></div>
      <div id="studyOverlay" class="study-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="studyTitle"><section class="study-panel">
      <div class="study-head"><h2 id="studyTitle">我的麻将学习档案</h2><button id="studyClose">回牌桌</button></div>
      <p id="studyBuildIdentity"></p><p id="studyProgress"></p><p>仅在此浏览器本地保存，不自动上传。浏览器可能清理数据，请定期保存备份到“文件”，再选回核验。恢复的是学习档案，不续打旧Worker；未完成或结果未知的牌局不计有效样本。旧共用库保持原样，本版不自动打开或迁移。</p>
      <div id="studyCreate"><label>计划用途（创建后不能更改）<select id="studyPurpose"><option value="">请明确选择用途</option><option value="device_acceptance">设备验收，不参与正式统计</option><option value="formal_freeplay">正式自由对局，20局且两种模式各10局</option></select></label><label>便于辨认的名称<input id="studyPlanTitle" placeholder="可选，例如iPhone设备验收"></label><button id="studyBegin">创建独立计划</button><p>创建不会自动切换。请在牌局结束后点击相应计划的“设为当前计划”。</p></div>
      <div id="studyPlans"></div>
      <div class="study-actions"><button id="studyExport">导出当前查看的独立计划</button><button id="studyPersist">申请持久保存</button><button id="studyRetry">恢复保存 / 重新呈现</button><button id="studyCancelStart">取消未派发的新局</button><button id="studyFreshGame">新开局（不续打已保存局面）</button><button id="studyStop">停止本局记录，保留已存数据</button><button id="studyRevision" hidden disabled>追加当前判断</button></div>
      <details id="studyBackupSection"><summary>本地单计划备份与恢复</summary><p>备份前请结束当前牌局并处理待恢复事务。旧证据导出仅可核验；不支持的格式不会自动升级。相同ID内容冲突一律拒绝，不覆盖原档案。SHA-256校验完整性，不证明身份或答案正确。</p><button id="studyBackupPrepare">准备当前计划备份</button><a id="studyBackupDownload" class="hidden" download>保存备份到文件</a><label>重新选择本地JSON文件<input id="studyBackupFile" type="file" accept=".json,application/json"></label><pre id="studyBackupPreview"></pre><label><input id="studyBackupConsent" type="checkbox">我确认只恢复此计划，不覆盖任何已有数据，不恢复旧牌局运行状态</label><button id="studyBackupRestore" disabled>确认原子恢复</button></details>
      <p>自由对局不弹问卷：保存可见局面、真实动作和实际帮助，不推测你的理由或信心；旧回答仍在导出和备份中保留。</p><p id="studySupplementStatus"></p><p id="studyMessage" role="status"></p><details><summary>对局与记录状态</summary><div id="studyGames"></div></details>
      <details><summary>旧资料只读预检（真实迁移已停用）</summary><p>旧库保持原样；旧页面仍可能续写。本轮只允许真实旧库预检，禁止复制迁移。安全交接需另行授权。</p><button id="studyPreflight">只读预检旧资料</button><pre id="studyMigrationInfo"></pre><label><input id="studyMigrationConsent" type="checkbox">仅隔离虚构测试库可确认复制；真人库禁用</label><button id="studyMigrate" disabled>确认复制迁移</button></details>
      <p>正式自由对局先收集20个有效完成局，两种模式各至少10局；不再要求旧问卷的60份回答和20份手填数学判断。100局用于后续跟踪，不阻止继续打牌。本版通过导出备份在Windows离线生成初步分析，不在应用内自动诊断，不用输赢或AI一致率评分。</p></section></div>
      <div id="studyQuestion" class="study-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="studyQuestionTitle"><section class="study-panel">
      <h2 id="studyQuestionTitle"></h2><p id="studyPlanned"></p><p id="studyOwnHand" class="study-context"></p><details><summary>查看当时四家公开信息（不含对手暗牌）</summary><div id="studyPublicContext"></div></details><p>不确定可以写“不知道”“没考虑过”，也可以跳过。首次答案保存后锁定；这里只记录，不替你出牌。</p>
      <form id="studyForm"><label id="studyFollowupTargetRow" hidden>这次补充针对什么？<select id="studyFollowupTarget"></select><span>综合补充仅记录当时的帮助上下文，不等于逐项评价；跳过仍记为未提供。</span></label><div data-for="discard"><label>本次假设打哪张牌？<input name="intended_discard" placeholder="请求帮助前填写，例如1万；也可写不知道"></label><label>打出后预计是什么牌型？<input name="shape" placeholder="自己的判断，或不知道"></label>
      <label>打出后是否听牌？<select name="tenpai"><option value="">请选择</option><option value="yes">听牌</option><option value="no">未听牌</option><option value="unknown">不知道/不确定</option></select></label>
      <label>如果听牌，你认为有哪些待牌？<textarea name="waits" placeholder="逐种写牌名；不知道也请注明"></textarea></label>
      <label>每种待牌还未见到多少张？<textarea name="unseen" placeholder="逐种写数量，或不知道；这里不是牌墙内数量"></textarea></label></div>
      <div data-for="exchange"><label>希望保留什么牌型？<textarea name="retain"></textarea></label><label>下一阶段准备怎样调整？<textarea name="next"></textarea></label></div>
      <div data-for="daque"><label>其他花色有什么优势或劣势？<textarea name="suits"></textarea></label><label>准备如何清缺？<textarea name="clear_plan"></textarea></label></div>
      <div data-for="choice"><label>该动作的预期收益？<textarea name="benefit"></textarea></label><label>不选它有什么好处？<textarea name="decline"></textarea></label><label>对手及后续风险？<textarea name="risk"></textarea></label></div>
      <label data-for="exchange daque choice">你的总体计划/判断是什么？<textarea name="plan" placeholder="可以写不知道"></textarea></label>
      <label>为什么选择这个动作？<textarea name="reason" placeholder="自己的理由，或不知道/没考虑过"></textarea></label>
      <label>考虑了哪些替代方案？<textarea name="alternatives" placeholder="没考虑过也请注明"></textarea></label>
      <div data-defense><label>哪家可能危险？<input name="danger_player" placeholder="可写不确定"></label><label>判断依据？<textarea name="danger_reason"></textarea></label><label>愿否为防守放弃进攻？<select name="defend"><option value="">请选择或不确定</option><option>愿意</option><option>不愿意</option><option>不确定/没考虑过</option></select></label></div>
      <label>判断信心（1低，5高）<select name="confidence"><option value="">请选择</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option><option value="unknown">不知道</option></select></label>
      <p id="studyAnswerError" role="alert"></p><div class="study-actions"><button type="button" id="studyUnknown">其余未填问题记为“不知道”</button><button type="submit">保存判断，返回牌桌</button><button type="button" id="studySkip">跳过本次问题</button><button type="button" id="studyLater">暂不提交，返回选牌</button></div></form></section></div>`;
      document.body.append(ui);
      const build=globalThis.__mahjongBuild;
      document.getElementById('studyBuildIdentity').textContent=`存储通道：${this.channel}。版本：${build?.app_release||APP}；提交：${build?.source_commit||'未核实'}${build?.working_tree_dirty?' + 未提交工作树':''}；构建：${build?.build_id||'未核实'}；数据：${VERSION}；规则：${build?.rules_version||'P0.2-frozen+p04-opening'}。${build?.verified?'资源SHA-256已核验':'开发环境身份未核实'}；正式20局：${formalFreeplayBuildReady(build)?'已批准的构建':'未批准，不可正式采集'}。`;
      for(const o of document.getElementById('studyPurpose').options)if(o.value)o.disabled=!channelAllows(this.channel,o.value,this.testing);
      if(this.source==='automated_test')document.getElementById('studyTitle').textContent='自动化测试档案（不计入真人学习）';
      for(const selector of ['header','#drawerMenu .menu-grid','#newGameOverlay .panel','#exchangeOverlay .panel','#daqueOverlay .panel']){
        const parent=document.querySelector(selector);if(parent){const b=document.createElement('button');b.className='study-entry secondary';b.onclick=()=>this.open();parent.append(b);}}
      const on=(name,fn)=>document.getElementById(name).onclick=async()=>{try{await fn();}catch(e){document.getElementById('studyMessage').textContent=String(e.message||e);this.paint();}};
      on('studyClose',()=>{document.getElementById('studyOverlay').classList.add('hidden');hooks.refresh();});
      on('studyBegin',async()=>{await this.createPlan(document.getElementById('studyPurpose').value,document.getElementById('studyPlanTitle').value);document.getElementById('studyMessage').textContent='已创建。请在牌局结束后明确设为当前计划；不补造当前局历史。';});
      on('studyRetry',async()=>{if(this.retryUIBusy)return;this.retryUIBusy=true;try{await this.retry(hooks.state());document.getElementById('studyMessage').textContent=this.readOnlyView?'已重新呈现保存结果；原Worker未恢复。':'待恢复事务已处理，未自动重发麻将动作。';hooks.clearError?.();hooks.refresh();if(!this.readOnlyView)await hooks.resume?.();}finally{this.retryUIBusy=false;}});
      on('studyCancelStart',()=>this.cancelPreparedStart());
      on('studyFreshGame',async()=>{document.getElementById('studyOverlay').classList.add('hidden');await hooks.newGame?.();});
      on('studyStop',async()=>{await this.stop();document.getElementById('studyMessage').textContent='本局停止记录，已存内容保留，本局不计配额；可以继续普通游戏。';hooks.refresh();});
      on('studyPersist',async()=>{const granted=await navigator.storage?.persist?.();document.getElementById('studyMessage').textContent=granted?'浏览器同意持久存储；仍请备份。':'浏览器未授予持久存储或不支持；仍可本地保存，请主动导出备份。';});
      on('studyExport',async()=>{const out=await this.export(this.viewPlanId),blob=new Blob([JSON.stringify(out,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
        a.href=url;a.download=`mahjong-study-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);document.getElementById('studyMessage').textContent='已生成本地导出文件，请确认已保存到文件中。';});
      on('studyBackupPrepare',async()=>{if(this.backupPreparing)return;this.backupPreparing=true;const a=document.getElementById('studyBackupDownload'),pid=this.viewPlanId;
        // Invalidate BEFORE any await. Failure must never leave a stale download actionable.
        if(this.backupURL)URL.revokeObjectURL(this.backupURL);this.backupURL=null;a.classList.add('hidden');a.removeAttribute('href');a.removeAttribute('download');a.textContent='保存备份到文件';
        try{const out=await this.backup(pid);if(pid!==this.viewPlanId)throw Error('查看的计划已改变，请为当前计划重新准备备份');
          const blob=await Backup.file(out);if(pid!==this.viewPlanId)throw Error('查看的计划已改变，请为当前计划重新准备备份');
          this.backupURL=URL.createObjectURL(blob);a.href=this.backupURL;a.download=`mahjong-plan-${pid}.json`;a.textContent=`保存计划 ${pid} · ${out.payload.exported_at} · 已持久化档案快照`;a.classList.remove('hidden');
          document.getElementById('studyMessage').textContent=`备份计划：${pid}；生成：${out.payload.exported_at}；快照：已持久化记录（不续打Worker），${out.payload.counts.games}局。请实际保存后选回核验；生成链接不代表已备份。`;
        }finally{this.backupPreparing=false;}});
      const resetPreview=()=>{this.backupPreview=null;document.getElementById('studyBackupConsent').checked=false;document.getElementById('studyBackupRestore').disabled=true;};
      document.getElementById('studyBackupFile').onchange=async e=>{resetPreview();const token=id();this.backupSelectionToken=token;const file=e.target.files?.[0],label=document.getElementById('studyBackupPreview');label.textContent='';if(!file)return;
        try{const v=await this.previewBackup(await file.text());if(token!==this.backupSelectionToken)return;this.backupPreview=v;label.textContent=v.restorable?`SHA-256通过；只读预览，尚未恢复。\n计划：${v.plan_id}\n用途：${v.payload.dataset.plans[0].purpose}\n来源通道：${v.payload.source.storage_channel}\n自动化虚构数据：${v.payload.source.automated_test}\n数量：${JSON.stringify(v.counts)}\n内容SHA-256：${v.content_sha256}\n不保证这些记录具有正式真人样本资格。`:v.reason;
        }catch(err){if(token!==this.backupSelectionToken)return;resetPreview();label.textContent='核验失败，未写入：'+String(err.message||err);}};
      document.getElementById('studyBackupConsent').onchange=e=>{document.getElementById('studyBackupRestore').disabled=!e.target.checked||!this.backupPreview?.restorable;};
      on('studyBackupRestore',async()=>{if(this.backupUIBusy)return;this.backupUIBusy=true;try{const r=await this.restoreBackup(document.getElementById('studyBackupConsent').checked);document.getElementById('studyMessage').textContent=r.status==='identical'?'相同计划及内容已存在，没有重复导入。':'计划档案已原子恢复并逐字段核对；没有重放麻将动作。';resetPreview();}finally{this.backupUIBusy=false;}});
      on('studyRevision',()=>{if(!this.firstAnswer())throw Error('当前没有可追加的已锁定回答');this.openQuestion(this.firstAnswer().planned_action,true);});
      on('studyPreflight',async()=>{const p=await this.preflightMigration();this.migrationToken=p.id||null;document.getElementById('studyMigrationConsent').checked=false;document.getElementById('studyMigrate').disabled=true;
        document.getElementById('studyMigrationInfo').textContent=!p.source_exists?'没有旧数据库；新版保持空库，不制造迁移记录。':p.already_migrated?'本源库已迁移，不重复插入。'+(p.source_changed?'源库后来有变化，暂停追加导入。':''):
          '只读预检数量：'+LEGACY_STORES.map(n=>n+' '+p.counts[n]).join('；')+'\n内容指纹：'+p.fingerprint+'\n需本人勾选确认后才复制。';});
      document.getElementById('studyMigrationConsent').onchange=e=>document.getElementById('studyMigrate').disabled=!this.testing||!e.target.checked||!this.migrationToken;
      on('studyMigrate',async()=>{const report=await this.confirmMigration(this.migrationToken,document.getElementById('studyMigrationConsent').checked);document.getElementById('studyMigrationInfo').textContent='复制完成；源库未改动。按表保留数量：'+JSON.stringify(report.copied_counts);this.migrationToken=null;document.getElementById('studyMigrate').disabled=true;});
      const closeForm=()=>{this.formOpen=false;document.getElementById('studyQuestion').classList.add('hidden');hooks.refresh();};
      document.getElementById('studyLater').onclick=closeForm;
      document.getElementById('studyUnknown').onclick=()=>{for(const el of document.querySelectorAll('#studyForm input,#studyForm textarea,#studyForm select')){
        if(el.value||el.closest('[hidden]'))continue;if(el.tagName==='SELECT')el.value=[...el.options].find(o=>o.value&&/不知道|不确定/.test(o.textContent))?.value||'';else el.value='不知道';
      }};
      const submit=async skip=>{const form=document.getElementById('studyForm');if(this.answerBusy)return;this.answerBusy=true;
        try{const fields=Object.fromEntries(new FormData(form)),value=document.getElementById('studyFollowupTarget').value,
          selection={version:'help-followup-v1',scope:value.startsWith('help:')?'specific':value,context_help_ids:value.startsWith('help:')?[value.slice(5)]:value==='combined'?[...form.helpContextIds]:[]};
          await this.saveAnswer(fields,this.planned,skip,form.dataset.revision==='true',form.dataset.decisionId,selection);closeForm();}
        catch(e){document.getElementById('studyAnswerError').textContent=String(e.message||e);}finally{this.answerBusy=false;}};
      document.getElementById('studyForm').onsubmit=e=>{e.preventDefault();submit(false);};document.getElementById('studySkip').onclick=()=>submit(true);
      this.paint();
    }
  }
  return {VERSION,APP,HELP_VERSION,FREEPLAY_VERSION,FORMAL_FREEPLAY_PROTOCOL,formalFreeplayProgress,formalFreeplayBuildReady,publicSettlement,formalBuildReady,helpPayload,helpFollowups,validateTeaching,RECORD_PROTOCOL,CHANNELS,BACKUP_FORMAT,BACKUP_VERSION,Backup,readBackupTree,STORES,LEGACY_STORES,snapshot,submitted,triggers,progress,planProgress,reliableProgress,thresholds,canonical,envelope,Database,Controller,LegacyMigration,legacyFence,legacyBundle,digest};
})();

