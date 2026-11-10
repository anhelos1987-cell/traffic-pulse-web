import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
function extract(from,to){
  const start=app.indexOf(from),end=app.indexOf(to,start+from.length);
  assert.ok(start>=0&&end>start,`Expected production source: ${from} -> ${to}`);
  return app.slice(start,end);
}
function harness(){
  const calls={weather:0,district:0},ctx={
    SIM_STEP:1/60,
    isLinkedJunctionType:type=>type==='double-horizontal',
    isEmergencyVehicle:c=>c.kind==='ambulance',
    weatherForLevel:()=>{calls.weather++;return 'clear';},
    districtInfo:()=>{calls.district++;return {id:'park'};}
  };
  const src=extract('  const visualFrameSnapshot=', '  function drawExtendedBackdrop(')+
    extract('  function cityReactionState(game){','  function drawTrafficAwareCityReactions(')+
    extract('  function cityRhythmState(game){','  function drawDailyCityRhythm(');
  runInNewContext(src+'\n globalThis.cache={beginVisualFrameSnapshot,endVisualFrameSnapshot,visualSnapshotFor,presentationElapsed,cityReactionState,cityRhythmState};',ctx);
  const game={
    state:'playing',externalPaused:false,userPaused:false,elapsed:24,renderAlpha:.5,
    level:22,config:{junctionType:'cross',maxQueue:4,total:10},flowStreak:5,exited:3,
    cars:[{dir:'E',stopped:true,progress:150,kind:'car'},{dir:'N',stopped:false,progress:440,kind:'ambulance',priorityAnnounced:true}]
  };
  return {cache:ctx.cache,calls,game};
}

test('M218: rhythm and reaction share a single immutable per-draw result, not 18 recomputations',()=>{
  const {cache,calls,game}=harness();
  const before=JSON.stringify(game);
  cache.beginVisualFrameSnapshot(game);
  const first=cache.cityRhythmState(game),reaction=cache.cityReactionState(game);
  for(let i=0;i<18;i++){
    assert.strictEqual(cache.cityRhythmState(game),first);
    assert.strictEqual(cache.cityReactionState(game),reaction);
  }
  assert.equal(calls.weather,2,'weather lookup for reaction and rhythm runs once each');
  assert.equal(calls.district,1,'district classification runs once');
  assert.equal(reaction.maxQueueNow,1);
  assert.equal(reaction.emergency,true);
  assert.equal(reaction.progress,.3);
  assert.equal(cache.presentationElapsed(game),24-1/120);
  assert.equal(JSON.stringify(game),before,'all gameplay state is immutable during the presentation snapshot');
  cache.endVisualFrameSnapshot();
});

test('M218: cache is never used by simulation or later frames',()=>{
  const {cache,calls,game}=harness();
  cache.beginVisualFrameSnapshot(game);
  const initial=cache.cityRhythmState(game);
  cache.endVisualFrameSnapshot();
  assert.equal(cache.visualSnapshotFor(game),null);
  game.elapsed+=2;game.cars[0].stopped=false;
  const next=cache.cityRhythmState(game);
  assert.notStrictEqual(next,initial,'outside a draw, no stale memoized state');
  assert.ok(next.cycle>initial.cycle,'new game time must be visible immediately');
  assert.ok(calls.weather>=4);
  cache.beginVisualFrameSnapshot(game);
  const current=cache.cityReactionState(game);
  assert.equal(current.maxQueueNow,0,'new draw sees changed queues');
  cache.endVisualFrameSnapshot();
});

test('M218: a second game never receives the first game draw cache',()=>{
  const {cache,game}=harness();
  const other={...game,elapsed:50,cars:[],flowStreak:0,exited:9};
  cache.beginVisualFrameSnapshot(game);
  const a=cache.cityRhythmState(game);
  const b=cache.cityRhythmState(other);
  assert.notStrictEqual(a,b);
  assert.ok(b.cycle>a.cycle);
  assert.equal(cache.cityReactionState(other).progress,.9);
  cache.endVisualFrameSnapshot();
});

test('M218: visual timing remains paused and deterministic across frames',()=>{
  const {cache,game}=harness();
  game.userPaused=true;game.renderAlpha=.3;
  cache.beginVisualFrameSnapshot(game);
  assert.equal(cache.presentationElapsed(game),24);
  cache.endVisualFrameSnapshot();
  game.userPaused=false;game.renderAlpha=0;
  assert.ok(Math.abs(cache.presentationElapsed(game)-(24-1/60))<1e-9);
});

test('M218: Canvas draw uses exception-safe cache boundaries; game physics remains independent',()=>{
  const draw=extract('    draw(){','    loop(ts){');
  const physics=extract('    update(dt){','    trySpawn(){');
  assert.match(draw,/beginVisualFrameSnapshot\(this\)/);
  assert.match(draw,/\}finally\s*\{[\s\S]*?endVisualFrameSnapshot\(\)/);
  assert.doesNotMatch(physics,/beginVisualFrameSnapshot|endVisualFrameSnapshot|cityRhythmState|cityReactionState/);
});
