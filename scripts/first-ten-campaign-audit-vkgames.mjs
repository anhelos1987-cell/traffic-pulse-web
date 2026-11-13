// M228: actual first-ten campaign playthrough under the shipping browser runtime.
// The ONLY QA injection is request-scoped in Puppeteer; never shipped in app.js.
// A deterministic queue-aware controller uses currently visible cars, not hidden
// future traffic-plan items, and must win levels without rescue or auto-win.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import puppeteer from 'puppeteer-core';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const contentType={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.png':'image/png'};
const server=createServer(async(req,res)=>{
  try{
    const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const target=resolve(root,'.'+(path==='/'?'/index.html':path));
    if(!target.startsWith(root+sep))throw Error('outside root');
    const bytes=await readFile(target);
    res.writeHead(200,{'content-type':contentType[extname(target)]||'application/octet-stream','cache-control':'no-store'});
    res.end(bytes);
  }catch(_){res.writeHead(404).end('Missing');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port+'/';
const chrome=process.env.CHROME_BIN||'/usr/bin/google-chrome';
let browser;
try{
  browser=await puppeteer.launch({headless:true,executablePath:chrome,
    args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage(),errors=[];
  await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
  page.on('pageerror',e=>errors.push(String(e?.stack||e)));
  await page.setRequestInterception(true);
  page.on('request',async req=>{
    if(new URL(req.url()).pathname!=='/app.js'){await req.continue();return;}
    try{
      const source=await readFile(resolve(root,'app.js'),'utf8'),anchor='  function startApp(){';
      assert.equal(source.split(anchor).length-1,1,'QA injection marker exists exactly once');
      const instrumented=source.replace(anchor,
        '  window.__tpFirstTenQA={game:Game,save:save};\n'+anchor);
      await req.respond({status:200,contentType:'application/javascript',body:instrumented});
    }catch(e){console.error(e);await req.abort();}
  });
  await page.goto(url,{waitUntil:'networkidle2',timeout:25000});
  await page.waitForFunction(()=>window.__tpFirstTenQA?.game?.state==='playing',{timeout:15000});
  await page.evaluate(()=>{
    const {game,save}=window.__tpFirstTenQA;
    // Freeze the normal real-time driver. Use the unmodified fixed-step update
    // with explicit, repeatable 60 Hz ticks instead of artificial browser timers.
    cancelAnimationFrame(game.frameId);
    game.loop=()=>{};
    save.trainingCompleted=true; // test-only: cover campaign L1 without replaying tutorial
  });
  const results=[];
  for(let n=1;n<=10;n++){
    const outcome=await page.evaluate(async level=>{
      const {game:g}=window.__tpFirstTenQA;
      g.startLevel(level,false,'campaign');
      const events=[];
      let attempted=0,success=0,occupiedSwitches=0;
      const maxTicks=12000;
      for(let tick=0;tick<maxTicks&&g.state==='playing';tick++){
        // This controller can see cars and current signal, but cannot inspect
        // future plan entries or change vehicle progress, queue, score or RNG.
        if(tick%9===0&&g.transitionTimer<=0&&!g.userPaused&&!g.externalPaused){
          const waiting={H:0,V:0},near={H:0,V:0};
          for(const c of g.cars){
            if(c.progress<365){
              waiting[c.axis]++;
              if(c.progress>=180)near[c.axis]++;
            }
          }
          const current=g.phase,opposite=current==='H'?'V':'H';
          const occupied=g.cars.some(c=>c.inside);
          const starving=waiting[opposite]>=3&&waiting[current]<=1;
          if(!occupied&&waiting[opposite]>0&&(waiting[current]===0||starving&&near[current]===0)){
            attempted++;
            if(g.toggle()){
              success++;
              events.push({sec:Number(g.elapsed.toFixed(2)),phase:opposite,h:waiting.H,v:waiting.V});
            }
          }
        }
        g.update(1/60);
        if(tick%600===599)await new Promise(resolve=>setTimeout(resolve,0));
      }
      return {
        level,mode:g.mode,state:g.state,elapsed:Number(g.elapsed.toFixed(2)),
        exited:g.exited,total:g.config.total,switches:g.switches,
        attempted,successfulSwitches:success,occupiedSwitches,
        maxObservedQueue:g.maxObservedQueue,queueLimit:g.config.maxQueue,
        cleanWave:Boolean(g.pulseContract?.done),assisted:Boolean(g.assistActive),
        failure:g.lastFailType||'',events:events.slice(0,35)
      };
    },n);
    results.push(outcome);
    console.log('FIRST-TEN '+JSON.stringify(outcome));
    assert.equal(outcome.mode,'campaign');
    assert.equal(outcome.assisted,false,'M228 must not rely on retry assistance');
    assert.equal(outcome.state,'won','L'+n+' must be fully solvable by visible-queue policy');
    assert.equal(outcome.exited,outcome.total,'L'+n+' must clear every real spawned car');
    assert.ok(outcome.elapsed>1&&outcome.elapsed<180,'L'+n+' must finish in a short playable session');
    assert.ok(outcome.maxObservedQueue<=outcome.queueLimit,'L'+n+' peak queue cannot exceed loss limit');
    if(n===1)assert.ok(outcome.successfulSwitches>=1,'L1 demonstrates meaningful player input');
  }
  await mkdir(resolve(root,'artifacts/browser-smoke'),{recursive:true});
  await writeFile(resolve(root,'artifacts/browser-smoke/m228-first-ten-audit.json'),
    JSON.stringify({policy:'visible-queue',simHz:60,levels:results},null,2)+'\n');
  assert.deepEqual(errors,[],'all first-ten gameplay must have no browser runtime errors');
  console.log('PASS M228 first ten actual wins '+results.length+'/10; no rescue; genuine 60Hz simulation.');
}finally{
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
