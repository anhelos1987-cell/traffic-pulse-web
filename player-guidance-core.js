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
 root.TrafficPulseGuidance=Object.freeze({
   firstSessionActive,nextLessonLevel,signalProgressSteps
 });
})(globalThis);
