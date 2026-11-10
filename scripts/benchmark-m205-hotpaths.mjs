// Informational microbenchmark, not a release FPS score.
// Exercises shipping 60Hz cleanup methods vs the pre-M205 .filter cleanup.
// Run: node scripts/benchmark-m205-hotpaths.mjs
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {runInNewContext} from 'node:vm';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
function part(a,b){
  const start=app.indexOf(a),end=app.indexOf(b,start+a.length);
  if(start<0||end<=start)throw Error('Cannot locate shipping hot path: '+a);
  return app.slice(start,end);
}
const methods={
  particles:part('    updateParticles(dt){','    emitCrashFx(a,b){'),
  pedestrians:part('    updatePedestrians(dt){','    toggle(junctionId=null){')
};
const legacy={
  particles:methods.particles.replace(/const particles=this\.particles;let kept=0;\s*for\(let i=0;i<particles\.length;i\+\+\)if\(particles\[i\]\.life>0\)particles\[kept\+\+\]=particles\[i\];\s*particles\.length=kept;/,'this.particles=this.particles.filter(p=>p.life>0);'),
  pedestrians:methods.pedestrians.replace(/const pedestrians=this\.pedestrians;let kept=0;\s*for\(let i=0;i<pedestrians\.length;i\+\+\)if\(pedestrians\[i\]\.t<1\)pedestrians\[kept\+\+\]=pedestrians\[i\];\s*pedestrians\.length=kept;/,'this.pedestrians=this.pedestrians.filter(p=>p.t<1);')
};
for(const kind of Object.keys(methods))if(legacy[kind]===methods[kind])throw Error('Could not reconstruct legacy '+kind+' cleanup');

function make(kind,source,count){
  const context={
    signalControllerState:(g,id)=>id?g.signalControllers[id]:g,
    independentSignals:g=>g.signalMode==='independent'
  };
  runInNewContext('globalThis.game={'+source+'};',context,{filename:'bench-'+kind+'.js'});
  const game=context.game;
  if(kind==='particles'){
    Object.assign(game,{
      particles:Array.from({length:count},(_,i)=>({kind:'spark',life:100000,x:i,y:i,vx:0,vy:0})),
      crashFx:null,cameraKick:0
    });
  }else Object.assign(game,{
    pedestrians:Array.from({length:count},(_,i)=>({t:.1,roadAxis:'H',junctionId:'J0',duration:1000000,reverse:Boolean(i%2)})),
    signalMode:'independent',mode:'greenwave',pedestrianSpawnTimer:0,
    signalControllers:{J0:{transitionTimer:0,phaseElapsed:0},J1:{transitionTimer:0,phaseElapsed:0}}
  });
  return game;
}
function elapsed(kind,method,count,iterations){
  const g=make(kind,method,count);
  const step=kind==='particles'?g.updateParticles:g.updatePedestrians;
  for(let i=0;i<3000;i++)step.call(g,1/60);
  const start=performance.now();
  for(let i=0;i<iterations;i++)step.call(g,1/60);
  return performance.now()-start;
}
const iterations=30000;
console.log('M205 source-level fixed-step cleanup microbenchmark; Node runtime, not mobile FPS.');
for(const kind of ['particles','pedestrians']){
  for(const count of [0,8]){
    const before=elapsed(kind,legacy[kind],count,iterations);
    const after=elapsed(kind,methods[kind],count,iterations);
    const ratio=before/Math.max(.001,after);
    console.log(JSON.stringify({
      hotPath:kind,liveObjects:count,ticks:iterations,
      legacyMs:Number(before.toFixed(2)),m205Ms:Number(after.toFixed(2)),
      speedRatio:Number(ratio.toFixed(2)),avoidedTemporaryArrays:iterations,
      note:'informational only; JIT and device differences apply'
    }));
  }
}
