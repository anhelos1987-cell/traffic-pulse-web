import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../player-guidance-core.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
function policy(){
  const sandbox={};
  runInNewContext(source,sandbox,{filename:'player-guidance-core.js'});
  return sandbox.TrafficPulseGuidance.campaignStarFeedback;
}
const conf={maxQueue:6,perfectQueue:2,perfectSwitchBudget:5,parSwitches:4};
const stats=(queue,switches,flags={})=>({
  maxObservedQueue:queue,switches,rescueUsed:false,assistActive:false,...flags
});
function plain(v){return v===null?null:JSON.parse(JSON.stringify(v));}

test('M211: one-star run explains the exact next two-star queue threshold',()=>{
  const feedback=policy();
  assert.deepEqual(plain(feedback(1,stats(6,3),conf)),{
    kind:'queue',targetStars:2,target:5,actual:6
  });
  assert.deepEqual(plain(feedback(1,stats(9,12),conf)),{
    kind:'queue',targetStars:2,target:5,actual:9
  });
});

test('M211: two-star run explains first unmet three-star requirement',()=>{
  const feedback=policy();
  assert.deepEqual(plain(feedback(2,stats(3,4),conf)),{
    kind:'queue',targetStars:3,target:2,actual:3
  });
  assert.deepEqual(plain(feedback(2,stats(2,7),conf)),{
    kind:'switches',targetStars:3,target:5,actual:7
  });
});

test('M211: adaptive assistance and rescue are accurately recognized as three-star caps',()=>{
  const feedback=policy();
  for(const flag of [{rescueUsed:true},{assistActive:true}]){
    assert.deepEqual(plain(feedback(2,stats(1,2,flag),conf)),{
      kind:'assist',targetStars:3
    });
  }
  assert.equal(feedback(3,stats(1,2),conf),null,'perfect score must not show advice');
  assert.equal(feedback(1,stats(1,2),conf),null,'impossible inconsistent scores must not invent advice');
});

test('M211: explanations remain pure and handle invalid inputs without a runtime fault',()=>{
  const feedback=policy(),metrics=stats(4,6);
  const before=JSON.stringify(metrics),rules=JSON.stringify(conf);
  for(const stars of [NaN,0,1,2,3]){
    assert.doesNotThrow(()=>feedback(stars,metrics,conf));
  }
  assert.equal(feedback(2,stats(NaN,3),conf),null);
  assert.equal(feedback(2,null,conf),null);
  assert.equal(JSON.stringify(metrics),before);
  assert.equal(JSON.stringify(conf),rules);
});

test('M211: real win explanation text is localized and rendered only for non-perfect clears',()=>{
  const begin=app.indexOf('  function campaignStarFeedbackText(');
  const end=app.indexOf('  function showWin(',begin);
  assert.ok(begin>0&&end>begin);
  const formatSection=app.slice(begin,end);
  const ctx={lang:'ru',Game:{...stats(3,4),config:conf}};
  runInNewContext(source,ctx);
  runInNewContext(formatSection+'\nglobalThis.format=campaignStarFeedbackText;',ctx);
  assert.equal(ctx.format(2),'Для 3★: пик очереди не выше 2 (сейчас 3)');
  ctx.lang='en';
  assert.equal(ctx.format(2),'For 3★: peak queue at most 2 (now 3)');
  ctx.Game=Object.assign(ctx.Game,stats(2,6));
  assert.equal(ctx.format(2),'For 3★: no more than 5 switches (now 6)');
  ctx.Game=Object.assign(ctx.Game,stats(2,3,{rescueUsed:true}));
  assert.match(ctx.format(2),/without rescue or adaptive assist/);
  assert.equal(ctx.format(3),'');
  const win=app.slice(end,app.indexOf('  function actions(items){',end));
  assert.match(win,/const starTip=campaignStarFeedbackText\(stars\);if\(starTip\)extras\.push/);
});
