import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {createBilling,APP_ID,ITEM,verifyLaunch} from '../server/vk-payments.mjs';

const secret='test-secret-not-a-production-key',clock=1804147200000;
function launch(user=42,overrides={}){
 const p={vk_app_id:String(APP_ID),vk_user_id:String(user),vk_ts:String(clock/1000),vk_platform:'desktop_web',...overrides};
 const q=new URLSearchParams();for(const k of Object.keys(p).sort())q.append(k,p[k]);
 q.set('sign',createHmac('sha256',secret).update(q.toString()).digest('base64url'));return q.toString();
}
function signed(extra={}){
 const p={app_id:String(APP_ID),user_id:'42',receiver_id:'42',notification_type:'order_status_change',order_id:'9001',status:'chargeable',item:ITEM,item_id:ITEM,item_price:'10',...extra};
 p.sig=createHash('md5').update(Object.keys(p).sort().map(k=>k+'='+p[k]).join('')+secret).digest('hex');return new URLSearchParams(p).toString();
}
const config={secret,liveEnabled:true,photoURL:'https://example.test/product.png',now:()=>clock};
const service=(extra={})=>createBilling({...config,...extra});
const callback=(s,body)=>s.handle(new Request('https://billing.example.test/api/vkgames/callback',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body})).then(r=>r.json());
const entitlement=(s,user=42,raw)=>s.handle(new Request('https://billing.example.test/api/vkgames/entitlements',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({launch_params:raw||launch(user)})}));

test('catalog returns one permanent product at 10 votes; client price cannot change it',async t=>{
 const s=service();t.after(()=>s.close());
 const r=await callback(s,signed({notification_type:'get_item',item_price:'1'}));
 assert.equal(r.response.price,10);assert.equal(r.response.item_id,ITEM);assert.equal(r.response.title,'Открыть все карты');
 assert.ok((await callback(s,signed({notification_type:'get_item',item:'other'}))).error);
});
test('invalid signatures, wrong app, wrong recipient and wrong amount cannot grant access',async t=>{
 const s=service();t.after(()=>s.close());
 for(const body of [signed().replace(/sig=[^&]+/,'sig=bad'),signed({app_id:'123'}),signed({receiver_id:'43'}),signed({item_price:'9'}),signed({item_id:'another'})])assert.ok((await callback(s,body)).error);
 assert.equal((await (await entitlement(s)).json()).all_maps,false);
});
test('confirmed payment is idempotent, account scoped and persists across server restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tp-payments-'));let s=service({dbPath:join(dir,'orders.sqlite')});
 try{
  const a=await callback(s,signed()),b=await callback(s,signed());assert.deepEqual(a,b);assert.equal(a.response.order_id,9001);
  assert.equal((await (await entitlement(s)).json()).all_maps,true);
  assert.equal((await (await entitlement(s,43)).json()).all_maps,false);
  assert.ok((await callback(s,signed({order_id:'9002'}))).error,'second order must not charge for an owned permanent product');
  s.close();s=service({dbPath:join(dir,'orders.sqlite')});assert.equal((await (await entitlement(s)).json()).all_maps,true);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
test('refund revokes access and late chargeable retries never resurrect the purchase',async t=>{
 const s=service();t.after(()=>s.close());await callback(s,signed());await callback(s,signed({status:'refunded'}));
 assert.equal((await (await entitlement(s)).json()).all_maps,false);
 await callback(s,signed());assert.equal((await (await entitlement(s)).json()).all_maps,false);
 await callback(s,signed({order_id:'9003',status:'refunded'}));await callback(s,signed({order_id:'9003'}));
 assert.equal((await (await entitlement(s)).json()).all_maps,false);
});
test('test purchases require an allowlisted account and cannot become live entitlements',async t=>{
 const s=service({liveEnabled:false,testUsers:[42]});t.after(()=>s.close());
 assert.ok((await callback(s,signed())).error);
 assert.ok((await callback(s,signed({notification_type:'order_status_change_test',user_id:'43',receiver_id:'43'}))).error);
 assert.ok((await callback(s,signed({notification_type:'order_status_change_test'}))).response);
 assert.equal((await (await entitlement(s)).json()).all_maps,true);
 assert.equal((await (await entitlement(s,43)).json()).all_maps,false);
});
test('launch authentication rejects forged account, wrong app, stale time, and duplicate parameters',()=>{
 assert.equal(verifyLaunch(launch(),secret,clock),42);
 for(const q of [launch().replace('vk_user_id=42','vk_user_id=43'),launch(42,{vk_app_id:'123'}),launch(42,{vk_ts:'1'}),launch()+'&vk_user_id=43'])assert.equal(verifyLaunch(q,secret,clock),null);
});
test('entitlement endpoint rejects unsigned requests, disallowed origins, and duplicate callback fields',async t=>{
 const s=service({allowedOrigins:['https://game.example.test']});t.after(()=>s.close());
 assert.equal((await entitlement(s,42,'vk_user_id=42')).status,401);
 const r=await s.handle(new Request('https://billing.example.test/api/vkgames/entitlements',{method:'POST',headers:{Origin:'https://attacker.test','Content-Type':'application/json'},body:'{}'}));assert.equal(r.status,403);
 assert.ok((await callback(s,signed()+'&item_price=1')).error);
});

const purchaseSource=readFileSync(new URL('../vk-purchases.js',import.meta.url),'utf8');
function client({enabled=true,confirmed=false,nativeResult={success:true},replyUser=42,onNative,fetchError=false}={}){
 let user=42,nativeCalls=0,requests=0;
 const context={URL,AbortController,setTimeout,clearTimeout};runInNewContext(purchaseSource,context);
 const state=context.TrafficPulseVKPurchases.create({config:{enabled,endpoint:'https://billing.example.test',appId:APP_ID,item:ITEM,priceVotes:10},
  account:()=>({ready:true,appId:APP_ID,userId:user,launchQuery:launch(user)}),supported:async()=>true,sleep:async()=>{},
  call:async()=>{nativeCalls++;await onNative?.();return nativeResult;},
  fetch:async()=>{requests++;if(fetchError)throw Error('offline');return {ok:true,json:async()=>({app_id:APP_ID,user_id:replyUser,item:ITEM,price_votes:10,purchasable:true,all_maps:confirmed&&nativeCalls>0})};}
 });
 return {state,calls:()=>({nativeCalls,requests}),switchAccount:()=>{user=43;}};
}
test('disabled integration never queries a backend or opens a payment dialog',async()=>{
 const h=client({enabled:false});assert.equal(await h.state.purchase(),false);assert.equal(await h.state.refresh(),false);assert.deepEqual(h.calls(),{nativeCalls:0,requests:0});
});
test('native success without confirmed server payment grants nothing; verification failure never opens dialog',async()=>{
 const a=client();assert.equal(await a.state.purchase(),false);assert.equal(a.state.hasAllMaps(),false);
 const b=client({fetchError:true});assert.equal(await b.state.purchase(),false);assert.equal(b.calls().nativeCalls,0);
});
test('concurrent purchase clicks open one dialog and access requires server confirmation',async()=>{
 let release;const h=client({confirmed:true,onNative:()=>new Promise(r=>release=r)});
 const first=h.state.purchase();await new Promise(r=>setTimeout(r,0));assert.equal(await h.state.purchase(),false);release();
 assert.equal(await first,true);assert.equal(h.state.hasAllMaps(),true);assert.equal(h.calls().nativeCalls,1);
});
test('a receipt for another account and account switching during the dialog cannot unlock maps',async()=>{
 const a=client({confirmed:true,replyUser:43});assert.equal(await a.state.purchase(),false);assert.equal(a.state.hasAllMaps(),false);
 let h;h=client({confirmed:true,onNative:()=>h.switchAccount()});assert.equal(await h.state.purchase(),false);assert.equal(h.state.hasAllMaps(),false);
});

test('map checks reuse verified memory for five minutes while explicit checks stay fresh',async()=>{
 let time=1000000,requests=0;
 const context={URL,AbortController,setTimeout,clearTimeout};runInNewContext(purchaseSource,context);
 const state=context.TrafficPulseVKPurchases.create({config:{enabled:true,endpoint:'https://billing.example.test',appId:APP_ID,item:ITEM,priceVotes:10},account:()=>({ready:true,appId:APP_ID,userId:42,launchQuery:launch()}),now:()=>time,
 fetch:async()=>{requests++;return {ok:true,json:async()=>({app_id:APP_ID,user_id:42,item:ITEM,price_votes:10,purchasable:true,all_maps:false})};}});
 await Promise.all([state.refresh({force:false}),state.refresh({force:false})]);assert.equal(requests,1);
 for(let n=0;n<20;n++)await state.refresh({force:false});assert.equal(requests,1);
 await state.refresh();assert.equal(requests,2);
 time+=300001;await state.refresh({force:false});assert.equal(requests,3);
});
test('old account checks cannot clobber a new account verification or leave it stuck',async()=>{
 let user=42,release;
 const context={URL,AbortController,setTimeout,clearTimeout};runInNewContext(purchaseSource,context);
 const state=context.TrafficPulseVKPurchases.create({config:{enabled:true,endpoint:'https://billing.example.test',appId:APP_ID,item:ITEM,priceVotes:10},account:()=>({ready:true,appId:APP_ID,userId:user,launchQuery:launch(user)}),
 fetch:async()=>{const replyUser=user;if(replyUser===42)await new Promise(r=>release=r);return {ok:true,json:async()=>({app_id:APP_ID,user_id:replyUser,item:ITEM,price_votes:10,purchasable:true,all_maps:true})};}});
 const old=state.refresh();user=43;state.reset();await state.refresh();assert.equal(state.hasAllMaps(),true);release();await old;assert.equal(state.hasAllMaps(),true);assert.equal(state.checking,false);
});

test('failed background checks back off while manual restore can retry immediately',async()=>{
 const h=client({fetchError:true});
 await h.state.refresh({force:false});
 for(let i=0;i<10;i++)await h.state.refresh({force:false});
 assert.equal(h.calls().requests,1);
 await h.state.refresh();
 assert.equal(h.calls().requests,2);
});
