'use strict';
(()=>{
 const names=Object.freeze(['mahjong-test-scale-probe-20261107-v1-control','mahjong-test-scale-probe-20261107-v1-source','mahjong-test-scale-probe-20261107-v1-restored']);
 const allowed=new Set(names),opens=[],denied=[];
 const native=IDBFactory.prototype.open;
 Object.defineProperty(IDBFactory.prototype,'open',{configurable:false,writable:false,value:function(name,...args){
  name=String(name);if(!allowed.has(name)){denied.push(name);throw new Error('安全阻断：本页面禁止打开非容量测试数据库');}
  opens.push({name,at:performance.now()});return native.call(this,name,...args);
 }});
 Object.defineProperty(IDBFactory.prototype,'deleteDatabase',{configurable:false,writable:false,value:function(){throw new Error('安全阻断：本页面不允许删除数据库');}});
 if(IDBFactory.prototype.databases)Object.defineProperty(IDBFactory.prototype,'databases',{configurable:false,writable:false,value:function(){throw new Error('安全阻断：本页面不枚举已有数据库');}});
 Object.defineProperty(globalThis,'ScaleIsolation',{value:Object.freeze({names,opens,denied}),writable:false,configurable:false});
})();

