import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { TextDecoder, TextEncoder } from 'node:util';
import { webcrypto } from 'node:crypto';

const source = readFileSync(new URL('../vk-games.js', import.meta.url), 'utf8');
const coreContext={};runInNewContext(readFileSync(new URL('../progress-core.js',import.meta.url),'utf8'),coreContext);
const production=coreContext.TrafficPulseProgress;
const manifestKey = 'trafficpulse_vkg_v2_index';
const epochKey = 'trafficpulse_vkg_v2_reset_epoch';
const prefix = 'trafficpulse_vkg_v2_';

const clone = value => JSON.parse(JSON.stringify(value ?? {}));
const normalize = data => ({
  revision:0,level:1,coins:0,starsByLevel:{},vkPaidCoinsCredited:0,
  vkEntitlements:{},vkPendingSpend:null,...clone(data)
});
function merge(local,remote,base){
  const out={...remote,
    level:Math.max(local.level??1,remote.level??1),
    revision:Math.max(local.revision??0,remote.revision??0),
    starsByLevel:{...remote.starsByLevel,...local.starsByLevel}
  };
  // Mirrors the production three-way intent: never resurrect old cloud currency,
  // but preserve positive offline earnings when we have the last cloud baseline.
  out.coins=base
    ? Math.max(0,(remote.coins??0)+Math.max(0,(local.coins??0)-(base.coins??0)))
    : (remote.coins??0);
  return normalize(out);
}
function localStore(map){
  return {
    getItem:key=>map.has(key)?map.get(key):null,
    setItem:(key,value)=>map.set(key,String(value)),
    removeItem:key=>map.delete(key)
  };
}
function accountStore(all,userId){
  if(!all.has(userId))all.set(userId,new Map());
  return all.get(userId);
}
function harness(allVk,localMap,initialSave={},opts={}){
  let data=normalize(initialSave);
  const operations=[];
  const userId=opts.userId??42,appId=opts.appId??54870403;
  const isOk=opts.client==='ok',okAppId=opts.okAppId??512005046523;
  // OK and VK accounts are separate stores even when their numeric user IDs match.
  const vk=accountStore(allVk,isOk?'ok:'+okAppId+':'+userId:userId);
  const supported=new Set(opts.unsupported?[
    'VKWebAppGetLaunchParams','VKWebAppStorageGet','VKWebAppStorageSet',
    'VKWebAppStorageGetKeys','VKWebAppCheckNativeAds','VKWebAppShowNativeAds','VKWebAppCheckBannerAd','VKWebAppShowBannerAd','VKWebAppHideBannerAd'
  ].filter(x=>!opts.unsupported.includes(x)):[
    'VKWebAppGetLaunchParams','VKWebAppStorageGet','VKWebAppStorageSet',
    'VKWebAppStorageGetKeys','VKWebAppCheckNativeAds','VKWebAppShowNativeAds','VKWebAppCheckBannerAd','VKWebAppShowBannerAd','VKWebAppHideBannerAd'
  ]);
  if(isOk)supported.delete('VKWebAppGetLaunchParams');
  const bridge={
    isEmbedded:()=>Boolean(opts.embedded),
    isWebView:()=>false,
    supportsAsync:async method=>supported.has(method),
    async send(method,payload={}){
      operations.push(method);
      if(opts.rejectStorageSend&&method.startsWith('VKWebAppStorage'))throw Error('storage_not_available');
      if(opts.onCall)await opts.onCall(method,payload);
      if(method==='VKWebAppInit')return {result:true};
      if(method==='VKWebAppGetUserInfo')return {id:opts.infoUserId??userId};
      if(method==='VKWebAppGetLaunchParams'){
        if(isOk)throw Error('OK does not support VKWebAppGetLaunchParams');
        return {
        vk_app_id:opts.launchAppId??appId,
        vk_user_id:opts.launchUserId??userId,
        vk_client:opts.client||'vk',vk_language:'ru',vk_platform:opts.clientPlatform||''
      };
      }
      if(method==='VKWebAppStorageGet')return {
        keys:payload.keys.map(key=>({key,value:vk.get(key)||''}))
      };
      if(method==='VKWebAppStorageSet'){
        if(opts.rejectWrite?.(payload.key,payload.value))throw Error('simulated_write_failure');
        vk.set(payload.key,payload.value);if(opts.afterStorageWrite)await opts.afterStorageWrite(payload);return {result:true};
      }
      if(method==='VKWebAppStorageGetKeys'){
        const keys=[...vk.keys()].slice(payload.offset||0,(payload.offset||0)+(payload.count||100));
        return {keys};
      }
      if(method==='VKWebAppCheckNativeAds')return {result:opts.adAvailable!==false};
      if(method==='VKWebAppShowNativeAds')return {result:opts.adSuccess!==false};
      if(method==='VKWebAppCheckBannerAd')return {result:opts.bannerAvailable!==false,banner_width:320,banner_height:50,banner_location:'bottom',layout_type:'resize',height_type:'compact'};
      if(method==='VKWebAppShowBannerAd'){opts.onBanner?.(payload);return {result:opts.bannerSuccess!==false,banner_width:payload.orientation==='vertical'?160:320,banner_height:payload.orientation==='vertical'?600:50,banner_location:payload.banner_location,banner_align:payload.banner_align,layout_type:payload.layout_type,height_type:payload.height_type,orientation:payload.orientation};}
      if(method==='VKWebAppHideBannerAd')return {result:opts.hideSuccess!==false,banner_width:0,banner_height:0,banner_location:'bottom',layout_type:'overlay',height_type:'compact'};
      throw Error('unexpected_bridge_call: '+method);
    }
  };
  const context={
    vkBridge:bridge,
    location:{search:opts.embedded
      ?(isOk
        ?`?vk_app_id=${appId}&vk_ok_app_id=${okAppId}&vk_ok_user_id=${opts.launchOkUserId??userId}&vk_user_id=${opts.technicalVkId??987654}&vk_language=ru&vk_client=ok&vk_platform=${opts.clientPlatform||'desktop_web_ok'}`
        :`?vk_app_id=${appId}&vk_user_id=${userId}&vk_language=ru&vk_client=${opts.client||'vk'}`)
      :''},
    navigator:{onLine:opts.online!==false},localStorage:localStore(localMap),innerWidth:opts.innerWidth??1280,innerHeight:opts.innerHeight??720,
    crypto:webcrypto,TextDecoder,TextEncoder,URLSearchParams,
    atob:s=>Buffer.from(s,'base64').toString('latin1'),
    btoa:s=>Buffer.from(s,'latin1').toString('base64'),
    setTimeout,clearTimeout,Date,Math,JSON,Number,Promise,Array,Set,Map,
    Uint8Array,Uint32Array,String,Object,RegExp,Boolean
  };
  context.globalThis=context;
  runInNewContext(source,context,{filename:'vk-games.js'});
  const instance=context.TrafficPulseVKGames.create({
    storage:context.localStorage,getSave:()=>data,normalize,merge:opts.productionMerge?production.merge:merge,
    onLoad:value=>{data=normalize(value)},onRead(){},onWrite(){},onDelete(){}
  });
  return {
    instance,operations,vk,getSave:()=>data,setSave:value=>{data=normalize(value)},
    cleanup:()=>clearTimeout(instance.timer)
  };
}

test('outside VK: starts in local mode without requesting account data',async()=>{
  const h=harness(new Map(),new Map(),{revision:5,level:9});
  assert.equal(await h.instance.init(),false);
  assert.equal(h.getSave().level,9);
  assert.ok(!h.operations.includes('VKWebAppGetUserInfo'));
  assert.equal(h.instance.privacyStatus().cloudflarePlayerStorage,false);
  h.cleanup();
});

test('new VK account never imports an unrelated browser profile automatically',async()=>{
  const all=new Map(),local=new Map();
  const h=harness(all,local,{revision:55,level:99,coins:9999},{embedded:true});
  assert.equal(await h.instance.init(),true);
  assert.equal(h.getSave().level,1);
  assert.equal(h.getSave().coins,0);
  assert.equal(h.instance.dirty,false);
  h.cleanup();
});

test('VK native storage persists a generated SHA-256 manifest and loads on another device',async()=>{
  const all=new Map(),localA=new Map();
  const a=harness(all,localA,{}, {embedded:true});
  assert.equal(await a.instance.init(),true);
  a.setSave({revision:1,level:4,coins:70,starsByLevel:{'3':3}});
  a.instance.changed();assert.equal(await a.instance.sync(),true);

  const manifest=JSON.parse(a.vk.get(manifestKey));
  assert.equal(manifest.version,2);
  assert.match(manifest.generation,/^[a-f0-9]{32}$/);
  assert.match(manifest.sha256,/^[a-f0-9]{64}$/);
  assert.ok(manifest.chunks>=1);

  const b=harness(all,new Map(),{}, {embedded:true});
  assert.equal(await b.instance.init(),true);
  assert.equal(b.getSave().level,4);
  assert.equal(b.getSave().coins,70);
  assert.equal(b.getSave().starsByLevel['3'],3);
  a.cleanup();b.cleanup();
});

test('same-account three-way merge preserves offline earnings but does not revive old spent cloud coins',async()=>{
  const all=new Map(),localA=new Map();
  const a=harness(all,localA,{}, {embedded:true});
  await a.instance.init();
  a.setSave({revision:1,level:3,coins:100,starsByLevel:{'2':2}});
  a.instance.changed();await a.instance.sync();
  a.cleanup();

  // Device B spends 40 coins and commits newer cloud state.
  const b=harness(all,new Map(),{}, {embedded:true});
  await b.instance.init();
  b.setSave({...b.getSave(),revision:2,coins:60,level:4});
  b.instance.changed();await b.instance.sync();b.cleanup();

  // Device A was offline from the 100-coin baseline and earned +20 plus a star.
  const a2=harness(all,localA,{revision:3,level:7,coins:120,starsByLevel:{'6':3}},{embedded:true});
  await a2.instance.init();
  assert.equal(a2.getSave().coins,80);
  assert.equal(a2.getSave().level,7);
  assert.equal(a2.getSave().starsByLevel['6'],3);
  a2.cleanup();
});

test('account switch on the same browser cannot expose the previous account save',async()=>{
  const all=new Map(),local=new Map();
  const a=harness(all,local,{}, {embedded:true,userId:42});
  await a.instance.init();
  a.setSave({revision:1,level:12,coins:500});a.instance.changed();await a.instance.sync();a.cleanup();

  const b=harness(all,local,{revision:1,level:12,coins:500},{embedded:true,userId:77});
  await b.instance.init();
  assert.equal(b.getSave().level,1);
  assert.equal(b.getSave().coins,0);
  assert.equal(accountStore(all,77).get(manifestKey),undefined);
  b.cleanup();
});

test('interrupted generation write does not replace the committed pointer',async()=>{
  const all=new Map(),local=new Map();
  const a=harness(all,local,{}, {embedded:true});await a.instance.init();
  a.setSave({revision:1,level:3,coins:23});a.instance.changed();await a.instance.sync();
  const before=a.vk.get(manifestKey);a.cleanup();

  let failed=false;
  const b=harness(all,local,{revision:2,level:8,coins:50},{
    embedded:true,rejectWrite:(key)=>{
      if(key.startsWith(prefix)&&key!==manifestKey&&key!==epochKey&&!failed){failed=true;return true;}
      return false;
    }
  });
  await b.instance.init();
  b.setSave({revision:3,level:8,coins:50});b.instance.changed();
  assert.equal(await b.instance.sync(),false);
  assert.equal(b.vk.get(manifestKey),before);

  const c=harness(all,new Map(),{}, {embedded:true});await c.instance.init();
  assert.equal(c.getSave().level,3);assert.equal(c.getSave().coins,23);
  b.cleanup();c.cleanup();
});

test('large UTF-8 saves are chunked below the VK per-value guard and round-trip',async()=>{
  const all=new Map(),a=harness(all,new Map(),{}, {embedded:true});await a.instance.init();
  const narrative='Поездка по большому городу 🚗'.repeat(270);
  a.setSave({revision:1,level:48,coins:101,narrative,
    starsByLevel:Object.fromEntries(Array.from({length:180},(_,i)=>[String(i+1),3]))});
  a.instance.changed();await a.instance.sync();
  const meta=JSON.parse(a.vk.get(manifestKey));assert.ok(meta.chunks>1);
  for(let i=0;i<meta.chunks;i++)assert.ok((a.vk.get(`${prefix}${meta.generation}_${i}`)||'').length<=3000);

  const b=harness(all,new Map(),{}, {embedded:true});await b.instance.init();
  assert.equal(b.getSave().narrative,narrative);
  assert.equal(b.getSave().starsByLevel['150'],3);
  a.cleanup();b.cleanup();
});

test('corrupt cloud chunk is rejected instead of silently loading damaged progress',async()=>{
  const all=new Map(),a=harness(all,new Map(),{}, {embedded:true});await a.instance.init();
  a.setSave({revision:1,level:5,coins:40});a.instance.changed();await a.instance.sync();
  const meta=JSON.parse(a.vk.get(manifestKey)),key=`${prefix}${meta.generation}_0`;
  a.vk.set(key,(a.vk.get(key)||'').replace(/^./,'A'));a.cleanup();

  const b=harness(all,new Map(),{}, {embedded:true});
  assert.equal(await b.instance.init(),false);
  assert.match(b.instance.error,/checksum|cloud/i);
  b.cleanup();
});

test('deleteData clears only Traffic Pulse VK keys and advances reset epoch',async()=>{
  const all=new Map(),local=new Map(),a=harness(all,local,{}, {embedded:true});await a.instance.init();
  a.setSave({revision:1,level:9,coins:90});a.instance.changed();await a.instance.sync();
  a.vk.set('another_app_key','keep-me');
  assert.equal(await a.instance.deleteData(),true);
  assert.equal(a.vk.get('another_app_key'),'keep-me');
  assert.equal(a.vk.get(manifestKey),'');
  assert.match(a.vk.get(epochKey),/^[a-f0-9]{32}$/);
  for(const [key,value] of a.vk)if(key.startsWith(prefix)&&key!==epochKey)assert.equal(value,'');
  assert.equal(a.getSave().level,1);assert.equal(a.getSave().coins,0);
  a.cleanup();
});

test('wrong VK application id fails closed before storage operations',async()=>{
  const h=harness(new Map(),new Map(),{}, {embedded:true,appId:54870404});
  assert.equal(await h.instance.init(),false);
  assert.match(h.instance.error,/Wrong VK application/i);
  assert.ok(!h.operations.includes('VKWebAppStorageGet'));
  h.cleanup();
});

test('account mismatch fails closed before storage operations',async()=>{
  const h=harness(new Map(),new Map(),{}, {embedded:true,userId:42,launchUserId:77});
  assert.equal(await h.instance.init(),false);
  assert.match(h.instance.error,/mismatch/i);
  assert.ok(!h.operations.includes('VKWebAppStorageGet'));
  h.cleanup();
});

test('native ads require capability + availability and reward only on successful VK callback',async()=>{
  const all=new Map(),a=harness(all,new Map(),{}, {embedded:true,adAvailable:false});await a.instance.init();
  assert.equal(await a.instance.showAd('reward'),false);
  assert.ok(a.operations.includes('VKWebAppCheckNativeAds'));
  assert.ok(!a.operations.includes('VKWebAppShowNativeAds'));a.cleanup();

  const b=harness(all,new Map(),{}, {embedded:true,adAvailable:true,adSuccess:false});await b.instance.init();
  assert.equal(await b.instance.showAd('reward'),false);
  assert.ok(b.operations.includes('VKWebAppShowNativeAds'));b.cleanup();

  const c=harness(all,new Map(),{}, {embedded:true,adAvailable:true,adSuccess:true});await c.instance.init();
  assert.equal(await c.instance.showAd('reward'),true);c.cleanup();
});

test('adaptive banner uses vertical right layout on desktop and compact bottom layout on mobile',async()=>{
  const all=new Map(),desktopCalls=[];
  const desktop=harness(all,new Map(),{}, {embedded:true,innerWidth:1280,innerHeight:720,onBanner:p=>desktopCalls.push(p)});
  await desktop.instance.init();
  assert.equal(await desktop.instance.showAdaptiveBanner(),true);
  assert.equal(desktopCalls.at(-1).orientation,'vertical');
  assert.equal(desktopCalls.at(-1).banner_align,'right');
  assert.equal(desktop.instance.bannerMode,'desktop-side');
  assert.equal(await desktop.instance.hideBanner(),true);desktop.cleanup();

  const mobileCalls=[];
  const mobile=harness(new Map(),new Map(),{}, {embedded:true,innerWidth:390,innerHeight:844,onBanner:p=>mobileCalls.push(p)});
  await mobile.instance.init();
  assert.equal(await mobile.instance.showAdaptiveBanner(),true);
  assert.equal(mobileCalls.at(-1).orientation,'horizontal');
  assert.equal(mobileCalls.at(-1).banner_location,'bottom');
  assert.equal(mobileCalls.at(-1).height_type,'compact');
  assert.equal(mobile.instance.bannerMode,'mobile-bottom');
  mobile.cleanup();
});

test('VK Games save strips VK Play paid wallet and adapter has no HTTP backend transport',async()=>{
  assert.ok(!/\bfetch\s*\(/.test(source));
  assert.ok(!/https?:\/\//.test(source));
  const all=new Map(),a=harness(all,new Map(),{}, {embedded:true});await a.instance.init();
  a.setSave({revision:1,coins:5,vkPaidCoinsCredited:10000,vkEntitlements:{supporter_pack:1}});
  a.instance.changed();await a.instance.sync();

  const b=harness(all,new Map(),{}, {embedded:true});await b.instance.init();
  assert.equal(b.getSave().vkPaidCoinsCredited,0);
  assert.deepEqual(JSON.parse(JSON.stringify(b.getSave().vkEntitlements)),{});
  assert.equal(b.instance.privacyStatus().personalDataBackend,false);
  a.cleanup();b.cleanup();
});


test('simultaneous ad requests open only one native ad',async()=>{
 const h=harness(new Map(),new Map(),{}, {embedded:true});await h.instance.init();
 const results=await Promise.all([h.instance.showAd('reward'),h.instance.showAd('reward')]);
 assert.equal(results.filter(Boolean).length,1);
 assert.equal(h.operations.filter(m=>m==='VKWebAppShowNativeAds').length,1);h.cleanup();
});
test('concurrent banner requests are coalesced and desktop uses reserved layout space',async()=>{
 const h=harness(new Map(),new Map(),{}, {embedded:true,onBanner:p=>assert.equal(p.layout_type,'resize')});await h.instance.init();
 await Promise.all([h.instance.showAdaptiveBanner(),h.instance.showAdaptiveBanner()]);
 assert.equal(h.operations.filter(m=>m==='VKWebAppShowBannerAd').length,1);h.cleanup();
});
test('native ad waits for an in-flight banner then hides it before showing',async()=>{
 let release,entered;const started=new Promise(r=>entered=r),hold=new Promise(r=>release=r);
 const h=harness(new Map(),new Map(),{}, {embedded:true,onCall:async m=>{if(m==='VKWebAppShowBannerAd'){entered();await hold;}}});
 await h.instance.init();const banner=h.instance.showAdaptiveBanner();await started;
 const ad=h.instance.showAd('reward');release();await banner;assert.equal(await ad,true);
 const show=h.operations.indexOf('VKWebAppShowNativeAds'),hide=h.operations.indexOf('VKWebAppHideBannerAd');
 assert.ok(hide>=0&&hide<show);h.cleanup();
});
test('failed banner hide prevents native ads from overlapping it',async()=>{
 const h=harness(new Map(),new Map(),{}, {embedded:true,hideSuccess:false});await h.instance.init();
 await h.instance.showAdaptiveBanner();assert.equal(await h.instance.showAd('reward'),false);
 assert.ok(!h.operations.includes('VKWebAppShowNativeAds'));h.cleanup();
});
test('account switch stays isolated when VK Storage is unsupported',async()=>{
 const all=new Map(),local=new Map(),a=harness(all,local,{}, {embedded:true});await a.instance.init();
 a.setSave({revision:1,level:12,coins:500});a.instance.changed();await a.instance.sync();a.cleanup();
 const b=harness(all,local,{revision:1,level:12,coins:500},{embedded:true,userId:77,unsupported:['VKWebAppStorageGet']});
 await b.instance.init();assert.equal(b.getSave().level,1);assert.equal(b.getSave().coins,0);b.cleanup();
});
test('account switch stays isolated when the first cloud read fails',async()=>{
 const all=new Map(),local=new Map(),a=harness(all,local,{}, {embedded:true});await a.instance.init();
 a.setSave({revision:1,level:12,coins:500});a.instance.changed();await a.instance.sync();a.cleanup();
 const b=harness(all,local,{revision:1,level:12,coins:500},{embedded:true,userId:77,onCall:m=>{if(m==='VKWebAppStorageGet')throw Error('offline')}});
 assert.equal(await b.instance.init(),false);assert.equal(b.getSave().coins,0);b.cleanup();
});
test('production merge preserves offline car spending when another device earns coins',async()=>{
 const all=new Map(),local=new Map(),a=harness(all,local,{}, {embedded:true,productionMerge:true});await a.instance.init();
 a.setSave({revision:1,level:10,coins:500,ownedCars:[0],purchasedCars:[]});a.instance.changed();await a.instance.sync();a.cleanup();
 const b=harness(all,new Map(),{}, {embedded:true,productionMerge:true});await b.instance.init();
 b.setSave({...b.getSave(),revision:2,coins:550});b.instance.changed();await b.instance.sync();b.cleanup();
 const c=harness(all,local,{revision:2,level:10,coins:400,ownedCars:[0,1],purchasedCars:[1]},{embedded:true,productionMerge:true});
 await c.instance.init();assert.equal(c.getSave().coins,450);assert.ok(c.getSave().ownedCars.includes(1));c.cleanup();
});
test('stale device cannot republish its save after deletion on another device',async()=>{
 const all=new Map(),a=harness(all,new Map(),{}, {embedded:true});await a.instance.init();
 a.setSave({revision:1,level:5,coins:50});a.instance.changed();await a.instance.sync();a.cleanup();
 const b=harness(all,new Map(),{}, {embedded:true});await b.instance.init();await b.instance.deleteData();
 a.setSave({revision:2,level:8,coins:100});a.instance.changed();assert.equal(await a.instance.sync(),false);
 assert.equal(a.vk.get(manifestKey),'');a.cleanup();b.cleanup();
});

test('desktop host keeps the side banner when VK resizes the iframe below 900px',async()=>{
 const h=harness(new Map(),new Map(),{}, {embedded:true,clientPlatform:'desktop_web',innerWidth:800,innerHeight:720});
 await h.instance.init();assert.equal(h.instance.bannerLayout().mode,'desktop-side');h.cleanup();
});

test('OK app uses account storage and isolates the same numeric VK user',async()=>{
 const local=new Map(),all=new Map();
 const vk=harness(all,local,{}, {embedded:true});
 const ok=harness(all,local,{}, {embedded:true,client:'ok'});
 try{
 assert.equal(await vk.instance.init(),true);
 assert.equal(await ok.instance.init(),true,ok.instance.error);
 assert.equal(ok.instance.socialPlatform,'ok');
 assert.equal(ok.instance.privacyStatus().platform,'okgames');
 assert.notEqual(vk.instance.fingerprint,ok.instance.fingerprint);
 ok.setSave({revision:1,level:7});ok.instance.changed();
 assert.equal(await ok.instance.sync(),true);
 const next=harness(all,new Map(),{}, {embedded:true,client:'ok'});
 try{assert.equal(await next.instance.init(),true,next.instance.error);assert.equal(next.getSave().level,7);}finally{next.cleanup();}
 }finally{vk.cleanup();ok.cleanup();}
});
test('rejects cross-platform app IDs',async()=>{
 for(const opts of [{appId:54870404,client:'ok'},{appId:512005046523,client:'vk'},{okAppId:512005046524,client:'ok'}]){
  const h=harness(new Map(),new Map(),{}, {embedded:true,...opts});
  try{assert.equal(await h.instance.init(),false);}finally{h.cleanup();}
 }
});

test('OK launch uses vk_app_id for VK identity, vk_ok_app_id for its cloud and vk_ok_user_id for its player',async()=>{
  const all=new Map(),a=harness(all,new Map(),{},{
    embedded:true,client:'ok',clientPlatform:'desktop_web_ok',userId:701,technicalVkId:90042
  });
  assert.equal(await a.instance.init(),true,a.instance.error);
  assert.equal(a.instance.socialPlatform,'ok');
  assert.equal(a.instance.appId,512005046523);
  assert.equal(a.instance.userId,701);
  assert.equal(a.instance.cloud,true);
  assert.equal(a.instance.privacyStatus().platform,'okgames');
  assert.ok(!a.operations.includes('VKWebAppGetLaunchParams'),'not supported in OK bridge');
  a.setSave({revision:3,level:13,coins:240,starsByLevel:{'12':3}});
  a.instance.changed();assert.equal(await a.instance.sync(),true);
  const b=harness(all,new Map(),{},{
    embedded:true,client:'ok',clientPlatform:'mobile_android_ok',userId:701,technicalVkId:90042
  });
  assert.equal(await b.instance.init(),true,b.instance.error);
  assert.equal(b.getSave().level,13);
  assert.equal(b.getSave().coins,240);
  assert.equal(b.getSave().starsByLevel['12'],3);
  a.cleanup();b.cleanup();
});

test('OK and VK saves with the same numeric user ID cannot be mixed',async()=>{
  const all=new Map();
  const vk=harness(all,new Map(),{}, {embedded:true,userId:7});
  assert.equal(await vk.instance.init(),true);
  vk.setSave({revision:2,level:11,coins:250});
  vk.instance.changed();await vk.instance.sync();
  const ok=harness(all,new Map(),{}, {embedded:true,userId:7,client:'ok'});
  assert.equal(await ok.instance.init(),true,ok.instance.error);
  assert.equal(ok.getSave().level,1);
  assert.equal(ok.getSave().coins,0);
  ok.setSave({revision:1,level:4,coins:50});ok.instance.changed();await ok.instance.sync();
  const otherVk=harness(all,new Map(),{}, {embedded:true,userId:7});
  assert.equal(await otherVk.instance.init(),true);
  assert.equal(otherVk.getSave().level,11);
  assert.equal(otherVk.getSave().coins,250);
  vk.cleanup();ok.cleanup();otherVk.cleanup();
});

test('OK rejects a wrong OK app ID or wrong signed OK player ID before cloud I/O',async()=>{
  for(const opts of [
    {okAppId:512005046524},
    {appId:54870404},
    {launchOkUserId:999}
  ]){
    const a=harness(new Map(),new Map(),{}, {embedded:true,client:'ok',userId:7,...opts});
    assert.equal(await a.instance.init(),false);
    assert.match(a.instance.error,/application|identity|mismatch/i);
    assert.ok(!a.operations.includes('VKWebAppStorageGet'));
    a.cleanup();
  }
});

test('OK bridge without storage capabilities does not pretend it saved to the cloud',async()=>{
  const a=harness(new Map(),new Map(),{revision:2,level:6},{embedded:true,client:'ok',
    unsupported:['VKWebAppStorageGet','VKWebAppStorageSet','VKWebAppStorageGetKeys'],rejectStorageSend:true});
  assert.equal(await a.instance.init(),true);
  assert.equal(a.instance.privacyStatus().cloud,false);
  assert.equal(a.instance.status(),'local');
  a.cleanup();
});

test('OK cloud probes real Storage when capabilities incorrectly report unsupported',async()=>{
  const all=new Map();
  const a=harness(all,new Map(),{}, {embedded:true,client:'ok',
    unsupported:['VKWebAppStorageGet','VKWebAppStorageSet','VKWebAppStorageGetKeys']});
  assert.equal(await a.instance.init(),true,a.instance.error);
  assert.equal(a.instance.cloud,true);
  a.setSave({revision:2,level:5,coins:80});a.instance.changed();
  assert.equal(await a.instance.sync(),true);
  const b=harness(all,new Map(),{}, {embedded:true,client:'ok'});
  assert.equal(await b.instance.init(),true);
  assert.equal(b.getSave().level,5);
  a.cleanup();b.cleanup();
});

test('OK preserves previously unlinked local progress for explicit import into an empty cloud',async()=>{
  const all=new Map(),browserLocal=new Map();
  const a=harness(all,browserLocal,{revision:4,level:8,coins:170,starsByLevel:{'7':3}},{
    embedded:true,client:'ok',userId:26
  });
  assert.equal(await a.instance.init(),true,a.instance.error);
  assert.equal(a.getSave().level,1,'unlinked local progress must never auto-upload into an account');
  assert.equal(a.instance.recoverableLocal()?.level,8);
  assert.equal(a.instance.recoverableLocal()?.coins,170);
  assert.equal(await a.instance.importUnlinkedLocal(),true);
  assert.equal(a.instance.recoverableLocal(),null);
  const b=harness(all,new Map(),{}, {embedded:true,client:'ok',userId:26});
  assert.equal(await b.instance.init(),true);
  assert.equal(b.getSave().level,8);
  assert.equal(b.getSave().coins,170);
  assert.equal(b.getSave().starsByLevel['7'],3);
  a.cleanup();b.cleanup();
});

test('OK local-only mode does not erase fresh offline progress at the next cloud retry',async()=>{
  const all=new Map(),local=new Map();
  const a=harness(all,local,{revision:5,level:7,coins:50},{
    embedded:true,client:'ok',userId:26,
    unsupported:['VKWebAppStorageGet','VKWebAppStorageSet'],rejectStorageSend:true
  });
  assert.equal(await a.instance.init(),true);
  assert.equal(a.getSave().level,1,'unlinked legacy progress is backed up separately');
  a.setSave({revision:1,level:3,coins:90});a.instance.changed();a.cleanup();
  const retry=harness(all,local,a.getSave(),{embedded:true,client:'ok',userId:26});
  assert.equal(await retry.instance.init(),true,retry.instance.error);
  assert.equal(retry.getSave().level,3,'same-account offline progress survives retry');
  assert.equal(await retry.instance.sync(),true);
  const phone=harness(all,new Map(),{}, {embedded:true,client:'ok',userId:26});
  assert.equal(await phone.instance.init(),true);
  assert.equal(phone.getSave().level,3);
  retry.cleanup();phone.cleanup();
});


test('M202: continuous progress changes cannot postpone the earliest pending cloud write',async()=>{
  const h=harness(new Map(),new Map(),{}, {embedded:true});
  try{
    assert.equal(await h.instance.init(),true);
    h.setSave({revision:1,level:2,coins:10});
    h.instance.changed();
    h.instance.schedule(100); // Bring the first upload forward for a short deterministic test.
    const firstDue=h.instance.timerDueAt;
    assert.ok(firstDue>Date.now());
    for(let n=2;n<=6;n++){
      await new Promise(resolve=>setTimeout(resolve,10));
      h.setSave({revision:n,level:n+1,coins:n*10});
      h.instance.changed(); // A classic trailing-edge debounce would postpone every write.
      assert.equal(h.instance.timerDueAt,firstDue);
    }
    await new Promise(resolve=>setTimeout(resolve,160));
    assert.ok(h.vk.get(manifestKey),'a pending save must reach VK storage despite new edits');
    const cloud=await h.instance.readSnapshot();
    assert.equal(cloud.progress.level,7);
    assert.equal(cloud.progress.coins,60);
    assert.equal(h.instance.dirty,false);
  }finally{h.cleanup();}
});

test('M202: explicit cloud flush cancels the deferred write and persists immediately',async()=>{
  const h=harness(new Map(),new Map(),{}, {embedded:true});
  try{
    await h.instance.init();
    h.setSave({revision:2,level:5,coins:25});
    h.instance.changed();
    assert.ok(h.instance.timer);
    assert.equal(await h.instance.sync(),true);
    assert.equal(h.instance.timer,0);
    assert.equal(h.instance.timerDueAt,0);
    const snapshot=await h.instance.readSnapshot();
    assert.equal(snapshot.progress.level,5);
    assert.equal(snapshot.progress.coins,25);
  }finally{h.cleanup();}
});

test('M202: malformed cloud manifest fails closed and preserves same-account local progress',async()=>{
  const all=new Map(),local=new Map();
  const a=harness(all,local,{}, {embedded:true});
  try{
    await a.instance.init();
    a.setSave({revision:1,level:4,coins:40});a.instance.changed();
    assert.equal(await a.instance.sync(),true);
    a.vk.set(manifestKey,'{"version":2,');
  }finally{a.cleanup();}
  const b=harness(all,local,{revision:2,level:6,coins:50}, {embedded:true});
  try{
    assert.equal(await b.instance.init(),false,'corrupted remote data is not an empty cloud');
    assert.ok(b.instance.error,'the corruption must be reported');
    assert.equal(b.getSave().level,6);
    assert.equal(b.getSave().coins,50);
    assert.equal(b.vk.get(manifestKey),'{"version":2,','do not overwrite the damaged pointer');
    assert.ok(!b.operations.includes('VKWebAppStorageSet'));
  }finally{b.cleanup();}
});

test('M202: failed cloud sync keeps a bounded retry backoff while progress changes',async()=>{
  const h=harness(new Map(),new Map(),{}, {embedded:true});
  try{
    assert.equal(await h.instance.init(),true);
    h.instance.error='simulated-cloud-error';
    h.setSave({revision:1,level:3,coins:8});
    h.instance.changed();
    const retryDue=h.instance.timerDueAt;
    assert.ok(retryDue-Date.now()>10000,'cloud error must not retry in only 900 ms');
    for(let i=0;i<8;i++)h.instance.changed();
    assert.equal(h.instance.timerDueAt,retryDue);
    assert.equal(h.operations.filter(m=>m==='VKWebAppStorageSet').length,0);
  }finally{h.cleanup();}
});

test('M209: a clean device discovers remote saves during ordinary heartbeat sync',async()=>{
  const all=new Map();
  const a=harness(all,new Map(),{}, {embedded:true});
  const b=harness(all,new Map(),{}, {embedded:true});
  try{
    assert.equal(await a.instance.init(),true);
    assert.equal(await b.instance.init(),true);
    a.setSave({revision:2,level:4,starsByLevel:{1:3,2:2,3:1}});
    a.instance.changed();
    assert.equal(await a.instance.sync(),true);
    assert.equal(b.getSave().level,1);
    // Previously sync() returned immediately when clean; no second device pull.
    assert.equal(await b.instance.sync(),true);
    assert.equal(b.getSave().level,4);
    assert.equal(b.getSave().starsByLevel[3],1);
    assert.equal(b.instance.head.generation,a.instance.head.generation);
    assert.equal(b.instance.dirty,false);
  }finally{a.cleanup();b.cleanup();}
});

test('M209: clean sync checks the lightweight index before downloading cloud chunks',async()=>{
  const all=new Map(),h=harness(all,new Map(),{}, {embedded:true});
  try{
    await h.instance.init();
    h.setSave({revision:2,level:4,starsByLevel:{1:3}});
    h.instance.changed();await h.instance.sync();
    const old=h.operations.length;
    assert.equal(await h.instance.sync(),true);
    const reads=h.operations.slice(old).filter(x=>x==='VKWebAppStorageGet');
    assert.equal(reads.length,1,'unchanged pointer must not download and decode the save');
  }finally{h.cleanup();}
});

test('M209: overwritten commit pointer is not acknowledged as a successful upload',async()=>{
  const all=new Map();let notifyEntered,releaseA;
  const entered=new Promise(resolve=>notifyEntered=resolve);
  const blocked=new Promise(resolve=>releaseA=resolve);
  let held=false;
  const a=harness(all,new Map(),{}, {embedded:true,afterStorageWrite:async ({key})=>{
    if(key===manifestKey&&!held){held=true;notifyEntered();await blocked;}
  }});
  const b=harness(all,new Map(),{}, {embedded:true});
  try{
    await a.instance.init();await b.instance.init();
    a.setSave({revision:3,level:3,starsByLevel:{1:3,2:2}});
    b.setSave({revision:3,level:5,starsByLevel:{1:3,4:3}});
    a.instance.changed();b.instance.changed();
    const aWrite=a.instance.sync();
    await entered; // A pointer is committed, its acknowledgment is held.
    assert.equal(await b.instance.sync(),true); // B reads A, merges, commits its own pointer.
    releaseA();
    assert.equal(await aWrite,false,'A must detect that B replaced A pointer before acknowledgment');
    assert.equal(a.instance.dirty,true,'A must retry instead of claiming all changes are saved');
    assert.ok(a.getSave().starsByLevel[4]===3,'A must import B\'s new stars');
    assert.equal(await a.instance.sync(),true);
    const third=harness(all,new Map(),{}, {embedded:true});
    try{
      assert.equal(await third.instance.init(),true);
      assert.equal(third.getSave().level,5);
      assert.equal(third.getSave().starsByLevel[2],2);
      assert.equal(third.getSave().starsByLevel[4],3);
    }finally{third.cleanup();}
  }finally{releaseA?.();a.cleanup();b.cleanup();}
});

test('M209: an external reset epoch still fails closed during clean reconciliation',async()=>{
  const all=new Map(),a=harness(all,new Map(),{}, {embedded:true});
  try{
    await a.instance.init();
    a.vk.set(epochKey,'a'.repeat(32));
    assert.equal(await a.instance.sync(),false);
    assert.match(a.instance.error,/reload/i);
    assert.equal(a.instance.loaded,true);
  }finally{a.cleanup();}
});
