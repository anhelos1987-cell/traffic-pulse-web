import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const start=app.indexOf('    moveCars(dt){');
const end=app.indexOf('    advanceEndlessWave(){',start);
assert.ok(start>0&&end>start,'shipping Game.moveCars must be found');
const moveCarsSource=app.slice(start,end);

function car(id,lane,progress,kind='car'){
  return {
    id,dir:'E',axis:'H',lane,progress,kind,
    length:76,topSpeed:100,baseSpeed:100,currentSpeed:80,
    accel:260,brake:620,mergeT:1,laneChangeT:1,
    laneChanged:false,laneChangeIntent:false,turn:'straight',
    busStopState:0,inside:false,stopped:false
  };
}

function trafficHarness(cars){
  const audio={busStops:0};
  const ctx={
    isLinkedJunctionType:()=>false,isRoundaboutJunction:()=>false,
    roadLayout:()=>({edgeMin:400,edgeMax:500}),
    turnCurveBounds:()=>({start:360,end:540}),
    isEmergencyVehicle:()=>false,roundaboutOccupiesCircle:()=>false,
    stopTargetProgress:()=>460,
    tryIncidentLaneMerge(){},
    incidentLaneAvailable:()=>true,
    signalStateForAxis:()=> 'green',
    vehicleFollowGapExtra:()=>0,
    incidentSpeedFactor:()=>1,
    maybeCueEmergencyApproach(){},
    vehicleStopLookahead:()=>130,
    approachValue:(old,target,step)=>old<target?Math.min(target,old+step):Math.max(target,old-step),
    carXY:()=>({x:0,y:0,rot:0}),
    renderedTrafficScale:()=>1,
    vehicleHornDelay:()=>Infinity,
    AudioFx:{
      busAirBrake(){audio.busStops++;},vehicleMotion(){},
      trafficHorn:()=>false,priority(){},pass(){}
    },
    Haptics:{pass(){},priority(){}},
    toast(){},T:{violatorAlert:'alert',priorityAlert:'alert',priorityYield:'yield'},
    AXIS:{E:'H',W:'H',N:'V',S:'V'}
  };
  runInNewContext('globalThis.game={'+moveCarsSource+'};',ctx,{filename:'shipping-moveCars.js'});
  const g=Object.assign(ctx.game,{
    config:{lanes:2,junctionType:'cross'},level:46,mode:'campaign',
    cars,turnOwnerId:null,roundaboutOwnerId:null,emergencyPriorityId:null,
    flowStreak:0,lastPassAt:-99,elapsed:1,exited:0,
    prioritySaved:0,particles:[],
    activeAxis:()=> 'H',pedestriansOnAxis:()=>false,
    emitExitParticles(){},
    rng:()=>.5
  });
  return {g,audio};
}

test('M203: neighboring lanes never become phantom leaders for same-direction traffic',()=>{
  const behind=car(1,0,300),adjacent=car(2,1,320);
  const {g}=trafficHarness([behind,adjacent]);
  g.moveCars(1/60);
  assert.ok(behind.progress>300,'a car with no leader in its lane must advance');
  assert.ok(adjacent.progress>320,'adjacent lane should advance independently');
  assert.equal(g.cars.length,2);
});

test('M203: a nearby same-lane leader prevents the follower from overlapping',()=>{
  const behind=car(3,0,300),ahead=car(4,0,380);
  const {g}=trafficHarness([behind,ahead]);
  g.moveCars(1/60);
  assert.equal(behind.progress,300,'unsafe headway must block forward progress');
  assert.ok(ahead.progress>380,'leader may continue normally');
});

test('M203: bus stop lasts a deterministic duration without reading Math.random',()=>{
  const bus=car(5,0,660,'bus');
  const {g,audio}=trafficHarness([bus]);
  g.moveCars(1/60);
  assert.equal(bus.busStopState,1);
  assert.ok(bus.busStopTimer>.7&&bus.busStopTimer<.83);
  assert.equal(audio.busStops,1);
  for(let i=0;i<60;i++)g.moveCars(1/60);
  assert.equal(bus.busStopState,2);
  assert.equal(audio.busStops,1,'stop sound only fires once');
});
