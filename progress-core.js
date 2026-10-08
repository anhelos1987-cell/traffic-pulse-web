// Traffic Pulse VK Play progress format; identical validation in client and Worker.
(function(root){
'use strict';
const SAVE_SCHEMA_VERSION=5, DAILY_HISTORY_LIMIT=180;
const ACHIEVEMENT_KEYS=['perfect','flow','priority','roadwork','missions'];
const CAR_COSTS=[0,180,330,580,850,1200,1750,2500,3500,5000];
const SCENARIO_SAVE_KEYS=new Set(['after_school@1','after_school@2','green_corridor@1','stadium_exit@1','airport_priority@1','roadworks_detour@1','freight_port@1','roundabout_trial@1']);
const GREEN_WAVE_SAVE_KEYS=new Set(['catch_wave@1','both_sides@1','side_streets@1','pedestrian_hour@1','long_transport@1','dispatcher_duty@1']);
  function safeInt(value,min,max,fallback=min){ const n=Number(value); return Number.isFinite(n)?Math.max(min,Math.min(max,Math.floor(n))):fallback; }

  function normalizeLanguageMode(value){return ['auto','ru','en'].includes(value)?value:'auto';}

  function validDayKey(key){ if(!/^\d{4}-\d{2}-\d{2}$/.test(key))return false; const t=Date.parse(`${key}T00:00:00Z`); return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===key; }

  function boundedDailyMap(value){
    const src=value&&typeof value==='object'?value:{}; const keys=Object.keys(src).filter(validDayKey).sort();
    const keep=keys.slice(-DAILY_HISTORY_LIMIT),out={}; for(const k of keep)out[k]=src[k]; return out;
  }

  function normalizeStarsMap(value,maxLevel=1_000_000){
    const src=value&&typeof value==='object'?value:{},out={};
    for(const [k,v] of Object.entries(src)){const level=Number(k),stars=Number(v);if(Number.isInteger(level)&&level>=1&&level<=maxLevel&&Number.isFinite(stars)&&stars>0)out[String(level)]=Math.min(3,Math.floor(stars));}
    return out;
  }

  function normalizeMissionMap(value,maxLevel=1_000_000){
    const src=value&&typeof value==='object'?value:{},out={};
    for(const [k,v] of Object.entries(src)){const level=Number(k);if(Number.isInteger(level)&&level>=1&&level<=maxLevel&&(v===true||v===1))out[String(level)]=true;}
    return out;
  }

  function normalizeMedalMap(value,maxLevel=1_000_000){
    const src=value&&typeof value==='object'?value:{},out={};
    for(const [k,v] of Object.entries(src)){const level=Number(k),mask=Number(v);if(Number.isInteger(level)&&level>=1&&level<=maxLevel&&Number.isFinite(mask)){const safe=Math.max(0,Math.min(7,Math.floor(mask)));if(safe)out[String(level)]=safe;}}
    return out;
  }

  function normalizeAchievements(value){const src=value&&typeof value==='object'?value:{},out={};for(const k of ACHIEVEMENT_KEYS)if(src[k]===true||src[k]===1)out[k]=true;return out;}

  function cleanToken(value,max=128){return typeof value==='string'?value.replace(/[^a-zA-Z0-9:_@.\-]/g,'').slice(0,max):'';}

  function normalizeBestRecord(v){
    if(!v||typeof v!=='object')return null;
    const out={stars:safeInt(v.stars,1,3,1),switches:safeInt(v.switches,0,9999,9999),maxQueue:safeInt(v.maxQueue,0,999,999)};
    const runId=cleanToken(v.runId,96),compat=cleanToken(v.compat,160);if(runId)out.runId=runId;if(compat)out.compat=compat;
    if(v.rules!=null)out.rules=safeInt(v.rules,0,999,0);if(v.configHash!=null)out.configHash=cleanToken(String(v.configHash),24);
    if(v.rescued===true)out.rescued=true;if(v.assisted===true)out.assisted=true;if(v.finishedAt!=null)out.finishedAt=safeInt(v.finishedAt,0,9_000_000_000_000_000,0);
    return out;
  }

  function normalizeDailyBest(value){
    const src=boundedDailyMap(value),out={};
    for(const [k,v] of Object.entries(src)){const record=normalizeBestRecord(v);if(record)out[k]=record;}
    return out;
  }

  function normalizeChallengeCompatMap(value){
    const src=boundedDailyMap(value),out={};
    for(const [dateKey,categories] of Object.entries(src)){
      if(!categories||typeof categories!=='object')continue;const inner={};let count=0;
      for(const [compat,v] of Object.entries(categories)){
        const key=cleanToken(compat,160),record=normalizeBestRecord(v);if(!key||!record)continue;inner[key]=record;if(++count>=8)break;
      }
      if(Object.keys(inner).length)out[dateKey]=inner;
    }
    return out;
  }

  function normalizeDailyRewards(value){ const src=boundedDailyMap(value),out={}; for(const [k,v] of Object.entries(src))if(v===true||v===1)out[k]=true; return out; }

  function normalizeScenarioProgress(value){
    const src=value&&typeof value==='object'?value:{},out={};
    for(const [k,v] of Object.entries(src)){if(!SCENARIO_SAVE_KEYS.has(k)||!v||typeof v!=='object')continue;out[k]={stars:safeInt(v.stars,0,3,0),bestQueue:safeInt(v.bestQueue,0,999,999),bestSwitches:safeInt(v.bestSwitches,0,9999,9999),bestPriority:safeInt(v.bestPriority,0,999,0),clears:safeInt(v.clears,0,1_000_000,0)};}
    return out;
  }

  function betterScenario(a,b){if(!a)return b;if(!b)return a;if((b.stars||0)!==(a.stars||0))return (b.stars||0)>(a.stars||0)?b:a;if((b.bestPriority||0)!==(a.bestPriority||0))return (b.bestPriority||0)>(a.bestPriority||0)?b:a;if((b.bestSwitches??9999)!==(a.bestSwitches??9999))return (b.bestSwitches??9999)<(a.bestSwitches??9999)?b:a;return (b.bestQueue??999)<(a.bestQueue??999)?b:a;}

  function normalizeGreenWaveProgress(value){
    const src=value&&typeof value==='object'?value:{},out={};
    for(const [k,v] of Object.entries(src)){if(!GREEN_WAVE_SAVE_KEYS.has(k)||!v||typeof v!=='object')continue;out[k]={stars:safeInt(v.stars,0,3,0),throughNoStop:safeInt(v.throughNoStop,0,999,0),throughTotal:safeInt(v.throughTotal,0,999,0),bestSideQueue:safeInt(v.bestSideQueue,0,999,999),bestSwitches:safeInt(v.bestSwitches,0,9999,9999),bestPriority:safeInt(v.bestPriority,0,999,0),clears:safeInt(v.clears,0,1_000_000,0)};}
    return out;
  }

  function betterGreenWave(a,b){if(!a)return b;if(!b)return a;if((b.stars||0)!==(a.stars||0))return (b.stars||0)>(a.stars||0)?b:a;const ar=(a.throughNoStop||0)/Math.max(1,a.throughTotal||0),br=(b.throughNoStop||0)/Math.max(1,b.throughTotal||0);if(br!==ar)return br>ar?b:a;if((b.bestPriority||0)!==(a.bestPriority||0))return (b.bestPriority||0)>(a.bestPriority||0)?b:a;if((b.bestSideQueue??999)!==(a.bestSideQueue??999))return (b.bestSideQueue??999)<(a.bestSideQueue??999)?b:a;return (b.bestSwitches??9999)<(a.bestSwitches??9999)?b:a;}

  function normalizeVkEntitlements(value){
    const src=value&&typeof value==='object'?value:{},out={};
    for(const [k,v] of Object.entries(src)){if(!/^[A-Za-z0-9._:-]{1,64}$/.test(k))continue;const qty=safeInt(v,0,999,0);if(qty>0)out[k]=qty;}
    return out;
  }

  function normalizeVkPendingSpend(value){
    if(!value||typeof value!=='object')return null;
    const requestId=String(value.requestId||''),context=String(value.context||''),carId=safeInt(value.carId,0,9,-1),cost=safeInt(value.cost,0,100000,0),localPart=safeInt(value.localPart,0,100000,0),serverPart=safeInt(value.serverPart,0,100000,0),createdAt=safeInt(value.createdAt,0,9_000_000_000_000_000,0);
    if(!/^[A-Za-z0-9._:-]{12,128}$/.test(requestId)||!/^garage_car:[0-9]+$/.test(context)||carId<0||cost<=0||localPart+serverPart!==cost)return null;
    return {requestId,context,carId,cost,localPart,serverPart,createdAt};
  }


  function normalizeSaveData(data={}){
    if(!data||typeof data!=='object')data={};
    const level=safeInt(data.level,1,1_000_000,1),legacyCount=safeInt(data.unlockedCars,1,10,1);
    const migratedOwned=Array.isArray(data.ownedCars)?data.ownedCars.map(Number).filter(v=>Number.isInteger(v)&&v>=0&&v<10):Array.from({length:legacyCount},(_,i)=>i);
    const ownedCars=[...new Set([0,...migratedOwned])].sort((a,b)=>a-b);
    const purchasedCars=Array.isArray(data.purchasedCars)?[...new Set(data.purchasedCars.map(Number).filter(v=>Number.isInteger(v)&&v>0&&v<10&&ownedCars.includes(v)))].sort((a,b)=>a-b):[];
    const starsByLevel=normalizeStarsMap(data.starsByLevel,level),starsSum=Object.values(starsByLevel).reduce((n,v)=>n+v,0);
    const reportedStars=Math.min(safeInt(data.totalStars,0,3_000_000,0),level*3),totalStars=Math.max(starsSum,reportedStars);
    const maxClaimed=Math.floor(totalStars/15),claimedRaw=Number(data.starMilestonesClaimed),claimed=Number.isFinite(claimedRaw)?Math.min(safeInt(claimedRaw,0,200_000,0),maxClaimed):maxClaimed;
    return {
      schemaVersion:SAVE_SCHEMA_VERSION, vkCloudRewards:normalizeRewardReceipts(data.vkCloudRewards), level, coins:safeInt(data.coins,0,1_000_000_000_000,0), vkPaidCoinsCredited:safeInt(data.vkPaidCoinsCredited,0,1_000_000_000_000,0), vkEntitlements:normalizeVkEntitlements(data.vkEntitlements), vkPendingSpend:normalizeVkPendingSpend(data.vkPendingSpend), totalStars, starsByLevel,
      sound:data.sound!==false, sfx:data.sfx===undefined?data.sound!==false:data.sfx!==false, musicLevel:data.musicLevel===undefined?(data.sound===false?0:3):safeInt(data.musicLevel,0,3,3), langMode:normalizeLanguageMode(data.langMode), ownedCars, purchasedCars, favoriteCar:ownedCars.includes(safeInt(data.favoriteCar,0,9,0))?safeInt(data.favoriteCar,0,9,0):0, sessions:safeInt(data.sessions,0,1_000_000_000,0),
      dailyBest:normalizeDailyBest(data.dailyBest), dailyBestCompat:normalizeChallengeCompatMap(data.dailyBestCompat), dailyRewards:normalizeDailyRewards(data.dailyRewards),
      starMilestonesClaimed:claimed, bestFlow:safeInt(data.bestFlow,0,9999,0), missionCompleted:normalizeMissionMap(data.missionCompleted,level), medalsByLevel:normalizeMedalMap(data.medalsByLevel,level), achievements:normalizeAchievements(data.achievements), weeklyBest:normalizeDailyBest(data.weeklyBest), weeklyBestCompat:normalizeChallengeCompatMap(data.weeklyBestCompat), weeklyRewards:normalizeDailyRewards(data.weeklyRewards), endlessBestScore:safeInt(data.endlessBestScore,0,1_000_000_000,0), endlessBestWave:safeInt(data.endlessBestWave,0,1_000_000,0), scenarioProgress:normalizeScenarioProgress(data.scenarioProgress), greenWaveProgress:normalizeGreenWaveProgress(data.greenWaveProgress), campaignRewardedThrough:(()=>{const raw=Number(data.campaignRewardedThrough);if(Number.isFinite(raw))return safeInt(raw,0,level,0);const currentPaid=Number(starsByLevel[String(level)]||0)>0?level:Math.max(0,level-1);return currentPaid;})(), revision:safeInt(data.revision,0,9_000_000_000_000_000,0), updatedAt:safeInt(data.updatedAt,0,9_000_000_000_000_000,0)
    };
  }

  function betterDaily(a,b){
    if(!a)return b;if(!b)return a;if((b.stars||0)!==(a.stars||0))return (b.stars||0)>(a.stars||0)?b:a;
    if((b.switches??9999)!==(a.switches??9999))return (b.switches??9999)<(a.switches??9999)?b:a;
    return (b.maxQueue??9999)<(a.maxQueue??9999)?b:a;
  }

  function mergeProgress(localData,cloudData){
    const a=normalizeSaveData(localData||{}),b=normalizeSaveData(cloudData||{}),stars={...a.starsByLevel};
    for(const [k,v] of Object.entries(b.starsByLevel||{}))stars[k]=Math.max(Number(stars[k]||0),Number(v||0));
    const dailyBest={...a.dailyBest};for(const [k,v] of Object.entries(b.dailyBest||{}))dailyBest[k]=betterDaily(dailyBest[k],v);
    const dailyBestCompat={...a.dailyBestCompat};for(const [dateKey,cats] of Object.entries(b.dailyBestCompat||{})){const inner={...(dailyBestCompat[dateKey]||{})};for(const [compat,v] of Object.entries(cats||{}))inner[compat]=betterDaily(inner[compat],v);dailyBestCompat[dateKey]=inner;}
    const dailyRewards={...a.dailyRewards};for(const [k,v] of Object.entries(b.dailyRewards||{}))if(v)dailyRewards[k]=true;
    const ownedCars=[...new Set([...a.ownedCars,...b.ownedCars,0])].sort((x,y)=>x-y);
    const purchasedCars=[...new Set([...(a.purchasedCars||[]),...(b.purchasedCars||[])])].sort((x,y)=>x-y);
    const missionCompleted={...a.missionCompleted};for(const [k,v] of Object.entries(b.missionCompleted||{}))if(v)missionCompleted[k]=true;
    const medalsByLevel={...a.medalsByLevel};for(const [k,v] of Object.entries(b.medalsByLevel||{})){const mask=((Number(medalsByLevel[k])||0)|(Number(v)||0))&7;if(mask)medalsByLevel[k]=mask;}
    const achievements={...a.achievements};for(const [k,v] of Object.entries(b.achievements||{}))if(v)achievements[k]=true;
    const weeklyBest={...a.weeklyBest};for(const [k,v] of Object.entries(b.weeklyBest||{}))weeklyBest[k]=betterDaily(weeklyBest[k],v);
    const weeklyBestCompat={...a.weeklyBestCompat};for(const [dateKey,cats] of Object.entries(b.weeklyBestCompat||{})){const inner={...(weeklyBestCompat[dateKey]||{})};for(const [compat,v] of Object.entries(cats||{}))inner[compat]=betterDaily(inner[compat],v);weeklyBestCompat[dateKey]=inner;}
    const weeklyRewards={...a.weeklyRewards};for(const [k,v] of Object.entries(b.weeklyRewards||{}))if(v)weeklyRewards[k]=true;
    const scenarioProgress={...a.scenarioProgress};for(const [k,v] of Object.entries(b.scenarioProgress||{})){const best=betterScenario(scenarioProgress[k],v);scenarioProgress[k]={...best,clears:Math.max(safeInt(a.scenarioProgress?.[k]?.clears,0,1_000_000,0),safeInt(b.scenarioProgress?.[k]?.clears,0,1_000_000,0))};}
    const greenWaveProgress={...a.greenWaveProgress};for(const [k,v] of Object.entries(b.greenWaveProgress||{})){const best=betterGreenWave(greenWaveProgress[k],v);greenWaveProgress[k]={...best,clears:Math.max(safeInt(a.greenWaveProgress?.[k]?.clears,0,1_000_000,0),safeInt(b.greenWaveProgress?.[k]?.clears,0,1_000_000,0))};}
    const totalStars=Math.max(Number(a.totalStars||0),Number(b.totalStars||0),Object.values(stars).reduce((n,v)=>n+Number(v||0),0));
    // A revision is a per-branch write counter, not a globally causal clock. Keep the conservative
    // revision-first policy for spendable currency, but use cross-device epoch timestamps for
    // user preferences. M132+ persists Yandex serverTime when the SDK is available; older saves
    // still carry epoch-millisecond Date.now values, so timestamps remain comparable enough for
    // non-economic settings. Exact timestamp ties fall back to revision, then local state.
    const balanceNewerIsCloud=(b.revision||0)!==(a.revision||0)?(b.revision||0)>(a.revision||0):(b.updatedAt||0)>(a.updatedAt||0),balanceNewer=balanceNewerIsCloud?b:a,balanceOlder=balanceNewerIsCloud?a:b;
    const preferenceNewerIsCloud=(b.updatedAt||0)!==(a.updatedAt||0)?(b.updatedAt||0)>(a.updatedAt||0):(b.revision||0)>(a.revision||0),preferenceNewer=preferenceNewerIsCloud?b:a;
    const favoriteCar=preferenceNewer.favoriteCar;
    // Currency is spendable, so max(local,cloud) is unsafe: an older pre-purchase snapshot can resurrect spent coins.
    // Use the conservative balance branch, then charge any purchase receipt imported only from the other branch exactly once.
    const newerPurchases=new Set(balanceNewer.purchasedCars||[]);let coins=balanceNewer.coins;
    for(const id of balanceOlder.purchasedCars||[])if(!newerPurchases.has(id))coins=Math.max(0,coins-(CAR_COSTS[id]||0));
    return normalizeSaveData({ ...a, level:Math.max(a.level,b.level), coins, vkPaidCoinsCredited:Math.max(a.vkPaidCoinsCredited||0,b.vkPaidCoinsCredited||0), vkEntitlements:{...a.vkEntitlements,...b.vkEntitlements}, vkPendingSpend:balanceNewer.vkPendingSpend||balanceOlder.vkPendingSpend||null, totalStars, starsByLevel:stars, ownedCars, purchasedCars, favoriteCar, sessions:Math.max(a.sessions,b.sessions), dailyBest, dailyBestCompat, dailyRewards, starMilestonesClaimed:Math.max(a.starMilestonesClaimed||0,b.starMilestonesClaimed||0), bestFlow:Math.max(a.bestFlow||0,b.bestFlow||0), missionCompleted, medalsByLevel, achievements, weeklyBest, weeklyBestCompat, weeklyRewards, endlessBestScore:Math.max(a.endlessBestScore||0,b.endlessBestScore||0), endlessBestWave:Math.max(a.endlessBestWave||0,b.endlessBestWave||0), scenarioProgress, greenWaveProgress, campaignRewardedThrough:Math.max(a.campaignRewardedThrough||0,b.campaignRewardedThrough||0), sound:preferenceNewer.sound, sfx:preferenceNewer.sfx, musicLevel:preferenceNewer.musicLevel, langMode:preferenceNewer.langMode, revision:Math.max(a.revision||0,b.revision||0), updatedAt:Math.max(a.updatedAt||0,b.updatedAt||0) });
  }

// Receipts cover ordinary earned rewards only. Real-money grants remain in the billing wallet.
function normalizeRewardReceipts(value){
 const out={};if(!value||typeof value!=='object'||Array.isArray(value))return out;
 let count=0;for(const [key,raw] of Object.entries(value)){
  if(!/^(clear:[0-9]+|star:[0-9]+:[123]|mission:[0-9]+|mission-bonus:[0-9]+|star-bonus:[0-9]+|achievement:[a-z]+|daily:[0-9-]+|weekly:[0-9-]+)$/.test(key))continue;
  const amount=safeInt(raw,0,100000,0);if(amount>0)out[key]=amount;if(++count>=10000)break;
 }return out;
}
function normalize(value){return normalizeSaveData(value);}
function merge(local,remote,base){
 const a=normalize(local),b=normalize(remote),c=base?normalize(base):null;
 const out=mergeProgress(a,b);
 // Use server causality for currency and settings, never a local clock or branch counter.
 out.vkCloudRewards={...a.vkCloudRewards,...b.vkCloudRewards};
 out.vkEntitlements=b.vkEntitlements;out.vkPaidCoinsCredited=b.vkPaidCoinsCredited;
 out.vkPendingSpend=null;
 let earned=Math.max(0,b.coins-b.vkPaidCoinsCredited);
 if(c){
  earned+=Math.max(0,a.coins-a.vkPaidCoinsCredited)-Math.max(0,c.coins-c.vkPaidCoinsCredited);
  for(const [key,amount] of Object.entries(a.vkCloudRewards)){
   if(!c.vkCloudRewards[key]&&b.vkCloudRewards[key])earned-=amount;
  }
  // Two devices buying the same permanent car import its debit only once.
  for(const id of a.purchasedCars){
   if(!c.purchasedCars.includes(id)&&b.purchasedCars.includes(id))earned+=CAR_COSTS[id]||0;
  }
 }
 out.coins=safeInt(earned+out.vkPaidCoinsCredited,0,1_000_000_000_000,0);
 for(const key of ['sound','sfx','musicLevel','langMode','favoriteCar'])out[key]=c&&a[key]!==c[key]?a[key]:b[key];
 // Rewards from an untracked legacy branch are not imported into an existing cloud balance.
 if(!c)out.vkCloudRewards={...b.vkCloudRewards};
 return normalize(out);
}
function forServer(value){const out=normalize(value);out.vkPendingSpend=null;return out;}
root.TrafficPulseProgress=Object.freeze({normalize,merge,forServer,normalizeRewardReceipts});
})(globalThis);
