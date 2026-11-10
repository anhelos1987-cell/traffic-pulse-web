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
  for(const viewport of [{width:1280,height:800,isMobile:false},{width:1366,height:768,isMobile:false},{width:390,height:844,isMobile:true,hasTouch:true},{width:844,height:390,isMobile:true,hasTouch:true}]){
    const page=await browser.newPage(),errors=[],missing=[],consoleErrors=[];
    page.on('pageerror',error=>errors.push(String(error?.stack||error?.message||error)));
    page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
    page.on('response',res=>{if(res.url().startsWith(address)&&!res.url().endsWith('/favicon.ico')&&res.status()>=400)missing.push(res.url()+' '+res.status());});
    try{
      await page.setViewport(viewport);
      // M214: run desktop and short-landscape screenshot checks with real RU UI
      // strings, which are longer than EN. Portrait remains EN for both locales.
      if(viewport.width!==390)await page.evaluateOnNewDocument(()=>{
        Object.defineProperty(navigator,'language',{configurable:true,get:()=> 'ru-RU'});
      });
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
      // M215: compare actual computed HUD typography, not just source CSS.
      // Both desktop aspect ratios must be readable without stealing space
      // from the square game board or truncating the main signal action.
      const hud=await page.evaluate(()=>{
        const size=selector=>parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
        const rect=selector=>document.querySelector(selector).getBoundingClientRect();
        const signal=document.querySelector('#signal-label');
        const gameRect=rect('.game-card'),controlsRect=rect('.controls');
        return {
          level:size('#level-label'),goal:size('.goal'),district:size('#district'),
          signal:size('#signal-label'),queue:size('.mini-status'),
          insight:size('.desktop-insight .insight-row'),
          boardWidth:gameRect.width,boardBottom:gameRect.bottom,
          controlsTop:controlsRect.top,
          signalOverflow:signal.scrollWidth-signal.clientWidth,
          footerOverflow:document.querySelector('.mini-status').scrollWidth
            -document.querySelector('.mini-status').clientWidth
        };
      });
      if(viewport.width>=900&&viewport.height>=650){
        assert.ok(hud.level>=22&&hud.goal>=14&&hud.queue>=13,
          'desktop level, objective and status must be readable: '+JSON.stringify(hud));
        assert.ok(hud.signal>=15&&hud.insight>=11,
          'desktop control and insight text must be readable: '+JSON.stringify(hud));
        assert.ok(hud.boardWidth>=480&&hud.boardBottom<=hud.controlsTop+2,
          'larger HUD must not overlap the game board: '+JSON.stringify(hud));
        assert.ok(hud.signalOverflow<=2&&hud.footerOverflow<=2,
          'main controls/status must not clip after scaling: '+JSON.stringify(hud));
        console.log('PASS M215 desktop HUD',viewport.width+'x'+viewport.height,hud);
      }
      await page.click('#signal-btn');
      await page.waitForFunction(
        ()=>document.querySelector('#signal-btn')?.getAttribute('aria-busy')==='true',
        {timeout:2000}
      );
      // M212: test actual user pause -> modal -> resume -> keyboard controls.
      await page.click('#pause-btn');
      await page.waitForFunction(()=>document.querySelector('#overlay')?.getAttribute('aria-hidden')==='false',{timeout:2000});
      // The 240ms pop-in animation temporarily scales buttons below their final CSS
      // touch target; measure only the stable state, not an in-flight transform.
      await page.waitForFunction(()=>!document.querySelector('#overlay')?.classList.contains('overlay-opening'),{timeout:2000});
      const modalTitle=await page.$eval('#modal-title',el=>el.textContent);
      assert.ok(modalTitle.trim(),'pause dialog must have a readable title');
      // M214: independently capture the actual pause screen, not only gameplay.
      // At desktop dimensions twelve actions must fit with a two-column grid
      // and without the narrow internal scroll bar reported in manual QA.
      const pauseMetrics=await page.evaluate(()=>{
        const m=document.querySelector('.modal'),buttons=[...document.querySelectorAll('#modal-actions button')];
        const styles=getComputedStyle(document.querySelector('#modal-actions'));
        return {
          width:m.getBoundingClientRect().width,scrollHeight:m.scrollHeight,
          clientHeight:m.clientHeight,
          isPause:m.classList.contains('pause-modal'),
          columns:styles.gridTemplateColumns.trim().split(/\s+/).length,
          buttonCount:buttons.length,
          language:document.querySelector('#modal-title')?.textContent,
          minButtonHeight:Math.min(...buttons.map(b=>b.getBoundingClientRect().height)),
          maxButtonOverflow:Math.max(...buttons.map(b=>b.scrollWidth-b.clientWidth)),
          firstButtonVisible:buttons[0].getBoundingClientRect().height>=44
        };
      });
      assert.equal(pauseMetrics.isPause,true,'pause dialog must select its own layout');
      assert.equal(pauseMetrics.buttonCount,12,'all twelve pause actions must remain available');
      assert.equal(pauseMetrics.firstButtonVisible,true,'Continue remains touchable');
      assert.ok(pauseMetrics.minButtonHeight>=44,'all pause actions must be at least 44 CSS px tall: '+JSON.stringify(pauseMetrics));
      assert.ok(pauseMetrics.maxButtonOverflow<=2,'localized button text must fit: '+JSON.stringify(pauseMetrics));
      if(viewport.width!==390)assert.equal(pauseMetrics.language,'Пауза','desktop and landscape should test Russian localization');
      if(viewport.width>=1000&&viewport.height>=700){
        assert.ok(pauseMetrics.width>=650,'desktop pause should use available horizontal space');
        assert.equal(pauseMetrics.columns,2,'desktop pause must present two action columns');
        assert.ok(pauseMetrics.scrollHeight<=pauseMetrics.clientHeight+2,
          'desktop pause should fit without internal scrolling: '+JSON.stringify(pauseMetrics));
      }
      if(viewport.width===390&&viewport.height===844){
        assert.equal(pauseMetrics.columns,2,'phone portrait pause should fit two secondary action columns');
        assert.ok(pauseMetrics.scrollHeight<=pauseMetrics.clientHeight+2,
          'portrait pause should fit all actions: '+JSON.stringify(pauseMetrics));
      }
      if(viewport.width===844&&viewport.height===390){
        assert.equal(pauseMetrics.columns,4,'phone landscape pause should use a compact 4-column grid');
        assert.ok(pauseMetrics.scrollHeight<=pauseMetrics.clientHeight+2,
          'landscape pause should fit all actions: '+JSON.stringify(pauseMetrics));
      }
      await mkdir(resolve(root,'artifacts/browser-smoke'),{recursive:true});
      await page.screenshot({path:resolve(root,'artifacts/browser-smoke',viewport.width+'x'+viewport.height+'-pause.png'),fullPage:false});
      console.log('PASS M214 pause layout',viewport.width+'x'+viewport.height,pauseMetrics);
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
