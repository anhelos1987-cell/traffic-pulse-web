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
          '  window.__tpQA={win:()=>Game.win(),game:Game,perf:PerfProbe,updateHud};\n'+anchor);
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

    await winPage.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
    const openingChecks=await winPage.evaluate(()=>{
      const {game}=window.__tpQA;
      cancelAnimationFrame(game.frameId);
      const tick=()=>game.update(1/60);
      function play(level,firstSwitch){
        game.startLevel(level);
        game.externalPaused=false;
        const opening=game.cars.map(c=>c.dir).join('');
        let lastSwitch=0,sawFlow=false;
        for(let i=1;i<60*40&&game.state==='playing';i++){
          const time=i/60;
          if(!game.switches){
            if(time>=firstSwitch&&game.toggle())lastSwitch=time;
          }else if(!game.transitionTimer&&time-lastSwitch>=2.3){
            const waiting=game.cars.some(c=>c.axis!==game.phase&&c.progress>180&&c.progress<340);
            const greenNear=game.cars.some(c=>c.axis===game.phase&&c.progress>120&&c.progress<620);
            if(waiting&&(!greenNear||time-lastSwitch>=4.4)&&game.toggle())lastSwitch=time;
          }
          tick();
          sawFlow||=game.drivingFeedback?.kind==='flow';
        }
        return {opening,state:game.state,elapsed:game.elapsed,switches:game.switches,sawFlow};
      }
      return [play(3,.75),play(3,3.85),play(6,1.08),play(10,.8),play(10,6.1),play(10,.8)];
    });
    assert.ok(openingChecks.every(run=>run.state==='won'),'all prototype schedules must be playable');
    assert.deepEqual(openingChecks.map(run=>run.opening),['WNN','WNN','WNN','NNWE','NNWE','NNWE']);
    assert.ok(openingChecks[0].switches>openingChecks[1].switches,'waiting for the last car should save a switch');
    assert.ok(openingChecks[1].sawFlow,'ordinary play in level 3 should reach a flow milestone');
    assert.notEqual(openingChecks[3].switches,openingChecks[4].switches,'rush-hour strategies should have different results');
    assert.deepEqual(openingChecks[3],openingChecks[5],'same rush-hour strategy should replay identically');

    const cue=await winPage.evaluate(()=>{
      const {game}=window.__tpQA;
      const original=CanvasRenderingContext2D.prototype.fillText,texts=[];
      CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){
        texts.push([text,x,y]);
        return original.call(this,text,x,y,...rest);
      };
      try{
        game.startLevel(6);game.externalPaused=false;
        for(let i=0;i<65;i++)game.update(1/60);
        game.draw();
        const bottomQueue=texts.some(([text,x,y])=>text==='2'&&x===450&&y===796);
        const firstWave=game.pedestrianSerial;
        game.toggle();
        for(let i=0;i<81;i++)game.update(1/60);
        texts.length=0;game.draw();
        const waitCue=texts.some(([text])=>text==='Waiting for pedestrians'||text==='Ждём пешеходов');
        const holding=game.pedestrianHold;
        for(let i=0;i<32;i++)game.update(1/60);
        texts.length=0;game.draw();
        const cueCleared=!texts.some(([text])=>text==='Waiting for pedestrians'||text==='Ждём пешеходов');
        game.startLevel(6);game.externalPaused=false;
        game.config.maxQueue=1;
        for(let i=0;i<180&&game.state==='playing';i++)game.update(1/60);
        texts.length=0;game.draw();
        return {bottomQueue,firstWave,waitCue,holding,cueCleared,jam:game.lastFailType==='jam',
          jamText:document.querySelector('#modal-text').textContent,
          jamBadge:texts.some(([text,x,y])=>text==='2 / 1'&&x===450&&y===796)};
      }finally{CanvasRenderingContext2D.prototype.fillText=original;}
    });
    assert.equal(cue.firstWave,1);
    assert.ok(cue.bottomQueue&&cue.waitCue&&cue.holding&&cue.cueCleared&&cue.jam&&cue.jamBadge,JSON.stringify(cue));
    assert.match(cue.jamText,/bottom approach\. Vehicles: 2, limit: 1|снизу\. Машин: 2, лимит: 1/);
    console.log('PASS M219 playable openings, pedestrian hold and jam direction',openingChecks,cue);

    const jam=await winPage.evaluate(()=>{
      const {game}=window.__tpQA;
      const step=()=>game.update(1/60);
      function until(predicate,limit=200){
        for(let i=0;i<limit&&!predicate()&&game.state==='playing';i++)step();
      }
      function start(level,mode='campaign'){
        game.startLevel(level,false,mode);
        game.externalPaused=false;
      }
      start(6);
      game.config.maxQueue=1;
      until(()=>game.jamRecovery);
      const startedAt=game.elapsed,deadline=game.jamRecovery.deadline;
      const original=CanvasRenderingContext2D.prototype.fillText,labels=[];
      CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){
        labels.push([text,x,y]);
        return original.call(this,text,x,y,...rest);
      };
      try{game.draw();}finally{CanvasRenderingContext2D.prototype.fillText=original;}
      const badge=labels.some(([text,x,y])=>text==='2/1'&&x===450&&y===782)&&
        labels.some(([text,x,y])=>['1.5s','1,5 с'].includes(text)&&x===450&&y===810);
      game.userPaused=true;
      for(let i=0;i<120;i++)step();
      const froze=game.elapsed===startedAt&&game.jamRecovery.deadline===deadline;
      game.userPaused=false;
      const switched=game.toggle();step();
      const switchDeadline=game.jamRecovery.deadline;
      until(()=>!game.jamRecovery);
      const saved=game.state==='playing'&&!game.jamRecovery&&game.maxObservedQueue===2;

      start(6);game.config.maxQueue=1;
      until(()=>game.jamRecovery);
      const lostStart=game.elapsed;
      until(()=>game.state==='failed');
      const timeout=game.elapsed-lostStart;
      const expired=game.lastFailType==='jam'&&game.failedQueue?.dir==='N'&&!game.jamRecovery;
      const failCopy=document.querySelector('#modal-text').textContent;

      start(103);until(()=>game.jamRecovery,600);
      const naturalOverload=game.jamRecovery&&game.maxObservedQueue>game.config.maxQueue;
      until(()=>!game.jamRecovery);
      const naturalRecovery=game.state==='playing'&&!game.jamRecovery;

      start(28,'daily');game.config.maxQueue=0;
      until(()=>game.maxObservedQueue>0,600);
      const dailyImmediate=game.maxObservedQueue>0&&game.lastFailType==='jam'&&!game.jamRecovery;
      return {badge,froze,switched,extension:switchDeadline-deadline,saved,expired,timeout,failCopy,naturalOverload,naturalRecovery,dailyImmediate};
    });
    assert.ok(jam.badge&&jam.froze&&jam.switched&&jam.saved&&jam.expired,JSON.stringify(jam));
    assert.ok(Math.abs(jam.extension-1.5)<1e-7&&Math.abs(jam.timeout-1.5)<1e-7,JSON.stringify(jam));
    assert.ok(jam.naturalOverload&&jam.naturalRecovery&&jam.dailyImmediate,JSON.stringify(jam));
    assert.match(jam.failCopy,/Time to clear the queue ran out|Время на разгрузку вышло/);
    console.log('PASS M220 jam recovery, clearance allowance, pause and timeout',jam);

    await winPage.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
    const feedback=await winPage.evaluate(()=>{
      const {game,updateHud}=window.__tpQA;
      const badge=document.querySelector('#driving-feedback');
      const phase=document.querySelector('#phase-indicator');
      function badgeState(){
        return {kind:badge.dataset.kind,text:badge.textContent.trim(),animation:getComputedStyle(badge).animationName};
      }
      game.startLevel(3);game.externalPaused=false;
      const waiting=game.cars.find(car=>car.dir==='N');
      game.cars=[{...waiting,stopped:true,inside:false}];
      game.lastPassAt=game.elapsed;
      document.querySelector('#toast').textContent='existing road notice';
      document.querySelector('#signal-btn').click();
      const sync=badgeState(),syncCount=game.maxSyncStreak;
      const noticePreserved=document.querySelector('#toast').textContent==='existing road notice';
      const rect=badge.getBoundingClientRect(),phaseRect=phase.getBoundingClientRect();
      const unobstructed=rect.bottom<phaseRect.top||rect.right<phaseRect.left;
      game.restart();game.externalPaused=false;
      const reset=badge.dataset.kind===''&&game.maxSyncStreak===0&&game.syncStreak===0;

      const seedCar=game.cars[0];
      function pass(waitTime){
        game.elapsed+=.6;
        game.cars=[{...seedCar,progress:960,waitTime,stopped:false,inside:false}];
        game.moveCars(1/60);updateHud();
      }
      pass(0);pass(.25);pass(0);
      const queuedFlow=badgeState(),chainBroken=game.cleanFlowStreak===1;
      pass(0);pass(0);
      const clean=badgeState();
      game.elapsed+=2;updateHud();
      const expired=badge.dataset.kind==='';
      game.win();
      const summary=document.querySelector('.win-breakdown')?.textContent||'';
      return {sync,syncCount,noticePreserved,unobstructed,reset,queuedFlow,chainBroken,clean,expired,summary};
    });
    assert.equal(feedback.sync.kind,'sync');
    assert.match(feedback.sync.text,/Perfect switch ×1|Точная смена ×1/);
    assert.equal(feedback.sync.animation,'none');
    assert.equal(feedback.syncCount,1);
    assert.ok(feedback.noticePreserved&&feedback.unobstructed&&feedback.reset&&feedback.chainBroken&&feedback.expired,JSON.stringify(feedback));
    assert.equal(feedback.queuedFlow.kind,'flow');
    assert.equal(feedback.clean.kind,'clean');
    assert.match(feedback.clean.text,/No stops ×3|Без остановок ×3/);
    assert.match(feedback.summary,/Best no-stop streak ×3|Лучшая серия без остановок ×3/);
    console.log('PASS M221 flow, no-stop streak, perfect switch and retry reset',feedback.sync,feedback.clean);

    const roadEvents=await winPage.evaluate(()=>{
      const {game,updateHud}=window.__tpQA;
      const labels=[],original=CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){
        labels.push([text,x,y]);
        return original.call(this,text,x,y,...rest);
      };
      function run(level){
        game.startLevel(level);game.externalPaused=false;
        let lastSwitch=0,early=null,warning=null,active=null,cleared=null;
        const snapshot=()=>{labels.length=0;updateHud();game.draw();return [...labels];};
        for(let i=1;i<60*50&&game.state==='playing';i++){
          const now=i/60;
          if(!game.transitionTimer&&now-lastSwitch>=2.3){
            const waiting=game.cars.some(c=>c.axis!==game.phase&&c.progress>180&&c.progress<340);
            const greenNear=game.cars.some(c=>c.axis===game.phase&&c.progress>120&&c.progress<620);
            if(waiting&&(!greenNear||now-lastSwitch>=4.4)&&game.toggle())lastSwitch=now;
          }
          game.update(1/60);
          const ambulance=game.cars.find(c=>c.kind==='ambulance');
          if(!early&&ambulance){
            const tag=snapshot().find(([text])=>text.startsWith('🚑'));
            if(tag)early={tag,dir:ambulance.dir,progress:ambulance.progress,preempting:ambulance.emergencyPriorityActive,
              status:document.querySelector('#priority-badge').textContent};
          }
          const incident=game.incidentDirector;
          if(incident?.warned&&!warning)warning=snapshot().filter(([text])=>/^⚠ \d/.test(text));
          if(incident?.active&&!active)active=snapshot().filter(([text])=>/^⏱ \d/.test(text));
          if(incident?.completed&&!cleared)cleared=snapshot().filter(([text])=>/^(⚠|⏱) \d/.test(text));
        }
        return {state:game.state,prioritySaved:game.prioritySaved,early,warning,active,cleared};
      }
      try{return [run(16),run(66),run(94),run(122)];}
      finally{CanvasRenderingContext2D.prototype.fillText=original;}
    });
    const [ambulance,broken,works,slow]=roadEvents;
    assert.ok(roadEvents.every(run=>run.state==='won'),'all four campaign levels should stay playable');
    assert.equal(ambulance.early.tag[0],'🚑 ←');
    assert.ok(ambulance.early.tag[1]>650&&ambulance.early.progress<70&&!ambulance.early.preempting);
    assert.match(ambulance.early.status,/←/);
    assert.equal(ambulance.prioritySaved,1);
    assert.ok(broken.warning.length===1&&broken.warning[0][1]<250&&broken.active.length===1);
    assert.ok(works.warning.length===2&&works.active.length===2);
    assert.ok(works.warning.some(([, ,y])=>y<250)&&works.warning.some(([, ,y])=>y>650));
    assert.equal(works.early.tag[0],'🚑 ↑');
    assert.ok(slow.warning.length===2&&slow.active.length===2);
    assert.ok([broken,works,slow].every(run=>run.cleared.length===0));
    console.log('PASS M222 early emergency direction and incident countdown lifecycle',roadEvents.map(run=>({early:run.early,warning:run.warning,active:run.active})));
    assert.deepEqual(winErrors,[],'real win page must have zero errors');
  }finally{await winPage.close();}
}finally{
  if(browser)await browser.close();
  await new Promise(done=>server.close(done));
}
