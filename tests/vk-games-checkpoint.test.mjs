import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const checkpointStart=app.indexOf('  function persistCheckpoint(){');
const checkpointEnd=app.indexOf('\n  const VKPurchases=',checkpointStart);
assert.ok(checkpointStart>=0&&checkpointEnd>checkpointStart,'checkpoint helper must be present');
const helper=app.slice(checkpointStart,checkpointEnd);

function runCheckpoint(ready,cloud){
  const events=[];
  const sandbox={
    persist(){events.push('local');},
    VKGames:{ready,cloud,sync(){events.push('cloud');return Promise.resolve(true);}}
  };
  runInNewContext(helper+'\npersistCheckpoint();',sandbox,{filename:'checkpoint-helper.js'});
  return events;
}

test('M202: important progress is persisted locally before cloud sync starts',()=>{
  assert.deepEqual(runCheckpoint(true,true),['local','cloud']);
});

test('M202: important progress stays locally durable if platform cloud is unavailable',()=>{
  assert.deepEqual(runCheckpoint(false,false),['local']);
  assert.deepEqual(runCheckpoint(true,false),['local']);
});

test('M202: every win mode and successful rewarded coin grant uses checkpoint flush',()=>{
  const start=app.indexOf('    win(){');
  const end=app.indexOf('    async next(){',start);
  assert.ok(start>=0&&end>start,'Game.win must be found');
  const wins=app.slice(start,end);
  // Scenario, green wave, weekly, daily, campaign.
  assert.equal((wins.match(/persistCheckpoint\(\)/g)||[]).length,5);
  const rewardStart=app.indexOf('  async function claimWinRewardedCoins(');
  const rewardEnd=app.indexOf('  function showWin(',rewardStart);
  assert.ok(rewardStart>=0&&rewardEnd>rewardStart);
  assert.match(app.slice(rewardStart,rewardEnd),/save\.coins\+=amount;persistCheckpoint\(\)/);
});
