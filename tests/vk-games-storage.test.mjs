import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { TextDecoder, TextEncoder } from 'node:util';
import { webcrypto } from 'node:crypto';

const source = readFileSync(new URL('../vk-games.js', import.meta.url), 'utf8');
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
  const vk=accountStore(allVk,userId);
  const supported=new Set(opts.unsupported?[
    'VKWebAppGetLaunchParams','VKWebAppStorageGet','VKWebAppStorageSet',
    'VKWebAppStorageGetKeys','VKWebAppCheckNativeAds','VKWebAppShowNativeAds','VKWebAppCheckBannerAd','VKWebAppShowBannerAd','VKWebAppHideBannerAd'
  ].filter(x=>!opts.unsupported.includes(x)):[
    'VKWebAppGetLaunchParams','VKWebAppStorageGet','VKWebAppStorageSet',
    'VKWebAppStorageGetKeys','VKWebAppCheckNativeAds','VKWebAppShowNativeAds','VKWebAppCheckBannerAd','VKWebAppShowBannerAd','VKWebAppHideBannerAd'
  ]);
  const bridge={
    isEmbedded:()=>Boolean(opts.embedded),
    isWebView:()=>false,
    supportsAsync:async method=>supported.has(method),
    async send(method,payload={}){
      operations.push(method);
      if(method==='VKWebAppInit')return {result:true};
      if(method==='VKWebAppGetUserInfo')return {id:opts.infoUserId??userId};
      if(method==='VKWebAppGetLaunchParams')return {
        vk_app_id:opts.launchAppId??appId,
        vk_user_id:opts.launchUserId??userId,
        vk_language:'ru'
      };
      if(method==='VKWebAppStorageGet')return {
        keys:payload.keys.map(key=>({key,value:vk.get(key)||''}))
      };
      if(method==='VKWebAppStorageSet'){
        if(opts.rejectWrite?.(payload.key,payload.value))throw Error('simulated_write_failure');
        vk.set(payload.key,payload.value);return {result:true};
      }
      if(method==='VKWebAppStorageGetKeys'){
        const keys=[...vk.keys()].slice(payload.offset||0,(payload.offset||0)+(payload.count||100));
        return {keys};
      }
      if(method==='VKWebAppCheckNativeAds')return {result:opts.adAvailable!==false};
      if(method==='VKWebAppShowNativeAds')return {result:opts.adSuccess!==false};
      if(method==='VKWebAppCheckBannerAd')return {result:opts.bannerAvailable!==false,banner_width:320,banner_height:50,banner_location:'bottom',layout_type:'resize',height_type:'compact'};
      if(method==='VKWebAppShowBannerAd'){opts.onBanner?.(payload);return {result:opts.bannerSuccess!==false,banner_width:payload.orientation==='vertical'?160:320,banner_height:payload.orientation==='vertical'?600:50,banner_location:payload.banner_location,banner_align:payload.banner_align,layout_type:payload.layout_type,height_type:payload.height_type,orientation:payload.orientation};}
      if(method==='VKWebAppHideBannerAd')return {result:true,banner_width:0,banner_height:0,banner_location:'bottom',layout_type:'overlay',height_type:'compact'};
      throw Error('unexpected_bridge_call: '+method);
    }
  };
  const context={
    vkBridge:bridge,
    location:{search:opts.embedded?`?vk_app_id=${appId}&vk_user_id=${userId}&vk_language=ru`:''},
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
    storage:context.localStorage,getSave:()=>data,normalize,merge,
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
