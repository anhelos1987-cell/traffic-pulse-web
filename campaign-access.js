// Campaign access is separate from earned progress. Paid ownership is supplied at runtime.
(function(root){
 'use strict';
 const MAX_LEVEL=1_000_000;
 function level(value){const n=Number(value);return Number.isSafeInteger(n)&&n>=1&&n<=MAX_LEVEL?n:null;}
 function unlocked(value,save,allMaps=false){const n=level(value);return n!==null&&(allMaps===true||n<=Number(save?.level||1));}
 function completed(value,save){const n=level(value);return n!==null&&(n<Number(save?.level||1)||Number(save?.starsByLevel?.[n]||0)>0);}
 function firstClear(value,oldStars,save){const n=level(value);return n!==null&&Number(oldStars||0)===0&&n>Number(save?.campaignRewardedThrough||0)&&!save?.vkCloudRewards?.['clear:'+n];}
 function advance(save){
  let frontier=level(save.level)||1;
  while(frontier<MAX_LEVEL&&Number(save.starsByLevel?.[frontier]||0)>0)frontier++;
  save.level=frontier;
  save.campaignRewardedThrough=Math.max(Number(save.campaignRewardedThrough||0),frontier-1);
  return frontier;
 }
 root.TrafficPulseCampaign=Object.freeze({MAX_LEVEL,unlocked,completed,firstClear,advance});
})(globalThis);
