// Browser-level smoke for the VK Games entrypoint without a platform account.
// CI installs puppeteer-core transiently and uses preinstalled Chrome.
// This tests real script loading, startup and basic interaction, NOT VK/OK callbacks.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import puppeteer from 'puppeteer-core';

const root=resolve(fileURLToPath(new URL('../',import.meta.url))); // normalize trailing slash before containment check
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
  for(const viewport of [{width:1280,height:800,isMobile:false},{width:390,height:844,isMobile:true,hasTouch:true},{width:844,height:390,isMobile:true,hasTouch:true}]){
    const page=await browser.newPage(),errors=[],missing=[],consoleErrors=[];
    page.on('pageerror',error=>errors.push(String(error?.stack||error?.message||error)));
    page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
    page.on('response',res=>{if(res.url().startsWith(address)&&!res.url().endsWith('/favicon.ico')&&res.status()>=400)missing.push(res.url()+' '+res.status());});
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
      // M212: test actual user pause -> modal -> resume -> keyboard controls.
      await page.click('#pause-btn');
      await page.waitForFunction(()=>document.querySelector('#overlay')?.getAttribute('aria-hidden')==='false',{timeout:2000});
      const modalTitle=await page.$eval('#modal-title',el=>el.textContent);
      assert.ok(modalTitle.trim(),'pause dialog must have a readable title');
      await page.click('#modal-actions button.primary');
      await page.waitForFunction(()=>document.querySelector('#overlay')?.getAttribute('aria-hidden')==='true',{timeout:2000});
      await page.waitForFunction(()=>document.querySelector('#signal-btn')?.disabled===false,{timeout:5000});
      await page.keyboard.press('Space');
      await page.waitForFunction(()=>document.querySelector('#signal-btn')?.getAttribute('aria-busy')==='true',{timeout:2500});
      const renderFallback=await page.evaluate(()=>window.__trafficPulseRenderFault||null);
      assert.equal(renderFallback,null,'Canvas must not silently fall back to emergency rendering');
      // Save UI screenshots as CI artifacts for the next manual review.
      await mkdir(resolve(root,'artifacts/browser-smoke'),{recursive:true});
      const target=resolve(root,'artifacts/browser-smoke',viewport.width+'x'+viewport.height+'.png');
      await page.screenshot({path:target,fullPage:false});
      // Reload must bootstrap from an actual durable local checkpoint as well.
      const before=await page.evaluate(()=>JSON.parse(
        localStorage.getItem('traffic_pulse_vk_games_save_v1')||'{}'
      ));
      assert.ok(Number(before.revision)>=1,'a local save must exist before reload');
      await page.reload({waitUntil:'networkidle2',timeout:20000});
      await page.waitForFunction(()=>{
        const signal=document.querySelector('#signal-btn'),canvas=document.querySelector('#game');
        return signal&&!signal.disabled&&canvas?.width>100;
      },{timeout:15000});
      const after=await page.evaluate(()=>JSON.parse(
        localStorage.getItem('traffic_pulse_vk_games_save_v1')||'{}'
      ));
      assert.ok(Number(after.sessions)>=Number(before.sessions)+1,
        'reload must restore saved sessions and record one new launch');
      assert.ok(Number(after.level)>=Number(before.level),
        'reload cannot roll back local level progress');
      // M213: exercise repeated portrait/landscape transitions without reloading
      // the game or resetting the saved session. This checks live viewport
      // observers, canvas sizing and interactive targets under resize stress.
      if(viewport.isMobile){
        for(let rotation=0;rotation<12;rotation++){
          const rotated=rotation%2===0
            ?{width:844,height:390,isMobile:true,hasTouch:true}
            :{width:390,height:844,isMobile:true,hasTouch:true};
          await page.setViewport(rotated);
          const state=await page.evaluate(async()=>{
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            const canvas=document.querySelector('#game');
            const signal=document.querySelector('#signal-btn');
            const rect=canvas?.getBoundingClientRect();
            const button=signal?.getBoundingClientRect();
            return {
              canvasWidth:canvas?.width||0,canvasHeight:canvas?.height||0,
              canvasRectWidth:rect?.width||0,canvasRectHeight:rect?.height||0,
              buttonWidth:button?.width||0,buttonHeight:button?.height||0,
              overflow:document.documentElement.scrollWidth-innerWidth,
              disabled:signal?.disabled,renderFault:window.__trafficPulseRenderFault||null
            };
          });
          assert.ok(state.canvasWidth>100&&state.canvasHeight>100,
            'canvas remains sized after rotation '+rotation+': '+JSON.stringify(state));
          assert.ok(state.canvasRectWidth>100&&state.canvasRectHeight>100,
            'canvas remains visible after rotation '+rotation);
          assert.ok(state.buttonWidth>=40&&state.buttonHeight>=40,
            'signal remains touchable after rotation '+rotation+': '+JSON.stringify(state));
          assert.ok(state.overflow<=2,'no horizontal overflow after rotation '+rotation);
          assert.equal(state.disabled,false,'signal stays interactive after rotation '+rotation);
          assert.equal(state.renderFault,null,'no render fallback after rotation '+rotation);
        }
        console.log('PASS M213 live viewport rotations',viewport.width+'x'+viewport.height,12);
      }
      assert.deepEqual(errors,[],'no uncaught JS errors: '+errors.join('; '));
      assert.deepEqual(missing,[],'no missing production resources: '+missing.join('; '));
      console.log('PASS browser boot/control',viewport.width+'x'+viewport.height,initial);
    }finally{await page.close();}
  }
}finally{
  if(browser)await browser.close();
  await new Promise(done=>server.close(done));
}
