/* Runs the shared Python engine inside a Web Worker via Pyodide,
   so the UI thread never blocks on AI "thinking" time. Fetches the .py
   sources from this worker's own directory (webgame/) and its siblings
   (repo root), writes them into Pyodide's virtual filesystem at matching
   relative paths, then imports pwa_bridge.py exactly as the local dev
   simulation was verified against.
*/
const PYODIDE_BASE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';

// Transport receipt ledger only: never changes a Mahjong rule or sees a hidden tile.
class CommandRegistry {
  constructor(){this.workerId=crypto.randomUUID();this.revision=0;this.seen=new Map();this.results=new Map();}
  state(value){return {...value,...(globalThis.__mahjongWorkerBuild?{_build_identity:globalThis.__mahjongWorkerBuild}:{}),_recording_protocol:{version:2,worker_id:this.workerId,revision:this.revision}};}
  run(kind,args,execute){
    if(args?._command&&(args._command.intent||args._command.fingerprint)&&args._command.protocol!==2)throw Error('Invalid sealed command protocol');
    if(args?._command?.protocol===2)return this.runSealed(kind,args,execute);
    return this.runLegacy(kind,args,execute);
  }
  async runSealed(kind,args,execute){
    const c=args._command,i=c.intent;
    const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
    if(!i||typeof i.game_id!=='string'||!i.game_id||!(i.plan_id===null||typeof i.plan_id==='string')||typeof i.created_at!=='string'||!i.created_at||!i.configuration||!i.configuration.rules||i.exchange_enabled!==i.configuration.rules.exchange_enabled||i.version!==2||i.command_id!==c.id||i.worker_id!==c.worker_id||i.expected_revision!==c.expected_revision||i.kind!==kind)throw Error('Command intent identity mismatch');
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(i))),hash=Array.from(new Uint8Array(bytes)).map(b=>b.toString(16).padStart(2,'0')).join('');
    const body={...args};delete body._command;
    if(hash!==c.fingerprint||canonical(body)!==canonical(i.payload))throw Error('Command content fingerprint mismatch');
    return this.runLegacy(kind,args,input=>{const state=execute(input);
      if(state.ai!==i.configuration.ai||canonical(state.rules)!==canonical(i.configuration.rules))throw Error('Actual game configuration differs from frozen intent');
      return state;});
  }
  runLegacy(kind,args,execute){
    const input={...(args||{})},command=input._command;delete input._command;
    if(!command){let value;try{value=execute(input);}finally{this.revision++;}return this.state(value);}
    const stable=x=>Array.isArray(x)?'['+x.map(stable).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}':JSON.stringify(x);
    const signature=stable({kind,input,command});
    if(typeof command.id!=='string'||command.id.length<8||command.id.length>120||!Number.isInteger(command.expected_revision)||command.expected_revision<0)throw Error('Invalid command descriptor');
    if(this.seen.has(command.id)){
      if(this.seen.get(command.id)!==signature)throw Error('Command ID payload conflict');
      if(!this.results.has(command.id))throw Error('Receipt expired or execution unknown; command will NOT be repeated');
      return JSON.parse(JSON.stringify(this.results.get(command.id)));
    }
    if(command.worker_id!==this.workerId||command.expected_revision!==this.revision)throw Error('Stale worker or state revision; command rejected');
    this.seen.set(command.id,signature);
    let value;try{value=execute(input);}catch(e){this.revision++;throw Error('Command execution uncertain; do not repeat: '+e.message);}
    this.revision++;
    const result={...this.state(value),_receipt:{command_id:command.id,kind,worker_id:this.workerId,expected_revision:command.expected_revision,revision:this.revision,accepted:true,engine_game:value.game_id,...(command.protocol===2?{fingerprint:command.fingerprint,intent:command.intent,actual_configuration:{ai:value.ai,rules:value.rules}}:{})}};
    this.results.set(command.id,result);while(this.results.size>8)this.results.delete(this.results.keys().next().value);
    return JSON.parse(JSON.stringify(result));
  }
}
const commandRegistry=new CommandRegistry();

// vfs path -> source URL, relative to this worker script
const SOURCES = {
  '/mahjong/dfncy/block_dfncy.py': '../dfncy/block_dfncy.py',
  '/mahjong/hytreekong.py': '../hytreekong.py',
  '/mahjong/strategy_defense.py': '../strategy_defense.py',
  '/mahjong/strategy_huev.py': '../strategy_huev.py',
  '/mahjong/strategy_initial21_7attr.py': '../strategy_initial21_7attr.py',
  '/mahjong/strategyz0614.py': '../strategyz0614.py',
  '/mahjong/utils/constants.py': '../utils/constants.py',
  '/mahjong/utils/daque.py': '../utils/daque.py',
  '/mahjong/utils/hutype.py': '../utils/hutype.py',
  '/mahjong/utils/hysolx.py': '../utils/hysolx.py',
  '/mahjong/utils/pusolx.py': '../utils/pusolx.py',
  '/mahjong/utils/xzcard.py': '../utils/xzcard.py',
  '/mahjong/utils/xzscore.py': '../utils/xzscore.py',
  '/mahjong/utils/xzutils.py': '../utils/xzutils.py',
  '/mahjong/xzdealer.py': '../xzdealer.py',
  '/mahjong/xzjudger.py': '../xzjudger.py',
  '/mahjong/xzplayer.py': '../xzplayer.py',
  '/mahjong/xzround.py': '../xzround.py',
  '/mahjong/webgame/game_core.py': './game_core.py',
  '/mahjong/webgame/pwa_bridge.py': './pwa_bridge.py',
};

let bridge = null;

async function boot(){
  const manifestURL=new URL('../release.json',self.location.href),manifestResponse=await fetch(manifestURL,{cache:'no-store'});
  const manifest=manifestResponse.status===404?null:await manifestResponse.json();
  if(manifest&&!manifest.build_identity)throw Error('Worker构建身份缺失');
  const verify=async(url,bytes)=>{if(!manifest)return;const path=new URL(url,self.location.href).href.slice(new URL('.',manifestURL).href.length),entry=manifest.files[path];
    const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
    if(!entry||entry.bytes!==bytes.byteLength||entry.sha256!==sha)throw Error('Worker实际资源版本不一致：'+path);};
  if(manifest){const own=await fetch(self.location.href,{cache:'no-store'});if(!own.ok)throw Error('Worker源码不可核实');await verify(self.location.href,await own.arrayBuffer());}
  globalThis.__mahjongWorkerBuild=manifest?{...manifest.build_identity,verified:true}:{verified:false,storage_channel:'development_preview'};
  postMessage({type:'progress', text:'加载 Python 运行时…'});
  // Loader failures must reach boot_error, including Safari/CDN/network errors.
  importScripts(PYODIDE_BASE + 'pyodide.js');
  const pyodide = await loadPyodide({indexURL: PYODIDE_BASE});

  postMessage({type:'progress', text:'下载对局引擎源码…'});
  const files = {};
  await Promise.all(Object.entries(SOURCES).map(async ([vfsPath, url]) => {
    const r = await fetch(url, {cache:'no-cache'});
    if(!r.ok) throw new Error(`fetch ${url} failed: ${r.status}`);
    const bytes=await r.arrayBuffer();await verify(url,bytes);files[vfsPath] = new TextDecoder().decode(bytes);
  }));

  postMessage({type:'progress', text:'初始化对局引擎…'});
  pyodide.globals.set('_vfs_files', pyodide.toPy(files));
  pyodide.runPython(`
import os
for _path, _content in _vfs_files.items():
    os.makedirs(os.path.dirname(_path), exist_ok=True)
    with open(_path, 'w', encoding='utf-8') as _f:
        _f.write(_content)
import sys
sys.path.insert(0, '/mahjong/webgame')
`);
  bridge = pyodide.pyimport('pwa_bridge');
  postMessage({type:'ready',build_identity:globalThis.__mahjongWorkerBuild});
}
const bootPromise = boot();
bootPromise.catch(err => {
  postMessage({type:'boot_error', text: String(err)});
});

const DISPATCH = {
  new: (args) => bridge.api_new(args),
  act: (args) => bridge.api_act(args),
  step: () => bridge.api_step(),
  state: () => bridge.api_state(),
  hint: () => bridge.api_hint(),
  hand_math: () => bridge.api_hand_math(),
  daily_par: () => bridge.api_daily_par(),
};

self.onmessage = async (ev) => {
  const {id, fn, args} = ev.data;
  try{
    await bootPromise;
    const invoke=input=>{const jsonStr=DISPATCH[fn](input?JSON.stringify(input):undefined),value=jsonStr?JSON.parse(jsonStr):null;
      if(value?._status>=400)throw Error(value.error||'engine rejected request');return value;};
    const result=['new','act','step'].includes(fn)?await commandRegistry.run(fn,args,invoke):fn==='state'?commandRegistry.state(invoke(args)):invoke(args);
    postMessage({id, result});
  } catch(err){
    postMessage({id, error: String(err && err.message || err)});
  }
};
