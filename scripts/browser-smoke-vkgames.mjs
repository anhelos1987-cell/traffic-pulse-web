// Browser-level smoke for the VK Games entrypoint without a platform account.
// CI installs puppeteer-core transiently and uses preinstalled Chrome.
// This tests real script loading, startup and basic interaction, NOT VK/OK callbacks.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import puppeteer from 'puppeteer-core';

const root=fileURLToPath(new URL('../',import.meta.url));
function browserBinary(){
  for(const choice of [process.env.CHROME_BIN,'google-chrome','google-chrome-stable','chromium','chromium-browser']){
    if(!choice)continue;
    if(choice.startsWith('/')&&existsSync(choice))return choice;
    try{return execFileSync('which',[choice],{encoding:'utf8'}).trim();}catch(_){}
  }
  throw new Error('Chrome/Chromium binary missing on CI runner');
}
const mimes={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    const pathname=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
    const target=resolve(root,'.'+pathname);
    if(!target.startsWith(root+sep)){res.writeHead(403).end();return;}
    const bytes=await readFile(target);
    res.writeHead(200,{'Content-Type':mimes[extname(target)]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(bytes);
  }catch(_){res.writeHead(404).end('Not found');}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const address='http://127.0.0.1:'+server.address().port+'/';
let browser;
try{
  browser=await puppeteer.launch({executablePath:browserBinary(),headless:true,
    args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']});
  for(const viewport of [{width:1280,height:800,isMobile:false},{width:390,height:844,isMobile:true,hasTouch:true}]){
    const page=await browser.newPage(),errors=[],missing=[],consoleErrors=[];
    page.on('pageerror',error=>errors.push(String(error?.stack||error?.message||error)));
    page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
    page.on('response',res=>{if(res.url().startsWith(address)&&res.status()>=400)missing.push(res.url()+' '+res.status());});
    try{
      await page.setViewport(viewport);
      await page.goto(address,{waitUntil:'networkidle2',timeout:20000});
      try{
        await page.waitForFunction(()=>{
          const canvas=document.querySelector('#game'),signal=document.querySelector('#signal-btn');
          return canvas?.width>50&&canvas?.height>50&&signal&&!signal.disabled&&
            document.querySelector('#progress-bar')&&document.querySelector('#level-label');
        },{timeout:15000});
      }catch(error){
        const state=await page.evaluate(()=>({
          ready:document.readyState,board:document.querySelector('#game')?.getBoundingClientRect().toJSON(),
          canvas:[document.querySelector('#game')?.width,document.querySelector('#game')?.height],
          buttonDisabled:document.querySelector('#signal-btn')?.disabled,
          buttonText:document.querySelector('#signal-label')?.textContent,
          level:document.querySelector('#level-label')?.textContent,
          appChildren:document.querySelector('#app')?.children?.length
        }));
        throw new Error('Browser boot failed: '+JSON.stringify({viewport,state,errors,consoleErrors,missing,reason:String(error)}));
      }
      const initial=await page.evaluate(()=>({
        loaded:[...document.scripts].some(s=>s.src.includes('player-guidance-core.js')),
        width:document.querySelector('#game').width,
        height:document.querySelector('#game').height,
        overflow:document.documentElement.scrollWidth-innerWidth
      }));
      assert.equal(initial.loaded,true,'M207 guidance module must load');
      assert.ok(initial.width>100&&initial.height>100,'Canvas should render a usable board');
      assert.ok(initial.overflow<=2,'shell must fit viewport');
      await page.click('#signal-btn');
      await page.waitForFunction(
        ()=>document.querySelector('#signal-btn')?.getAttribute('aria-busy')==='true',
        {timeout:2000}
      );
      assert.deepEqual(errors,[],'no uncaught JS errors: '+errors.join('; '));
      assert.deepEqual(missing,[],'no missing production resources: '+missing.join('; '));
      console.log('PASS browser boot/control',viewport.width+'x'+viewport.height,initial);
    }finally{await page.close();}
  }
}finally{
  if(browser)await browser.close();
  await new Promise(done=>server.close(done));
}
