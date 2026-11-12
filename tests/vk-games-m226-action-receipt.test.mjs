import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const receipt=require('../dispatch-receipt-core.js');
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('M226: only early campaign decisions create visible receipts',()=>{
  assert.equal(receipt.begin('training',1,'V',3,0),null);
  assert.equal(receipt.begin('daily',1,'V',3,0),null);
  assert.equal(receipt.begin('campaign',11,'V',3,0),null);
  assert.equal(receipt.begin('campaign',1,'X',3,0),null);
  const r=receipt.begin('campaign',1,'V',3,10);
  assert.deepEqual({...r},{phase:'V',waiting:3,passed:0,startedAt:10,lastPassAt:-Infinity});
  assert.deepEqual({...receipt.view(r,10.4,true)},{phase:'V',waiting:3,passed:0,stage:'switching'});
  assert.equal(receipt.view(r,11.5,false).stage,'open');
});

test('M226: credit requires observed junction crossing on exactly the selected green',()=>{
  const r=receipt.begin('campaign',3,'H',2,2);
  const car={axis:'H',signalCommitted:true,violation:'none'};
  for(const patch of [
    {axis:'V'},{signalCommitted:false},{violation:'red'},{violation:'yellow'},
    {emergencyPriorityActive:true}
  ]){
    assert.equal(receipt.observe(r,{...car,...patch},364,366,'H',false,3),false);
  }
  assert.equal(receipt.observe(r,car,364,366,'V',false,3),false,'old phase is not the requested green');
  assert.equal(receipt.observe(r,car,364,366,'H',true,3),false,'yellow/all-red cannot be counted');
  assert.equal(receipt.observe(r,car,366,370,'H',false,3),false,'already inside');
  assert.equal(receipt.observe(r,car,300,364,'H',false,3),false,'still approaching the junction');
  assert.equal(receipt.observe(r,car,364,366,'H',false,3),true);
  assert.equal(receipt.observe(r,car,364,366,'H',false,3),false,'same car cannot count twice');
  assert.equal(r.passed,1);
  assert.equal(receipt.view(r,3.1,false).stage,'passed');
});

test('M226: no stale result survives a long interval or mistaken old traffic',()=>{
  const r=receipt.begin('campaign',1,'V',0,15);
  const car={axis:'V',signalCommitted:true};
  assert.equal(receipt.view(r,19.25,false),null,'unproductive request is temporary');
  assert.equal(receipt.observe(r,car,364,366,'V',false,23.1),false,'old event is not attributed to new tap');
  assert.equal(receipt.view(r,23.1,false),null);
  const newRequest=receipt.begin('campaign',1,'H',2,24);
  assert.equal(newRequest.passed,0,'new action is measured independently');
});

test('M226: real crossing, not world exit, triggers the existing Clean Wave progress',()=>{
  assert.match(app,/if\(this\.mode==='campaign'&&this\.level<=20&&beforeCrossing<365&&next>=365/);
  assert.match(app,/this\.recordPulseDeparture\?\.\(c\)/);
  assert.match(app,/this\.recordDispatchCrossing\?\.\(c,beforeCrossing,next\)/);
  assert.doesNotMatch(app,/if\(c\.progress>=exitAt\)\{ passed\+\+; this\.recordPulseDeparture\(c\)/);
});

test('M226: shipping UI and entrypoint include receipt core before app',()=>{
  const core=html.indexOf('dispatch-receipt-core.js?v=M226');
  const game=html.indexOf('app.js?v=M226-VKGAMES-ACTION-RECEIPT');
  assert.ok(core>=0&&game>core);
  for(const id of ['dispatch-receipt','dispatch-receipt-title','dispatch-receipt-detail']){
    assert.ok(html.includes('id="'+id+'"'),id);
  }
  assert.match(app,/const BUILD_VERSION = 'M226-VKGAMES-ACTION-RECEIPT';/);
});
