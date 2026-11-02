// VK Games purchases: the native dialog never grants access by itself.
// This module makes no requests while the deployment configuration is disabled.
(function(root){
 'use strict';
 root.TrafficPulseVKPurchases=Object.freeze({create(deps){
  const config=deps.config||root.TrafficPulsePaymentsConfig||{};
  const request=deps.fetch||root.fetch?.bind(root);
  const sleep=deps.sleep||((ms)=>new Promise(resolve=>setTimeout(resolve,ms)));
  const now=deps.now||(()=>Date.now());
  let endpoint='';
  try{const u=new URL(config.endpoint);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&!/(^|\.)workers\.dev$/.test(u.hostname))endpoint=u.origin+u.pathname.replace(/\/$/,'');}catch(_){}
  const state={enabled:config.enabled===true&&config.appId===54870403&&config.item==='unlock_all_maps'&&config.priceVotes===10&&Boolean(endpoint&&request),
   owned:false,purchasable:false,checked:false,checking:false,busy:false,error:'',owner:'',checkJob:null,checkedAt:0,generation:0,
   account(){const a=deps.account();return a?.ready&&a.appId===54870403&&Number.isSafeInteger(a.userId)&&a.userId>0&&typeof a.launchQuery==='string'&&a.launchQuery?{...a,key:String(a.appId)+':'+a.userId}:null;},
   reset(){this.generation++;this.owned=false;this.purchasable=false;this.checked=false;this.checking=false;this.owner='';this.error='';this.checkedAt=0;this.checkJob=null;},
   hasAllMaps(){const a=this.account();return Boolean(a&&this.owner===a.key&&this.owned);},
   async refresh({force=true}={}){
    if(!this.enabled)return false;
    const account=this.account();if(!account){this.reset();return false;}
    if(this.owner!==account.key){this.reset();this.owner=account.key;}
    if(this.checkJob)return this.checkJob;
    // Cache only server-verified results in memory, never a paid localStorage flag.
    if(!force&&this.checked&&!this.error&&now()-this.checkedAt<300000)return this.hasAllMaps();
    const generation=this.generation;
    this.checking=true;
    const job=(async()=>{
     const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8000);
     try{
      const r=await request(config.transport==='yandex-function'?endpoint:endpoint+'/api/vkgames/entitlements',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({launch_params:account.launchQuery}),credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});
      if(!r.ok)throw Error('verification_unavailable');
      const data=await r.json(),current=this.account();
      if(generation!==this.generation||!current||current.key!==account.key)return false;
      if(data?.app_id!==54870403||data?.user_id!==account.userId||typeof data.all_maps!=='boolean'||typeof data.purchasable!=='boolean'||data.item!=='unlock_all_maps'||data.price_votes!==10)throw Error('invalid_verification');
      this.owner=account.key;this.owned=data.all_maps;this.purchasable=data.purchasable;this.checked=true;this.checkedAt=now();this.error='';return this.owned;
     }catch(error){if(generation===this.generation)this.error='verification_unavailable';return false;}finally{clearTimeout(timer);}
    })();
    this.checkJob=job;
    try{return await job;}finally{if(this.checkJob===job){this.checkJob=null;this.checking=false;deps.onChange?.();}}
   },
   async purchase(){
    if(!this.enabled||this.busy)return false;
    this.busy=true;deps.onBusy?.(true);
    try{
     await this.refresh();if(this.hasAllMaps())return true;
     if(!this.checked||!this.purchasable||this.error||!this.account())return false;
     if(!await deps.supported('VKWebAppShowOrderBox')){this.error='purchase_unsupported';return false;}
     const owner=this.account().key;
     let result;try{result=await deps.call('VKWebAppShowOrderBox',{type:'item',item:'unlock_all_maps'},120000);}catch(_){this.error='purchase_cancelled';}
     if(this.account()?.key!==owner){this.reset();return false;}
     // Even success/status/order_id from Bridge is only a hint to query the signed callback ledger.
     for(const delay of (result?.success===true||result?.status==='success'?[0,350,800,1500,2500]:[0])){
      if(delay)await sleep(delay);
      if(this.account()?.key!==owner){this.reset();return false;}
      await this.refresh();if(this.hasAllMaps())return true;
     }
     this.error=this.error||'payment_not_confirmed';return false;
    }finally{this.busy=false;deps.onBusy?.(false);deps.onChange?.();}
   }
  };
  return state;
 }});
})(globalThis);
