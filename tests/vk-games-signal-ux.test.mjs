import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../style.css',import.meta.url),'utf8');

function part(start,end){
  const a=app.indexOf(start); assert.ok(a>=0,'missing '+start);
  const b=app.indexOf(end,a+start.length); assert.ok(b>a,'missing '+end);
  return app.slice(a,b);
}
function meter(independent=false){
  const buttons=Object.fromEntries(['signal-btn','signal-j0-btn','signal-j1-btn'].map(id=>{
    const writes=[];return [id,{writes,style:{setProperty(k,v){writes.push([k,v]);}}}];
  }));
  const game={config:{clearance:.82},transitionTimer:.82,signalMode:independent?'independent':'shared',
    signalControllers:independent?{J0:{transitionTimer:.82},J1:{transitionTimer:.41}}:null};
  const sandbox={Game:game,$:id=>buttons[id],independentSignals:g=>g.signalMode==='independent'};
  const source=part('  function updateSignalProgress(){','  function setHudText(');
  runInNewContext('const SIGNAL_PROGRESS_CACHE=Object.create(null);'+source+';globalThis.render=updateSignalProgress;',sandbox);
  return {game,buttons,render:sandbox.render};
}

test('M204: regular signal meter advances with actual remaining time and resets',()=>{
  const {game,buttons,render}=meter();
  render();
  assert.deepEqual(buttons['signal-btn'].writes.at(-1),['--signal-progress','0']);
  game.transitionTimer=.41;render();
  assert.deepEqual(buttons['signal-btn'].writes.at(-1),['--signal-progress','0.5']);
  const writes=buttons['signal-btn'].writes.length;
  render();
  assert.equal(buttons['signal-btn'].writes.length,writes,'HUD update must avoid redundant DOM writes');
  game.transitionTimer=0;render();
  assert.deepEqual(buttons['signal-btn'].writes.at(-1),['--signal-progress','0']);
});

test('M204: Green Wave meters are independent for J0 and J1',()=>{
  const {game,buttons,render}=meter(true);
  render();
  assert.deepEqual(buttons['signal-j0-btn'].writes.at(-1),['--signal-progress','0']);
  assert.deepEqual(buttons['signal-j1-btn'].writes.at(-1),['--signal-progress','0.5']);
  game.signalControllers.J1.transitionTimer=0;render();
  assert.deepEqual(buttons['signal-j1-btn'].writes.at(-1),['--signal-progress','0']);
  assert.equal(buttons['signal-j0-btn'].writes.length,1);
});

test('M204: ignored input during clearance gives throttled feedback but never queues a switch',()=>{
  let clock=0,calls=0;
  const warnings=[];
  const game={state:'playing',userPaused:false,externalPaused:false,transitionTimer:.4,
    pedestrianHold:false,toggle(){calls++;return false;}};
  const ctx={Game:game,independentSignals:()=>false,performance:{now:()=>clock},
    toast:message=>warnings.push(message),T:{phaseChanging:'changing',phasePedestrianClearing:'pedestrian hold'}};
  runInNewContext(part('  let lastClearanceHintAt=-Infinity;',"  $('signal-btn').addEventListener"),ctx);
  assert.equal(ctx.togglePlayerSignal(),false);
  assert.deepEqual(warnings,['changing']);
  clock=200;ctx.togglePlayerSignal();
  assert.equal(warnings.length,1,'ignore repeated taps to avoid toast spam');
  clock=1020;game.pedestrianHold=true;ctx.togglePlayerSignal();
  assert.deepEqual(warnings,['changing','pedestrian hold']);
  game.userPaused=true;clock=2100;ctx.togglePlayerSignal();
  assert.equal(warnings.length,2);
  assert.equal(game.transitionTimer,.4);
  assert.equal(calls,4,'rejected input does not queue a second phase');
});

test('M204: meter styling lives on existing busy buttons and respects reduced motion',()=>{
  assert.match(css,/\.control\.signal\[aria-busy="true"\]::before\s*\{/);
  assert.match(css,/scaleX\(var\(--signal-progress,0\)\)/);
  assert.match(css,/prefers-reduced-motion: reduce/);
  assert.match(app,/updateSignalProgress\(\);\s*if\(typeof PersonalBestService/);
});
