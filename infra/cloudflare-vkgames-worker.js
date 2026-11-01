/**
 * Traffic Pulse VK Games: Cloudflare edge host.
 * GitHub is the upstream source while Pages Git integration is unavailable.
 * Only explicitly listed game assets can be served. Never proxy arbitrary URLs.
 */
const ORIGIN = 'https://raw.githubusercontent.com/anhelos1987-cell/traffic-pulse-web/vk-games/';
const TYPES = Object.freeze({
  'index.html':'text/html; charset=utf-8',
  'app.js':'application/javascript; charset=utf-8',
  'progress-core.js':'application/javascript; charset=utf-8',
  'vk-cloud.js':'application/javascript; charset=utf-8',
  'vk-games.js':'application/javascript; charset=utf-8',
  'style.css':'text/css; charset=utf-8'
});
const SECURITY = {
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'Cross-Origin-Resource-Policy':'cross-origin'
};
export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed',{status:405});
    const u=new URL(request.url);
    const path=(u.pathname==='/'||u.pathname==='/index.html')?'index.html':u.pathname.slice(1);
    if (!Object.prototype.hasOwnProperty.call(TYPES,path)) return new Response('Not found',{status:404,headers:SECURITY});
    const cacheUrl=new URL('/'+path,u.origin);
    const cache=new Request(cacheUrl.toString(),{method:'GET'});
    const hit=await caches.default.match(cache);
    if (hit) return request.method==='HEAD'?new Response(null,{status:200,headers:hit.headers}):hit;
    let upstream;
    try {
      upstream=await fetch(ORIGIN+path,{headers:{'Accept':'*/*'},cf:{cacheTtl:120,cacheEverything:true}});
    } catch (_){return new Response('Temporary upstream error',{status:503,headers:SECURITY});}
    if (!upstream.ok) return new Response('Game asset unavailable',{status:upstream.status>=500?503:404,headers:SECURITY});
    const headers=new Headers(SECURITY);
    headers.set('Content-Type',TYPES[path]);
    headers.set('Cache-Control',path==='index.html'?'public, max-age=60':'public, max-age=300');
    const res=new Response(upstream.body,{status:200,headers});
    ctx.waitUntil(caches.default.put(cache,res.clone()));
    return request.method==='HEAD'?new Response(null,{status:200,headers}):res;
  }
};