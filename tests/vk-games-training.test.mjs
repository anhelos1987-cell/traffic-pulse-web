import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const codec=readFileSync(new URL('../progress-core.js',import.meta.url),'utf8');
function harness(){
  const context={save:{level:1,coins:75,totalStars:0,starsByLevel:{}},
    platform:{adBusy:false,purchaseBusy:false},
    AudioFx:{sync(){},win(){}},checkpoints:0,
    persistCheckpoint(){context.checkpoints++;},updateHud(){},hideFirstSessionCoach(){},
    stopTargetProgress:()=>270,levelConfig:()=>({}),
  };
  const start=app.indexOf('  const Game = {');
  const end=app.indexOf('\n  };',start)+5;
  assert.ok(start>0&&end>start);
  runInNewContext(app.slice(start,end)+'\nglobalThis.game=Game;',context);
  const game=context.game;
  game.mode='training';game.state='playing';game.externalPaused=false;game.userPaused=false;
  game.training={step:0,stage:'action',feedback:0};
  game.updateParticles=()=>{};
  game.updateSignalControllers=()=>{};
  game.moveCars=()=>{};
  game.trySpawn=()=>{const dir=game.config.plan[game.spawned];game.cars.push({dir,axis:['N','S'].includes(dir)?'V':'H'});game.spawned++;return true;};
  game.spawnPedestrianWave=axis=>game.pedestrians.push({roadAxis:axis,t:0,duration:2.5});
  game.prepareTrainingStep();
  return {context,game};
}

test('training waits indefinitely for the action and actual car exits',()=>{
  const {game,context}=harness();
  for(let i=0;i<1000;i++)game.update(1/60);
  assert.equal(game.training.step,0);
  assert.equal(game.training.stage,'action');
  game.switches=1;game.update(1/60);
  assert.equal(game.training.stage,'action','a button press is not proof a car passed');
  game.exited=game.config.total;game.update(1/60);
  assert.equal(game.training.stage,'success');
  assert.equal(context.checkpoints,0);
  game.update(.6);assert.equal(game.training.step,0);
  game.update(.61);assert.equal(game.training.step,1);
});

test('training input gate covers pedestrians, occupied centre, transitions and repeated taps',()=>{
  const {game}=harness();
  assert.equal(game.trainingCanSwitch(),true);
  game.transitionTimer=.1;assert.equal(game.trainingCanSwitch(),false);
  game.transitionTimer=0;game.pedestrians=[{t:0}];assert.equal(game.trainingCanSwitch(),false);
  game.pedestrians=[];game.cars[0].inside=true;assert.equal(game.trainingCanSwitch(),false);
  game.cars[0].inside=false;game.switches=1;assert.equal(game.trainingCanSwitch(),false);
  game.training.step=3;assert.equal(game.trainingCanSwitch(),true);
  game.training.stage='complete';assert.equal(game.trainingCanSwitch(),false);
});

test('training is frozen during manual and external pauses',()=>{
  const {game}=harness();game.training.step=2;game.prepareTrainingStep();
  for(const pause of ['userPaused','externalPaused']){
    game[pause]=true;const elapsed=game.elapsed;
    game.update(5);
    assert.equal(game.elapsed,elapsed);assert.equal(game.pedestrians[0].t,0);
    game[pause]=false;
  }
  game.update(.5);assert.equal(game.pedestrians[0].t,.2);
});

test('final practice completes once and persists without campaign or currency rewards',()=>{
  const {game,context}=harness();game.training.step=3;game.prepareTrainingStep();
  const before=JSON.stringify(context.save);
  game.exited=game.config.total;game.update(1/60);
  assert.equal(game.training.stage,'complete');assert.equal(context.checkpoints,1);
  assert.equal(context.save.trainingCompleted,true);
  delete context.save.trainingCompleted;
  assert.equal(JSON.stringify(context.save),before);
  for(let i=0;i<10;i++)game.update(1/60);
  assert.equal(context.checkpoints,1,'rendered success screen cannot re-save or award repeatedly');
});

test('first campaign entry routes an untrained player through the same tutorial',()=>{
  const {game,context}=harness();let starts=0;
  game.startTraining=()=>{starts++;return true;};
  assert.equal(game.startLevel(1),true);assert.equal(starts,1);
  context.platform.adBusy=true;
  assert.equal(game.startLevel(1),false);assert.equal(starts,1);
});

test('tutorial completion migrates older progress and survives two-device cloud reconciliation',()=>{
  const context={};runInNewContext(codec,context);
  const p=context.TrafficPulseProgress;
  assert.equal(p.normalize({}).trainingCompleted,false);
  assert.equal(p.normalize({level:5}).trainingCompleted,true);
  assert.equal(p.normalize({starsByLevel:{1:2}}).trainingCompleted,true);
  assert.equal(p.normalize({trainingCompleted:'true'}).trainingCompleted,false);
  const old=p.normalize({});
  const completed=p.normalize({trainingCompleted:true});
  assert.equal(p.merge(completed,old,old).trainingCompleted,true);
  assert.equal(p.merge(old,completed,old).trainingCompleted,true);
  assert.equal(p.forServer(completed).trainingCompleted,true);
});
