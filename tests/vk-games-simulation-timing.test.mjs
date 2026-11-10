import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');

function extract(from,to){
  const begin=app.indexOf(from);
  assert.ok(begin>=0,`Missing shipping code: ${from}`);
  const end=app.indexOf(to,begin+from.length);
  assert.ok(end>begin,`Missing shipping boundary: ${to}`);
  return app.slice(begin,end);
}

function renderLoop(fps,quality=2,emaMs=16.7){
  const loop=extract('    loop(ts){','\n  };\n\n  function countQueues(){');
  const state={steps:0,draws:0,activeMs:0};
  const ctx={
    SIM_STEP:1/60,MAX_CATCHUP_STEPS:8,HUD_REFRESH_MS:80,
    RenderQuality:{level:quality,emaMs,observe(){}},
    PerfProbe:{enabled:false},
    YandexAudit:{sampleFrame(){}},
    platform:{noteActiveGameplay(ms){state.activeMs+=ms;}},
    updateHud(){},
    requestAnimationFrame(){return 42;}
  };
  runInNewContext('globalThis.game={'+loop+'};',ctx,{filename:'shipping-game-loop.js'});
  const g=ctx.game;
  Object.assign(g,{
    state:'playing',userPaused:false,externalPaused:false,
    accumulator:0,renderAlpha:1,lastTs:1000,lastHudTs:1000,lastDrawTs:1000,
    elapsed:0,hudDirty:false,replayPlayback:null,frameId:0,
    update(dt){state.steps++;this.elapsed+=dt;},
    updateParticles(){},
    draw(){state.draws++;}
  });
  for(let i=1;i<=fps;i++)g.loop(1000+i*(1000/fps));
  return {g,state};
}

test('M203: real fixed-step game loop advances identically at 20, 30 and 60 rendering FPS',()=>{
  const snapshots=[20,30,60].map(fps=>{
    const {g,state}=renderLoop(fps);
    return {fps,steps:state.steps,elapsed:g.elapsed};
  });
  assert.deepEqual(snapshots.map(s=>s.steps),[60,60,60]);
  for(const s of snapshots)assert.ok(Math.abs(s.elapsed-1)<1e-8,`${s.fps}FPS drifted: ${s.elapsed}`);
});

test('M203: adaptive low-quality drawing does not slow down the 60Hz simulation',()=>{
  const high=renderLoop(60,2),low=renderLoop(60,0,32);
  assert.equal(high.state.steps,low.state.steps);
  assert.equal(high.g.elapsed,low.g.elapsed);
  assert.ok(low.state.draws<high.state.draws);
  assert.ok(low.state.draws>0);
});

test('M203: paused game runs no simulation, resumes without catch-up burst',()=>{
  const loop=extract('    loop(ts){','\n  };\n\n  function countQueues(){');
  const ctx={
    SIM_STEP:1/60,MAX_CATCHUP_STEPS:8,HUD_REFRESH_MS:80,
    RenderQuality:{level:2,emaMs:16.7,observe(){}},PerfProbe:{enabled:false},
    YandexAudit:{sampleFrame(){}},platform:{noteActiveGameplay(){}},
    updateHud(){},requestAnimationFrame(){return 1;}
  };
  runInNewContext('globalThis.game={'+loop+'};',ctx);
  let count=0;
  const g=Object.assign(ctx.game,{
    state:'playing',userPaused:true,externalPaused:false,elapsed:0,accumulator:0,
    lastTs:1000,lastDrawTs:1000,lastHudTs:1000,hudDirty:false,
    update(dt){count++;this.elapsed+=dt;},updateParticles(){},draw(){}
  });
  for(let i=1;i<=20;i++)g.loop(1000+i*50);
  assert.equal(count,0);
  assert.equal(g.elapsed,0);
  assert.equal(g.accumulator,0);
  g.userPaused=false;
  g.loop(2050); // 50ms of active frame after 1000ms paused.
  assert.equal(count,3);
});

test('M203: severely delayed browser frame executes bounded catch-up, not a death spiral',()=>{
  const loop=extract('    loop(ts){','\n  };\n\n  function countQueues(){');
  const ctx={
    SIM_STEP:1/60,MAX_CATCHUP_STEPS:8,HUD_REFRESH_MS:80,
    RenderQuality:{level:2,emaMs:16.7,observe(){}},PerfProbe:{enabled:false},
    YandexAudit:{sampleFrame(){}},platform:{noteActiveGameplay(){}},
    updateHud(){},requestAnimationFrame(){return 1;}
  };
  runInNewContext('globalThis.game={'+loop+'};',ctx);
  let count=0;
  const g=Object.assign(ctx.game,{
    state:'playing',userPaused:false,externalPaused:false,accumulator:0,
    lastTs:1000,lastDrawTs:1000,lastHudTs:1000,hudDirty:false,
    update(){count++;},updateParticles(){},draw(){}
  });
  g.loop(1250); // 250ms gap: more than 8 fixed simulation steps.
  assert.equal(count,8);
  assert.equal(g.accumulator,0);
});

function replayHarness(){
  const method=extract('    captureFailureReplayFrame(dt=0){','    playFailureReplay(){');
  const ctx={
    carXY:car=>({x:car.progress,y:222.222,rot:.1}),
    pedestrianPose:p=>({x:50.456,y:p.t*100})
  };
  runInNewContext('globalThis.game={'+method+'};',ctx,{filename:'shipping-failure-replay.js'});
  const g=Object.assign(ctx.game,{
    state:'playing',userPaused:false,externalPaused:false,elapsed:0,
    config:{lanes:1},cars:[{progress:120.456,color:'#fff',kind:'car',style:0}],
    pedestrians:[{t:.33}],phase:'H',transitionTimer:0,
    failureReplayClock:0,failureReplayFrames:[]
  });
  return g;
}

test('M203: replay recorder preserves 120ms capture cadence at 60Hz',()=>{
  const g=replayHarness();
  for(let i=0;i<60;i++){g.elapsed+=(1/60);g.captureFailureReplayFrame(1/60);}
  assert.equal(g.failureReplayFrames.length,8,'1s of simulation should yield eight 120ms snapshots');
  assert.ok(g.failureReplayClock>=0&&g.failureReplayClock<.12);
  assert.equal(g.failureReplayFrames[0].cars[0].x,120.5);
  assert.equal(g.failureReplayFrames[0].pedestrians[0].x,50.5);
});

test('M203: failure replay history remains bounded and does not record during pause',()=>{
  const g=replayHarness();
  for(let i=0;i<600;i++){g.elapsed+=1/60;g.captureFailureReplayFrame(1/60);}
  assert.equal(g.failureReplayFrames.length,36);
  g.userPaused=true;
  for(let i=0;i<60;i++)g.captureFailureReplayFrame(1/60);
  assert.equal(g.failureReplayFrames.length,36);
  assert.equal(g.failureReplayClock<.12,true);
});

test('M216: low detail at steady 60Hz no longer discards half of presentation frames',()=>{
  const high=renderLoop(60,2,16.7),lowSmooth=renderLoop(60,0,16.7);
  assert.equal(lowSmooth.state.draws,high.state.draws,
    'adaptive visual-detail setting alone must not force 30fps on a stable PC');
  assert.equal(lowSmooth.state.steps,high.state.steps,'fixed-step simulation remains identical');
  assert.equal(lowSmooth.g.elapsed,high.g.elapsed);
});

test('M216: overloaded low-detail display still reduces Canvas work without changing simulation',()=>{
  const high=renderLoop(60,2,16.7),lowOverloaded=renderLoop(60,0,31);
  assert.ok(lowOverloaded.state.draws<high.state.draws);
  assert.equal(lowOverloaded.state.steps,high.state.steps);
  assert.equal(lowOverloaded.g.elapsed,high.g.elapsed);
});
