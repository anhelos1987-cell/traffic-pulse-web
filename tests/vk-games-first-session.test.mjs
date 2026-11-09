import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
function section(start,end){
  const a=app.indexOf(start),b=app.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,'missing source section '+start);return app.slice(a,b);
}
function lessonHarness(){
  const T={
    tapSignal:'Tap',tutorialGoal2:'Wait for the next stream',
    tutorialGoal3:'Watch both queues',tutorialGoal4:'Let junction clear',
    tutorialGoal5:'Let groups through',tutorialPedestrians:'Pedestrians next'
  };
  const ctx={T,Number};
  const source=section('  function tutorialCueForLevel(level){','  function firstSessionCoachActive(');
  runInNewContext(source+'\nglobalThis.lesson=firstSessionNextLesson;',ctx);
  return ctx.lesson;
}
test('M206: first-clear lessons preview the real upcoming tutorial in order',()=>{
  const lesson=lessonHarness();
  assert.deepEqual([1,2,3,4,5].map(n=>lesson(n,true)),[
    '🚦 Wait for the next stream','👀 Watch both queues','🛡 Let junction clear',
    '⚡ Let groups through','🚶 Pedestrians next'
  ]);
});
test('M206: previews cannot appear on replay or outside first five levels',()=>{
  const lesson=lessonHarness();
  for(const level of [-1,0,1,5,6,50,NaN,1.5])assert.equal(lesson(level,false),'');
  for(const level of [-1,0,6,50,NaN,1.5])assert.equal(lesson(level,true),'');
  const showWin=section('  function showWin(','  function actions(');
  assert.match(showWin,/firstSessionNextLesson\(Game\.level,firstClear\)/);
  assert.match(showWin,/nextLesson\?\x60\$\{T\.completeText\}/);
});

function failHarness({level=2,saveLevel=2,type='jam',fails=0}={}){
  const els=Object.fromEntries(['modal-kicker','modal-title','modal-text','modal-stars','modal-reward','modal-extra']
    .map(k=>[k,{textContent:'',classList:{add(){},remove(){}}}]));
  let actionsArgs=null,opened=null;
  const Game={mode:'campaign',level,fail:()=>{},restart(){},failureReplayFrames:[]};
  const ctx={
    Game,save:{level:saveLevel},sessionFailCounts:new Map([[level,fails]]),
    T:{crash:'Crash',trafficJam:'Jam',crashText:'Crossing conflict.',jamText:'Queue limit exceeded.',
      tutorialCoachOpenWaiting:'Open the waiting stream.',assistNext:'Assist next run.',
      failureReplayCrash:'Replay crash',failureReplayJam:'Replay jam',tryAgain:'Retry'},
    $:id=>els[id],actions:a=>{actionsArgs=a;},openOverlay:x=>{opened=x;}
  };
  runInNewContext(section('  function firstSessionCoachActive(','  function hideFirstSessionCoach(')+
    '\n'+section('  function showFail(type){','  async function claimWinRewardedCoins('),ctx);
  ctx.showFail(type);
  return {text:els['modal-text'].textContent,actions:actionsArgs,opened};
}
test('M206: early jam explains an actionable next step, without changing retry flow',()=>{
  const early=failHarness({level:3});
  assert.equal(early.text,'Queue limit exceeded. Open the waiting stream.');
  assert.equal(early.actions[0].text,'Retry');
  assert.equal(early.opened,'fail');
});
test('M206: non-onboarding jams and crashes preserve existing copy',()=>{
  assert.equal(failHarness({level:12,saveLevel:12}).text,'Queue limit exceeded.');
  assert.equal(failHarness({level:2,type:'crash'}).text,'Crossing conflict.');
  assert.equal(failHarness({level:2,fails:2}).text,'Queue limit exceeded. Open the waiting stream. Assist next run.');
});
test('M206: tutorial callback belongs to restart-cancellable notice list',()=>{
  const toggle=section('    toggle(junctionId=null){','    toggleJunction(junctionId){');
  assert.match(toggle,/this\.scheduleNotice\(\(\)=>\{if\(this\.state==='playing'/);
  assert.doesNotMatch(toggle,/else if\(wasFirstInput&&this\.level===1\)setTimeout/);
  const level=section('    startLevel(n,rescued=false,mode=','    startScenario(');
  assert.match(level,/this\.clearNoticeTimers\(\)/);
});
