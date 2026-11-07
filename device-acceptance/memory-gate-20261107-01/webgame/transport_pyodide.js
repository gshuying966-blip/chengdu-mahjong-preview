/* Transport for app.html: runs the engine in a Web Worker (worker.js) via
   Pyodide, so AI "thinking" time never blocks the UI thread. Bridges the
   worker's request/response protocol to the same
   window.__transport(path, body) -> Promise<json> shape transport_fetch.js
   provides, so game.js is identical between the two entry points. */
(function(){
  const manifestURL=new URL('../release.json',document.currentScript.src);
  const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
  const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
  // A missing manifest is explicit unverified development mode, never a formal channel.
  const identityReady=(async()=>{const r=await fetch(manifestURL,{cache:'no-store'});
    if(r.status===404)return Object.freeze({verified:false,storage_channel:'development_preview',app_release:'unpackaged-development'});
    if(!r.ok)throw Error('构建清单加载失败');const m=await r.json(),identity=m.build_identity;
    if(!identity||!['formal_learning','device_acceptance','development_preview'].includes(identity.storage_channel))throw Error('构建身份格式无效');
    const plain={...identity};delete plain.build_id;
    if(await sha(new TextEncoder().encode(canonical({identity:plain,files:m.files})))!==identity.build_id)throw Error('构建清单指纹无效');
    await Promise.all(Object.entries(m.files).map(async([name,entry])=>{
      if(!/^[A-Za-z0-9_.\/-]+$/.test(name)||name.split('/').includes('..'))throw Error('非法资源路径');
      const r=await fetch(new URL(name,manifestURL),{cache:'no-store'});if(!r.ok)throw Error('版本资源缺失：'+name);
      const b=await r.arrayBuffer();if(b.byteLength!==entry.bytes||await sha(b)!==entry.sha256)throw Error('版本资源不一致：'+name);
    }));return Object.freeze({...identity,verified:true,verification:'SRI-main-scripts + resource-SHA256'});
  })();
  window.__buildIdentityReady=identityReady.then(x=>(globalThis.__mahjongBuild=x));
  let worker = null, fatal = null, ready = false;
  let nextId = 1;
  const pending = new Map();
  const LIMIT_MS = 180000;

  function fail(reason){
    if(fatal) return;
    fatal = new Error('本机计算加载或运行失败：' + reason + '。请检查网络后刷新重试；刷新会重新开局。');
    clearTimeout(startupTimer);
    const splash = document.getElementById('bootSplash');
    if(splash) splash.classList.remove('hidden');
    const text = document.getElementById('bootText');
    if(text) text.textContent = fatal.message;
    const retry = document.getElementById('bootRetry');
    if(retry) retry.classList.remove('hidden');
    if(worker) worker.terminate();
    for(const p of pending.values()){clearTimeout(p.timer);p.reject(fatal);}
    pending.clear();
  }
  const startupTimer = setTimeout(()=>fail('等待运行时超过3分钟'), LIMIT_MS);
  try {
    worker = new Worker('worker.js');
    worker.onerror = ev => {
      if(ev.preventDefault) ev.preventDefault();
      fail(ev.message || 'Worker启动失败或被浏览器终止');
    };
    worker.onmessageerror = ()=>fail('Worker消息无法读取');
  } catch(err){fail(err.message || String(err));}

  if(worker) worker.onmessage = (ev) => {
    if(fatal) return;
    const msg = ev.data;
    if(msg.type === 'progress'){
      const el = document.getElementById('bootText');
      if(el) el.textContent = msg.text;
      return;
    }
    if(msg.type === 'boot_error'){
      fail(msg.text);
      return;
    }
    if(msg.type === 'ready'){
      window.__buildIdentityReady.then(identity=>{
      if(identity.verified&&identity.build_id!==msg.build_identity?.build_id){fail('主线程和Worker构建身份不一致');return;}
      ready = true;
      clearTimeout(startupTimer);
      const splash = document.getElementById('bootSplash');
      if(splash) splash.classList.add('hidden');
      }).catch(e=>fail(e.message));
      return;
    }
    const p = pending.get(msg.id);
    if(!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if(msg.error){ p.reject(new Error(msg.error)); }
    else p.resolve(msg.result);
  };
  window.__buildIdentityReady.catch(e=>fail(e.message));

  // path -> worker fn name, mirrors server.py's URL routing
  const ROUTES = {
    '/api/new': 'new', '/api/act': 'act', '/api/step': 'step',
    '/api/state': 'state', '/api/hint': 'hint', '/api/daily_par': 'daily_par',
    '/api/hand_math': 'hand_math',
  };

  window.__transport = function(path, body){
    if(fatal) return Promise.reject(fatal);
    const fn = ROUTES[path];
    if(!fn) return Promise.resolve(null);
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(()=>fail(ready ? '计算响应超时，未自动重试操作' : '运行时未就绪'), LIMIT_MS);
      pending.set(id, {resolve, reject, timer});
      window.__buildIdentityReady.then(()=>{try{worker.postMessage({id, fn, args: body});}
      catch(err){fail(err.message || String(err));}}).catch(e=>fail(e.message));
    });
  };
})();
