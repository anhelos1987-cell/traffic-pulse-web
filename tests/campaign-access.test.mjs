import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const context={};
for(const name of ['campaign-access.js','progress-core.js'])runInNewContext(readFileSync(new URL('../'+name,import.meta.url),'utf8'),context);
const C=context.TrafficPulseCampaign,P=context.TrafficPulseProgress;
test('paid access unlocks arbitrary maps without changing earned level, stars, coins or cars',()=>{
 const save=P.normalize({level:2,coins:100,ownedCars:[0],starsByLevel:{1:3}}),before=JSON.stringify(save);
 assert.equal(C.unlocked(117,save),false);assert.equal(C.unlocked(117,save,true),true);assert.equal(C.completed(117,save),false);
 assert.equal(JSON.stringify(save),before);assert.equal(C.unlocked(1000001,save,true),false);
 // No client-controlled progress flag is interpreted as a purchase.
 assert.equal(C.unlocked(117,{...save,allMaps:true}),false);
});
test('winning a late map preserves the sequential frontier and pays first-clear only once',()=>{
 let save=P.normalize({level:2,starsByLevel:{1:3},campaignRewardedThrough:1});
 assert.equal(C.firstClear(117,0,save),true);save.starsByLevel[117]=2;save.missionCompleted[117]=true;save.medalsByLevel[117]=3;C.advance(save);save=P.normalize(save);
 assert.equal(save.level,2);assert.equal(save.campaignRewardedThrough,1);assert.equal(save.starsByLevel[117],2);assert.equal(save.missionCompleted[117],true);assert.equal(save.medalsByLevel[117],3);
 assert.equal(C.firstClear(117,save.starsByLevel[117],save),false);assert.equal(C.completed(116,save),false);
});
test('ordinary sequential wins still advance and merge keeps earned stars on future maps',()=>{
 const save=P.normalize({level:2,starsByLevel:{1:3,2:2,117:2}});C.advance(save);assert.equal(save.level,3);
 const merged=P.merge(save,P.normalize({level:2,starsByLevel:{1:3,110:1}}),null);
 assert.equal(merged.starsByLevel[117],2);assert.equal(merged.starsByLevel[110],1);assert.equal(merged.level,3);
});
