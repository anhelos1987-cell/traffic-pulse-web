import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function section(a,b){
  const i=source.indexOf(a),j=source.indexOf(b,i+a.length);
  assert.ok(i>=0&&j>i,'missing gameplay section: '+a);
  return source.slice(i,j);
}
const earlySource=section('  const EARLY_LEVELS = [','  function seeded(seed)');
function earlyConfigs(){
  const context={};
  runInNewContext(earlySource+'\nglobalThis.early=EARLY_LEVELS;',context);
  return context.early;
}
function forecast(){
  const code=section('  function dispatchForecast(game=Game){','  function levelGoal(){');
  const context={axisForPlanItem:x=>['N','S'].includes(x)?'V':'H'};
  runInNewContext(code+'\nglobalThis.forecast=dispatchForecast;',context);
  return context.forecast;
}
test('M225: curated first-ten schedules remain short, deterministic and contain learnable green groups',()=>{
  const early=earlyConfigs();
  assert.equal(early.length,30,'later campaign chapter definitions remain available');
  assert.equal(early[0].plan,'NNNNN','first tutorial/campaign lesson stays compatible');
  for(let level=1;level<=10;level++){
    const cfg=early[level-1],axes=[...cfg.plan].map(x=>['N','S'].includes(x)?'V':'H');
    assert.ok(/^[NSEW]+$/.test(cfg.plan));
    assert.ok(cfg.plan.length>=5&&cfg.plan.length<=12, 'short first session L'+level);
    assert.ok(cfg.interval>=1.08,'readable timing L'+level);
    assert.ok(cfg.maxQueue>=4&&cfg.maxQueue<=5,'queue stays bounded L'+level);
    if(level>=2){assert.ok(axes.includes('H')&&axes.includes('V'));}
    assert.ok(axes.some((v,i)=>i>1&&v===axes[i-1]&&v===axes[i-2]),
      'every level offers a meaningful 3-car dispatch opportunity L'+level);
  }
});
test('M225: arrival forecast is exact next contiguous axis and stops at group boundary',()=>{
  const f=forecast();
  assert.deepEqual({...f({mode:'campaign',level:4,state:'playing',config:{plan:['N','N','E','E','W','S']},spawned:2})},{axis:'H',group:3});
  assert.deepEqual({...f({mode:'campaign',level:4,state:'playing',config:{plan:['N','S','W']},spawned:0})},{axis:'V',group:2});
  assert.deepEqual({...f({mode:'campaign',level:4,state:'playing',config:{plan:['N','N']},spawned:1})},{axis:'V',group:1});
});
test('M225: forecast disappears in training, late campaign, daily, or after final spawn',()=>{
  const f=forecast();
  const g={mode:'campaign',level:1,state:'playing',config:{plan:['N','S']},spawned:0};
  for(const patch of [{mode:'training'},{mode:'daily'},{level:11},{state:'failed'},{spawned:2},{spawned:-1}]){
    assert.equal(f({...g,...patch}),null);
  }
});
test('M225: compact horizontal-phone titles are localized and retain core goals outside the presentation layer',()=>{
  const code=section('  function compactDispatchGoal(level,language){','  function levelGoal(){');
  const context={};
  runInNewContext(code+'\nglobalThis.shortGoal=compactDispatchGoal;',context);
  const short=context.shortGoal;
  assert.equal(short(1,'ru'),'Открой ↕');
  assert.equal(short(1,'en'),'Open ↕');
  assert.equal(short(6,'ru'),'Береги пешеходов');
  assert.equal(short(11,'ru'),'');
  assert.equal(short(0,'en'),'');
  assert.match(source,/el\.setAttribute\('aria-label',fullGoal\)/);
});

test('M225: atlas cached separately from later city and does not replace actual roads',()=>{
  assert.match(source,/dispatchFocusWorld\(game\)/);
  assert.match(source,/\$\{dispatchFocus\?'focus':'city'\}/);
  assert.match(source,/if\(dispatchFocus\)\{drawDispatchAtlasBase\(g,theme\.id\);\}else\{/);
  assert.match(source,/drawRoadSurface\(g,lanes\);drawSidewalkFrame\(g,lanes\);drawAsphaltSheen/);
  assert.match(source,/if\(!focusWorld\)drawSidewalkPedestrians\(g,game\);/);
  assert.ok(html.includes('id="dispatch-forecast"')&&html.includes('id="dispatch-forecast-text"'));
});
