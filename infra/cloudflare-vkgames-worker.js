/**
 * Traffic Pulse VK Games: Cloudflare edge host.
 * Static assets are stored in the private Cloudflare Workers KV namespace.
 * No GitHub runtime fetch and no server-side player save database are needed.
 */
const CACHE_VERSION = 'vk-games-m200a-yandex-payments';
const TYPES = Object.freeze({
  'index.html':'text/html; charset=utf-8',
  'all-maps.png':'image/png',
  'app.js':'application/javascript; charset=utf-8',
  'progress-core.js':'application/javascript; charset=utf-8',
  'campaign-access.js':'application/javascript; charset=utf-8',
  'payments-config.js':'application/javascript; charset=utf-8',
  'vk-purchases.js':'application/javascript; charset=utf-8',
  'vk-games.js':'application/javascript; charset=utf-8',
  'vkbridge.min.js':'application/javascript; charset=utf-8',
  'style.css':'text/css; charset=utf-8'
});
const SECURITY = {
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'Cross-Origin-Resource-Policy':'cross-origin',
  'Permissions-Policy':'geolocation=(), microphone=(), camera=(), payment=(), usb=(), serial=(), bluetooth=()',
  'Content-Security-Policy':"default-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src https://functions.yandexcloud.net/d4eo58crqj6cu6fk4hmg; object-src 'none'; base-uri 'none'; form-action 'none'"
};
export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed',{status:405});
    // URL query values (including VK launch parameters) are never logged, cached, copied to KV, or used as player identity.
    const u=new URL(request.url);
    const path=(u.pathname==='/'||u.pathname==='/index.html')?'index.html':u.pathname.slice(1);
    if (!Object.prototype.hasOwnProperty.call(TYPES,path)) return new Response('Not found',{status:404,headers:SECURITY});
    const cacheUrl=new URL('/'+CACHE_VERSION+'/'+path,u.origin);
    const cache=new Request(cacheUrl.toString(),{method:'GET'});
    const hit=await caches.default.match(cache);
    if (hit) return request.method==='HEAD'?new Response(null,{status:200,headers:hit.headers}):hit;
    let bytes;
    try { bytes=await env.GAME_ASSETS.get(path,{type:'arrayBuffer'}); }
    catch (_) { return new Response('Temporary storage error',{status:503,headers:SECURITY}); }
    if (!bytes) return new Response('Game asset unavailable',{status:503,headers:SECURITY});
    const headers=new Headers(SECURITY);
    headers.set('Content-Type',TYPES[path]);
    headers.set('Cache-Control',path==='index.html'?'public, max-age=60':'public, max-age=300');
    const res=new Response(bytes,{status:200,headers});
    ctx.waitUntil(caches.default.put(cache,res.clone()));
    return request.method==='HEAD'?new Response(null,{status:200,headers}):res;
  }
};
