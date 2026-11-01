import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { TextDecoder, TextEncoder } from 'node:util';

const source = readFileSync(new URL('../vk-games.js', import.meta.url), 'utf8');
const manifestKey = 'TP_VKG_HEAD_V1';
const serialize = data => structuredClone(data ?? {});
const normalize = data => ({revision: 0, level: 1, coins: 0, starsByLevel: {}, ...serialize(data)});
const merge = (local, remote) => ({...remote,
  level: Math.max(local.level ?? 1, remote.level ?? 1),
  starsByLevel: {...remote.starsByLevel, ...local.starsByLevel}
});

function harness(storage, initialSave={}, opts={}) {
  let data=normalize(initialSave);
  const operations = [];
  const bridge={
    isEmbedded:()=>Boolean(opts.embedded),
    async send(method,payload) {
      operations.push(method);
      if(method==='VKWebAppInit')return {};
      if(method==='VKWebAppStorageGet')return {
        keys:payload.keys.map(key=>({key,value:storage.get(key)||''}))
      };
      if(method==='VKWebAppStorageSet'){
        if(opts.rejectWrite?.(payload.key,payload.value))throw Error('simulated_write_failure');
        storage.set(payload.key,payload.value);return {result:true};
      }
      if(method==='VKWebAppShowNativeAds')return {result:opts.adSuccess!==false};
      throw Error('unexpected_bridge_call: '+method);
    }
  };
  const context={
    vkBridge:bridge,location:{search:opts.embedded?'?vk_app_id=100&vk_user_id=42':''},
    navigator:{onLine:true},TextDecoder,TextEncoder,URLSearchParams,
    atob:s=>Buffer.from(s,'base64').toString('latin1'),
    btoa:s=>Buffer.from(s,'latin1').toString('base64'),
    setTimeout,clearTimeout,Date,Math,JSON,Number,Promise,Array,Uint8Array,String,Object,
  };
  context.globalThis=context;
  runInNewContext(source,context,{filename:'vk-games.js'});
  const instance=context.TrafficPulseVKGames.create({
    getSave:()=>data,normalize,merge,onLoad:value=>{data=normalize(value)},
    onRead(){},onWrite(){},
  });
  return {instance, operations, getSave:()=>data,cleanup:()=>clearTimeout(instance.timer)};
}

test('Outside VK: local game starts without waiting for VK account handshake',async()=>{
  const h=harness(new Map(),{revision:5,level:9});
  assert.equal(await h.instance.init(),false);
  assert.equal(h.getSave().level,9);
  assert.ok(!h.operations.includes('VKWebAppInit'));
  h.cleanup();
});

test('VK native storage persists first user save and loads on another device',async()=>{
  const kv=new Map(),a=harness(kv,{level:4,coins:70},{embedded:true});
  assert.equal(await a.instance.init(),true);
  assert.equal(JSON.parse(kv.get(manifestKey)).bank,'A');
  const b=harness(kv,{}, {embedded:true});
  assert.equal(await b.instance.init(),true);
  assert.equal(b.getSave().level,4);assert.equal(b.getSave().coins,70);
  a.cleanup();b.cleanup();
});

test('Offline progress merges unlocks without restoring an already-spent VK coin balance',async()=>{
  const kv=new Map(),a=harness(kv,{level:2,coins:13},{embedded:true});
  await a.instance.init();
  const b=harness(kv,{revision:14,level:7,coins:999,starsByLevel:{'6':3}},{embedded:true});
  await b.instance.init();
  assert.equal(b.getSave().level,7);
  assert.equal(b.getSave().starsByLevel['6'],3);
  assert.equal(b.getSave().coins,13);
  assert.equal(JSON.parse(kv.get(manifestKey)).bank,'B');
  a.cleanup();b.cleanup();
});

test('Interrupted chunk write does not advance committed pointer',async()=>{
  const kv=new Map(),a=harness(kv,{level:3,coins:23},{embedded:true});
  await a.instance.init();const before=kv.get(manifestKey);
  let failed=false;
  const b=harness(kv,{revision:5,level:6},{
    embedded:true,rejectWrite:key=>{
      if(key.startsWith('TP_VKG_BANK_V1_B_')&&!failed){failed=true;return true;}return false;
    }
  });
  assert.equal(await b.instance.init(),true); // Bridge initialized, sync returned false.
  assert.equal(kv.get(manifestKey),before);
  const c=harness(kv,{}, {embedded:true});
  await c.instance.init();assert.equal(c.getSave().level,3);
  a.cleanup();b.cleanup();c.cleanup();
});

test('Chunked UTF-8 saves round-trip large progress maps',async()=>{
  const kv=new Map(),value={revision:0,level:48,coins:101,
    narrative:'Поездка по большому городу 🚗'.repeat(270),
    starsByLevel:Object.fromEntries(Array.from({length:180},(_,i)=>[String(i+1),3]))
  };
  const a=harness(kv,value,{embedded:true});await a.instance.init();
  const meta=JSON.parse(kv.get(manifestKey));assert.ok(meta.count>1);
  for(let i=0;i<meta.count;i++)assert.ok((kv.get('TP_VKG_BANK_V1_A_'+i)||'').length<=3500);
  const b=harness(kv,{}, {embedded:true});await b.instance.init();
  assert.equal(b.getSave().narrative,value.narrative);
  assert.equal(b.getSave().starsByLevel['150'],3);
  a.cleanup();b.cleanup();
});

test('Ads reward only on successful VK native callback',async()=>{
  const kv=new Map(),a=harness(kv,{}, {embedded:true,adSuccess:false});await a.instance.init();
  assert.equal(await a.instance.showAd('reward'),false);a.cleanup();
  const b=harness(kv,{}, {embedded:true,adSuccess:true});await b.instance.init();
  assert.equal(await b.instance.showAd('reward'),true);b.cleanup();
});

test('VK Games never imports VK Play paid wallet or entitlements',async()=>{
  const kv=new Map(),a=harness(kv,{
    coins:5,vkPaidCoinsCredited:10000,vkEntitlements:{supporter_pack:1}
  },{embedded:true});
  await a.instance.init();
  const b=harness(kv,{}, {embedded:true});await b.instance.init();
  assert.equal(b.getSave().vkPaidCoinsCredited,0);
  assert.deepEqual(JSON.parse(JSON.stringify(b.getSave().vkEntitlements)),{});
  a.cleanup();b.cleanup();
});
