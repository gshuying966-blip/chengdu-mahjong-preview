/* Transport for app.html: runs the engine in a Web Worker (worker.js) via
   Pyodide, so AI "thinking" time never blocks the UI thread. Bridges the
   worker's request/response protocol to the same
   window.__transport(path, body) -> Promise<json> shape transport_fetch.js
   provides, so game.js is identical between the two entry points. */
(function(){
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
      ready = true;
      clearTimeout(startupTimer);
      const splash = document.getElementById('bootSplash');
      if(splash) splash.classList.add('hidden');
      return;
    }
    const p = pending.get(msg.id);
    if(!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if(msg.error){ p.reject(new Error(msg.error)); }
    else p.resolve(msg.result);
  };

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
      try{worker.postMessage({id, fn, args: body});}
      catch(err){fail(err.message || String(err));}
    });
  };
})();
