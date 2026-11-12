import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const pulse=require('../pulse-contract-core.js');

test('clean-wave contract is opt-in campaign only and bounded to first 20 levels',()=>{
  assert.equal(pulse.start(2,6,'daily'),null);
  assert.equal(pulse.start(21,12,'campaign'),null);
  assert.equal(pulse.targetForLevel(1,5),2);
  assert.equal(pulse.targetForLevel(4,8),3);
  assert.equal(pulse.targetForLevel(12,18),4);
  assert.equal(pulse.targetForLevel(10,2),2);
});
test('requires a deliberate switch and correct green direction',()=>{
  const contract=pulse.start(3,8,'campaign');
  assert.equal(pulse.departure(contract,'V','V',false),false);
  assert.equal(contract.progress,0,'cars leaving before first player switch do not count');
  pulse.switchTo(contract,'V');
  assert.equal(pulse.departure(contract,'H','V',false),false);
  assert.equal(pulse.departure(contract,'V','V',true),false);
  assert.equal(contract.progress,0);
  pulse.departure(contract,'V','V',false);
  assert.equal(contract.progress,1);
  pulse.switchTo(contract,'H');
  assert.equal(contract.progress,0,'changing green interrupts unfinished group');
  assert.equal(pulse.departure(contract,'H','V',false),false);
});
test('three exits on a single selected green complete exactly once',()=>{
  const contract=pulse.start(4,8,'campaign');
  pulse.switchTo(contract,'H');
  assert.equal(pulse.departure(contract,'H','H',false),false);
  assert.equal(pulse.departure(contract,'H','H',false),false);
  assert.equal(pulse.departure(contract,'H','H',false),true);
  assert.equal(pulse.departure(contract,'H','H',false),false);
  assert.equal(contract.progress,3);
  assert.equal(contract.done,true);
  assert.equal(pulse.switchTo(contract,'V'),false);
});
test('first-clear payout is exact and idempotent in the existing campaign reward path',()=>{
  const contract=pulse.start(1,5,'campaign');
  assert.equal(pulse.bonusForWin(contract,true),0);
  pulse.switchTo(contract,'V');
  pulse.departure(contract,'V','V',false);
  pulse.departure(contract,'V','V',false);
  assert.equal(pulse.bonusForWin(contract,true),25);
  assert.equal(pulse.bonusForWin(contract,false),0);
  assert.equal(pulse.bonusForWin(null,true),0);
});
test('shipping HTML includes core before app and objective nodes exist',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const core=html.indexOf('pulse-contract-core.js?v=M224'),app=html.indexOf('app.js?v=M226-');
  assert.ok(core>=0&&app>core);
  for(const id of ['pulse-contract','pulse-contract-label','pulse-contract-count'])assert.ok(html.includes('id="'+id+'"'));
});
