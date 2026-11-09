import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');

function ownerSelectionHarness(junctionType='cross'){
  const begin=source.indexOf('    moveCars(dt){');
  const end=source.indexOf('      // Smooth parking-lot merges',begin);
  assert.ok(begin>=0&&end>begin,'real moveCars owner reservation section found');
  const shippingPrefix=source.slice(begin,end);
  // Execute the shipping selection code and stop before downstream car integration
  // to isolate reservation semantics rather than duplicating the implementation.
  const ctx={
    isLinkedJunctionType:()=>false,
    isRoundaboutJunction:kind=>kind==='roundabout',
    roadLayout:()=>({edgeMin:400,edgeMax:500}),
    turnCurveBounds:()=>({start:360,end:540}),
    roundaboutOccupiesCircle:()=>false,
    roundaboutRouteEndProgress:()=>990,
    stopTargetProgress:()=>340,
    carXY:c=>({x:c.progress,y:0,rot:0}),
    AXIS:{E:'H',W:'H',N:'V',S:'V'},
    turnExitDir:()=> 'N'
  };
  runInNewContext('globalThis.game={'+shippingPrefix+
    'return {roundaboutOwnerId:this.roundaboutOwnerId,turnOwnerId:this.turnOwnerId};}};',ctx,
    {filename:'shipping-owner-reservations.js'});
  const g=Object.assign(ctx.game,{
    config:{lanes:2,junctionType},cars:[],turnOwnerId:null,roundaboutOwnerId:null,
    activeAxis:()=> 'H',pedestriansOnAxis:()=>false
  });
  return g;
}

const car=(id,progress,overrides={})=>({
  id,progress,dir:'E',axis:'H',lane:0,turn:'left',inside:false,...overrides
});

test('M210: protected-turn reservation selects highest progress and lowest tie ID',()=>{
  const g=ownerSelectionHarness();
  g.cars=[
    car(12,338),car(3,338),car(7,347),car(2,347),
    car(1,350,{axis:'V'}),car(5,370),car(4,315),car(16,345,{turn:'straight'})
  ];
  g.moveCars(1/60);
  assert.equal(g.turnOwnerId,2,'same-progress candidates break ties using smallest ID');
  g.turnOwnerId=null;g.cars=g.cars.filter(c=>c.id!==2);
  g.moveCars(1/60);
  assert.equal(g.turnOwnerId,7);
});

test('M210: pedestrian conflicts continue to prevent protected-turn reservations',()=>{
  const g=ownerSelectionHarness();
  g.cars=[car(1,345),car(2,330)];
  g.pedestriansOnAxis=axis=>axis==='V';
  g.moveCars(1/60);
  assert.equal(g.turnOwnerId,null);
});

test('M210: roundabout priority retains the same frontmost and tie-break behavior',()=>{
  const g=ownerSelectionHarness('roundabout');
  g.cars=[
    car(10,320),car(7,346),car(2,346),car(3,360),
    car(11,339,{axis:'V'})
  ];
  g.moveCars(1/60);
  assert.equal(g.roundaboutOwnerId,2);
  assert.equal(g.turnOwnerId,null,'roundabout must not open a turn slot');
});

test('M210: idle two-junction controller updates preserve phases and aggregate hold/timers',()=>{
  const start=source.indexOf('    updateSignalControllers(dt){');
  const end=source.indexOf('    update(dt){',start);
  assert.ok(start>=0&&end>start);
  const ctx={
    independentSignals:()=>true,isLinkedJunctionType:()=>true,
    updateSignalIcon(){},updateHud(){}
  };
  runInNewContext('globalThis.game={'+source.slice(start,end)+'};',ctx);
  const g=Object.assign(ctx.game,{
    config:{lanes:2,junctionType:'double-horizontal'},
    cars:[],pedestriansOnAxis:()=>false,phase:'H',pendingPhase:null,transitionTimer:0,pedestrianHold:false,
    signalControllers:{
      J0:{phase:'H',pendingPhase:null,transitionTimer:0,pedestrianHold:false},
      J1:{phase:'V',pendingPhase:'H',transitionTimer:.5,pedestrianHold:true}
    }
  });
  for(let i=0;i<12000;i++)g.updateSignalControllers(1/60);
  assert.equal(g.phase,'H');
  assert.equal(g.transitionTimer,0);
  assert.equal(g.pedestrianHold,false);
  assert.equal(g.signalControllers.J1.phase,'H');
  assert.equal(g.signalControllers.J1.pendingPhase,null);
  const signalBody=source.slice(start,end);
  assert.doesNotMatch(signalBody,/Object\.(entries|values)\(this\.signalControllers\)/,
    '60Hz independent control must avoid temporary object enumeration arrays');
});

test('M210: hot-path reservations do not allocate a filtered/sorted candidate list',()=>{
  const a=source.indexOf('    moveCars(dt){'),b=source.indexOf('      // Smooth parking-lot merges',a);
  const prefix=source.slice(a,b);
  assert.doesNotMatch(prefix,/const candidates=this\.cars\.filter/);
  const emergency=source.slice(source.indexOf('const heldEmergency=',a),source.indexOf('this.emergencyPriorityId=emergencyOwner?',a));
  assert.doesNotMatch(emergency,/\.filter\(|\.sort\(/);
});
