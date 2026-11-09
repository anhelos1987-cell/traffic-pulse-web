import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');

function section(from,to){
  const start=source.indexOf(from);
  assert.ok(start>=0,`Missing source marker: ${from}`);
  const end=source.indexOf(to,start+from.length);
  assert.ok(end>start,`Missing end marker: ${to}`);
  return source.slice(start,end);
}

// Exercise the shipping Game methods, rather than a hand-written second
// implementation of the signal rules. Other game systems are deliberately mocked.
function signalHarness(independent=false){
  const events={ui:0};
  const context={
    reducedMotion:true,clearTimeout(){},setTimeout(){return 1;},
    AudioFx:{switch(){},sync(){},dangerSwitch(){}},
    Haptics:{switch(){}},
    countQueues:()=>({N:0,S:0,E:0,W:0}),
    updateSignalIcon(){events.ui++;},updateHud(){events.ui++;},
    hideFirstSessionCoach(){},showFirstSessionCoach(){},
    linkedJunctionInside:()=>false,
    isLinkedJunctionType:()=>independent,
    stopTargetProgress:()=>345,
    toast(){},T:{greenWaveChoose:'select junction'},
    $:()=>null
  };
  const helpers=section('  function createSignalController(', '  // M100 common signal-authority interface');
  const toggles=section('    toggle(junctionId=null){','    pause(){');
  const signalUpdater=section('    updateSignalControllers(dt){','    update(dt){');
  runInNewContext(helpers+'\nconst Game={'+toggles+signalUpdater+'}; globalThis.exports={Game,createSignalController,signalStateForAxis,anySignalTransitioning};',context,{filename:'shipping-signals.js'});
  const {Game,createSignalController,signalStateForAxis,anySignalTransitioning}=context.exports;
  Object.assign(Game,{
    state:'playing',mode:independent?'greenwave':'campaign',
    signalMode:independent?'independent':'shared',
    signalControllers:independent?{J0:createSignalController('H'),J1:createSignalController('V')}:null,
    phase:'H',pendingPhase:null,transitionTimer:0,phaseElapsed:0,pedestrianHold:false,
    cars:[],pedestrians:[],config:{clearance:.82,lanes:1,junctionType:independent?'double-horizontal':'cross'},
    elapsed:0,lastPassAt:-99,syncStreak:0,maxSyncStreak:0,firstInput:true,level:8,
    userPaused:false,externalPaused:false,switches:0,
    particles:[],rng:()=>.5,
    pedestriansOnAxis(axis,id=null){return this.pedestrians.some(p=>p.roadAxis===axis&&(!id||p.junctionId===id));}
  });
  return {Game,signalStateForAxis,anySignalTransitioning,events};
}

test('M203: normal signals keep yellow and all-red clearance before allowing opposite traffic',()=>{
  const {Game:g,signalStateForAxis:light}=signalHarness();
  assert.equal(light('H',g),'green');
  assert.equal(light('V',g),'red');
  assert.equal(g.toggle(),true);
  assert.equal(g.phase,'H','active phase cannot change at click time');
  assert.equal(g.pendingPhase,'V');
  assert.equal(g.switches,1);
  assert.equal(light('H',g),'yellow');
  assert.equal(light('V',g),'red');
  assert.equal(g.toggle(),false,'repeated click during transition is rejected');
  assert.equal(g.switches,1);
  g.updateSignalControllers(.50);
  assert.equal(light('H',g),'red');
  assert.equal(light('V',g),'red','clearance includes all-red interval');
  g.updateSignalControllers(.33);
  assert.equal(g.phase,'V');
  assert.equal(g.pendingPhase,null);
  assert.equal(g.transitionTimer,0);
  assert.equal(light('V',g),'green');
  assert.equal(light('H',g),'red');
});

test('M203: pedestrians block green release until the crosswalk clears',()=>{
  const {Game:g,signalStateForAxis:light}=signalHarness();
  g.pedestrians.push({roadAxis:'V'});
  assert.equal(g.toggle(),true);
  g.updateSignalControllers(.83);
  assert.equal(g.phase,'H');
  assert.equal(g.pendingPhase,'V');
  assert.equal(g.pedestrianHold,true);
  assert.equal(light('H',g),'red');
  assert.equal(light('V',g),'red');
  g.pedestrians.length=0;
  g.updateSignalControllers(.05);
  assert.equal(g.phase,'V');
  assert.equal(g.pedestrianHold,false);
});

test('M203: a committed crossing vehicle delays the opposite green',()=>{
  const {Game:g}=signalHarness();
  g.cars.push({axis:'H',signalCommitted:true,progress:344});
  g.toggle();g.updateSignalControllers(.83);
  assert.equal(g.phase,'H');
  assert.equal(g.pendingPhase,'V');
  assert.ok(g.transitionTimer>0);
  g.cars.length=0;g.updateSignalControllers(.05);
  assert.equal(g.phase,'V');
});

test('M203: green-wave J0 and J1 have independent transitions and counters',()=>{
  const {Game:g,signalStateForAxis:light,anySignalTransitioning}=signalHarness(true);
  assert.equal(g.toggle('J9'),false);
  assert.equal(g.switches,0);
  assert.equal(g.toggle('J0'),true);
  assert.equal(g.signalControllers.J0.phase,'H');
  assert.equal(g.signalControllers.J0.pendingPhase,'V');
  assert.equal(g.signalControllers.J1.phase,'V');
  assert.equal(light('H',g,'J0'),'yellow');
  assert.equal(light('V',g,'J1'),'green');
  assert.equal(g.toggle('J0'),false);
  assert.equal(g.toggle('J1'),true,'J1 can switch while J0 is clearing');
  assert.equal(g.switches,2);
  assert.equal(anySignalTransitioning(g),true);
  g.updateSignalControllers(.83);
  assert.equal(g.signalControllers.J0.phase,'V');
  assert.equal(g.signalControllers.J1.phase,'H');
  assert.equal(g.signalControllers.J0.pendingPhase,null);
  assert.equal(g.signalControllers.J1.pendingPhase,null);
  assert.equal(anySignalTransitioning(g),false);
});

test('M203: manual, platform and nonplaying pauses reject signal input',()=>{
  for(const independent of [false,true]){
    const {Game:g}=signalHarness(independent);
    for(const mode of ['userPaused','externalPaused','state']){
      g.userPaused=false;g.externalPaused=false;g.state='playing';
      if(mode==='state')g.state='won';else g[mode]=true;
      assert.equal(g.toggle(independent?'J0':null),false,`must reject ${mode}`);
      assert.equal(g.switches,0);
      assert.equal(g.transitionTimer,0);
    }
  }
});

test('M208: Green Wave pedestrian hold immediately updates the player-facing state',()=>{
  const {Game:g,events}=signalHarness(true);
  assert.equal(g.toggle('J0'),true);
  const before=events.ui;
  g.pedestrians.push({roadAxis:'V',junctionId:'J0'});
  g.updateSignalControllers(.83);
  assert.equal(g.signalControllers.J0.pedestrianHold,true);
  assert.ok(events.ui>before,'entering pedestrian hold must invalidate UI');
  const after=events.ui;
  g.pedestrians.length=0;
  g.updateSignalControllers(.05);
  assert.equal(g.signalControllers.J0.pedestrianHold,false);
  assert.equal(g.signalControllers.J0.phase,'V');
  assert.ok(events.ui>after,'release must refresh the independent light');
});
test('M208: real dual-signal label identifies a pedestrian hold rather than generic switching',()=>{
  const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const a=app.indexOf('  function updateSignalIcon(){'),b=app.indexOf('  function toast(msg){',a);
  assert.ok(a>=0&&b>a);
  function element(){
    const attrs={};
    return {attrs,dataset:{},style:{},classList:{toggle(){}},
      setAttribute(k,v){attrs[k]=v;},
      querySelector(){return {classList:{toggle(){}},style:{}};},
      textContent:'',disabled:false};
  }
  const ids=['signal-btn','greenwave-controls','phase-indicator','phase-label','controls-panel',
    'signal-j0-btn','signal-j1-btn','signal-j0-label','signal-j1-label'];
  const elements=Object.fromEntries(ids.map(id=>[id,element()]));
  const g={signalMode:'independent',signalControllers:{
    J0:{phase:'H',pendingPhase:'V',transitionTimer:.04,pedestrianHold:true},
    J1:{phase:'V',pendingPhase:'H',transitionTimer:.5,pedestrianHold:false}
  }};
  const ctx={Game:g,$:id=>elements[id],T:{
    greenWaveLeft:'Left',greenWaveRight:'Right',phaseChanging:'Switching',
    phasePedestrianClearing:'Pedestrians clearing',switchLight:'Switch'
  },independentSignals:()=>true,updateSignalProgress(){},phaseLabelText:x=>x};
  runInNewContext(app.slice(a,b)+'\nglobalThis.render=updateSignalIcon;',ctx,{filename:'shipping-signal-label.js'});
  ctx.render();
  assert.match(elements['signal-j0-label'].textContent,/Pedestrians clearing/);
  assert.equal(elements['signal-j0-btn'].dataset.waiting,'pedestrians');
  assert.equal(elements['signal-j0-btn'].attrs['aria-busy'],'true');
  assert.match(elements['signal-j1-label'].textContent,/Switching/);
  assert.equal(elements['signal-j1-btn'].dataset.waiting,'');
});
