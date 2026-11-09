import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
function extract(from,to){
  const start=app.indexOf(from),end=app.indexOf(to,start+from.length);
  assert.ok(start>=0&&end>start,'shipping method boundaries: '+from);
  return app.slice(start,end);
}
function particleHarness(input=[]){
  const ctx={};
  const method=extract('    updateParticles(dt){','    emitCrashFx(a,b){');
  runInNewContext('globalThis.game={'+method+'};',ctx,{filename:'shipping-particles.js'});
  return Object.assign(ctx.game,{particles:input,crashFx:null,cameraKick:0});
}
function pedestrianHarness(input=[]){
  const ctx={
    signalControllerState:(game,id)=>id?game.signalControllers[id]:game,
    independentSignals:g=>g.signalMode==='independent'
  };
  const method=extract('    updatePedestrians(dt){','    toggle(junctionId=null){');
  runInNewContext('globalThis.game={'+method+'};',ctx,{filename:'shipping-pedestrians.js'});
  return Object.assign(ctx.game,{
    pedestrians:input,signalMode:'independent',mode:'greenwave',
    signalControllers:{J0:{transitionTimer:0,phaseElapsed:0},J1:{transitionTimer:0,phaseElapsed:0}},
    pedestrianSpawnTimer:0
  });
}

test('M205: stable particle scenes reuse one backing array over many 60Hz ticks',()=>{
  const game=particleHarness(),identity=game.particles;
  for(let i=0;i<12000;i++)game.updateParticles(1/60);
  assert.strictEqual(game.particles,identity);
  assert.equal(game.particles.length,0);
});

test('M205: expired particles compact in place and retain surviving order and original objects',()=>{
  const gone={kind:'spark',x:0,y:0,vx:0,vy:0,life:.001};
  const keepA={kind:'confetti',x:10,y:20,vx:3,vy:1,life:.3};
  const keepB={kind:'smoke',x:15,y:25,vx:0,vy:0,life:1,size:6};
  const expired={kind:'debris',x:30,y:30,vx:0,vy:0,life:.005};
  const game=particleHarness([gone,keepA,expired,keepB]);
  const original=game.particles;
  game.updateParticles(1/60);
  assert.strictEqual(game.particles,original);
  assert.equal(game.particles.length,2);
  assert.strictEqual(game.particles[0],keepA);
  assert.strictEqual(game.particles[1],keepB);
  assert.ok(keepA.y>20,'existing dynamics are applied before removal');
  assert.ok(keepB.size>6);
});

test('M205: crash flash and camera decay remain unchanged by array compaction',()=>{
  const game=particleHarness();
  game.crashFx={life:.02};game.cameraKick=1;
  game.updateParticles(.01);
  assert.ok(game.crashFx&&game.crashFx.life>0);
  assert.ok(game.cameraKick<1);
  game.updateParticles(.02);
  assert.equal(game.crashFx,null);
});

test('M205: empty pedestrian scenes keep stable backing storage across fixed steps',()=>{
  const game=pedestrianHarness(),original=game.pedestrians;
  for(let i=0;i<12000;i++)game.updatePedestrians(1/60);
  assert.strictEqual(game.pedestrians,original);
  assert.equal(game.pedestrians.length,0);
  assert.equal(game.pedestrianSpawnTimer,99,'Green Wave does not spawn crossings');
});

test('M205: pedestrian cleanup compacts in place while retaining order and transition rate',()=>{
  const end={roadAxis:'V',junctionId:'J0',t:.999,duration:1};
  const first={roadAxis:'H',junctionId:'J0',t:.2,duration:2};
  const second={roadAxis:'V',junctionId:'J1',t:.25,duration:1};
  const game=pedestrianHarness([end,first,second]);
  const original=game.pedestrians;
  game.signalControllers.J1.transitionTimer=.2;
  game.signalControllers.J1.pendingPhase='V';
  game.updatePedestrians(.1);
  assert.strictEqual(game.pedestrians,original);
  assert.equal(game.pedestrians.length,2);
  assert.strictEqual(game.pedestrians[0],first);
  assert.strictEqual(game.pedestrians[1],second);
  assert.ok(Math.abs(first.t-.25)<1e-8);
  assert.ok(Math.abs(second.t-.405)<1e-8,'crossing completion during all-red is faster');
});

test('M205: per-tick cleanup must not call Array.filter on the gameplay arrays',()=>{
  const particles=extract('    updateParticles(dt){','    emitCrashFx(a,b){');
  const pedestrians=extract('    updatePedestrians(dt){','    toggle(junctionId=null){');
  assert.doesNotMatch(particles,/this\.particles\s*=\s*this\.particles\.filter\(/);
  assert.doesNotMatch(pedestrians,/this\.pedestrians\s*=\s*this\.pedestrians\.filter\(/);
});
