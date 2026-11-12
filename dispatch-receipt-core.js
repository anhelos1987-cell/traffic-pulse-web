/* M226 — visible, source-backed result of a player-controlled green phase.
   Pure presentation receipt: not part of traffic authority, scoring or persistence. */
(function(root){
  'use strict';
  const GATE=365,MAX_AGE=8,INITIAL_VISIBLE=4.2,AFTER_PASS_VISIBLE=3.2;
  function eligible(mode,level){
    return mode==='campaign'&&Number.isInteger(level)&&level>=1&&level<=10;
  }
  function begin(mode,level,phase,waiting,now){
    if(!eligible(mode,level)||(phase!=='H'&&phase!=='V')||!Number.isFinite(now))return null;
    return {phase,waiting:Math.max(0,Math.min(99,Math.trunc(Number(waiting)||0))),
      passed:0,startedAt:now,lastPassAt:-Infinity};
  }
  function observe(receipt,car,before,after,activeAxis,transitioning,now){
    if(!receipt||!car||receipt.phase!==activeAxis||transitioning||
       car.axis!==activeAxis||!car.signalCommitted||car.emergencyPriorityActive||
       car.violation&&car.violation!=='none'||!Number.isFinite(now)||
       now<receipt.startedAt||now-receipt.startedAt>MAX_AGE||
       !Number.isFinite(before)||!Number.isFinite(after)||
       before>=GATE||after<GATE||car.dispatchReceiptMarker===receipt)return false;
    // One physical crossing produces one feedback event even if an integration
    // accidentally reports it twice; the marker is presentation-only.
    car.dispatchReceiptMarker=receipt;
    receipt.passed++;receipt.lastPassAt=now;return true;
  }
  function view(receipt,now,transitioning){
    if(!receipt||!Number.isFinite(now)||now<receipt.startedAt)return null;
    const age=now-receipt.startedAt;
    if(age>MAX_AGE||age>(receipt.passed>0?receipt.lastPassAt-receipt.startedAt+AFTER_PASS_VISIBLE:INITIAL_VISIBLE))return null;
    return {phase:receipt.phase,waiting:receipt.waiting,passed:receipt.passed,
      stage:transitioning&&receipt.passed===0?'switching':receipt.passed?'passed':receipt.waiting?'open':'empty'};
  }
  const api=Object.freeze({eligible,begin,observe,view,GATE});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.TrafficPulseDispatchReceipt=api;
})(typeof window!=='undefined'?window:globalThis);
