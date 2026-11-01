// Traffic Pulse / VK Games (VK Mini Apps) adapter.
// Native VK Storage is the authoritative cross-device progress store.
// Writes use alternate banks and a commit pointer to tolerate interrupted sessions.
(function(root){
  'use strict';
  const HEAD = 'TP_VKG_HEAD_V1', KEY_PREFIX = 'TP_VKG_BANK_V1_';
  const CHUNK_SIZE = 3500, MAX_CHUNKS = 64; // VK Storage values are capped at 4096 bytes.
  const TIMEOUT_MS = 6500;
  const timeout = (promise, ms=TIMEOUT_MS) => {
    let timer;
    return Promise.race([
      Promise.resolve(promise).finally(()=>clearTimeout(timer)),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('vk_bridge_timeout')),ms);})
    ]);
  };
  function checksum(str){ // Data corruption detector only; not an authentication hash.
    let h=2166136261;
    for(let i=0;i<str.length;i++){h=Math.imul(h^str.charCodeAt(i),16777619);}
    return (h>>>0).toString(16);
  }
  function encode(json){
    const bytes=new TextEncoder().encode(json);
    let binary='';
    for(let i=0;i<bytes.length;i+=8192){
      binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+8192));
    }
    return btoa(binary);
  }
  function decode(base64){
    const binary=atob(base64),bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  }
  const storeKey=(bank,index)=>KEY_PREFIX+bank+'_'+index;
  const parseHead=value=>{
    if(!value)return null;
    const head=JSON.parse(value);
    if(head?.v!==1||!['A','B'].includes(head.bank)||
       !Number.isSafeInteger(head.count)||head.count<1||head.count>MAX_CHUNKS||
       !/^[0-9a-f]{1,8}$/.test(String(head.hash)))throw new Error('vk_cloud_invalid_manifest');
    return head;
  };
  function cleanProgress(value,normalize){
    const p=normalize(value);
    // VK Play purchases and their wallet must never be imported into VK Games.
    p.vkPaidCoinsCredited=0;p.vkEntitlements={};p.vkPendingSpend=null;
    return p;
  }
  root.TrafficPulseVKGames=Object.freeze({
    create(deps){
      const bridge=root.vkBridge;
      const state={
        ready:false,loaded:false,available:!!bridge,
        // Local progress may have advanced during an earlier offline session.
        dirty:Number(deps.getSave()?.revision||0)>0,busy:null,timer:0,
        head:null,error:'', lastAdAt:0,
        status(){return !this.available?'local':this.error?'offline':!this.loaded?'loading':this.busy||this.dirty?'saving':'saved';},
        inform(){deps.onStatus?.(this.status());},
        async command(type,params){if(!bridge?.send)throw new Error('vk_bridge_unavailable');return timeout(bridge.send(type,params));},
        async get(keys){
          const r=await this.command('VKWebAppStorageGet',{keys});
          if(!r||!Array.isArray(r.keys))throw new Error('vk_cloud_invalid_response');
          return Object.fromEntries(r.keys.map(v=>[String(v.key),String(v.value||'')]));
        },
        async set(key,value){
          if(value.length>4096)throw new Error('vk_cloud_value_too_large');
          const result=await this.command('VKWebAppStorageSet',{key,value});
          if(result?.result===false)throw new Error('vk_cloud_write_rejected');
        },
        async readSnapshot(){
          const values=await this.get([HEAD]),head=parseHead(values[HEAD]||'');
          if(!head)return {head:null,progress:null};
          const keys=Array.from({length:head.count},(_,i)=>storeKey(head.bank,i));
          // Small batches guard against platform-specific message size limits.
          let encoded='';
          for(let i=0;i<keys.length;i+=8){
            const batch=keys.slice(i,i+8),parts=await this.get(batch);
            for(const key of batch){
              const part=parts[key];
              if(typeof part!=='string'||part.length===0||part.length>CHUNK_SIZE)throw new Error('vk_cloud_missing_chunk');
              encoded+=part;
            }
          }
          if(checksum(encoded)!==head.hash)throw new Error('vk_cloud_checksum_mismatch');
          return {head,progress:cleanProgress(JSON.parse(decode(encoded)),deps.normalize)};
        },
        async load(){
          const snapshot=await this.readSnapshot();
          this.head=snapshot.head;
          if(snapshot.progress){
            // The VK copy owns spendable currency; non-economic achievements may merge.
            // An offline cached balance must not revive coins spent on another device.
            const reconciled=this.dirty?deps.merge(deps.getSave(),snapshot.progress):snapshot.progress;
            reconciled.coins=snapshot.progress.coins;
            deps.onLoad(reconciled);
            this.dirty=JSON.stringify(cleanProgress(reconciled,deps.normalize))!==JSON.stringify(snapshot.progress);
          }else{
            this.dirty=true; // First launch: migrate this device's progress into VK.
          }
          this.loaded=true;this.error='';deps.onRead?.();this.inform();
          return true;
        },
        changed(){
          this.dirty=true;this.inform();this.schedule(1200);
        },
        schedule(delay=1200){
          clearTimeout(this.timer);this.timer=0;
          if(!this.ready)return;
          this.timer=setTimeout(()=>{this.timer=0;void this.sync();},delay);
        },
        async write(){
          const current=await this.readSnapshot();
          if((current.head?.hash||'')!==(this.head?.hash||'')){
            // Another device committed since our last read. Preserve unlocks/records,
            // then save the reconciled snapshot instead of blindly overwriting.
            if(current.progress){
              const reconciled=deps.merge(deps.getSave(),current.progress);
              reconciled.coins=current.progress.coins;
              deps.onLoad(reconciled);
            }
            this.head=current.head;
          }
          const atStart=JSON.stringify(cleanProgress(deps.getSave(),deps.normalize));
          const encoded=encode(atStart);
          const count=Math.ceil(encoded.length/CHUNK_SIZE);
          if(count>MAX_CHUNKS)throw new Error('vk_cloud_capacity_exceeded');
          const bank=this.head?.bank==='A'?'B':'A';
          for(let i=0;i<count;i++){
            await this.set(storeKey(bank,i),encoded.slice(i*CHUNK_SIZE,(i+1)*CHUNK_SIZE));
          }
          const head={v:1,bank,count,hash:checksum(encoded)};
          await this.set(HEAD,JSON.stringify(head)); // Commit last; old bank stays valid until here.
          this.head=head;this.error='';deps.onWrite?.();
          this.dirty=JSON.stringify(cleanProgress(deps.getSave(),deps.normalize))!==atStart;
          return true;
        },
        async sync(){
          if(!this.ready||root.navigator?.onLine===false)return false;
          if(this.busy){return this.busy;}
          const job=(async()=>{
            if(!this.loaded)await this.load();
            if(this.dirty)await this.write();
            return true;
          })();
          this.busy=job;this.inform();
          try{return await job;}
          catch(err){this.error=String(err?.message||err||'vk_cloud_error');return false;}
          finally{
            if(this.busy===job)this.busy=null;
            this.inform();if(this.dirty||this.error)this.schedule(this.error?12000:1000);
          }
        },
        async init(){
          if(!this.available){this.error='vk_bridge_missing';this.inform();return false;}
          try{
            await this.command('VKWebAppInit',{});
            this.ready=true;
            await this.sync();
            return true;
          }catch(err){this.error=String(err?.message||'vk_init_error');this.inform();return false;}
        },
        async showAd(format){
          if(!this.ready||!['reward','interstitial'].includes(format))return false;
          // No rewards without a positive platform callback.
          try{
            const response=await this.command('VKWebAppShowNativeAds',{ad_format:format});
            return response?.result===true;
          }catch(_){return false;}
        }
      };
      return state;
    }
  });
})(globalThis);
