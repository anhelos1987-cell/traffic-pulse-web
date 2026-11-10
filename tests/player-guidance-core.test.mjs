import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const guidanceSource=readFileSync(new URL('../player-guidance-core.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function load(){
  const root={};
  runInNewContext(guidanceSource,root,{filename:'player-guidance-core.js'});
  return root.TrafficPulseGuidance;
}

test('M207: guidance policy stays a dependency-free frozen API',()=>{
  const p=load();
  assert.deepEqual(Object.keys(p).sort(),['firstSessionActive','nextLessonLevel','signalProgressSteps','campaignStarFeedback'].sort());
  assert.equal(Object.isFrozen(p),true);
  assert.doesNotMatch(guidanceSource,/\b(document|localStorage|vkBridge|navigator|fetch)\b/);
});

test('M207: onboarding gates are strict to first five campaign levels',()=>{
  const p=load();
  for(let level=1;level<=5;level++)assert.equal(p.firstSessionActive('campaign',level,level),true);
  for(const mode of ['daily','weekly','greenwave','scenario','endless'])assert.equal(p.firstSessionActive(mode,1,1),false);
  for(const [a,b] of [[0,1],[6,1],[1,6],[1,0],[NaN,1],[1,NaN],['1',1]])assert.equal(p.firstSessionActive('campaign',a,b),false);
});

test('M207: first-clear next level is a pure rule, never unlocks or awards anything',()=>{
  const p=load();
  assert.deepEqual([1,2,3,4,5].map(n=>p.nextLessonLevel(n,true)),[2,3,4,5,6]);
  for(const n of [0,6,10,1.5,-3,NaN])assert.equal(p.nextLessonLevel(n,true),null);
  for(const n of [1,3,5])assert.equal(p.nextLessonLevel(n,false),null);
  assert.equal(p.nextLessonLevel(2,1),null,'non-boolean truthy values must not count as a first clear');
});

test('M207: 20-step clearance meter handles steady, half and invalid durations deterministically',()=>{
  const p=load();
  assert.equal(p.signalProgressSteps(0,.82),0);
  assert.equal(p.signalProgressSteps(.82,.82),0);
  assert.equal(p.signalProgressSteps(.41,.82),10);
  assert.equal(p.signalProgressSteps(.205,.82),15);
  assert.equal(p.signalProgressSteps(-1,.82),0);
  assert.equal(p.signalProgressSteps(100,.82),0);
  assert.equal(p.signalProgressSteps(Infinity,.82),0);
  assert.equal(p.signalProgressSteps(NaN,.82),0);
  assert.equal(p.signalProgressSteps(.41,NaN),10,'invalid clearance uses original .82 fallback');
  assert.ok([...Array(101)].every((_,i)=>{
    const n=p.signalProgressSteps(i/100,.82);
    return Number.isInteger(n)&&n>=0&&n<=20;
  }));
});

test('M207: script load order and asset cache keys include the extracted policy',()=>{
  const iGuidance=html.indexOf('src="player-guidance-core.js?v=M211"');
  const iApp=html.indexOf('src="app.js?v=M215-VKGAMES-RC"');
  assert.ok(iGuidance>0&&iApp>iGuidance);
  assert.match(html,/href="style\.css\?v=M215-VKGAMES-RC"/);
  assert.match(app,/const BUILD_VERSION = 'M215-VKGAMES-RC';/);
  assert.match(html,/src="vk-games\.js\?v=M209-VKGAMES-CLOUD-RC"/);
  assert.match(app,/TrafficPulseGuidance\.nextLessonLevel\(/);
  assert.match(app,/TrafficPulseGuidance\.firstSessionActive\(/);
  assert.match(app,/TrafficPulseGuidance\.signalProgressSteps\(/);
});

test('M207: all local production scripts and styles resolve in the VK repository tree',()=>{
  const references=[
    ...[...html.matchAll(/<script\s+src="([^"]+)"/g)].map(x=>x[1]),
    ...[...html.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"/g)].map(x=>x[1])
  ];
  assert.ok(references.length>=8,'VK production entrypoint should enumerate all required modules');
  for(const ref of references){
    if(ref.startsWith('/')||/^https?:/.test(ref))continue;
    const pathname=ref.split('?')[0].split('#')[0];
    assert.ok(existsSync(new URL('../'+pathname,import.meta.url)),`missing production asset: ${pathname}`);
  }
  assert.equal(references.filter(x=>x.startsWith('player-guidance-core.js?')).length,1,
    'new module must be shipped exactly once');
  assert.equal(references.filter(x=>x.startsWith('app.js?')).length,1);
});
