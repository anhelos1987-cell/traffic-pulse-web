// Pure UI guidance policy. No DOM, storage, platform SDK or gameplay mutations.
// Loaded before app.js by index.html; independently testable with Node.
(function(root){
 'use strict';
 function firstSessionActive(mode,level,unlockedLevel){
   return mode==='campaign'&&Number.isSafeInteger(level)&&level>=1&&level<=5
     &&Number.isSafeInteger(unlockedLevel)&&unlockedLevel>=1&&unlockedLevel<=5;
 }
 function nextLessonLevel(level,firstClear){
   return firstClear===true&&Number.isSafeInteger(level)&&level>=1&&level<=5
     ?level+1:null;
 }
 function signalProgressSteps(timer,clearance){
   const total=Math.max(.01,Number(clearance)||.82);
   const remaining=Math.max(0,Number(timer)||0);
   return remaining>0?Math.max(0,Math.min(20,Math.floor((1-Math.min(1,remaining/total))*20))):0;
 }
 // M211: explain one concrete reason why the next campaign star was not earned.
 // This is intentionally read-only; scoring still happens in Game.win().
 function campaignStarFeedback(stars,metrics,config){
   if(stars>=3||stars<1||!metrics||!config)return null;
   const queue=Number(metrics.maxObservedQueue),switches=Number(metrics.switches);
   if(!Number.isFinite(queue)||!Number.isFinite(switches))return null;
   const twoStarQueue=Math.max(2,Number(config.maxQueue||4)-1);
   const perfectQueue=Number(config.perfectQueue||2);
   const switchBudget=Number(config.perfectSwitchBudget??(Number(config.parSwitches||0)+2));
   if(stars===1&&queue>twoStarQueue)return {kind:'queue',targetStars:2,target:twoStarQueue,actual:queue};
   if(queue>perfectQueue)return {kind:'queue',targetStars:3,target:perfectQueue,actual:queue};
   if(switches>switchBudget)return {kind:'switches',targetStars:3,target:switchBudget,actual:switches};
   if(metrics.rescueUsed||metrics.assistActive)return {kind:'assist',targetStars:3};
   return null;
 }
 root.TrafficPulseGuidance=Object.freeze({
   firstSessionActive,nextLessonLevel,signalProgressSteps,campaignStarFeedback
 });
})(globalThis);
