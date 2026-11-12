/* M224: deterministic, optional dispatch contract for the first campaign sessions.
   Pure state transitions: no DOM, timers, RNG, persistent schema or platform calls. */
(function(root){
  'use strict';
  const MAX_LEVEL=20, FIRST_CLEAR_BONUS=25;
  function targetForLevel(level,total){
    const n=Number(level),cars=Number(total);
    if(!Number.isInteger(n)||n<1||n>MAX_LEVEL||!Number.isFinite(cars)||cars<2)return 0;
    return Math.min(cars,n<=2?2:n<=10?3:4);
  }
  function start(level,total,mode){
    const target=mode==='campaign'?targetForLevel(level,total):0;
    return target?{target,progress:0,best:0,phase:null,armed:false,done:false}:null;
  }
  function switchTo(contract,phase){
    if(!contract||contract.done||(phase!=='H'&&phase!=='V'))return false;
    contract.phase=phase;contract.progress=0;contract.armed=true;
    return true;
  }
  function departure(contract,carAxis,openAxis,transitioning){
    if(!contract||contract.done||!contract.armed||transitioning||openAxis!==contract.phase||carAxis!==openAxis)return false;
    contract.progress=Math.min(contract.target,contract.progress+1);
    contract.best=Math.max(contract.best,contract.progress);
    if(contract.progress===contract.target){contract.done=true;return true;}
    return false;
  }
  function bonusForWin(contract,firstClear){
    return Boolean(contract&&contract.done&&firstClear)?FIRST_CLEAR_BONUS:0;
  }
  const api=Object.freeze({targetForLevel,start,switchTo,departure,bonusForWin,FIRST_CLEAR_BONUS});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.TrafficPulsePulseContract=api;
})(typeof window!=='undefined'?window:globalThis);
