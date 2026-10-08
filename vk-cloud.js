// VK Play cloud transport. Account-scoped local cache + server compare-and-swap.
(function(root){
'use strict';
root.TrafficPulseCloud={create(deps){
 const core=root.TrafficPulseProgress,storage=deps.storage;
 const OWNER='traffic_pulse_vk_owner_v1',CLAIMED='traffic_pulse_vk_legacy_claimed_v1',PREFIX='traffic_pulse_vk_profile_v1:';
 const read=(key)=>{try{return JSON.parse(storage.getItem(key)||'null');}catch{return null;}};
 const write=(key,value)=>{try{storage.setItem(key,JSON.stringify(value));return true;}catch{return false;}};
 const id=()=>root.crypto?.randomUUID?.()||`progress-${Date.now()}-${Math.random().toString(16).slice(2)}`;
 const equal=(a,b)=>JSON.stringify(core.forServer(a))===JSON.stringify(core.forServer(b));
 const cloud={uid:String(read(OWNER)||''),ready:false,busy:null,timer:0,epoch:0,base:null,revision:0,pending:null,dirty:false,error:'',failures:0,
  cacheKey(){return PREFIX+(this.uid||'guest');},
  restoreMeta(){const cached=read(this.cacheKey());this.base=cached?.base?core.forServer(cached.base):null;this.revision=Number.isSafeInteger(cached?.revision)?cached.revision:0;this.pending=cached?.pending||null;},
  checkpoint(){write(this.cacheKey(),{snapshot:core.normalize(deps.getSave()),base:this.base,revision:this.revision,pending:this.pending});},
  setSave(value,restart=false){
   const localPending=deps.getSave()?.vkPendingSpend;
   const next=core.normalize(value);next.vkPendingSpend=localPending||null;
   deps.setSave(next,restart);this.checkpoint();deps.onStatus?.();
  },
  bind(uid){
   uid=String(uid||'');if(!/^[0-9]{1,32}$/.test(uid))return false;
   if(this.uid!==uid){
    this.checkpoint();const old=this.uid;this.uid=uid;this.epoch++;clearTimeout(this.timer);this.timer=0;
    const cached=read(this.cacheKey());const legacy=!old&&!read(CLAIMED);
    // A profile switch never imports another account's balance, receipts or entitlements.
    const snapshot=cached?.snapshot||(legacy?deps.getSave():{});
    this.base=null;this.revision=0;this.pending=null;this.ready=false;this.error='';this.dirty=true;
    deps.setSave(core.normalize(snapshot),true);this.restoreMeta();
   }
   write(OWNER,uid);write(CLAIMED,true);this.checkpoint();return true;
  },
  unbind(){
   if(!this.uid)return;this.checkpoint();this.uid='';this.epoch++;clearTimeout(this.timer);this.timer=0;
   this.base=null;this.revision=0;this.pending=null;this.ready=false;this.dirty=false;this.error='';
   const guest=read(this.cacheKey());deps.setSave(core.normalize(guest?.snapshot||{}),true);write(OWNER,'');this.checkpoint();deps.onStatus?.();
  },
  changed(){this.dirty=true;this.checkpoint();this.schedule(350);deps.onStatus?.();},
  schedule(delay=0){clearTimeout(this.timer);this.timer=0;if(!this.uid||!deps.authorized(this.uid))return;
   this.timer=setTimeout(()=>{this.timer=0;void this.sync();},delay);
  },
  async call(path,payload,epoch,keepalive=false){
   const auth=await deps.auth();if(epoch!==this.epoch||String(auth.uid)!==this.uid)throw new Error('account_changed');
   const data=await deps.request(path,{...payload,...auth},keepalive);
   if(epoch!==this.epoch)throw new Error('account_changed');return data;
  },
  async sync(keepalive=false){
   if(!this.uid||!deps.authorized(this.uid))return false;
   if(this.busy){this.dirty=true;return this.busy;}
   if(deps.online()===false){this.error='offline';this.checkpoint();deps.onStatus?.();return false;}
   const epoch=this.epoch;this.error='';
   const job=this.run(epoch,keepalive);this.busy=job;deps.onStatus?.();
   try{return await job;}catch(error){
    if(epoch===this.epoch){this.error=String(error?.message||'cloud_error');this.failures++;this.checkpoint();deps.onStatus?.();}return false;
   }finally{
    if(this.busy===job)this.busy=null;
    if(epoch===this.epoch){deps.onStatus?.();if(this.error||this.dirty)this.schedule(this.error?Math.min(30000,2000*2**Math.min(this.failures,4)):350);}
    else this.schedule(0);
   }
  },
  async run(epoch,keepalive){
   // Replay an ambiguous write before reading: its id survives reloads and network timeouts.
   for(let attempt=0;attempt<4;attempt++){
    if(this.pending){
     let result;
     try{result=await this.call('/api/progress/save-auth',this.pending,epoch,keepalive);}
     catch(error){
      if(error?.data?.error!=='progress_conflict')throw error;
      const remote=error.data;
      if(!Number.isSafeInteger(remote.revision)||!remote.progress)throw new Error('invalid_cloud_response');
      this.setSave(core.merge(deps.getSave(),remote.progress,this.base));
      this.base=core.forServer(remote.progress);this.revision=remote.revision;this.pending=null;this.ready=true;this.dirty=true;this.checkpoint();continue;
     }
     if(result?.ok!==true||(!result.progress&&!result.idempotent)||!Number.isSafeInteger(result.revision)||result.request_id!==this.pending.request_id)throw new Error('invalid_cloud_response');
     const sent=this.pending.progress,live=deps.getSave(),ack=result.progress||sent;
     const applied=equal(live,sent)?ack:core.merge(live,ack,sent);
     this.base=core.forServer(ack);this.revision=result.revision;this.pending=null;this.ready=true;this.failures=0;
     this.setSave(applied);this.dirty=!equal(deps.getSave(),this.base);this.checkpoint();deps.onCommit?.();
     // Read latest after an idempotent retry; another device may have written since this receipt.
     if(result.idempotent||this.dirty)continue;
     return true;
    }
    const loadStart=core.forServer(deps.getSave());
    const result=await this.call('/api/progress/load-auth',{},epoch,keepalive);
    if(result?.ok!==true||!Number.isSafeInteger(result.revision)||result.revision<0||(result.progress!==null&&typeof result.progress!=='object'))throw new Error('invalid_cloud_response');
    const first=!this.ready;
    if(result.progress){
     if(!this.base||result.revision!==this.revision){
      // No baseline means legacy migration: server balance wins, achievements are united.
      const merged=core.merge(deps.getSave(),result.progress,this.base||loadStart);
      this.base=core.forServer(result.progress);this.revision=result.revision;this.setSave(merged,first);
     }
    }else{this.base=null;this.revision=0;}
    this.ready=true;this.failures=0;this.dirty=!result.progress||!equal(deps.getSave(),this.base);deps.onRead?.();
    if(!this.dirty){this.checkpoint();return true;}
    this.pending={request_id:id(),expected_revision:this.revision,progress:core.forServer(deps.getSave())};this.checkpoint();
   }
   this.dirty=true;return false;
  },
  status(){return !this.uid||!deps.authorized(this.uid)?'guest':this.error?'offline':this.busy?'saving':this.ready&&!this.dirty?'saved':'loading';}
 };
 cloud.restoreMeta();return cloud;
}};
})(globalThis);
