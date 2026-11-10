import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
function extract(start,end){
  const a=app.indexOf(start),b=app.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,`Missing shipping source boundaries: ${start} -> ${end}`);
  return app.slice(a,b);
}

function presentationHarness(){
  const source=extract('  function pedestrianPose(', '  function emergencyApproachingAxis(')+
    extract('  function lerpAngle(', '  function drawExtendedBackdrop(');
  const ctx={
    SIM_STEP:1/60,
    CROSSWALK_STOP_A:268,CROSSWALK_STOP_B:632,
    roadLayout:()=>({edgeMin:278,edgeMax:622}),
    carXY:car=>({x:car.progress,y:100,rot:0}),
    Game:{config:{lanes:2},renderAlpha:.5,elapsed:10,state:'playing',userPaused:false,externalPaused:false}
  };
  runInNewContext(source+'\n globalThis.p={pedestrianPose,renderPedestrianPose,presentationElapsed,renderCarPose};',ctx);
  return {p:ctx.p,Game:ctx.Game};
}

test('M217: interpolates crossing pedestrian position without changing authoritative progress',()=>{
  const {p}=presentationHarness();
  const ped={roadAxis:'V',t:.6,prevRenderT:.4,laneSide:0,reverse:false,crossing:0};
  const before=p.pedestrianPose(ped,2,.4),middle=p.renderPedestrianPose(ped,2,.5),after=p.pedestrianPose(ped,2,.6);
  assert.ok(before.x<middle.x&&middle.x<after.x);
  assert.ok(Math.abs(middle.x-(before.x+after.x)*.5)<1e-9);
  assert.equal(ped.t,.6);
  assert.equal(ped.prevRenderT,.4);
});

test('M217: no previous pose falls back to the current pedestrian position',()=>{
  const {p}=presentationHarness();
  const ped={roadAxis:'H',t:.42,reverse:true,laneSide:1};
  assert.deepEqual({...p.renderPedestrianPose(ped,2,.25)},{...p.pedestrianPose(ped,2)});
});

test('M217: interpolation also honors 0 and 1 endpoints for vehicles and pedestrians',()=>{
  const {p}=presentationHarness();
  const ped={roadAxis:'V',t:.7,prevRenderT:.5};
  assert.deepEqual({...p.renderPedestrianPose(ped,2,0)},{...p.pedestrianPose(ped,2,.5)});
  assert.deepEqual({...p.renderPedestrianPose(ped,2,1)},{...p.pedestrianPose(ped,2,.7)});
  const car={progress:120,prevRenderPose:{x:110,y:100,rot:0}};
  assert.equal(p.renderCarPose(car,0).x,110);
  assert.equal(p.renderCarPose(car,1).x,120);
});

test('M217: decorative presentation uses continuous fractional simulation time',()=>{
  const {p,Game}=presentationHarness();
  Game.elapsed=10;Game.renderAlpha=0;
  assert.ok(Math.abs(p.presentationElapsed(Game)-(10-1/60))<1e-9);
  Game.renderAlpha=.5;
  assert.ok(Math.abs(p.presentationElapsed(Game)-(10-1/120))<1e-9);
  Game.renderAlpha=1;
  assert.equal(p.presentationElapsed(Game),10);
  Game.userPaused=true;Game.renderAlpha=.15;
  assert.equal(p.presentationElapsed(Game),10,'paused visual clock must not advance');
  Game.userPaused=false;Game.externalPaused=true;
  assert.equal(p.presentationElapsed(Game),10,'platform pause remains frozen');
});

test('M217: game update snapshots pedestrian progress before advancing it',()=>{
  const source=extract('    updatePedestrians(dt){','    toggle(junctionId=null){');
  const ctx={
    signalControllerState:()=>({transitionTimer:0,pendingPhase:null}),
    independentSignals:()=>false
  };
  runInNewContext('globalThis.g={'+source+'};',ctx);
  const g=ctx.g;
  const ped={id:1,t:.4,duration:2,roadAxis:'V'};
  Object.assign(g,{
    pedestrians:[ped],config:{lanes:1},transitionTimer:1,
    signalControllers:null,mode:'campaign',phaseElapsed:0
  });
  g.updatePedestrians(1/60);
  assert.equal(ped.prevRenderT,.4);
  assert.ok(ped.t>.4);
  const previous=ped.t;
  g.updatePedestrians(1/60);
  assert.equal(ped.prevRenderT,previous,'multiple catch-up ticks snapshot the immediately preceding step');
});

test('M217: frame profiler distinguishes rAF gaps from main-loop work and simulation cost',()=>{
  assert.match(app,/simP95Ms:/);
  assert.match(app,/loopP95Ms:/);
  assert.match(app,/catchupPct:/);
  assert.match(app,/PerfProbe\.sim\(performance\.now\(\)-startedSim,steps\)/);
  assert.match(app,/PerfProbe\.loopWork\(performance\.now\(\)-startedWork\)/);
  assert.match(app,/const visualTime=presentationElapsed\(game\)/);
  assert.match(app,/renderPedestrianPose\(ped,game\.config\?\.lanes\|\|1,game\.renderAlpha\)/);
});
