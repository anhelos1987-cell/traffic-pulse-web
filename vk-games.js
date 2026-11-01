// Traffic Pulse / VK Games adapter.
 // Player progress stays in VK account storage. No profile/save/launch data is sent to Cloudflare.
 (function(root){
 'use strict';

 const PREFIX='trafficpulse_vkg_v2';
 const INDEX=PREFIX+'_index';
 const EPOCH=PREFIX+'_reset_epoch';
 const LOCAL_META='traffic_pulse_vkg_local_meta_v2';
 const CHUNK=3000;
 const MAX_BYTES=190000;
 const MAX_CHUNKS=Math.ceil(MAX_BYTES*4/3/CHUNK)+1;
 const IO_DEADLINE_MS=60000;
 const CALL_TIMEOUT_MS=8000;

 function timeout(promise,ms,label){
   let timer;
   return Promise.race([
     Promise.resolve(promise).finally(()=>clearTimeout(timer)),
     new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out')),ms);})
   ]);
 }
 function remaining(deadline){
   const ms=Math.min(CALL_TIMEOUT_MS,deadline-Date.now());
   if(ms<=0)throw new Error('VK cloud operation timed out');
   return ms;
 }
 function encodeBytes(buffer){
   let binary='';
   for(let i=0;i<buffer.length;i+=8192)binary+=String.fromCharCode.apply(null,buffer.subarray(i,i+8192));
   return root.btoa(binary);
 }
 function decodeBytes(text){
   const binary=root.atob(text),buffer=new Uint8Array(binary.length);
   for(let i=0;i<binary.length;i++)buffer[i]=binary.charCodeAt(i);
   return buffer;
 }
 async function sha256(buffer){
   if(!root.crypto?.subtle)throw new Error('Secure VK storage checksum unavailable');
   const hash=new Uint8Array(await root.crypto.subtle.digest('SHA-256',buffer));
   return Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('');
 }
 function generation(){
   if(!root.crypto?.getRandomValues)throw new Error('Secure VK storage generation unavailable');
   const values=root.crypto.getRandomValues(new Uint32Array(4));
   return Array.from(values,n=>n.toString(16).padStart(8,'0')).join('');
 }
 function parseManifest(text){
   if(!text)return null;
   const value=JSON.parse(text);
   if(!value||value.version!==2||!/^[a-f0-9]{32}$/.test(value.generation)||
      !Number.isInteger(value.chunks)||value.chunks<1||value.chunks>MAX_CHUNKS||
      !Number.isInteger(value.bytes)||value.bytes<1||value.bytes>MAX_BYTES||
      !/^[a-f0-9]{64}$/.test(value.sha256))throw new Error('Invalid VK cloud manifest');
   return value;
 }
 function chunkKeys(manifest){
   return Array.from({length:manifest.chunks},(_,i)=>PREFIX+'_'+manifest.generation+'_'+i);
 }
 function plainObject(value){return value&&typeof value==='object'&&!Array.isArray(value);}
 function cleanProgress(value,normalize){
   const out=normalize(value||{});
   // VK Play billing state belongs to a different product/platform and is never copied to VK Games.
   out.vkPaidCoinsCredited=0;out.vkEntitlements={};out.vkPendingSpend=null;
   return out;
 }
 function sameProgress(a,b,normalize){
   return JSON.stringify(cleanProgress(a,normalize))===JSON.stringify(cleanProgress(b,normalize));
 }
 function safeStorage(){
   try{return root.localStorage||null;}catch(_){return null;}
 }
 function readJson(storage,key){
   if(!storage)return null;
   try{return JSON.parse(storage.getItem(key)||'null');}catch(_){return null;}
 }
 function writeJson(storage,key,value){
   if(!storage)return false;
   try{storage.setItem(key,JSON.stringify(value));return true;}catch(_){return false;}
 }

 root.TrafficPulseVKGames=Object.freeze({
  create(deps){
   const bridge=root.vkBridge;
   const storage=deps.storage||safeStorage();
   const state={
    ready:false,cloud:false,loaded:false,dirty:false,busy:null,timer:0,error:'',
    appId:0,userId:0,fingerprint:'',epoch:'',head:null,base:null,
    deleting:false,deletionSupported:false,adBusy:false,rewardedStatus:'unknown',

    status(){
     if(!this.ready)return this.error==='outside_vk'||this.error==='vk_bridge_missing'?'local':'loading';
     if(!this.cloud)return 'local';
     if(this.error)return 'offline';
     if(!this.loaded)return 'loading';
     if(this.busy||this.dirty)return 'saving';
     return 'saved';
    },
    inform(){deps.onStatus?.(this.status());},
    async call(method,props={},ms=CALL_TIMEOUT_MS){
     if(!bridge?.send)throw new Error('vk_bridge_unavailable');
     return timeout(bridge.send(method,props),ms,method);
    },
    async supported(method){
     if(!bridge||typeof bridge.supportsAsync!=='function')return false;
     try{return (await timeout(bridge.supportsAsync(method),2500,'VK capabilities'))===true;}catch(_){return false;}
    },
    async get(keys,deadline){
     const result=await this.call('VKWebAppStorageGet',{keys},remaining(deadline));
     if(!result||!Array.isArray(result.keys)||result.keys.length!==keys.length)throw new Error('Incomplete VK cloud response');
     const values=Object.create(null);
     for(const item of result.keys){
       if(!item||keys.indexOf(item.key)<0||typeof item.value!=='string'||Object.prototype.hasOwnProperty.call(values,item.key))
         throw new Error('Invalid VK storage entry');
       values[item.key]=item.value;
     }
     return keys.map(key=>{
       if(!Object.prototype.hasOwnProperty.call(values,key))throw new Error('Missing VK cloud entry');
       return values[key];
     });
    },
    async set(key,value,deadline){
     if(typeof value!=='string'||value.length>4096)throw new Error('VK cloud value too large');
     const result=await this.call('VKWebAppStorageSet',{key,value},remaining(deadline));
     if(!result||result.result!==true)throw new Error('VK cloud write not acknowledged');
    },
    async accountFingerprint(appId,userId){
     const bytes=new TextEncoder().encode('traffic-pulse:vkgames:'+appId+':'+userId);
     return sha256(bytes);
    },
    localMeta(){
     const meta=readJson(storage,LOCAL_META);
     if(!plainObject(meta)||meta.version!==2||typeof meta.fingerprint!=='string')return null;
     return meta;
    },
    saveLocalMeta(){
     writeJson(storage,LOCAL_META,{
       version:2,fingerprint:this.fingerprint,epoch:this.epoch,
       generation:this.head?.generation||'',base:this.base?cleanProgress(this.base,deps.normalize):null
     });
    },
    async initializeAccount(){
     const initialized=await this.call('VKWebAppInit',{},3000);
     if(!initialized||initialized.result!==true)throw new Error('VK initialization not acknowledged');

     const user=await this.call('VKWebAppGetUserInfo',{},3500);
     if(!user||!Number.isSafeInteger(user.id)||user.id<=0)throw new Error('VK account unavailable');

     let launch=null;
     if(await this.supported('VKWebAppGetLaunchParams'))launch=await this.call('VKWebAppGetLaunchParams',{},3500);
     const query=new URLSearchParams(root.location?.search||'');
     const queryApp=Number(query.get('vk_app_id')||0),queryUser=Number(query.get('vk_user_id')||0);
     const appId=Number(launch?.vk_app_id||queryApp||0);
     const launchUser=Number(launch?.vk_user_id||queryUser||0);
     if(!Number.isSafeInteger(appId)||appId<=0)throw new Error('VK application unavailable');
     if(launchUser&&launchUser!==user.id)throw new Error('VK account mismatch; reload the game');
     if(queryUser&&queryUser!==user.id)throw new Error('VK launch mismatch; reload the game');
     if(queryApp&&queryApp!==appId)throw new Error('VK application mismatch; reload the game');

     const [canGet,canSet,canKeys]=await Promise.all([
       this.supported('VKWebAppStorageGet'),
       this.supported('VKWebAppStorageSet'),
       this.supported('VKWebAppStorageGetKeys')
     ]);
     this.appId=appId;this.userId=user.id;this.cloud=canGet&&canSet;this.deletionSupported=this.cloud&&canKeys;
     this.fingerprint=await this.accountFingerprint(appId,user.id);

     if(this.cloud){
       const deadline=Date.now()+5000;
       this.epoch=(await this.get([EPOCH],deadline))[0];
       if(this.epoch&&!/^[a-f0-9]{32}$/.test(this.epoch))throw new Error('Invalid VK reset marker');
     }
     return true;
    },
    async readSnapshot(deadline=Date.now()+IO_DEADLINE_MS){
     if(!this.cloud||this.deleting)throw new Error('VK account storage unavailable');
     const epochNow=(await this.get([EPOCH],deadline))[0];
     if(epochNow!==this.epoch)throw new Error('VK data changed on another device; reload the game');
     const indexText=(await this.get([INDEX],deadline))[0];
     const manifest=parseManifest(indexText);
     if(!manifest)return {manifest:null,progress:null};
     const keys=chunkKeys(manifest),parts=[];
     for(let i=0;i<keys.length;i+=16){
       const batch=await this.get(keys.slice(i,i+16),deadline);
       for(const part of batch){
         if(!/^[A-Za-z0-9+/=]{1,3000}$/.test(part))throw new Error('Invalid VK cloud chunk');
         parts.push(part);
       }
     }
     const buffer=decodeBytes(parts.join(''));
     if(buffer.length!==manifest.bytes||await sha256(buffer)!==manifest.sha256)throw new Error('VK cloud checksum mismatch');
     const json=new TextDecoder('utf-8',{fatal:true}).decode(buffer);
     const parsed=JSON.parse(json);
     if(!plainObject(parsed))throw new Error('Invalid VK cloud JSON');
     return {manifest,progress:cleanProgress(parsed,deps.normalize)};
    },
    async load(){
     if(!this.cloud){this.loaded=true;this.inform();return false;}
     const snapshot=await this.readSnapshot();
     this.head=snapshot.manifest;
     const meta=this.localMeta();
     const sameOwner=Boolean(meta&&meta.fingerprint===this.fingerprint&&meta.epoch===this.epoch);
     const local=cleanProgress(deps.getSave(),deps.normalize);
     const base=sameOwner&&plainObject(meta.base)?cleanProgress(meta.base,deps.normalize):null;

     if(snapshot.progress){
       const next=sameOwner?deps.merge(local,snapshot.progress,base):snapshot.progress;
       deps.onLoad(cleanProgress(next,deps.normalize),{accountChanged:!sameOwner});
       this.base=snapshot.progress;
       this.dirty=!sameProgress(deps.getSave(),snapshot.progress,deps.normalize);
     }else if(sameOwner){
       this.base=null;
       this.dirty=Number(local.revision||0)>0;
     }else{
       // New/different VK account: never import a previous browser profile automatically.
       deps.onLoad(cleanProgress({},deps.normalize),{accountChanged:true});
       this.base=null;this.dirty=false;
     }
     this.loaded=true;this.error='';this.saveLocalMeta();deps.onRead?.();this.inform();
     if(this.dirty)this.schedule(250);
     return true;
    },
    changed(){
     if(this.deleting)return;
     this.dirty=true;this.saveLocalMeta();this.inform();this.schedule(900);
    },
    schedule(delay=900){
     clearTimeout(this.timer);this.timer=0;
     if(!this.ready||!this.cloud||this.deleting)return;
     this.timer=setTimeout(()=>{this.timer=0;void this.sync();},delay);
    },
    async cleanupOld(old,next){
     if(!old||old.generation===next.generation)return;
     try{
       const deadline=Date.now()+15000;
       const current=parseManifest((await this.get([INDEX],deadline))[0]);
       if(!current||current.generation!==next.generation)return;
       for(const key of chunkKeys(old))await this.set(key,'',deadline);
     }catch(_){}
    },
    async write(){
     if(!this.cloud||this.deleting)return false;
     const deadline=Date.now()+IO_DEADLINE_MS;
     const epochNow=(await this.get([EPOCH],deadline))[0];
     if(epochNow!==this.epoch)throw new Error('VK data changed on another device; reload the game');

     // Re-read current pointer before publishing to reconcile another device's completed save.
     const current=await this.readSnapshot(deadline);
     if((current.manifest?.generation||'')!==(this.head?.generation||'')){
       if(current.progress){
         const merged=deps.merge(cleanProgress(deps.getSave(),deps.normalize),current.progress,this.base);
         deps.onLoad(cleanProgress(merged,deps.normalize),{accountChanged:false});
       }
       this.head=current.manifest;this.base=current.progress;
     }

     const progress=cleanProgress(deps.getSave(),deps.normalize);
     const json=JSON.stringify(progress),buffer=new TextEncoder().encode(json);
     if(!buffer.length||buffer.length>MAX_BYTES)throw new Error('VK cloud payload exceeds game limit');
     const encoded=encodeBytes(buffer);
     const next={
       version:2,generation:generation(),chunks:Math.ceil(encoded.length/CHUNK),
       bytes:buffer.length,sha256:await sha256(buffer)
     };
     const keys=chunkKeys(next);
     for(let i=0;i<keys.length;i++)await this.set(keys[i],encoded.slice(i*CHUNK,(i+1)*CHUNK),deadline);
     if((await this.get([EPOCH],deadline))[0]!==this.epoch)throw new Error('VK data changed on another device; reload the game');
     const old=this.head;
     await this.set(INDEX,JSON.stringify(next),deadline); // Commit pointer last.
     this.head=next;this.base=progress;this.error='';this.dirty=!sameProgress(deps.getSave(),progress,deps.normalize);
     this.saveLocalMeta();deps.onWrite?.();void this.cleanupOld(old,next);
     return true;
    },
    async sync(){
     if(!this.ready||!this.cloud||this.deleting||root.navigator?.onLine===false)return false;
     if(this.busy){this.dirty=true;return this.busy;}
     const job=(async()=>{
       if(!this.loaded)await this.load();
       if(this.dirty)await this.write();
       return true;
     })();
     this.busy=job;this.inform();
     try{return await job;}
     catch(error){this.error=String(error?.message||error||'vk_cloud_error');return false;}
     finally{
       if(this.busy===job)this.busy=null;
       this.inform();
       if((this.dirty||this.error)&&!this.deleting)this.schedule(this.error?12000:800);
     }
    },
    async deleteData(){
     if(!this.ready||!this.cloud||!this.deletionSupported||this.adBusy)throw new Error('VK data deletion unavailable');
     this.deleting=true;clearTimeout(this.timer);this.timer=0;this.inform();
     const deadline=Date.now()+120000;
     try{
       while(this.busy){remaining(deadline);await new Promise(r=>setTimeout(r,50));}
       const newEpoch=generation();
       await this.set(EPOCH,newEpoch,deadline);
       this.epoch=newEpoch;

       let keys=[],offset=0;
       const chunkRe=new RegExp('^'+PREFIX+'_[a-f0-9]{32}_\\d+$');
       for(;;){
         const page=await this.call('VKWebAppStorageGetKeys',{count:100,offset},remaining(deadline));
         if(!page||!Array.isArray(page.keys)||page.keys.some(key=>typeof key!=='string'))throw new Error('Incomplete VK storage key list');
         keys.push(...page.keys.filter(key=>key===INDEX||chunkRe.test(key)));
         if(page.keys.length<100)break;
         offset+=page.keys.length;if(offset>10000)throw new Error('VK storage key list exceeded limit');
       }
       await this.set(INDEX,'',deadline);
       keys=[...new Set(keys)].filter(key=>key!==INDEX);
       for(const key of keys)await this.set(key,'',deadline);
       for(let i=0;i<keys.length;i+=16){
         if((await this.get(keys.slice(i,i+16),deadline)).some(value=>value!==''))throw new Error('VK deletion verification failed');
       }
       if((await this.get([INDEX],deadline))[0]!=='')throw new Error('VK save changed during deletion');

       this.head=null;this.base=null;this.loaded=true;this.dirty=false;this.error='';
       deps.onLoad(cleanProgress({},deps.normalize),{accountChanged:true,deleted:true});
       this.saveLocalMeta();deps.onDelete?.();return true;
     }finally{
       this.deleting=false;this.inform();
     }
    },
    async adAvailable(format){
     if(!this.ready||this.deleting||!['reward','interstitial'].includes(format))return false;
     const [check,show]=await Promise.all([this.supported('VKWebAppCheckNativeAds'),this.supported('VKWebAppShowNativeAds')]);
     if(!check||!show){this.rewardedStatus='unsupported';return false;}
     try{
       const result=await this.call('VKWebAppCheckNativeAds',{ad_format:format},3500);
       const ok=result?.result===true;if(format==='reward')this.rewardedStatus=ok?'ready':'no-fill';return ok;
     }catch(_){if(format==='reward')this.rewardedStatus='check-failed';return false;}
    },
    async showAd(format){
     if(this.adBusy||!await this.adAvailable(format))return false;
     this.adBusy=true;
     try{
       const result=await this.call('VKWebAppShowNativeAds',{ad_format:format},120000);
       return result?.result===true;
     }catch(_){return false;}
     finally{this.adBusy=false;if(format==='reward')this.rewardedStatus='unknown';}
    },
    async init(){
     if(!bridge?.send){this.error='vk_bridge_missing';this.inform();return false;}
     const query=new URLSearchParams(root.location?.search||'');
     const insideVK=query.has('vk_app_id')||query.has('vk_user_id')||bridge.isEmbedded?.()===true||bridge.isWebView?.()===true;
     if(!insideVK){this.error='outside_vk';this.inform();return false;}
     try{
       await this.initializeAccount();
       this.ready=true;this.error='';await this.load();this.inform();return true;
     }catch(error){
       this.error=String(error?.message||error||'vk_init_error');this.ready=false;this.cloud=false;this.loaded=true;this.inform();return false;
     }
    },
    privacyStatus(){
     return Object.freeze({
       platform:'vkgames',cloud:this.cloud,loaded:this.loaded,deletionSupported:this.deletionSupported,
       personalDataBackend:false,cloudflarePlayerStorage:false
     });
    }
   };
   return state;
  }
 });
 })(globalThis);
