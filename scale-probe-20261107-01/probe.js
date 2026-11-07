'use strict';
(()=>{
 const M=MahjongStudy,VERSION='scale-probe-20261107-v1',LIMIT=180000;
 const $=id=>document.getElementById(id),TABLES=['plans','games','decisions','answers','events','legacy_quarantine','app_meta'];
 const [CONTROL,SOURCE,TARGET]=ScaleIsolation.names;
 const events=[],pageId=crypto.randomUUID?.()||String(Date.now()),opened=new Set();
 let meta,fixture,identity,state={version:VERSION,attempts:{A:0,B:0}},busy=false,stopped=false,late=false,downloadURL=null,sourceDB=null,targetDB=null;
 const now=()=>new Date().toISOString(),req=r=>new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});
 const sha=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(n=>n.toString(16).padStart(2,'0')).join('');
 function mark(kind,detail={}){events.push({kind,detail,mono_ms:performance.now(),at:now(),page_id:pageId});}
 async function readMeta(){return req(meta.transaction('state').objectStore('state').get('main'));}
 async function persist(){const snapshot=structuredClone({...state,events:[...(state.events||[]),...events],last_page:pageId});events.length=0;
  await new Promise((ok,no)=>{const tx=meta.transaction('state','readwrite');tx.objectStore('state').put(snapshot,'main');tx.oncomplete=ok;tx.onabort=()=>no(tx.error||Error('测试结果状态保存失败'));});
  state=snapshot;
 }
 function fail(code,message){const e=new Error(message);e.code=code;return e;}
 function tell(text){$('status').textContent=text;}
 function details(){const compact={...state};delete compact.events;$('details').textContent=JSON.stringify({...compact,current_page_events:events,isolation:{allowed_databases:ScaleIsolation.names,opened:[...new Set(ScaleIsolation.opens.map(x=>x.name))],denied:ScaleIsolation.denied},safari_memory_peak:'not measured'},null,2);
  $('stateSummary').textContent=state.B?.verified?'已恢复，20局/10+10及逐字段核对通过':state.A?.bytes?'已生成约60MB备份，等待重新选择文件':state.failure?'本次失败，未通过':'尚未执行';
 }
 function buttons(){const off=busy||stopped||late;
  $('generate').disabled=off||!fixture||(state.attempts.A>=2&&!downloadURL);
  $('generate').textContent=downloadURL?'1. 再次保存已生成的同一份备份':'1. 生成20局并下载测试备份';
  $('file').disabled=off||!state.A?.bytes||state.attempts.B>=2;
  $('chooseLabel').setAttribute('aria-disabled',String($('file').disabled));
 }
 async function openDB(name){if(![SOURCE,TARGET].includes(name))throw fail('ISOLATION','非测试数据库被拒绝');
  // Called only inside withLock's actual exclusive navigator.locks callback.
  const db=await new M.Database(name,true).open();db.channel='device_acceptance';db.lockHeld=true;await db.ensureGate();opened.add(name);return db;
 }
 async function withLock(fn){if(!navigator.locks)throw fail('UNSUPPORTED','本浏览器不支持安全测试锁；未执行，未访问原记录');
  return navigator.locks.request('mahjong-test-scale-probe-20261107-v1-lock',{mode:'exclusive',ifAvailable:true},async lock=>{
   if(!lock)throw fail('LOCKED','另一测试标签正在操作，请关闭另一个容量测试页面后重试，不要清理Safari');
   sourceDB ||= await openDB(SOURCE);targetDB ||= await openDB(TARGET);
   sourceDB.lockHeld=targetDB.lockHeld=true;
   try{return await fn();}finally{sourceDB.lockHeld=targetDB.lockHeld=false;}
  });
 }
 function checkStill(){if(late)throw fail('TIMEOUT','操作超过180秒，禁止继续或自动重试；重开后核查测试状态');}
 function assertFixture(v){
  if(!v.restorable||v.plan_id!==fixture.plan_id||v.content_sha256!==fixture.content_sha256||v.payload.source.automated_test!==true)throw fail('FIXTURE_MISMATCH','不是本轮指定的虚构20局测试文件；未恢复');
  for(const n of TABLES)if(v.counts[n]!==fixture.counts[n])throw fail('COUNTS','记录条数不一致；未通过');
  const gs=v.payload.dataset.games;
  if(gs.length!==20||gs.some(g=>g.status!=='completed')||gs.filter(g=>g.exchange_enabled===true).length!==10||gs.filter(g=>g.exchange_enabled===false).length!==10)throw fail('MODES','20局/10+10完成状态不一致');
 }
 function nativeNormalized(value){if(Array.isArray(value))return value.map(nativeNormalized);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,nativeNormalized(value[k])]));return value;}
 const sameRow=(a,b)=>JSON.stringify(nativeNormalized(a))===JSON.stringify(nativeNormalized(b));
 async function keys(db,table){const all=await req(db.db.transaction(table).objectStore(table).getAllKeys());return table==='app_meta'?all.filter(k=>String(k).startsWith('command:')):all;}
 async function compareDatabases(){
  let total=0;const counts={};let modes={exchange:0,skip:0};
  for(const table of TABLES){
   checkStill();const [ka,kb]=await Promise.all([keys(sourceDB,table),keys(targetDB,table)]);
   if(!sameRow(ka,kb)||ka.length!==fixture.counts[table])throw fail('READBACK_COUNTS','重读测试库的ID或条数不一致：'+table);
   counts[table]=ka.length;
   for(let i=0;i<ka.length;i++){
    checkStill();const [a,b]=await Promise.all([sourceDB.get(table,ka[i]),targetDB.get(table,ka[i])]);
    if(!sameRow(a,b))throw fail('READBACK_FIELDS','重读测试库逐字段不一致：'+table+'，序号'+i);
    if(table==='games'){if(a.status!=='completed')throw fail('READBACK_STATUS','完成局状态不正确');if(a.exchange_enabled)modes.exchange++;else modes.skip++;}
    total++;if(total%200===0){$('progress').value=total/17681;tell('逐字段核对 '+total+' / 17681 条测试记录……');await new Promise(r=>setTimeout(r,0));}
   }
  }
  if(modes.exchange!==10||modes.skip!==10)throw fail('READBACK_MODES','重读玩法数量不一致');
  const receipt=await targetDB.get('app_meta','restore:'+fixture.plan_id);
  if(receipt?.content_sha256!==fixture.content_sha256||receipt.no_engine_replay!==true)throw fail('RESTORE_RECEIPT','测试库缺少原子恢复回执');
  return {matched_rows:total,counts,modes,restore_receipt_hash:receipt.content_sha256,source_and_target_fields_equal:true};
 }
 async function run(op,fn){
  if(busy||stopped||late)return;
  if((state.attempts[op]||0)>=2){$('error').hidden=false;$('error').textContent='已达到最多两次尝试，停止；请保留结果。';return;}
  busy=true;state.attempts[op]=(state.attempts[op]||0)+1;state.in_progress={op,page_id:pageId,at:now()};state.failure=null;
  $('error').hidden=true;$('progress').value=0;buttons();mark('operation_start',{op,attempt:state.attempts[op]});let timer,start=performance.now();
  try{
   await persist();
   timer=setTimeout(()=>{late=true;$('error').hidden=false;$('error').textContent='超过180秒，结果未通过。若已有事务正在落定，不能自动取消或重试；请重开后核查。';tell('TIMEOUT · 未通过');buttons();},LIMIT);
   const result=await withLock(fn);checkStill();mark('operation_completed',{op,ms:performance.now()-start});
   state[op]={...result,ms:performance.now()-start,at:now()};state.in_progress=null;
   if(op==='B')state.reopen_pending=true;
   await persist();$('progress').value=1;tell(op==='A'?'20局测试备份已生成，正在交给浏览器保存到“文件”':'恢复及逐字段核对通过。请关闭Safari，再打开同一地址核查持久化。');
   if(op==='A')download();
  }catch(e){
   mark('operation_failed',{op,code:e.code||e.name,message:String(e.message),ms:performance.now()-start});
   state.failure={op,code:e.code||e.name,message:String(e.message),at:now(),not_pass:true};
   state.failures=[...(state.failures||[]),state.failure];state.in_progress=null;
   if(late){state.needs_reopen=true;stopped=true;}
   try{await persist();}catch{stopped=true;}
   $('error').hidden=false;$('error').textContent=(e.code||e.name)+'：'+e.message;tell('未通过，请保留此结果');
  }finally{clearTimeout(timer);busy=false;buttons();details();}
 }
 function download(){if(!downloadURL)return;const a=$('download');a.href=downloadURL;a.click();mark('download_handoff',{bytes:state.A.bytes});}
 async function generate(){
  if(downloadURL){download();return;}
  await run('A',async()=>{
   if(!globalThis.DecompressionStream)throw fail('UNSUPPORTED','本Safari缺少gzip解压能力；未执行，不能用小文件代替');
   tell('下载2.8MB虚构夹具并解压为约60MB……');
   let response=await fetch('./synthetic-20.json.gz',{cache:'no-cache',credentials:'omit'});
   if(!response.ok)throw fail('FIXTURE_NETWORK','虚构夹具下载失败 HTTP '+response.status);
   let packed=await response.arrayBuffer();response=null;
   if(packed.byteLength!==fixture.compressed_bytes||await sha(packed)!==fixture.compressed_sha256)throw fail('GZIP_SHA','压缩夹具SHA-256不一致');
   let stream=new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'));packed=null;
   let text=await new Response(stream).text();stream=null;
   if(new TextEncoder().encode(text).byteLength!==fixture.uncompressed_bytes||await sha(new TextEncoder().encode(text))!==fixture.uncompressed_sha256)throw fail('FIXTURE_SHA','解压夹具字节或SHA-256不一致');
   checkStill();tell('调用原版Backup.validate及restore，建立独立测试源库……');
   let checked=await M.Backup.validate(text,sourceDB);text=null;assertFixture(checked);
   const seed=await M.Backup.restore(sourceDB,checked);checked=null;checkStill();mark('synthetic_source_restored',{status:seed.status});
   tell('调用原版Backup.make及file，制作约60MB备份……');
   const controller={assertIdle(){checkStill();},writer:true,available:true,channel:'device_acceptance',testing:true,db:sourceDB,queue:fn=>fn()};
   let out=await M.Backup.make(controller,fixture.plan_id);
   if(out.payload.content_sha256!==fixture.content_sha256)throw fail('MAKE_SHA','生成备份内容与固定夹具不同');
   const summary={bytes:0,counts:out.payload.counts,content_sha256:out.payload.content_sha256,payload_sha256:out.checksum.value,plan_id:fixture.plan_id,synthetic:true,seed_status:seed.status};
   let blob=await M.Backup.file(out);out=null;summary.bytes=blob.size;
   if(blob.size<59000000||blob.size>61000000)throw fail('SIZE','备份未达到固定20局约60MB规模');
   checkStill();if(downloadURL)URL.revokeObjectURL(downloadURL);downloadURL=URL.createObjectURL(blob);blob=null;return summary;
  });
 }
 async function selected(file){
  if(!file)return;
  await run('B',async()=>{
   if(file.size!==state.A.bytes)throw fail('WRONG_FILE','请只选择第一步刚保存的虚构JSON；大小不匹配，未读取文件');
   tell('读取重新选择的约60MB文件并执行原版SHA及格式核验……');
   let text;try{text=await file.text();}catch{throw fail('FILE_SELECTION','Safari无法读取所选文件');}
   let checked=await M.Backup.validate(text,targetDB);text=null;assertFixture(checked);
   if(checked.envelope.checksum.value!==state.A.payload_sha256)throw fail('WRONG_FILE_SHA','不是本轮刚生成的那一份文件；未恢复');
   checkStill();tell('恢复到独立临时目标库，等待原子事务完成……');
   const restored=await M.Backup.restore(targetDB,checked);checked=null;checkStill();mark('target_restore_committed',restored);
   const readback=await compareDatabases();checkStill();
   return {verified:true,restore_status:restored.status,content_sha256:fixture.content_sha256,readback,original_game_databases_opened:0};
  });
 }
 async function reopenVerify(){
  busy=true;buttons();const start=performance.now();let timer;
  try{
   timer=setTimeout(()=>{late=true;tell('重开核验超时，未通过');buttons();},LIMIT);
   tell('检测到此前恢复结果，正在实际重读测试库逐字段核对……');
   const readback=await withLock(compareDatabases);checkStill();
   const fromOtherPage=state.B?.at&&state.last_page!==pageId;
   state.reopen={verified:true,at:now(),page_id:pageId,distinct_page:!!fromOtherPage,ms:performance.now()-start,readback};state.reopen_pending=false;
   mark('reopen_database_verified',state.reopen);await persist();
   $('reopenSummary').textContent='新页面重读通过：20局、10+10及全部17681条记录仍一致。是否确已关闭Safari由本人确认。';
   tell('测试记录重开核验通过；真实iPhone结果仍须由本人反馈');
  }catch(e){state.reopen={verified:false,error:e.message,at:now()};try{await persist();}catch{}$('reopenSummary').textContent='重开核验失败：'+e.message;$('error').hidden=false;$('error').textContent=e.message;}
  finally{clearTimeout(timer);busy=false;buttons();details();}
 }
 async function boot(){
  $('chooseLabel').addEventListener('click',e=>{if($('file').disabled)e.preventDefault();});
  $('generate').addEventListener('click',generate);
  $('file').addEventListener('change',async e=>{const file=e.target.files[0];e.target.value='';await selected(file);});
  if(!crypto.subtle||!globalThis.indexedDB)throw fail('UNSUPPORTED','需要支持安全HTTPS、WebCrypto及IndexedDB的浏览器');
  meta=await new Promise((ok,no)=>{const r=indexedDB.open(CONTROL,1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});
  const prior=await readMeta();if(prior){if(prior.version!==VERSION)throw fail('VERSION','测试状态版本不匹配');state=prior;}
  [fixture,identity]=await Promise.all(['fixture-manifest.json','build-identity.json'].map(async name=>{const r=await fetch('./'+name,{cache:'no-cache',credentials:'omit'});if(!r.ok)throw fail('NETWORK','测试清单加载失败');return r.json();}));
  globalThis.__mahjongBuild=Object.freeze(identity);
  if(identity.formal_approval?.status!=='unapproved'||fixture.synthetic_only!==true||fixture.uncompressed_bytes!==59882257||fixture.counts.games!==20)throw fail('IDENTITY','验收身份或规模不匹配');
  mark('page_opened',{version:VERSION,prior:!!prior});
  if(state.in_progress){const interrupted=state.in_progress;state.failure={op:interrupted.op,code:'INTERRUPTED_UNKNOWN',message:'上一页操作未完成；可能关页、Safari回收或崩溃，原因未知。未计通过。',at:now()};state.failures=[...(state.failures||[]),state.failure];state.in_progress=null;await persist();$('error').hidden=false;$('error').textContent=state.failure.message;}
  details();buttons();
  if(state.B?.verified)await reopenVerify();else tell(state.A?.bytes?'第一步记录仍在，可重新选择此前保存的虚构JSON':'隔离环境就绪，请进行第一步');
 }
 window.addEventListener('error',e=>{mark('page_error',{message:e.message});});
 window.addEventListener('unhandledrejection',e=>{mark('unhandled_rejection',{message:String(e.reason?.message||e.reason)});});
 boot().catch(e=>{stopped=true;$('error').hidden=false;$('error').textContent=e.code+': '+e.message;tell('未执行 · 环境或隔离检查未通过');buttons();});
})();

