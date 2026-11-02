import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
function platformHarness(){
  const context={performance:{now:()=>0},document:{hidden:false},PLATFORM_TARGET:'vkgames',Date};
  const source=app.slice(app.indexOf('const platform = {'),app.indexOf('// VK Games deliberately has no VK Play billing'));
  runInNewContext(source+';globalThis.platform=platform;',context);
  return context;
}
function nextHarness(platform){
  const started=[],context={platform,save:{level:8}};
  const source=app.slice(app.indexOf('    async next(){'),app.indexOf('    draw(){',app.indexOf('    async next(){')));
  runInNewContext('globalThis.game={'+source+'};',context);
  Object.assign(context.game,{level:7,mode:'campaign',startLevel:(n)=>started.push(n)});
  return {game:context.game,started};
}
function rewardHarness(success){
 const button={disabled:false},save={coins:10};let persists=0,resolveAd;
 const game={state:'won',mode:'campaign',rewardedWinClaimed:false,rewardedWinClaiming:false};
 const context={Game:game,save,safeInt:(v,min,max)=>Math.max(min,Math.min(max,Number(v)||0)),
  platform:{showRewarded:()=>new Promise(r=>{resolveAd=()=>r(success)})},
  toast(){},T:{adUnavailable:'none',coins:'coins',adCoinsAdded:'added'},persist(){persists++},updateHud(){},$:()=>null};
 const start=app.indexOf('  async function claimWinRewardedCoins('),end=app.indexOf('  function showWin(',start);
 runInNewContext(app.slice(start,end)+';globalThis.claim=claimWinRewardedCoins;',context);
 return {claim:()=>context.claim(50,50,button),save,game,button,resolve:()=>resolveAd(),persists:()=>persists};
}
test('interstitial counts successful campaign completions including replays, independently of level number',()=>{
 const {platform:p}=platformHarness();
 p.noteCampaignCompletion(true);assert.equal(p.shouldRequestFullscreen(42),false);
 p.noteCampaignCompletion(false);assert.equal(p.shouldRequestFullscreen(7),true);
});
test('rewarded exposure suppresses a back-to-back interstitial and consumes the due slot',async()=>{
 const {platform:p}=platformHarness();p.campaignCompletionsSinceFullscreen=2;p.noteRewardedExposure();
 assert.equal(await p.showFullscreen(),false);assert.equal(p.campaignCompletionsSinceFullscreen,0);
});
test('Next cannot change the run while a rewarded ad is active',async()=>{
 const h=nextHarness({adBusy:true});await h.game.next();assert.deepEqual(h.started,[]);
});
test('double Next cannot start a new run before an interstitial settles',async()=>{
 let finish;const h=nextHarness({adBusy:false,shouldRequestFullscreen:()=>true,showFullscreen:()=>new Promise(r=>finish=r)});
 const first=h.game.next();await h.game.next();assert.deepEqual(h.started,[]);
 finish(true);await first;assert.deepEqual(h.started,[8]);assert.equal(h.game.nextPending,false);
});
test('rewarded coin callback grants exactly once, even with simultaneous clicks',async()=>{
 const h=rewardHarness(true),first=h.claim();assert.equal(h.button.disabled,true);
 assert.equal(await h.claim(),false);h.resolve();assert.equal(await first,true);
 assert.equal(h.save.coins,60);assert.equal(h.persists(),1);assert.equal(await h.claim(),false);
});
test('failed rewarded callback grants no coins and allows retry',async()=>{
 const h=rewardHarness(false),first=h.claim();h.resolve();assert.equal(await first,false);
 assert.equal(h.save.coins,10);assert.equal(h.persists(),0);assert.equal(h.button.disabled,false);
});
test('rewarded car unlock grants ownership without debiting coins; failure grants nothing',async()=>{
 for(const success of [true,false]){
  const save={level:10,coins:500,ownedCars:[0]},context={save,garagePreviewId:0,
   safeInt:v=>v,CAR_NAMES:['a','b'],CAR_REQUIREMENTS:[0,2],ownedStyleIds:()=>save.ownedCars,
   platform:{showRewarded:async()=>success},T:{},toast(){},persist(){},updateHud(){},showGarage(){}};
  const start=app.indexOf('  async function unlockGarageCarByAd('),end=app.indexOf('  async function purchaseGarageCar(',start);
  runInNewContext(app.slice(start,end)+';globalThis.unlock=unlockGarageCarByAd;',context);
  assert.equal(await context.unlock(1),success);assert.equal(save.coins,500);
  assert.equal(save.ownedCars.includes(1),success);
 }
});
