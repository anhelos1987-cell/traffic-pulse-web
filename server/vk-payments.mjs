// Run on a Russian-hosted server with persistent local storage, not Cloudflare.
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';

export const APP_ID=54870403;
export const ITEM='unlock_all_maps';
export const PRICE_VOTES=10;
const error=(code,msg,critical=true)=>({error:{error_code:code,error_msg:msg,critical}});
function equal(a,b){const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y);}
function id(value){const s=String(value??'');return /^[1-9][0-9]{0,15}$/.test(s)&&Number.isSafeInteger(Number(s))?s:null;}
function uniqueForm(text){
 const p=new URLSearchParams(text),out=Object.create(null);
 for(const [k,v] of p){if(Object.hasOwn(out,k)||k.length>128||v.length>4096)throw Error('invalid_form');out[k]=v;}
 return out;
}
export function verifyCallback(params,secret){
 if(!/^[a-f0-9]{32}$/.test(params.sig||''))return false;
 const payload=Object.keys(params).filter(k=>k!=='sig').sort().map(k=>k+'='+params[k]).join('')+secret;
 return equal(createHash('md5').update(payload).digest('hex'),params.sig);
}
export function verifyLaunch(text,secret,now=Date.now()){
 if(typeof text!=='string'||text.length>12000)return null;
 let p;try{p=uniqueForm(text);}catch(_){return null;}
 if(Number(p.vk_app_id)!==APP_ID||!id(p.vk_user_id)||!p.sign)return null;
 const ts=Number(p.vk_ts),seconds=Math.floor(now/1000);
 if(!Number.isSafeInteger(ts)||ts>seconds+300||ts<seconds-86400)return null;
 const query=new URLSearchParams();for(const k of Object.keys(p).filter(k=>k.startsWith('vk_')).sort())query.append(k,p[k]);
 const sign=createHmac('sha256',secret).update(query.toString()).digest('base64url');
 return equal(sign,p.sign)?Number(p.vk_user_id):null;
}
export function createBilling({secret,dbPath=':memory:',liveEnabled=false,testUsers=[],allowedOrigins=[],photoURL='',now=()=>Date.now()}){
 if(typeof secret!=='string'||!secret.trim())throw Error('VK_APP_SECRET is required');
 const users=new Set(testUsers.map(Number).filter(Number.isSafeInteger));
 const origins=new Set(allowedOrigins);
 const db=new DatabaseSync(dbPath);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
 CREATE TABLE IF NOT EXISTS orders(
  order_id TEXT NOT NULL, test INTEGER NOT NULL, user_id INTEGER NOT NULL,
  item TEXT NOT NULL, price INTEGER NOT NULL, status TEXT NOT NULL,
  updated_at INTEGER NOT NULL, PRIMARY KEY(order_id,test));`);
 const getOrder=db.prepare('SELECT * FROM orders WHERE order_id=? AND test=?');
 const owned=db.prepare("SELECT order_id FROM orders WHERE user_id=? AND test=? AND item=? AND status='chargeable' LIMIT 1");
 const insert=db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?,?)');
 const refund=db.prepare("UPDATE orders SET status='refunded',updated_at=? WHERE order_id=? AND test=?");
 const testForUser=user=>!liveEnabled&&users.has(user);
 const purchasable=(user,test)=>test?users.has(user):liveEnabled;
 function callback(p){
  if(!verifyCallback(p,secret))return error(10,'Invalid signature');
  if(Number(p.app_id)!==APP_ID)return error(10,'Wrong application');
  const test=p.notification_type?.endsWith('_test')?1:0,type=test?p.notification_type.slice(0,-5):p.notification_type;
  const uid=id(p.user_id),receiver=p.receiver_id===undefined?uid:id(p.receiver_id);
  if(!uid||uid!==receiver)return error(10,'Invalid recipient');
  const user=Number(uid);
  if(type==='get_item'){
   if(p.item!==ITEM)return error(20,'Product does not exist');
   if(!purchasable(user,test)||!/^https:\/\//.test(photoURL))return error(20,'Purchases unavailable');
   if(owned.get(user,test,ITEM))return error(20,'Product already purchased');
   return {response:{item_id:ITEM,title:'Открыть все карты',photo_url:photoURL,price:PRICE_VOTES,expiration:0}};
  }
  if(type!=='order_status_change')return error(1,'Unsupported notification');
  const order=id(p.order_id);
  if(!order||p.item!==ITEM||(p.item_id!==undefined&&p.item_id!==ITEM)||String(p.item_price)!==String(PRICE_VOTES)||!['chargeable','refunded'].includes(p.status))return error(20,'Invalid order');
  if(p.status==='chargeable'&&!purchasable(user,test))return error(20,'Purchases unavailable');
  const response={response:{order_id:Number(order)}};
  db.exec('BEGIN IMMEDIATE');
  try{
   const previous=getOrder.get(order,test);
   if(previous){
    if(previous.user_id!==user||previous.item!==ITEM||previous.price!==PRICE_VOTES){db.exec('ROLLBACK');return error(10,'Order mismatch');}
    // A late chargeable retry must never resurrect an already refunded purchase.
    if(p.status==='refunded'&&previous.status!=='refunded')refund.run(now(),order,test);
   }else{
    if(p.status==='chargeable'&&owned.get(user,test,ITEM)){db.exec('ROLLBACK');return error(20,'Product already purchased');}
    insert.run(order,test,user,ITEM,PRICE_VOTES,p.status,now());
   }
   db.exec('COMMIT');return response;
  }catch(_){db.exec('ROLLBACK');return error(1,'Temporary payment error',false);}
 }
 const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
 const limits=new Map();
 function rate(user){const bucket=Math.floor(now()/60000),key=user+':'+bucket;limits.set(key,(limits.get(key)||0)+1);if(limits.size>5000)for(const k of limits.keys())if(!k.endsWith(':'+bucket))limits.delete(k);return limits.get(key)<=60;}
 async function handle(request){
  const url=new URL(request.url),origin=request.headers.get('Origin'),cors=origin&&origins.has(origin)?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{};
  if(url.pathname==='/health'&&request.method==='GET')return json({ok:true,app_id:APP_ID,live_enabled:liveEnabled});
  if(url.pathname==='/api/vkgames/callback'){
   if(request.method!=='POST')return json(error(1,'POST required'),405);
   if(!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded'))return json(error(1,'Form required'),400);
   const text=await request.text();if(Buffer.byteLength(text)>16384)return json(error(1,'Request too large'),413);
   try{return json(callback(uniqueForm(text)));}catch(_){return json(error(1,'Invalid notification'),400);}
  }
  if(url.pathname!=='/api/vkgames/entitlements')return json({error:'not_found'},404);
  if(origin&&!origins.has(origin))return json({error:'origin_not_allowed'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'}});
  if(request.method!=='POST')return json({error:'method_not_allowed'},405,cors);
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'json_required'},400,cors);
  let body;try{const text=await request.text();if(Buffer.byteLength(text)>16384)return json({error:'too_large'},413,cors);body=JSON.parse(text);}catch(_){return json({error:'invalid_json'},400,cors);}
  const user=verifyLaunch(body.launch_params,secret,now());
  if(!user)return json({error:'invalid_vk_session'},401,cors);
  if(!rate(user))return json({error:'rate_limited'},429,cors);
  const test=testForUser(user)?1:0;
  return json({app_id:APP_ID,user_id:user,item:ITEM,price_votes:PRICE_VOTES,all_maps:Boolean(owned.get(user,test,ITEM)),purchasable:purchasable(user,test)},200,cors);
 }
 return {handle,close:()=>db.close()};
}

export function startServer(env=process.env){
 const dbPath=env.VK_PAYMENTS_DB;
 if(!dbPath||dbPath===':memory:')throw Error('VK_PAYMENTS_DB must point to a persistent local file');
 const service=createBilling({secret:env.VK_APP_SECRET,dbPath,liveEnabled:env.VK_PAYMENTS_LIVE==='true',testUsers:(env.VK_TEST_USERS||'').split(',').filter(Boolean).map(Number),allowedOrigins:(env.VK_ALLOWED_ORIGINS||'').split(',').filter(Boolean),photoURL:env.VK_ITEM_PHOTO_URL||''});
 const server=createServer(async(req,res)=>{
  try{
   const parts=[];let bytes=0;
   for await(const part of req){bytes+=part.length;if(bytes>16384){res.writeHead(413);res.end();return;}parts.push(part);}
   const request=new Request('http://localhost'+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(parts)}:{})});
   const result=await service.handle(request);res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
  }catch(_){res.writeHead(500,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"error":"temporary_error"}');}
 });
 server.requestTimeout=15000;server.headersTimeout=10000;
 server.listen(Number(env.PORT||8080),env.HOST||'127.0.0.1');
 server.on('close',()=>service.close());return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)startServer();
