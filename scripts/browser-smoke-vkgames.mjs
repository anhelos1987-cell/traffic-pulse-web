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
async function checkInteractiveTraining(browser,address){
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  try{
    await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
    await page.evaluateOnNewDocument(()=>Object.defineProperty(navigator,'language',{configurable:true,get:()=> 'ru-RU'}));
    await page.goto(address,{waitUntil:'networkidle2',timeout:20000});
    await page.waitForSelector('#training-panel[data-step="1"]',{visible:true,timeout:15000});
    assert.equal(await page.$eval('#training-play-btn',el=>getComputedStyle(el).display),'none',
      'campaign entry must not be offered before the exercise is complete');
    await mkdir(resolve(root,'artifacts/browser-smoke'),{recursive:true});
    await page.screenshot({path:resolve(root,'artifacts/browser-smoke/training-portrait.png')});
    const heading=await page.$eval('#level-label',el=>({right:el.getBoundingClientRect().right,scroll:el.scrollWidth,width:el.clientWidth}));
    const goalLeft=await page.$eval('.goal',el=>el.getBoundingClientRect().left);
    assert.ok(heading.right<=goalLeft+1&&heading.scroll<=heading.width+1,'tutorial heading must fit beside its progress bar');
    const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('traffic_pulse_vk_games_save_v1')));
    for(const step of [1,2,3]){
      await page.waitForFunction(()=>!document.querySelector('#signal-btn').disabled,{timeout:15000});
      await page.click('#signal-btn');
      await page.waitForSelector(`#training-panel[data-step="${step+1}"]`,{visible:true,timeout:30000});
      if(step===2){
        assert.equal(await page.$eval('#signal-btn',el=>el.disabled),true,
          'pedestrians must finish before a vehicle signal can be requested');
        await page.keyboard.press('Space');
        assert.equal(await page.$eval('#training-panel',el=>el.dataset.step),'3',
          'keyboard cannot bypass the pedestrian step');
      }
    }
    // The practice starts with both roads occupied. Only player inputs release both queues.
    for(let turn=0;turn<2;turn++){
      await page.waitForFunction(()=>document.querySelector('#training-panel').dataset.stage==='complete'||!document.querySelector('#signal-btn').disabled,{timeout:20000});
      if(await page.$eval('#training-panel',el=>el.dataset.stage==='complete'))break;
      const through=await page.$eval('#queue-label',el=>el.textContent);
      await page.click('#signal-btn');
      await page.waitForFunction(previous=>document.querySelector('#training-panel').dataset.stage==='complete'||document.querySelector('#queue-label').textContent!==previous,{timeout:20000},through);
    }
    await page.waitForSelector('#training-panel[data-stage="complete"]',{visible:true,timeout:30000});
    const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('traffic_pulse_vk_games_save_v1')));
    assert.equal(after.trainingCompleted,true);
    for(const key of ['level','coins','totalStars','campaignRewardedThrough'])assert.equal(after[key],before[key],
      'training cannot grant campaign rewards: '+key);
    assert.deepEqual(after.starsByLevel,before.starsByLevel);
    await page.click('#training-play-btn');
    await page.waitForSelector('#training-panel',{hidden:true,timeout:5000});
    assert.equal(await page.$eval('#training-panel',el=>getComputedStyle(el).display),'none');
    await page.reload({waitUntil:'networkidle2',timeout:20000});
    await page.waitForSelector('#signal-btn',{visible:true,timeout:15000});
    assert.equal(await page.$eval('#training-panel',el=>getComputedStyle(el).display),'none',
      'tutorial completion must survive a real reload');
    await page.click('#pause-btn');
    const replay=await page.waitForSelector('::-p-text(🚦 Пройти обучение)',{timeout:5000});
    await replay.click();
    await page.waitForSelector('#training-panel[data-step="1"]',{visible:true,timeout:5000});
    await page.click('#restart-btn');
    assert.equal(await page.$eval('#training-panel',el=>el.dataset.step),'1');
    assert.deepEqual(errors,[],'interactive training must have no runtime errors');
    console.log('PASS four live traffic lessons, pedestrian input gate, reward isolation, persistence, replay');
  }finally{await page.close();}
}
let browser;
try{
  browser=await puppeteer.launch({executablePath:browserBinary(),headless:true,
    args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']});
  await checkInteractiveTraining(browser,address);
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
      assert.equal(pauseMetrics.buttonCount,13,'pause actions must include the replayable tutorial');
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

  // M216: take an actual campaign victory screenshot from shipping app.js.
  // Expose the internal Game only in this CI response body; the committed
  // production bundle has no QA hook or free-win command.
  const winPage=await browser.newPage(),winErrors=[];
  await winPage.setViewport({width:1280,height:800,isMobile:false});
  winPage.on('pageerror',error=>winErrors.push(String(error?.message||error)));
  await winPage.setRequestInterception(true);
  winPage.on('request',async request=>{
    if(new URL(request.url()).pathname==='/app.js'){
      try{
        const original=await readFile(resolve(root,'app.js'),'utf8');
        const anchor='  function startApp(){';
        assert.equal(original.split(anchor).length-1,1);
        const instrumented=original.replace(anchor,
          '  window.__tpQA={win:()=>Game.win(),game:Game,perf:PerfProbe};\n'+anchor);
        await request.respond({status:200,contentType:'application/javascript',body:instrumented});
      }catch(error){console.error(error);await request.abort();}
    }else await request.continue();
  });
  try{
    await winPage.goto(address+'?tpperf=1',{waitUntil:'networkidle2',timeout:20000});
    await winPage.waitForFunction(()=>window.__tpQA?.game?.state==='playing',{timeout:15000});
    await winPage.waitForFunction(()=>window.__trafficPulsePerfSnapshot?.samples>=20,{timeout:6000});
    const perf=await winPage.evaluate(()=>window.__trafficPulsePerfSnapshot);
    assert.ok(Number.isFinite(perf.fps)&&Number.isFinite(perf.p95Ms)&&Number.isFinite(perf.drawP95Ms));
    assert.ok(Number.isFinite(perf.simP95Ms)&&Number.isFinite(perf.loopP95Ms)&&Number.isFinite(perf.catchupPct));
    assert.ok(Object.keys(perf).every(k=>['fps','p95Ms','drawP95Ms','simP95Ms','loopP95Ms','catchupPct','slowFramesPct','quality','samples'].includes(k)),
      'performance diagnostic must not expose player IDs or save data');
    console.log('PASS M216 opt-in performance probe',perf);
    await winPage.evaluate(()=>window.__tpQA.win());
    await winPage.waitForFunction(()=>document.querySelector('.win-breakdown')&&
      document.querySelector('#overlay')?.getAttribute('aria-hidden')==='false',{timeout:5000});
    await winPage.waitForFunction(()=>!document.querySelector('#overlay')?.classList.contains('overlay-opening'),{timeout:2000});
    const result=await winPage.evaluate(()=>{
      const extra=document.querySelector('#modal-extra');
      const details=extra.querySelector('details.win-breakdown');
      const list=details.querySelector('.win-breakdown-list');
      const stats=[...extra.querySelectorAll('.win-stat')];
      const box=extra.getBoundingClientRect(),modal=document.querySelector('.modal');
      window.__tpQA.perf.node?.remove(); // hide opt-in diagnostic from the victory screenshot only
      return {
        summary:extra.classList.contains('win-summary-extra'),
        stats:stats.map(s=>s.textContent),
        detailsCollapsed:!details.open,rows:list.children.length,
        summaryText:details.querySelector('summary').textContent,
        reward:document.querySelector('#modal-reward').textContent,
        actions:document.querySelectorAll('#modal-actions button').length,
        boxHeight:box.height,modalClientHeight:modal.clientHeight,modalScrollHeight:modal.scrollHeight
      };
    });
    assert.equal(result.summary,true,'player-facing win must use the readable M216 layout');
    assert.equal(result.stats.length,2,'queue and switch should have distinct readable values');
    assert.equal(result.detailsCollapsed,true,'full legacy report must initially be collapsed');
    assert.ok(result.rows>=5,'the complete medals, awards, progression report must remain available');
    assert.ok(result.actions>=2,'next-level and campaign map buttons retained');
    assert.ok(result.modalScrollHeight<=result.modalClientHeight+2,
      'collapsed victory report should not force a desktop modal scrollbar: '+JSON.stringify(result));
    await mkdir(resolve(root,'artifacts/browser-smoke'),{recursive:true});
    await winPage.screenshot({path:resolve(root,'artifacts/browser-smoke','1280x800-win.png')});
    await winPage.click('.win-breakdown summary');
    const expanded=await winPage.$eval('.win-breakdown',el=>el.open);
    assert.equal(expanded,true,'reward details expand with a native accessible control');
    console.log('PASS M216 real campaign win dialog',result);
    assert.deepEqual(winErrors,[],'real win page must have zero errors');
  }finally{await winPage.close();}
}finally{
  if(browser)await browser.close();
  await new Promise(done=>server.close(done));
}
