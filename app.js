(() => {
  'use strict';

  // VK Play compatibility: keep the Canvas renderer alive on older/restricted browser engines.
  try{
    const proto=window.CanvasRenderingContext2D&&CanvasRenderingContext2D.prototype;
    if(proto&&!proto.ellipse){
      proto.ellipse=function(x,y,rx,ry,rotation,startAngle,endAngle,anticlockwise=false){
        this.save();this.translate(x,y);this.rotate(rotation||0);this.scale(Math.max(.0001,rx),Math.max(.0001,ry));this.arc(0,0,1,startAngle,endAngle,anticlockwise);this.restore();
      };
    }
    if(proto&&!proto.setLineDash)proto.setLineDash=function(){};
  }catch(_){}

  const BUILD_MODE = 'production';
  const BUILD_VERSION = 'M197-VKPLAY-ROUNDABOUT-TRIAL-RC1-HF5';
  const IS_DEVELOPMENT = BUILD_MODE === 'development';
  const PLATFORM_TARGET = 'vkplay'; // browser release target: VK Play iframe
  const YANDEX_PUBLIC_LEADERBOARD_NAME = 'TrafficPulseStars';
  const YANDEX_MASTERY_LEADERBOARD_NAME = 'TrafficPulseMastery';
  // M168: public Yandex card uses readable raw stars; the in-game mastery board keeps deterministic tie-breakers.
  // Current V1 bounds are <= 300 missions and <= 900 medals, so each field fits three digits.
  const LEADERBOARD_STAR_FACTOR = 1_000_000;
  const LEADERBOARD_MISSION_FACTOR = 1_000;
  const LEADERBOARD_TIE_MAX = 999;
  const YANDEX_AUDIT_ENABLED = (()=>{try{return new URLSearchParams(location.search).get('tpdebug')==='1';}catch(_){return false;}})();
  const YandexAudit = {
    startedAt:Date.now(), seq:0, lastEvent:'boot',
    state:{
      sdk:'pending',lang:'',loadingReady:0,player:'pending',cloudRead:0,cloudWrite:0,cloudFlush:0,cloudWriteErrors:0,cloudWriteTimeouts:0,cloudWriteLateSettlements:0,cloudWriteLateResolves:0,cloudWriteLateRejects:0,cloudOfflineDeferrals:0,cloudInitRetries:0,cloudInitRecoveries:0,cloudInitOfflineDeferrals:0,
      gameplayStart:0,gameplayStop:0,pause:0,resume:0,
      rewarded:{request:0,open:0,reward:0,close:0,error:0},fullscreen:{request:0,open:0,close:0,error:0},
      perf:{frames:0,mean:0,p95:0,max:0,jank25:0,jank33:0,quality:0,qualityChanges:0},
      audio:{state:'none',resumeAttempts:0,resumeSuccesses:0,gestureFallbacks:0,externalRecoveries:0,stateChanges:0,lastReason:''},
      lifecycle:{visibilityChanges:0,blurs:0,focuses:0,pagehides:0,pageshows:0,lastVisibility:document.visibilityState||'unknown',focused:document.hasFocus?.()??true},
      runtimeFaults:{errors:0,rejections:0,last:''},
      environment:{online:navigator.onLine!==false,secure:window.isSecureContext!==false,storage:'pending',storageError:'',onlineChanges:0,clockSource:'pending',clockSkewMs:0,clockSamples:0,clockErrors:0},
      releaseValidation:{runs:0,lastStatus:'PENDING',pass:0,warn:0,fail:0,pending:0,lastRunAtMs:0,checks:[]}
    },
    events:[], panel:null, frameSamples:[], copyButton:null, statusNode:null,
    mark(name,detail=''){
      if(!YANDEX_AUDIT_ENABLED&&!IS_DEVELOPMENT)return;
      this.seq++;this.lastEvent=name;this.events.push({seq:this.seq,t:Date.now()-this.startedAt,name,detail:String(detail||'')});if(this.events.length>80)this.events.shift();
      if(YANDEX_AUDIT_ENABLED){try{console.info('[TrafficPulse/PlatformAudit]',name,detail||'');}catch(_){}this.render();}
    },
    syncRuntime(){
      const a=this.state.audio,p=this.state.perf,l=this.state.lifecycle,e=this.state.environment;
      try{a.state=String(AudioFx?.ctx?.state||'none');a.resumeAttempts=Number(AudioFx?.resumeAttempts||0);a.resumeSuccesses=Number(AudioFx?.resumeSuccesses||0);a.needsGesture=Boolean(AudioFx?.needsGestureResume);}catch(_){}
      try{p.quality=Number(RenderQuality?.level||0);}catch(_){}
      l.lastVisibility=document.visibilityState||'unknown';l.focused=Boolean(document.hasFocus?.());e.online=navigator.onLine!==false;e.secure=window.isSecureContext!==false;
    },
    snapshot(){this.syncRuntime();return JSON.parse(JSON.stringify({enabled:YANDEX_AUDIT_ENABLED,build:BUILD_VERSION,uptimeMs:Date.now()-this.startedAt,lastEvent:this.lastEvent,state:this.state,events:this.events}));},
    reportText(){return JSON.stringify(this.snapshot(),null,2);},
    validationChecks(){
      this.syncRuntime();const s=this.state,events=this.events;
      const check=(id,status,detail)=>({id,status,detail:String(detail||'')});
      const checks=[];
      checks.push(check('sdk',s.sdk==='ready'?'PASS':s.sdk==='pending'?'PENDING':'FAIL',s.sdk));
      checks.push(check('loading-api',PLATFORM_TARGET==='yandex'?(s.loadingReady===1?'PASS':s.loadingReady===0?'PENDING':'WARN'):'PASS',PLATFORM_TARGET==='yandex'?`ready=${s.loadingReady}`:'not required for '+PLATFORM_TARGET));
      checks.push(check('player-cloud',s.player==='ready'&&s.cloudRead>=1&&s.cloudWrite>=1&&s.cloudWriteErrors===0?'PASS':s.cloudWriteTimeouts>0?'FAIL':s.player==='pending'?'PENDING':s.player==='ready'&&s.cloudRead>=1?'PENDING':'WARN',`player=${s.player} read=${s.cloudRead} write=${s.cloudWrite} flush=${s.cloudFlush} errors=${s.cloudWriteErrors||0} timeouts=${s.cloudWriteTimeouts||0}`));
      const gameplayDelta=s.gameplayStart-s.gameplayStop;
      checks.push(check('gameplay-api',gameplayDelta>=0&&gameplayDelta<=1?'PASS':'FAIL',`start=${s.gameplayStart} stop=${s.gameplayStop}`));
      checks.push(check('platform-pause-resume',Math.abs(s.pause-s.resume)<=1?'PASS':'WARN',`pause=${s.pause} resume=${s.resume}`));
      const lifecycleExercised=s.lifecycle.visibilityChanges>=2||(s.lifecycle.pagehides>=1&&s.lifecycle.pageshows>=1)||(s.lifecycle.blurs>=1&&s.lifecycle.focuses>=1);
      checks.push(check('lifecycle-roundtrip',lifecycleExercised?'PASS':'PENDING',`visibility=${s.lifecycle.visibilityChanges} blur/focus=${s.lifecycle.blurs}/${s.lifecycle.focuses} pagehide/show=${s.lifecycle.pagehides}/${s.lifecycle.pageshows}`));
      const faults=s.runtimeFaults||{errors:0,rejections:0,last:''},faultCount=Number(faults.errors||0)+Number(faults.rejections||0);
      checks.push(check('runtime-faults',faultCount===0?'PASS':'FAIL',`errors=${faults.errors||0} rejections=${faults.rejections||0}${faults.last?` last=${faults.last}`:''}`));
      const env=s.environment||{};checks.push(check('browser-environment',env.secure&&env.storage==='ok'?'PASS':env.storage==='failed'?'FAIL':'WARN',`secure=${env.secure} online=${env.online} storage=${env.storage}${env.storageError?` error=${env.storageError}`:''}`));
      const platformClock=(env.clockSource==='yandex'||env.clockSource==='vk');const clockStatus=platformClock&&env.clockSamples>=1?(env.clockSource==='vk'?'PASS':(Math.abs(Number(env.clockSkewMs||0))<=300000?'PASS':'WARN')):s.sdk==='ready'?(PLATFORM_TARGET==='standalone'?'WARN':'FAIL'):'PENDING';checks.push(check('server-clock',clockStatus,`source=${env.clockSource} samples=${env.clockSamples||0} skewMs=${Math.round(Number(env.clockSkewMs||0))} errors=${env.clockErrors||0}`));
      const perfFrames=Number(s.perf.frames||0),perfP95=Number(s.perf.p95||0),perfMax=Number(s.perf.max||0);
      checks.push(check('frame-health',perfFrames<30?'PENDING':perfP95<=50?'PASS':perfP95<=80?'WARN':'FAIL',`frames=${perfFrames} p95=${perfP95.toFixed(1)} max=${perfMax.toFixed(1)} quality=${s.perf.quality}`));
      const validateAds=(kind,rewarded=false)=>{
        const sessions=[];let current=null;
        for(const e of events){
          if(e.name===`${kind}:request`){current={order:['request'],open:0,reward:0,close:0,error:0};sessions.push(current);continue;}
          if(!current||!e.name.startsWith(`${kind}:`))continue;
          const phase=e.name.slice(kind.length+1);if(['open','reward','close','error'].includes(phase)){current.order.push(phase);current[phase]=(current[phase]||0)+1;}
        }
        if(!sessions.length)return check(kind,'PENDING','not exercised in this audit trace');
        let bad=0,openless=0,incomplete=0;
        for(const a of sessions){
          const terminal=a.close+a.error;const terminalIndex=Math.max(a.order.lastIndexOf('close'),a.order.lastIndexOf('error'));
          if(terminal!==1||a.open>1||a.close>1||a.error>1||(rewarded&&a.reward>1))bad++;
          const openIndex=a.order.indexOf('open'),rewardIndex=a.order.indexOf('reward');
          if(openIndex>=0&&terminalIndex>=0&&openIndex>terminalIndex)bad++;
          if(rewarded&&rewardIndex>=0&&(openIndex<0||rewardIndex<openIndex||rewardIndex>terminalIndex))bad++;
          if(a.open===0&&a.error===0)openless++;
          if(terminal===0)incomplete++;
          if(terminalIndex>=0&&a.order.slice(terminalIndex+1).some(x=>x==='open'||x==='reward'))bad++;
          if(rewarded&&a.reward&&a.open===0)bad++;
        }
        const status=bad?'FAIL':incomplete?'PENDING':openless?'WARN':'PASS';
        return check(kind,status,`sessions=${sessions.length} bad=${bad} incomplete=${incomplete} openless=${openless}`);
      };
      checks.push(validateAds('rewarded',true));checks.push(validateAds('fullscreen',false));
      const audioState=s.audio.state;checks.push(check('audio',audioState==='running'?'PASS':audioState==='none'?'PENDING':(audioState==='suspended'||audioState==='interrupted')?'FAIL':'WARN',`state=${audioState} resume=${s.audio.resumeSuccesses}/${s.audio.resumeAttempts}`));
      return checks;
    },
    validateSession(){
      const checks=this.validationChecks(),rank={FAIL:3,WARN:2,PENDING:1,PASS:0};let overall='PASS';
      for(const c of checks)if(rank[c.status]>rank[overall])overall=c.status;
      const v=this.state.releaseValidation;v.runs++;v.lastStatus=overall;v.lastRunAtMs=Date.now()-this.startedAt;v.checks=checks;
      v.pass=checks.filter(c=>c.status==='PASS').length;v.warn=checks.filter(c=>c.status==='WARN').length;v.fail=checks.filter(c=>c.status==='FAIL').length;v.pending=checks.filter(c=>c.status==='PENDING').length;
      this.mark('release-validation',`${overall} P${v.pass} W${v.warn} F${v.fail} ?${v.pending}`);return JSON.parse(JSON.stringify(v));
    },
    async copyReport(){
      const text=this.reportText();let ok=false;
      try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);ok=true;}}catch(_){}
      if(!ok){try{const ta=document.createElement('textarea');ta.value=text;ta.setAttribute('readonly','');ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();ok=document.execCommand?.('copy')===true;ta.remove();}catch(_){}}
      this.mark(ok?'audit:copy:ok':'audit:copy:failed');
      if(this.copyButton){const old=this.copyButton.textContent;this.copyButton.textContent=ok?'COPIED':'COPY FAILED';setTimeout(()=>{if(this.copyButton)this.copyButton.textContent=old;},1100);}
      return ok;
    },
    sampleFrame(ms){if(!YANDEX_AUDIT_ENABLED||!Number.isFinite(ms)||ms<=0||ms>500)return;const p=this.state.perf;p.frames++;p.mean+=(ms-p.mean)/p.frames;p.max=Math.max(p.max,ms);if(ms>25)p.jank25++;if(ms>33.4)p.jank33++;this.frameSamples.push(ms);if(this.frameSamples.length>180)this.frameSamples.shift();if(p.frames%60===0){const a=[...this.frameSamples].sort((x,y)=>x-y);p.p95=a[Math.min(a.length-1,Math.floor((a.length-1)*.95))]||0;this.render();}},
    ensurePanel(){
      if(!YANDEX_AUDIT_ENABLED||this.panel)return this.panel;
      const el=document.createElement('aside');el.id='yandex-audit';el.className='yandex-audit';el.setAttribute('aria-label','Platform SDK audit');
      const pre=document.createElement('pre');pre.className='yandex-audit-status';el.appendChild(pre);this.statusNode=pre;
      const actions=document.createElement('div');actions.className='yandex-audit-actions';
      const copy=document.createElement('button');copy.type='button';copy.textContent='COPY REPORT';copy.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();void this.copyReport();});actions.appendChild(copy);this.copyButton=copy;
      const validate=document.createElement('button');validate.type='button';validate.textContent='CHECK SESSION';validate.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();this.validateSession();this.render();});actions.appendChild(validate);
      const reset=document.createElement('button');reset.type='button';reset.textContent='CLEAR TRACE';reset.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();this.events=[];this.mark('audit:trace:cleared');});actions.appendChild(reset);
      el.appendChild(actions);document.body.appendChild(el);this.panel=el;return el;
    },
    render(){
      const el=this.ensurePanel();if(!el)return;this.syncRuntime();const s=this.state,r=s.rewarded,f=s.fullscreen,p=s.perf,a=s.audio,l=s.lifecycle,x=s.runtimeFaults,e=s.environment,v=s.releaseValidation;
      const target=this.statusNode||el;
      target.textContent=`PLATFORM AUDIT · ${PLATFORM_TARGET.toUpperCase()} · ${BUILD_VERSION} · RC PREFLIGHT\nSDK ${s.sdk} · lang ${s.lang||'-'} · vis ${l.lastVisibility}/${l.focused?'focus':'blur'}\nLoading ${s.loadingReady} · Player ${s.player} · Cloud R/W/F ${s.cloudRead}/${s.cloudWrite}/${s.cloudFlush} · err/to/off ${s.cloudWriteErrors||0}/${s.cloudWriteTimeouts||0}/${s.cloudOfflineDeferrals||0}\nGameplay ${s.gameplayStart}/${s.gameplayStop} · platform pause/resume ${s.pause}/${s.resume}\nAudio ${a.state}${a.needsGesture?' · NEED GESTURE':''} · resume ${a.resumeSuccesses}/${a.resumeAttempts} · gesture ${a.gestureFallbacks} · external ${a.externalRecoveries}\nFrame avg/p95/max ${Number(p.mean||0).toFixed(1)}/${Number(p.p95||0).toFixed(1)}/${Number(p.max||0).toFixed(1)} ms · Q${p.quality} · >25/>33 ${p.jank25||0}/${p.jank33||0}\nRewarded ${r.request}/${r.open}/${r.reward}/${r.close}/${r.error} · Fullscreen ${f.request}/${f.open}/${f.close}/${f.error}\nValidation ${v.lastStatus} · P/W/F/? ${v.pass}/${v.warn}/${v.fail}/${v.pending}\nLifecycle V/B/F/H/S ${l.visibilityChanges}/${l.blurs}/${l.focuses}/${l.pagehides}/${l.pageshows} · faults ${x.errors}/${x.rejections}\nEnv ${e.secure?'secure':'INSECURE'} · ${e.online?'online':'offline'} · storage ${e.storage} · clock ${e.clockSource} ${Math.round(Number(e.clockSkewMs||0))}ms\nLast: ${this.lastEvent}`;
    }
  };
  // M130: release preflight must fail loudly on uncaught runtime faults instead of relying on manual console inspection.
  window.addEventListener('error',e=>{const f=YandexAudit.state.runtimeFaults;f.errors++;f.last=String(e?.message||e?.error?.message||'window error').slice(0,160);YandexAudit.mark('runtime:error',f.last);});
  window.addEventListener('unhandledrejection',e=>{const f=YandexAudit.state.runtimeFaults;f.rejections++;f.last=String(e?.reason?.message||e?.reason||'unhandled rejection').slice(0,160);YandexAudit.mark('runtime:rejection',f.last);});
  // M131: surface browser/storage/network readiness in the opt-in RC preflight without changing gameplay.
  (()=>{const e=YandexAudit.state.environment;try{const k='tp_rc_storage_probe';localStorage.setItem(k,'1');localStorage.removeItem(k);e.storage='ok';}catch(err){e.storage='failed';e.storageError=String(err?.name||'storage error').slice(0,80);}window.addEventListener('online',()=>{e.online=true;e.onlineChanges++;YandexAudit.mark('environment:online');});window.addEventListener('offline',()=>{e.online=false;e.onlineChanges++;YandexAudit.mark('environment:offline');});})();

  const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let reducedMotion = Boolean(motionQuery?.matches);
  motionQuery?.addEventListener?.('change', e => { reducedMotion = Boolean(e.matches); });

  // Presentation quality is adaptive only; simulation rules never change with device speed.
  // M87 starts likely low-memory/low-core devices at a safer presentation tier instead of forcing
  // the first ~45 frames at maximum quality and reacting only after a visible stutter.
  function initialRenderQuality(){
    const memory=Number(navigator.deviceMemory||0),cores=Number(navigator.hardwareConcurrency||0),dpr=Math.max(1,window.devicePixelRatio||1);
    const vw=Math.max(1,window.innerWidth||screen?.width||390),vh=Math.max(1,window.innerHeight||screen?.height||844),pixelLoad=vw*vh*dpr*dpr;
    if((memory>0&&memory<=2)||(cores>0&&cores<=2)||pixelLoad>5_000_000)return 0;
    if((memory>0&&memory<=4)||(cores>0&&cores<=4)||pixelLoad>2_700_000)return 1;
    return 2;
  }
  const INITIAL_RENDER_QUALITY=initialRenderQuality();
  let canvasMetricsDirty=true, cachedCanvasCssW=0, cachedCanvasCssH=0;
  const RenderQuality = {
    level:INITIAL_RENDER_QUALITY, emaMs:16.7, samples:0, goodSamples:0,
    observe(frameMs, active){
      if(!active || !Number.isFinite(frameMs) || frameMs<=0 || frameMs>250) return;
      const before=this.level;
      this.emaMs=this.emaMs*.94+frameMs*.06; this.samples++;
      // Hotfix02: emergency downshift must be frame-count independent enough for very slow devices.
      // Waiting 45 samples can mean several seconds at 10-20 FPS, prolonging a bad first impression.
      // Severe sustained jank falls straight to Low after 12 samples; moderate jank can leave High
      // after 24 samples. Normal 60 FPS devices keep the existing conservative 45-sample policy.
      if(this.samples>=12 && this.emaMs>34 && this.level>0){ this.level=0; this.goodSamples=0; this.samples=0; }
      else if(this.samples>=24 && this.emaMs>22 && this.level>1){ this.level=1; this.goodSamples=0; this.samples=0; }
      else if(this.samples>=45){
        if(this.emaMs>26 && this.level>0){ this.level=0; this.goodSamples=0; this.samples=0; }
        else if(this.emaMs>18.6 && this.level>1){ this.level=1; this.goodSamples=0; this.samples=0; }
        else if(this.emaMs<16.25 && this.level<2){
          this.goodSamples++; if(this.goodSamples>900){ this.level++; this.goodSamples=0; this.samples=0; }
        } else this.goodSamples=0;
      }
      if(this.level!==before){canvasMetricsDirty=true;YandexAudit.state.perf.qualityChanges++;YandexAudit.state.perf.quality=this.level;YandexAudit.mark('perf:quality',`${before}->${this.level} ema=${this.emaMs.toFixed(1)}`);}
    },
    dprCap(){ return this.level===2?2.25:this.level===1?1.75:1.35; },
    pixelBudget(){ return this.level===2?3_000_000:this.level===1?2_100_000:1_400_000; },
    particleCount(){ return reducedMotion?0:(this.level===2?6:this.level===1?3:1); }
  };
  const SIM_STEP=1/60, MAX_CATCHUP_STEPS=8, HUD_REFRESH_MS=80;

  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

  // M96 HF02: use the layout viewport for the game shell. visualViewport can move/resize
  // transiently when browser chrome, iframe UI or accessibility overlays appear; tying the square
  // board to those transient values caused a visible 7–12 px jump that later snapped back.
  function updateViewportMetrics(){
    const width = Math.max(1, Math.round(window.innerWidth || document.documentElement.clientWidth || window.visualViewport?.width || 1));
    const height = Math.max(1, Math.round(window.innerHeight || document.documentElement.clientHeight || window.visualViewport?.height || 1));
    const root = document.documentElement;
    root.style.setProperty('--viewport-w', `${width}px`);
    root.style.setProperty('--viewport-h', `${height}px`);
    root.dataset.orientation = width >= height ? 'landscape' : 'portrait';
    root.dataset.dpr = String(Math.round((window.devicePixelRatio || 1) * 100) / 100);
  }
  updateViewportMetrics();

  const TEXT = {
    ru: {
      level:'Уровень', goal:'Пропусти весь транспорт', restart:'Заново', hint:'Совет', switchLight:'Сменить свет', pauseAction:'Пауза',
      jam:'Пробка', switches:'Переключения', tapSignal:'Нажми на светофор', paused:'Пауза', pausedText:'Движение остановлено.',
      continue:'Продолжить', complete:'Отличный поток!', completeText:'Перекрёсток свободен.', next:'Следующий уровень', coins:'монет',
      rewardAdCoins:'Дополнительный бонус', crash:'Столкновение!', crashText:'Не открывай встречный поток, пока перекрёсток занят.',
      trafficJam:'Город встал!', jamText:'Очередь стала слишком длинной.', tryAgain:'Повторить', rescueCrashAd:'Продолжение недоступно', rescueJamAd:'Продолжение недоступно',
      hintHorizontal:'Открой горизонтальное движение.', hintVertical:'Открой вертикальное движение.', hintWait:'Подожди, пока машины покинут перекрёсток.',
      adUnavailable:'Функция сейчас недоступна', demoReward:'Тестовый бонус получен', perfect:'Идеально!', good:'Хорошо!', survived:'Пройдено!',
      phaseH:'Горизонталь', phaseV:'Вертикаль', phaseChanging:'Переключение…', phasePedestrianClearing:'Пешеходы завершают переход…', flow:'ПОТОК', hotFlow:'ГОРЯЧИЙ ПОТОК', perfectSwitch:'ИДЕАЛЬНОЕ ПЕРЕКЛЮЧЕНИЕ', syncBonus:'Бонус синхронизации', boardLabel:'Игровой перекрёсток', controlsLabel:'Управление движением', progressLabel:'Прогресс уровня', starsLabel:'Звёзды', statusLabel:'Статус уровня', progressOverviewLabel:'Обзор прогресса', personalBestLabel:'Сравнение с личным рекордом', independentControlsLabel:'Независимое управление перекрёстками', eventRush:'ЧАС ПИК', eventHeavy:'ТЯЖЁЛЫЙ', eventService:'СЛУЖЕБНЫЙ', eventExpress:'ЭКСПРЕСС', eventFreight:'ГРУЗОВОЙ', eventPulse:'ПУЛЬС', eventAlternating:'СМЕНА ДАВЛЕНИЯ', eventRoadwork:'РЕМОНТ', junctionT:'T-ПЕРЕКРЁСТОК', junctionDouble:'ДВОЙНОЙ УЗЕЛ', priorityAlert:'СПЕЦТРАНСПОРТ', priorityYield:'УСТУПИ ДОРОГУ', priorityIncoming:'ПРИБЛИЖАЕТСЯ', priorityClear:'ОСВОБОДИ УЗЕЛ', pedestrianWalk:'ПЕШЕХОДАМ МОЖНО', pedestrianStop:'ПЕШЕХОДАМ СТОП', eventIntro:'Особый поток',
      soundOn:'🔊 Звук: вкл.', soundOff:'🔇 Звук: выкл.', musicLevel:'🎵 Музыка', effectsOn:'🔊 Эффекты: вкл.', effectsOff:'🔇 Эффекты: выкл.', language:'🌐 Язык', languageAuto:'Авто', languageRussian:'Русский', languageEnglish:'English', leaderboard:'Рейтинг', leaderboardTitle:'Мировой рейтинг', leaderboardDesc:'Звёзды определяют место. При равенстве учитываются миссии, затем медали.', leaderboardScore:'Твой результат', leaderboardYourRank:'Твоё место', leaderboardSignIn:'Войти в Яндекс', leaderboardSignInDesc:'Войди в Яндекс, чтобы опубликовать результат и увидеть своё место в рейтинге.', leaderboardUnavailable:'Рейтинг доступен только в версии Яндекс Игр.', leaderboardLoading:'Загрузка рейтинга…', leaderboardRetry:'Обновить', leaderboardNoEntries:'Пока нет результатов.', leaderboardSetup:'Рейтинг ещё не создан в консоли Яндекс Игр.', leaderboardAnonymous:'Игрок', leaderboardYou:'Ты', developer:'О игре', developerTitle:'О игре', developerDesc:'', developerBuild:'Разработчик', developerPlatform:'Почта', developerSave:'Версия игры', developerPublicBoard:'Основной рейтинг', developerMasteryBoard:'Рейтинг мастерства', developerSimulation:'Симуляция', stats:'Статистика', statsLevel:'Уровень', statsStars:'Звёзды', statsMissions:'Миссии', statsAchievements:'Достижения', statsCars:'Машины', statsFlow:'Рекорд FLOW', statsDaily:'Daily серия', statsWeekly:'Weekly победы', newCar:'Новый автомобиль доступен в гараже!', newDistrict:'Открыт новый район:', garage:'Гараж', garageDesc:'Гараж меняет только внешний вид. Любимая машина чаще появляется в обычном трафике (~55%), но не становится быстрее и не даёт бонусов.', garagePreview:'Предпросмотр', garageCollectionProgress:'Коллекция', garageTapPreview:'Нажми на машинку для предпросмотра', garageCanSelect:'Куплено · можно выбрать', garageUnlockIn:'до открытия', garageCoinsShort:'до покупки', nextPurchase:'Следующая покупка', needCoins:'не хватает', readyToBuy:'можно купить', owned:'Куплено', buy:'Купить', selected:'Выбрано', select:'Выбрать', collection:'Коллекция', favoriteCar:'Любимая машина', locked:'Откроется после уровня', notEnough:'Не хватает монет', close:'Закрыть', violatorAlert:'НАРУШИТЕЛЬ', violatorTip:'Некоторые торопыги могут завершить проезд на жёлтый. На красный гражданские машины всегда останавливаются.', tutorialLanes3:'Три полосы — следи за перестроениями',
      tutorialGoal1:'Открой вертикальный поток', tutorialGoal2:'Меняй свет, когда следующий поток уже ждёт', tutorialGoal3:'Смотри на обе очереди', tutorialGoal4:'Не переключай занятый перекрёсток', tutorialGoal5:'Пропускай группу целиком', tutorialCoachOpenWaiting:'Открой направление, где машины уже ждут', tutorialCoachOccupied:'Перекрёсток занят — сначала дай машине выехать', tutorialCoachQueue:'Очередь растёт — освободи более загруженное направление', tutorialCoachClearance:'Короткая пауза между фазами защищает перекрёсток', tutorialCoachRhythm:'Хороший ритм: пропускай группу целиком, затем переключай', tutorialPedestrians:'Пешеходы идут только когда машинам красный', tutorialTurns:'Появились повороты — следи за траекторией', tutorialYellow:'Некоторые водители завершают проезд на жёлтый', tutorialLeftTurns:'Левые повороты требуют больше свободного места', tutorialLanes:'Две полосы — один светофор', rushGoal:'Час пик: удержи поток', heavyGoal:'Тяжёлый поток: больше автобусов', serviceGoal:'Служебный поток: не создавай пробку', expressGoal:'Экспресс-поток: держи темп', freightGoal:'Грузовой час: оставляй запас', pulseGoal:'Пульс города: лови окна между волнами', alternatingGoal:'Смена давления: реагируй на волны с разных направлений', roadworkGoal:'Ремонт дороги: работай одной полосой', incidentBrokenCar:'СЛОМАННАЯ МАШИНА', incidentRoadworks:'ДОРОЖНЫЕ РАБОТЫ', incidentSlowZone:'ОГРАНИЧЕНИЕ СКОРОСТИ', incidentWarning:'Впереди дорожное происшествие', incidentActive:'Перестрой поток', incidentCleared:'Дорога снова свободна', incidentBrokenGoal:'Сломанная машина: поток перестраивается', incidentRoadworksGoal:'Ремонт: одна полоса временно закрыта', incidentSlowGoal:'Ограничение: поток временно замедлен',
      district1:'ЗЕЛЁНЫЙ ГОРОД', district2:'ПОБЕРЕЖЬЕ', district3:'ЦЕНТР', district4:'АЭРОПОРТ', district5:'ПОРТ', district6:'НОЧНОЙ ГОРОД', district7:'СТАРЫЙ ГОРОД', district8:'ТЕХНОПАРК', district9:'ЗИМНИЙ ГОРОД', trait2:'Больше выездов с парковок', trait3:'Быстрый городской поток', trait4:'Чаще спецтранспорт', trait5:'Больше грузовиков и автобусов', trait6:'Ночной скоростной поток',
      car1:'Городская', car2:'Такси', car3:'Фургон', car4:'Спорткар', car5:'Полиция', car6:'Электро', car7:'Премиум', car8:'Неон', car9:'Классика', car10:'Гиперкар', rare:'РЕДКАЯ', weatherRain:'ДОЖДЬ', weatherFog:'ТУМАН', weatherSunset:'ЗАКАТ', weatherSnow:'СНЕГ',
      dailyChallenge:'Ежедневный заезд', dailyDistrict:'ЕЖЕДНЕВНЫЙ ЗАЕЗД', dailyDesc:'Один и тот же транспортный сценарий для всех игроков сегодня.', dailyStart:'Начать заезд', dailyReturn:'В кампанию', dailyReplay:'Ещё раз', dailyBest:'Лучший результат сегодня', dailyFirstReward:'Награда за первый финиш', dailyDone:'Сегодня награда уже получена', dailyLocked:'Ежедневный заезд откроется после 3-го уровня', dailyStreak:'Серия дней', dailyStreakBonus:'Бонус серии', challengePassport:'Паспорт испытаний', challengePassportDesc:'Небольшие цели без штрафа за пропуск.', challengeToday:'Сегодня', challengeWeek:'Неделя', challengeNextBonus:'Следующий бонус', challengeClaimed:'получено', challengeReady:'готово', challengeDailyLadder:'Серия Daily', weeklyStreak:'Серия недель', weeklyStreakBonus:'Бонус недельной серии', weeklyNextBonus:'Следующий Weekly бонус', switchesShort:'Ходы', queueShort:'Пик пробки', starBonus:'Бонус за звёзды', flowBonus:'Бонус потока', priorityBonus:'Спецтранспорт без задержки', assistNext:'Следующая попытка будет немного легче.', assistGoal:'Помощь активна: увеличен запас пробки', insightTitle:'Ближайшие цели', insightCar:'Следующее авто', insightStars:'До бонуса', insightFlow:'Лучший поток', allCars:'Все авто открыты', newFlowRecord:'Новый рекорд потока', mission:'МИССИЯ', missionQueue:'Не выше пробки', missionSwitch:'Не больше переключений', missionFlow:'Собери поток', missionDone:'Миссия выполнена', missionReward:'Бонус миссии', missionReplay:'Перепройди ради миссии', missionMastery:'Мастерство миссий', missionMilestone:'Бонус за 5 миссий', achievement:'Достижение', achPerfect:'Идеальный диспетчер', achFlow:'Мастер потока', achPriority:'Спасательный коридор', achRoadwork:'Объезд найден', achMissions:'Охотник за миссиями', weeklyChallenge:'Недельный заезд', weeklyDistrict:'НЕДЕЛЬНЫЙ ЗАЕЗД', weeklyDesc:'Сложный сценарий недели: две полосы, смешанный трафик и крупная награда.', weeklyStart:'Недельный заезд', weeklyReturn:'В кампанию', weeklyReplay:'Ещё раз', weeklyFirstReward:'Награда недели', weeklyDone:'Награда этой недели уже получена', weeklyLocked:'Недельный заезд откроется после 11-го уровня', endlessMode:'Бесконечный поток', endlessDistrict:'БЕСКОНЕЧНЫЙ ПОТОК', endlessDesc:'Переживай всё более плотные волны. Одна ошибка завершает заезд.', endlessStart:'Начать бесконечный заезд', endlessReturn:'Вернуться в кампанию', endlessReplay:'Новый заезд', endlessLocked:'Бесконечный поток откроется после 19-го уровня', endlessWave:'Волна', endlessScore:'Счёт', endlessBest:'Рекорд', endlessNewBest:'Новый рекорд!', scenarioMode:'Сценарии', scenarioDistrict:'СЦЕНАРИЙ', scenarioLocked:'Сценарии откроются после 20-го уровня', scenarioAfterSchool:'После уроков', scenarioAfterSchoolDesc:'Разгрузи школьную улицу, пропусти три волны школьников и удержи автобусный поток без критической пробки.', scenarioAfterSchoolGoal:'Пропусти все школьные волны и автобусы', scenarioStart:'Начать сценарий', scenarioReplay:'Повторить сценарий', scenarioReturn:'Вернуться в кампанию', scenarioBest:'Лучший результат', scenarioStageClear:'Разгрузи улицу', scenarioStagePed1:'Первая группа школьников', scenarioStagePed2:'Вторая группа школьников', scenarioStageFinal:'Оставшийся транспорт', scenarioNextEvent:'Следующее событие', scenarioPedWave:'пешеходная волна', scenarioTrafficWave:'транспортная волна', scenarioComplete:'Сценарий выполнен', scenarioNoCoins:'Отдельные сценарные звёзды · без монет за повтор', modesHub:'Режимы', modesHubDesc:'Кампания, испытания и особые сценарии в одном месте.', modeCampaign:'Кампания', modeCampaignDesc:'Обычные уровни и основной прогресс.', modeLocked:'Закрыто', scenarioRule:'Особое правило', scenarioProgressLabel:'Прогресс', scenarioPedestrians:'Пешеходные волны', scenarioEmergency:'Спецтранспорт', scenarioTraffic:'Транспорт', scenarioAfterSchoolRule:'Три школьные волны и много автобусов. Пешеходов нужно полностью пропускать в безопасные окна.', scenarioGreenCorridor:'Зелёный коридор', scenarioGreenCorridorDesc:'Городские службы идут сериями и могут проходить красный. Освобождай перекрёсток заранее.', scenarioGreenCorridorGoal:'Не задерживай спецтранспорт', scenarioGreenCorridorRule:'Скорая, полиция и пожарные имеют приоритет и могут проходить красный только через свободный конфликтный узел.', scenarioStadium:'После матча', scenarioStadiumDesc:'Стадион выпускает толпы пешеходов одновременно с плотными волнами автомобилей.', scenarioStadiumGoal:'Чередуй пешеходные окна и транспорт', scenarioStadiumRule:'Четыре большие пешеходные волны. Не допускай критической пробки между ними.', scenarioAirportPriority:'Аэропорт: приоритет', scenarioAirportPriorityDesc:'Шаттлы, автобусы и спецслужбы делят двухполосный узел в часы пик.', scenarioAirportPriorityGoal:'Держи коридор для спецслужб', scenarioAirportPriorityRule:'Две полосы, много автобусов и минимум четыре спецмашины должны пройти без долгой задержки.', scenarioRoadworks:'Объезд ремонта', scenarioRoadworksDesc:'Одна из двух полос перекрыта конусами. Поток нужно заранее собирать в рабочую полосу.', scenarioRoadworksGoal:'Проведи поток через открытую полосу', scenarioRoadworksRule:'Одна полоса физически закрыта на всех подъездах. Ошибка выбора полосы быстро создаёт очередь.', scenarioFreightPort:'Грузовая смена', scenarioFreightPortDesc:'Порт выпускает длинные грузовики, автобусы и обычный транспорт на трёхполосный узел.', scenarioFreightPortGoal:'Разведи тяжёлый поток по трём полосам', scenarioFreightPortRule:'Три полосы и много длинных грузовиков: им нужно больше места и времени для освобождения перекрёстка.', scenarioStageSchoolOpen:'Разгрузи школьную улицу', scenarioStageSchoolRush:'Школьники выходят', scenarioStageSchoolSecond:'Вторая смена', scenarioStageSchoolFinal:'Последний автобус', scenarioStageEmergencyPrep:'Освободи перекрёсток', scenarioStageEmergencyWave:'Колонна спецслужб', scenarioStageEmergencyFinal:'Финальный коридор', scenarioStageCrowdPrep:'Подготовь переходы', scenarioStageCrowdWave:'Толпа со стадиона', scenarioStageCrowdFinal:'Развези остаток потока', scenarioStageAirportRush:'Пиковый заезд', scenarioStageAirportService:'Служебный коридор', scenarioStageAirportFinal:'Последние шаттлы', scenarioStageRoadworksPrep:'Собери поток в открытую полосу', scenarioStageRoadworksRush:'Объезд набирает нагрузку', scenarioStageRoadworksFinal:'Финальная очередь', scenarioStageFreightPrep:'Первые фуры', scenarioStageFreightRush:'Пиковая грузовая смена', scenarioStageFreightFinal:'Закрой смену', failureReplay:'Разбор ошибки', failureReplayPlaying:'Последние секунды', failureReplayCrash:'Два потока одновременно вошли в конфликтную зону.', failureReplayJam:'Очередь превысила допустимый предел. Раньше освобождай более загруженное направление.', failureReplayReturn:'Вернуться к результату', campaignMap:'Карта кампании', campaignMapDesc:'Выбирай пройденные уровни, улучшай звёзды и закрывай миссии.', campaignContinue:'Продолжить', campaignProgress:'Прогресс района', campaignStars:'Звёзды района', campaignNextReward:'Ближайшие награды', campaignNextCar:'Следующее авто', campaignMasteryBonus:'Бонус мастерства', campaignMissionBonus:'Бонус миссий', campaignNextDistrictGoal:'Следующий район', campaignLevelsToGo:'ур. осталось', campaignStarsToGo:'★ осталось', campaignMissionsToGo:'мис. осталось', campaignReady:'готово', campaignCurrent:'Текущий', campaignCompleted:'Пройдено', campaignLocked:'Закрыто', campaignMissionDone:'Миссия выполнена', campaignMissionOpen:'Миссия доступна', campaignChapter:'Район', campaignNextChapter:'Следующий район', campaignPrevChapter:'Предыдущий район', campaignCycle:'цикл', campaignFirstClear:'Первая награда', campaignReplayReward:'Повтор уровня', campaignBaseAlreadyPaid:'Базовая награда этого уровня уже получена. Повтор даёт монеты только за новые звёзды, миссии и достижения.', campaignStarImprove:'Улучшение звёзд', campaignModes:'Режимы и сценарии', greenWaveMode:'Зелёная волна', greenWaveDistrict:'ЗЕЛЁНАЯ ВОЛНА', greenWaveDesc:'6 испытаний · два связанных перекрёстка с независимым управлением.', greenWaveLocked:'Откроется на 25-м уровне · 6 испытаний с двумя связанными перекрёстками.', greenWaveChallengeLocked:'Сначала пройди предыдущее испытание.', greenWaveChallenges:'Испытания', greenWaveChallengesDesc:'Шесть коротких задач на координацию двух независимых перекрёстков.', greenWaveCatch:'Поймай волну', greenWaveCatchDesc:'Учебный заезд: выпусти группу с левого узла и подготовь правый к её прибытию.', greenWaveCatchGoal:'Проведи сквозной поток через оба узла', greenWaveBoth:'Обе стороны', greenWaveBothDesc:'Встречные группы идут по магистрали с разным временем подхода. Не заставляй одну волну ждать другую.', greenWaveBothGoal:'Проведи встречные волны через оба узла', greenWaveSide:'Боковые улицы', greenWaveSideDesc:'Магистраль остаётся важной, но боковые улицы быстро набирают очередь у обоих узлов.', greenWaveSideGoal:'Сохрани волну и регулярно разгружай боковые улицы', greenWavePed:'Пешеходный час', greenWavePedDesc:'У одного узла появляются локальные пешеходные запросы. Освобождай переход, не ломая зелёную волну.', greenWavePedGoal:'Проведи поток и безопасно пропусти пешеходов', greenWaveLong:'Длинный транспорт', greenWaveLongDesc:'Автобусы и грузовики занимают больше места между узлами. Не выпускай новую группу в заполненный соединительный участок.', greenWaveLongGoal:'Проведи длинный транспорт без блокировки соединения', greenWaveDispatcher:'Работа диспетчера', greenWaveDispatcherDesc:'Повороты, пешеходы и объявленный спецтранспорт требуют локальных решений на каждом узле.', greenWaveDispatcherGoal:'Координируй все виды движения и сохрани коридор спецтранспорту', greenWaveStart:'Начать', greenWaveNext:'Следующее испытание', greenWaveReplay:'Повторить', greenWaveReturn:'Вернуться в кампанию', greenWaveNoCoins:'Отдельные звёзды режима · без монет', greenWaveLeft:'Левый', greenWaveRight:'Правый', greenWaveChoose:'Используй отдельные кнопки Левый и Правый.', greenWaveBlocked:'ВЫХОД ЗАНЯТ', greenWaveThrough:'Без остановки', greenWaveSideQueue:'Боковая очередь', greenWavePriority:'Спецтранспорт без задержки', greenWavePedIncoming:'Пешеходы ждут безопасное окно', greenWaveEmergencyIncoming:'Внимание: приближается спецтранспорт', greenWaveHint:'Сначала выпусти группу слева, затем заранее открой магистраль справа.', greenWaveHintBoth:'Следи за обеими встречными волнами: магистраль зелёная сразу на двух узлах только когда это действительно нужно.', greenWaveHintSide:'Коротко открывай вертикаль там, где растёт очередь, и быстро возвращай магистраль.', greenWaveHintPed:'Пешеходный запрос выполняется только когда соответствующей дороге красный. Второй узел можно продолжать обслуживать независимо.', greenWaveHintLong:'Оставляй запас между длинными машинами: если участок между узлами заполнен, не выпускай следующую.', greenWaveHintDispatcher:'Не синхронизируй узлы автоматически: повороты, пешеходы и спецтранспорт требуют локального приоритета.'
    },
    en: {
      level:'Level', goal:'Clear all traffic', restart:'Restart', hint:'Hint', switchLight:'Switch light', pauseAction:'Pause',
      jam:'Jam', switches:'Switches', tapSignal:'Tap the traffic light', paused:'Paused', pausedText:'Traffic is stopped.',
      continue:'Continue', complete:'Perfect flow!', completeText:'The intersection is clear.', next:'Next level', coins:'coins',
      rewardAdCoins:'Extra bonus', crash:'Collision!', crashText:'Do not open the crossing flow while the intersection is occupied.',
      trafficJam:'Traffic jam!', jamText:'The queue became too long.', tryAgain:'Try again', rescueCrashAd:'Continue unavailable', rescueJamAd:'Continue unavailable',
      hintHorizontal:'Open horizontal traffic.', hintVertical:'Open vertical traffic.', hintWait:'Wait until the cars leave the intersection.',
      adUnavailable:'Feature is unavailable now', demoReward:'Test reward granted', perfect:'Perfect!', good:'Good!', survived:'Cleared!',
      phaseH:'Horizontal', phaseV:'Vertical', phaseChanging:'Switching…', phasePedestrianClearing:'Pedestrians are clearing the crossing…', flow:'FLOW', hotFlow:'HOT FLOW', perfectSwitch:'PERFECT SWITCH', syncBonus:'Sync bonus', boardLabel:'Traffic intersection', controlsLabel:'Traffic controls', progressLabel:'Level progress', starsLabel:'Stars', statusLabel:'Level status', progressOverviewLabel:'Progress overview', personalBestLabel:'Personal best comparison', independentControlsLabel:'Independent intersection controls', eventRush:'RUSH HOUR', eventHeavy:'HEAVY', eventService:'SERVICE', eventExpress:'EXPRESS', eventFreight:'FREIGHT', eventPulse:'PULSE', eventAlternating:'PRESSURE SHIFT', eventRoadwork:'ROADWORK', junctionT:'T-JUNCTION', junctionDouble:'DOUBLE JUNCTION', priorityAlert:'EMERGENCY', priorityYield:'YIELD', priorityIncoming:'APPROACHING', priorityClear:'CLEAR JUNCTION', pedestrianWalk:'WALK', pedestrianStop:'WAIT', eventIntro:'Special traffic',
      soundOn:'🔊 Sound: on', soundOff:'🔇 Sound: off', musicLevel:'🎵 Music', effectsOn:'🔊 Effects: on', effectsOff:'🔇 Effects: off', language:'🌐 Language', languageAuto:'Auto', languageRussian:'Russian', languageEnglish:'English', leaderboard:'Leaderboard', leaderboardTitle:'World leaderboard', leaderboardDesc:'Stars determine rank. Missions break ties first, then medals.', leaderboardScore:'Your result', leaderboardYourRank:'Your rank', leaderboardSignIn:'Sign in to Yandex', leaderboardSignInDesc:'Sign in with Yandex to publish your score and see your place in the leaderboard.', leaderboardUnavailable:'The leaderboard is available only in the Yandex Games build.', leaderboardLoading:'Loading leaderboard…', leaderboardRetry:'Refresh', leaderboardNoEntries:'No scores yet.', leaderboardSetup:'The leaderboard has not been created in the Yandex Games Console yet.', leaderboardAnonymous:'Player', leaderboardYou:'You', developer:'About', developerTitle:'About', developerDesc:'', developerBuild:'Developer', developerPlatform:'Email', developerSave:'Game version', developerPublicBoard:'Main leaderboard', developerMasteryBoard:'Mastery leaderboard', developerSimulation:'Simulation', stats:'Stats', statsLevel:'Level', statsStars:'Stars', statsMissions:'Missions', statsAchievements:'Achievements', statsCars:'Cars', statsFlow:'Best FLOW', statsDaily:'Daily streak', statsWeekly:'Weekly clears', newCar:'New car is available in the garage!', newDistrict:'New district unlocked:', garage:'Garage', garageDesc:'The garage is cosmetic only. Your favorite car appears more often in normal traffic (~55%), but gets no speed or gameplay bonus.', garagePreview:'Preview', garageCollectionProgress:'Collection', garageTapPreview:'Tap a car to preview it', garageCanSelect:'Owned · ready to select', garageUnlockIn:'until unlock', garageCoinsShort:'until purchase', nextPurchase:'Next purchase', needCoins:'need', readyToBuy:'ready', owned:'Owned', buy:'Buy', selected:'Selected', select:'Select', collection:'Collection', favoriteCar:'Favorite car', locked:'Unlocks after level', notEnough:'Not enough coins', close:'Close', violatorAlert:'TRAFFIC VIOLATOR', violatorTip:'Some impatient drivers may finish crossing on yellow. Civilian traffic always stops on red.', tutorialLanes3:'Three lanes — watch the lane changes',
      tutorialGoal1:'Open the vertical flow', tutorialGoal2:'Switch when the next stream is already waiting', tutorialGoal3:'Watch both queues', tutorialGoal4:'Do not switch while the junction is occupied', tutorialGoal5:'Let a group clear before switching', tutorialCoachOpenWaiting:'Open the direction where cars are already waiting', tutorialCoachOccupied:'The junction is occupied — let the car clear first', tutorialCoachQueue:'The queue is growing — release the busier direction', tutorialCoachClearance:'The short pause between phases keeps the junction safe', tutorialCoachRhythm:'Good rhythm: clear a group, then switch', tutorialPedestrians:'Pedestrians cross only while cars have red', tutorialTurns:'Turning traffic is here — watch the path', tutorialYellow:'Some drivers may finish through yellow', tutorialLeftTurns:'Left turns need more open space', tutorialLanes:'Two lanes, one traffic light', rushGoal:'Rush hour: keep traffic flowing', heavyGoal:'Heavy traffic: more buses', serviceGoal:'Service wave: avoid a jam', expressGoal:'Express wave: keep the pace', freightGoal:'Freight hour: leave extra room', pulseGoal:'City pulse: catch the gaps between waves', alternatingGoal:'Pressure shift: react as the dominant direction changes', roadworkGoal:'Roadworks: keep one lane moving', incidentBrokenCar:'BROKEN VEHICLE', incidentRoadworks:'ROAD WORKS', incidentSlowZone:'SLOW ZONE', incidentWarning:'Road incident ahead', incidentActive:'Adapt the flow', incidentCleared:'Road is clear again', incidentBrokenGoal:'Broken vehicle: traffic is merging', incidentRoadworksGoal:'Road works: one lane is temporarily closed', incidentSlowGoal:'Slow zone: traffic is temporarily reduced',
      district1:'GREEN TOWN', district2:'COAST CITY', district3:'DOWNTOWN', district4:'AIRPORT', district5:'HARBOR', district6:'NIGHT CITY', district7:'OLD TOWN', district8:'TECH PARK', district9:'WINTER CITY', trait2:'More parking-lot merges', trait3:'Faster downtown traffic', trait4:'More emergency vehicles', trait5:'More trucks and buses', trait6:'Night-speed traffic',
      car1:'City Car', car2:'Taxi', car3:'Van', car4:'Sports Car', car5:'Police', car6:'Electric', car7:'Executive', car8:'Neon', car9:'Classic', car10:'Hypercar', rare:'RARE', weatherRain:'RAIN', weatherFog:'FOG', weatherSunset:'SUNSET', weatherSnow:'SNOW',
      dailyChallenge:'Daily Challenge', dailyDistrict:'DAILY CHALLENGE', dailyDesc:'The same traffic scenario for every player today.', dailyStart:'Start challenge', dailyReturn:'Campaign', dailyReplay:'Play again', dailyBest:'Best today', dailyFirstReward:'First-clear reward', dailyDone:'Today’s reward is already claimed', dailyLocked:'Daily Challenge unlocks after Level 3', dailyStreak:'Daily streak', dailyStreakBonus:'Streak bonus', challengePassport:'Challenge Passport', challengePassportDesc:'Small goals with no penalty for missing a day.', challengeToday:'Today', challengeWeek:'Week', challengeNextBonus:'Next bonus', challengeClaimed:'claimed', challengeReady:'ready', challengeDailyLadder:'Daily streak', weeklyStreak:'Weekly streak', weeklyStreakBonus:'Weekly streak bonus', weeklyNextBonus:'Next Weekly bonus', switchesShort:'Moves', queueShort:'Peak jam', starBonus:'Star bonus', flowBonus:'Flow bonus', priorityBonus:'Emergency priority', assistNext:'The next attempt will be a little easier.', assistGoal:'Assist active: extra jam capacity', insightTitle:'Next goals', insightCar:'Next car', insightStars:'To bonus', insightFlow:'Best flow', allCars:'All cars unlocked', newFlowRecord:'New flow record', mission:'MISSION', missionQueue:'Keep jam at or below', missionSwitch:'Use no more than', missionFlow:'Build a flow streak', missionDone:'Mission complete', missionReward:'Mission bonus', missionReplay:'Replay for mission', missionMastery:'Mission mastery', missionMilestone:'5-mission bonus', achievement:'Achievement', achPerfect:'Perfect Controller', achFlow:'Flow Master', achPriority:'Emergency Corridor', achRoadwork:'Roadwork Solver', achMissions:'Mission Hunter', weeklyChallenge:'Weekly Challenge', weeklyDistrict:'WEEKLY CHALLENGE', weeklyDesc:'A harder weekly board with two lanes, mixed traffic and a bigger reward.', weeklyStart:'Weekly challenge', weeklyReturn:'Campaign', weeklyReplay:'Play again', weeklyFirstReward:'Weekly reward', weeklyDone:'This week’s reward is already claimed', weeklyLocked:'Weekly Challenge unlocks after Level 11', endlessMode:'Endless Flow', endlessDistrict:'ENDLESS FLOW', endlessDesc:'Survive increasingly dense waves. One failure ends the run.', endlessStart:'Start endless run', endlessReturn:'Return to campaign', endlessReplay:'New run', endlessLocked:'Endless Flow unlocks after Level 19', endlessWave:'Wave', endlessScore:'Score', endlessBest:'Best', endlessNewBest:'New best!', scenarioMode:'Scenarios', scenarioDistrict:'SCENARIO', scenarioLocked:'Scenarios unlock after Level 20', scenarioAfterSchool:'After School', scenarioAfterSchoolDesc:'Clear the school street, pass three student waves, and keep the bus flow below the critical jam limit.', scenarioAfterSchoolGoal:'Pass every student wave and school bus', scenarioStart:'Start scenario', scenarioReplay:'Replay scenario', scenarioReturn:'Return to campaign', scenarioBest:'Best result', scenarioStageClear:'Clear the street', scenarioStagePed1:'First student group', scenarioStagePed2:'Second student group', scenarioStageFinal:'Remaining traffic', scenarioNextEvent:'Next event', scenarioPedWave:'pedestrian wave', scenarioTrafficWave:'traffic wave', scenarioComplete:'Scenario complete', scenarioNoCoins:'Separate scenario stars · no repeat coin reward', modesHub:'Modes', modesHubDesc:'Campaign, challenges and special scenarios in one place.', modeCampaign:'Campaign', modeCampaignDesc:'Regular levels and main progression.', modeLocked:'Locked', scenarioRule:'Special rule', scenarioProgressLabel:'Progress', scenarioPedestrians:'Pedestrian waves', scenarioEmergency:'Emergency vehicles', scenarioTraffic:'Traffic', scenarioAfterSchoolRule:'Three school waves and many buses. Pedestrians must fully cross during safe windows.', scenarioGreenCorridor:'Green Corridor', scenarioGreenCorridorDesc:'City emergency services arrive in waves and may cross red. Clear the junction before they reach it.', scenarioGreenCorridorGoal:'Do not delay emergency vehicles', scenarioGreenCorridorRule:'Ambulance, police and fire have priority and may cross red only through a clear conflict zone.', scenarioStadium:'After the Match', scenarioStadiumDesc:'The stadium releases crowds while dense vehicle waves hit the junction.', scenarioStadiumGoal:'Alternate pedestrian windows and traffic', scenarioStadiumRule:'Four large pedestrian waves. Keep the jam below the critical limit between them.', scenarioAirportPriority:'Airport Priority', scenarioAirportPriorityDesc:'Shuttles, buses and emergency services share a two-lane peak-hour junction.', scenarioAirportPriorityGoal:'Keep a corridor open for emergency services', scenarioAirportPriorityRule:'Two lanes, many buses, and at least four emergency vehicles should pass without a long delay.', scenarioRoadworks:'Roadworks Detour', scenarioRoadworksDesc:'One of two lanes is blocked by cones. Merge traffic into the working lane before the queue builds.', scenarioRoadworksGoal:'Move traffic through the open lane', scenarioRoadworksRule:'One lane is physically closed on every approach. Bad lane timing quickly creates a jam.', scenarioFreightPort:'Freight Shift', scenarioFreightPortDesc:'The port releases long trucks, buses and regular traffic into a three-lane junction.', scenarioFreightPortGoal:'Manage heavy traffic across three lanes', scenarioFreightPortRule:'Three lanes and many long trucks: they need more space and time to clear the junction.', scenarioStageSchoolOpen:'Clear the school street', scenarioStageSchoolRush:'Students are leaving', scenarioStageSchoolSecond:'Second school wave', scenarioStageSchoolFinal:'Last school bus', scenarioStageEmergencyPrep:'Clear the junction', scenarioStageEmergencyWave:'Emergency convoy', scenarioStageEmergencyFinal:'Final corridor', scenarioStageCrowdPrep:'Prepare the crossings', scenarioStageCrowdWave:'Stadium crowd', scenarioStageCrowdFinal:'Clear remaining traffic', scenarioStageAirportRush:'Peak arrivals', scenarioStageAirportService:'Service corridor', scenarioStageAirportFinal:'Last shuttles', scenarioStageRoadworksPrep:'Merge into the open lane', scenarioStageRoadworksRush:'Detour load rising', scenarioStageRoadworksFinal:'Final queue', scenarioStageFreightPrep:'First trucks', scenarioStageFreightRush:'Peak freight shift', scenarioStageFreightFinal:'Close the shift', failureReplay:'Failure replay', failureReplayPlaying:'Last seconds', failureReplayCrash:'Two streams entered the conflict zone at the same time.', failureReplayJam:'The queue exceeded the limit. Release the busier direction earlier.', failureReplayReturn:'Back to result', campaignMap:'Campaign Map', campaignMapDesc:'Replay cleared levels, improve stars, and finish missions.', campaignContinue:'Continue', campaignProgress:'District progress', campaignStars:'District stars', campaignNextReward:'Next rewards', campaignNextCar:'Next car', campaignMasteryBonus:'Mastery bonus', campaignMissionBonus:'Mission bonus', campaignNextDistrictGoal:'Next district', campaignLevelsToGo:'levels left', campaignStarsToGo:'★ left', campaignMissionsToGo:'missions left', campaignReady:'ready', campaignCurrent:'Current', campaignCompleted:'Cleared', campaignLocked:'Locked', campaignMissionDone:'Mission complete', campaignMissionOpen:'Mission available', campaignChapter:'District', campaignNextChapter:'Next district', campaignPrevChapter:'Previous district', campaignCycle:'cycle', campaignFirstClear:'First-clear reward', campaignReplayReward:'Replay reward', campaignBaseAlreadyPaid:'This level’s base reward is already claimed. Replays only pay for new stars, missions, and achievements.', campaignStarImprove:'Star improvement', campaignModes:'Modes & scenarios', greenWaveMode:'Green Wave', greenWaveDistrict:'GREEN WAVE', greenWaveDesc:'6 challenges · two linked junctions with independent control.', greenWaveLocked:'Unlocks at level 25 · 6 challenges with two linked junctions.', greenWaveChallengeLocked:'Clear the previous challenge first.', greenWaveChallenges:'Challenges', greenWaveChallengesDesc:'Six short tests of coordinating two independent junctions.', greenWaveCatch:'Catch the Wave', greenWaveCatchDesc:'Tutorial run: release a group from the left node and prepare the right node for its arrival.', greenWaveCatchGoal:'Carry through traffic across both junctions', greenWaveBoth:'Both Directions', greenWaveBothDesc:'Opposing arterial groups arrive at different times. Keep one wave from trapping the other.', greenWaveBothGoal:'Carry opposing waves across both junctions', greenWaveSide:'Side Streets', greenWaveSideDesc:'The arterial still matters, but both side streets build queues quickly.', greenWaveSideGoal:'Preserve the wave while regularly serving side streets', greenWavePed:'Pedestrian Hour', greenWavePedDesc:'Local pedestrian requests appear at one junction. Clear the crossing without breaking the whole corridor.', greenWavePedGoal:'Carry traffic and safely serve pedestrians', greenWaveLong:'Long Vehicles', greenWaveLongDesc:'Buses and trucks consume more connector space. Do not release a new group into a full segment.', greenWaveLongGoal:'Carry long vehicles without blocking the connector', greenWaveDispatcher:'Dispatcher Duty', greenWaveDispatcherDesc:'Turns, pedestrians, and announced emergency traffic require local decisions at each node.', greenWaveDispatcherGoal:'Coordinate every movement and preserve the emergency corridor', greenWaveStart:'Start', greenWaveNext:'Next challenge', greenWaveReplay:'Replay', greenWaveReturn:'Return to campaign', greenWaveNoCoins:'Separate mode stars · no coins', greenWaveLeft:'Left', greenWaveRight:'Right', greenWaveChoose:'Use the separate Left and Right controls.', greenWaveBlocked:'EXIT BLOCKED', greenWaveThrough:'No-stop through', greenWaveSideQueue:'Side queue', greenWavePriority:'Emergency without delay', greenWavePedIncoming:'Pedestrians are waiting for a safe window', greenWaveEmergencyIncoming:'Warning: emergency traffic is approaching', greenWaveHint:'Release the group on the left, then open the arterial on the right before it arrives.', greenWaveHintBoth:'Watch both opposing waves: keep both nodes on the arterial only while a group actually needs the corridor.', greenWaveHintSide:'Open vertical briefly where the queue grows, then return that node to the arterial.', greenWaveHintPed:'A pedestrian request can start only while its road is red. The other junction can keep moving independently.', greenWaveHintLong:'Leave extra connector space for long vehicles; do not release another one into a full segment.', greenWaveHintDispatcher:'Do not synchronize blindly: turns, pedestrians, and emergency traffic need local priority.'
    }
  };

  Object.assign(TEXT.ru,{medals:'Медали',medalQueue:'Чистая очередь',medalSwitch:'Точный диспетчер',medalFlow:'Идеальный поток',medalPriority:'Приоритет спасения',medalIncident:'Контроль происшествия',medalNew:'Новая медаль',campaignMedals:'Медали района'});
  Object.assign(TEXT.en,{medals:'Medals',medalQueue:'Queue Control',medalSwitch:'Signal Discipline',medalFlow:'Perfect Flow',medalPriority:'Emergency Priority',medalIncident:'Incident Control',medalNew:'New medal',campaignMedals:'District medals'});
  Object.assign(TEXT.ru,{vkBillingPack:'500 монет',vkBillingPrice:'99 ₽ · VK Play',vkBillingBuy:'Купить',vkBillingOpening:'Открываем…',vkBillingPending:'Оплата открыта · после оплаты вернись в игру',vkBillingUnavailable:'Покупки доступны только внутри VK Play',vkBillingError:'Не удалось открыть оплату',vkBillingPopup:'Разреши открытие платёжного окна',vkBillingReceived:'Покупка подтверждена',vkBillingStore:'Магазин VK Play',vkBillingHistory:'Последние покупки',vkBillingPaidWallet:'Покупные монеты',vkBillingSpendPending:'Покупка подтверждается сервером…',vkBillingSpendError:'Не удалось подтвердить расход покупных монет',vkBillingRestore:'Покупки восстановлены',vkBillingSupporter:'Supporter Pack',vkBillingSupporterDesc:'Тема Gold Pulse + 800 монет + золотая машина',vkBillingSupporterOwned:'Gold Pulse активна · золотая машина и значок Supporter разблокированы',vkBillingSecure:'Цены и начисления проверяются сервером'});
  Object.assign(TEXT.en,{vkBillingPack:'500 coins',vkBillingPrice:'99 ₽ · VK Play',vkBillingBuy:'Buy',vkBillingOpening:'Opening…',vkBillingPending:'Payment opened · return to the game after paying',vkBillingUnavailable:'Purchases are available only inside VK Play',vkBillingError:'Could not open payment',vkBillingPopup:'Allow the payment window to open',vkBillingReceived:'Purchase confirmed',vkBillingStore:'VK Play Store',vkBillingHistory:'Recent purchases',vkBillingPaidWallet:'Purchased coins',vkBillingSpendPending:'Confirming purchase with the server…',vkBillingSpendError:'Could not confirm purchased-coin spend',vkBillingRestore:'Purchases restored',vkBillingSupporter:'Supporter Pack',vkBillingSupporterDesc:'Gold Pulse theme + 800 coins + exclusive gold car',vkBillingSupporterOwned:'Gold Pulse active · gold car and Supporter badge unlocked',vkBillingSecure:'Prices and grants are verified by the server'});


  const SAVE_KEY = 'traffic_pulse_save_v4';
  const SAVE_SCHEMA_VERSION = 5;
  const SAVE_BACKUP_KEY = 'traffic_pulse_save_v4_backup_m102';
  const OLD_SAVE_KEYS = ['traffic_pulse_save_v3','traffic_pulse_save_v2','traffic_pulse_save_v1'];
  const CLOUD_SAVE_KEY = 'trafficPulseSave';
  const defaultSave = { level:1, coins:0, totalStars:0, starsByLevel:{}, sound:true, sfx:true, musicLevel:3, langMode:'auto', ownedCars:[0], favoriteCar:0, sessions:0, dailyBest:{}, dailyBestCompat:{}, dailyRewards:{}, starMilestonesClaimed:0, bestFlow:0, missionCompleted:{}, medalsByLevel:{}, achievements:{}, weeklyBest:{}, weeklyBestCompat:{}, weeklyRewards:{}, endlessBestScore:0, endlessBestWave:0, scenarioProgress:{}, campaignRewardedThrough:0, updatedAt:0 };
  const DAILY_HISTORY_LIMIT=180, MAX_PARTICLES=96;
  const CHALLENGE_RULE_VERSION=1, CHALLENGE_TRACE_KEY='traffic_pulse_challenge_traces_v1', CHALLENGE_TRACE_BYTES=256*1024, CHALLENGE_TRACE_MAX_POINTS=300, DAILY_TRACE_LIMIT=14, WEEKLY_TRACE_LIMIT=8;
  const ACHIEVEMENT_KEYS=['perfect','flow','priority','roadwork','missions'];
  let cloudSaveHook=null;
  let save;
  let platformLang = /^ru(?:[_-]|$)/i.test(String(navigator.language||''))?'ru':'en';
  let lang = 'ru';

  Object.assign(TEXT.ru,{cityGrowth:'Развитие города',cityGrowthStage:'Стадия района',cityGrowthSeed:'Основа',cityGrowthGrowing:'Рост',cityGrowthActive:'Живой район',cityGrowthLandmark:'Новый силуэт',cityGrowthComplete:'Район сформирован',cityIdentity:'Характер района',cityLife:'Городская жизнь',cityGrowthWin:'Город развивается',cityGrowthNext:'До следующей стадии',cityGrowthLevels:'ур.',cityProfilePark:'Парки и семейные улицы',cityProfileCoast:'Набережная и курортный поток',cityProfileDowntown:'Высотки и деловой центр',cityProfileAirport:'Терминалы и служебные кварталы',cityProfileHarbor:'Порт, склады и грузовая смена',cityProfileNight:'Неон и вечерняя экономика',cityProfileOldtown:'Исторические кварталы и площади',cityProfileTech:'Технопарк и электромобили',cityProfileWinter:'Зимние улицы и тёплые витрины',cityLifePark:'Кафе · фонтаны · прогулки',cityLifeCoast:'Променад · киоски · туристы',cityLifeDowntown:'Такси · офисы · витрины',cityLifeAirport:'Шаттлы · маяки · сервис',cityLifeHarbor:'Контейнеры · краны · фуры',cityLifeNight:'Неон · ночные кафе · такси',cityLifeOldtown:'Часы · рынок · террасы',cityLifeTech:'Зарядки · LED · рободоставка',cityLifeWinter:'Снег · фонари · зимний рынок'});
  Object.assign(TEXT.en,{cityGrowth:'City Growth',cityGrowthStage:'District stage',cityGrowthSeed:'Foundation',cityGrowthGrowing:'Growing',cityGrowthActive:'Living district',cityGrowthLandmark:'New skyline',cityGrowthComplete:'District established',cityIdentity:'District identity',cityLife:'City life',cityGrowthWin:'The city is growing',cityGrowthNext:'Until next stage',cityGrowthLevels:'lv.',cityProfilePark:'Parks and family streets',cityProfileCoast:'Waterfront and resort traffic',cityProfileDowntown:'High-rises and business core',cityProfileAirport:'Terminals and service blocks',cityProfileHarbor:'Port, warehouses and freight shifts',cityProfileNight:'Neon and evening economy',cityProfileOldtown:'Historic blocks and plazas',cityProfileTech:'Tech park and electric mobility',cityProfileWinter:'Winter streets and warm storefronts',cityLifePark:'Cafés · fountains · walks',cityLifeCoast:'Promenade · kiosks · visitors',cityLifeDowntown:'Taxis · offices · storefronts',cityLifeAirport:'Shuttles · beacons · service',cityLifeHarbor:'Containers · cranes · trucks',cityLifeNight:'Neon · late cafés · taxis',cityLifeOldtown:'Clock · market · terraces',cityLifeTech:'Chargers · LED · robo-delivery',cityLifeWinter:'Snow · lamps · winter market'});


  Object.assign(TEXT.ru,{roundaboutTrial:'Кольцевой перекрёсток',roundaboutTrialDesc:'Экспериментальный уровень: машины входят на кольцо и расходятся по разным съездам. Управление остаётся прежним — переключай горизонтальную и вертикальную подачу.',roundaboutTrialGoal:'Пропусти весь поток через кольцо без аварии и критической пробки',roundaboutTrialRule:'Светофоры дозируют въезд. Машина, уже вошедшая на кольцо, имеет приоритет; дождись освобождения кольца перед новой подачей.',roundaboutWarmup:'Разогрев кольца',roundaboutMixed:'Смешанные съезды',roundaboutFinal:'Финальный поток',roundaboutExperimental:'Эксперимент',roundaboutYield:'Кольцо занято',roundaboutMetering:'Дозирование въезда'});
  Object.assign(TEXT.en,{roundaboutTrial:'Roundabout Trial',roundaboutTrialDesc:'Experimental level: cars enter a roundabout and leave through different exits. The core control stays the same — switch horizontal and vertical entry flow.',roundaboutTrialGoal:'Move all traffic through the roundabout without a crash or critical jam',roundaboutTrialRule:'Signals meter entry. A vehicle already on the roundabout has priority; wait until the circle is clear before releasing another approach.',roundaboutWarmup:'Roundabout warm-up',roundaboutMixed:'Mixed exits',roundaboutFinal:'Final flow',roundaboutExperimental:'Experimental',roundaboutYield:'Roundabout occupied',roundaboutMetering:'Entry metering'});

  let T = TEXT.ru;

  function safeInt(value,min,max,fallback=min){ const n=Number(value); return Number.isFinite(n)?Math.max(min,Math.min(max,Math.floor(n))):fallback; }
  function leaderboardBreakdown(data=save){
    const stars=Math.max(0,safeInt(data?.totalStars,0,999999,0));
    const missions=Math.min(LEADERBOARD_TIE_MAX,Object.values(data?.missionCompleted||{}).filter(Boolean).length);
    let medals=0;for(const raw of Object.values(data?.medalsByLevel||{})){const mask=(Number(raw)||0)&7;medals+=(mask&1?1:0)+(mask&2?1:0)+(mask&4?1:0);}
    medals=Math.min(LEADERBOARD_TIE_MAX,medals);
    return{stars,missions,medals};
  }
  function encodeLeaderboardScore(data=save){const b=leaderboardBreakdown(data);return b.stars*LEADERBOARD_STAR_FACTOR+b.missions*LEADERBOARD_MISSION_FACTOR+b.medals;}
  function decodeLeaderboardScore(raw){
    const score=Math.max(0,Math.floor(Number(raw)||0));
    // M166 stored raw stars. Preserve readable legacy rows while users migrate naturally.
    if(score<LEADERBOARD_STAR_FACTOR)return{stars:score,missions:0,medals:0,legacy:true,score};
    const stars=Math.floor(score/LEADERBOARD_STAR_FACTOR),tie=score%LEADERBOARD_STAR_FACTOR,missions=Math.floor(tie/LEADERBOARD_MISSION_FACTOR),medals=tie%LEADERBOARD_MISSION_FACTOR;
    return{stars,missions,medals,legacy:false,score};
  }
  function leaderboardBreakdownText(b){return `⭐ ${b.stars} · 🎯 ${b.missions} · 🏅 ${b.medals}`;}
  function normalizeLanguageMode(value){return ['auto','ru','en'].includes(value)?value:'auto';}
  function validDayKey(key){ if(!/^\d{4}-\d{2}-\d{2}$/.test(key))return false; const t=Date.parse(`${key}T00:00:00Z`); return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===key; }
  function boundedDailyMap(value){
    const src=value&&typeof value==='object'?value:{}; const keys=Object.keys(src).filter(validDayKey).sort();
    const keep=keys.slice(-DAILY_HISTORY_LIMIT),out={}; for(const k of keep)out[k]=src[k]; return out;
  }
  function normalizeStarsMap(value,maxLevel=1_000_000){
    const src=value&&typeof value==='object'?value:{},out={};
    for(const [k,v] of Object.entries(src)){const level=Number(k),stars=Number(v);if(Number.isInteger(level)&&level>=1&&level<=maxLevel&&Number.isFinite(stars)&&stars>0)out[String(level)]=Math.min(3,Math.floor(stars));}
    return out;
  }
  function normalizeMissionMap(value,maxLevel=1_000_000){
    const src=value&&typeof value==='object'?value:{},out={};
    for(const [k,v] of Object.entries(src)){const level=Number(k);if(Number.isInteger(level)&&level>=1&&level<=maxLevel&&(v===true||v===1))out[String(level)]=true;}
    return out;
  }
  function normalizeMedalMap(value,maxLevel=1_000_000){
    const src=value&&typeof value==='object'?value:{},out={};
    for(const [k,v] of Object.entries(src)){const level=Number(k),mask=Number(v);if(Number.isInteger(level)&&level>=1&&level<=maxLevel&&Number.isFinite(mask)){const safe=Math.max(0,Math.min(7,Math.floor(mask)));if(safe)out[String(level)]=safe;}}
    return out;
  }
  function medalCount(mask){let n=Number(mask)||0,c=0;for(let bit=0;bit<3;bit++)if(n&(1<<bit))c++;return c;}
  function normalizeAchievements(value){const src=value&&typeof value==='object'?value:{},out={};for(const k of ACHIEVEMENT_KEYS)if(src[k]===true||src[k]===1)out[k]=true;return out;}
  function cleanToken(value,max=128){return typeof value==='string'?value.replace(/[^a-zA-Z0-9:_@.\-]/g,'').slice(0,max):'';}
  function normalizeBestRecord(v){
    if(!v||typeof v!=='object')return null;
    const out={stars:safeInt(v.stars,1,3,1),switches:safeInt(v.switches,0,9999,9999),maxQueue:safeInt(v.maxQueue,0,999,999)};
    const runId=cleanToken(v.runId,96),compat=cleanToken(v.compat,160);if(runId)out.runId=runId;if(compat)out.compat=compat;
    if(v.rules!=null)out.rules=safeInt(v.rules,0,999,0);if(v.configHash!=null)out.configHash=cleanToken(String(v.configHash),24);
    if(v.rescued===true)out.rescued=true;if(v.assisted===true)out.assisted=true;if(v.finishedAt!=null)out.finishedAt=safeInt(v.finishedAt,0,9_000_000_000_000_000,0);
    return out;
  }
  function normalizeDailyBest(value){
    const src=boundedDailyMap(value),out={};
    for(const [k,v] of Object.entries(src)){const record=normalizeBestRecord(v);if(record)out[k]=record;}
    return out;
  }
  function normalizeChallengeCompatMap(value){
    const src=boundedDailyMap(value),out={};
    for(const [dateKey,categories] of Object.entries(src)){
      if(!categories||typeof categories!=='object')continue;const inner={};let count=0;
      for(const [compat,v] of Object.entries(categories)){
        const key=cleanToken(compat,160),record=normalizeBestRecord(v);if(!key||!record)continue;inner[key]=record;if(++count>=8)break;
      }
      if(Object.keys(inner).length)out[dateKey]=inner;
    }
    return out;
  }
  function normalizeDailyRewards(value){ const src=boundedDailyMap(value),out={}; for(const [k,v] of Object.entries(src))if(v===true||v===1)out[k]=true; return out; }
  const SCENARIO_SAVE_KEYS=new Set(['after_school@1','after_school@2','green_corridor@1','stadium_exit@1','airport_priority@1','roadworks_detour@1','freight_port@1','roundabout_trial@1']);
  function normalizeScenarioProgress(value){
    const src=value&&typeof value==='object'?value:{},out={};
    for(const [k,v] of Object.entries(src)){if(!SCENARIO_SAVE_KEYS.has(k)||!v||typeof v!=='object')continue;out[k]={stars:safeInt(v.stars,0,3,0),bestQueue:safeInt(v.bestQueue,0,999,999),bestSwitches:safeInt(v.bestSwitches,0,9999,9999),bestPriority:safeInt(v.bestPriority,0,999,0),clears:safeInt(v.clears,0,1_000_000,0)};}
    return out;
  }
  function betterScenario(a,b){if(!a)return b;if(!b)return a;if((b.stars||0)!==(a.stars||0))return (b.stars||0)>(a.stars||0)?b:a;if((b.bestPriority||0)!==(a.bestPriority||0))return (b.bestPriority||0)>(a.bestPriority||0)?b:a;if((b.bestSwitches??9999)!==(a.bestSwitches??9999))return (b.bestSwitches??9999)<(a.bestSwitches??9999)?b:a;return (b.bestQueue??999)<(a.bestQueue??999)?b:a;}
  const GREEN_WAVE_SAVE_KEYS=new Set(['catch_wave@1','both_sides@1','side_streets@1','pedestrian_hour@1','long_transport@1','dispatcher_duty@1']);
  function normalizeGreenWaveProgress(value){
    const src=value&&typeof value==='object'?value:{},out={};
    for(const [k,v] of Object.entries(src)){if(!GREEN_WAVE_SAVE_KEYS.has(k)||!v||typeof v!=='object')continue;out[k]={stars:safeInt(v.stars,0,3,0),throughNoStop:safeInt(v.throughNoStop,0,999,0),throughTotal:safeInt(v.throughTotal,0,999,0),bestSideQueue:safeInt(v.bestSideQueue,0,999,999),bestSwitches:safeInt(v.bestSwitches,0,9999,9999),bestPriority:safeInt(v.bestPriority,0,999,0),clears:safeInt(v.clears,0,1_000_000,0)};}
    return out;
  }
  function betterGreenWave(a,b){if(!a)return b;if(!b)return a;if((b.stars||0)!==(a.stars||0))return (b.stars||0)>(a.stars||0)?b:a;const ar=(a.throughNoStop||0)/Math.max(1,a.throughTotal||0),br=(b.throughNoStop||0)/Math.max(1,b.throughTotal||0);if(br!==ar)return br>ar?b:a;if((b.bestPriority||0)!==(a.bestPriority||0))return (b.bestPriority||0)>(a.bestPriority||0)?b:a;if((b.bestSideQueue??999)!==(a.bestSideQueue??999))return (b.bestSideQueue??999)<(a.bestSideQueue??999)?b:a;return (b.bestSwitches??9999)<(a.bestSwitches??9999)?b:a;}
  function dayOffsetKey(dayKey,days){
    const d=new Date(`${dayKey}T00:00:00Z`); if(!Number.isFinite(d.getTime()))return dayKey; d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10);
  }
  function dailyStreakEnding(dayKey,rewards){
    const map=rewards||save?.dailyRewards||{}; let count=0,key=dayKey;
    while(count<DAILY_HISTORY_LIMIT&&map[key]){count++;key=dayOffsetKey(key,-1);} return count;
  }
  function dailyStreakIfCleared(dayKey){ return save.dailyRewards[dayKey]?dailyStreakEnding(dayKey,save.dailyRewards):1+dailyStreakEnding(dayOffsetKey(dayKey,-1),save.dailyRewards); }
  function weekOffsetKey(weekKey,weeks){ return dayOffsetKey(weekKey,weeks*7); }
  function weeklyStreakEnding(weekKey,rewards){
    const map=rewards||save?.weeklyRewards||{};let count=0,key=weekKey;
    while(count<64&&map[key]){count++;key=weekOffsetKey(key,-1);}return count;
  }
  function weeklyStreakIfCleared(weekKey){ return save.weeklyRewards[weekKey]?weeklyStreakEnding(weekKey,save.weeklyRewards):1+weeklyStreakEnding(weekOffsetKey(weekKey,-1),save.weeklyRewards); }
  function weeklyStreakBonusFor(streak){ return Math.min(3,Math.max(0,safeInt(streak,1,64,1)-1))*40; }
  function weeklyFirstClearReward(stars,weekKey=weekStartKey()){ const streak=weeklyStreakIfCleared(weekKey);return {streak,streakBonus:weeklyStreakBonusFor(streak),reward:420+safeInt(stars,1,3,1)*80+weeklyStreakBonusFor(streak)}; }
  function challengeRetentionSummary(dayKey=todayDailyKey(),weekKey=weekStartKey()){
    const dailyClaimed=Boolean(save.dailyRewards?.[dayKey]),dailyCurrent=dailyClaimed?dailyStreakEnding(dayKey,save.dailyRewards):dailyStreakEnding(dayOffsetKey(dayKey,-1),save.dailyRewards),dailyProspective=dailyCurrent+1;
    const dailyBonus=Math.min(6,Math.max(0,dailyProspective-1))*15;
    const weeklyClaimed=Boolean(save.weeklyRewards?.[weekKey]),weeklyCurrent=weeklyClaimed?weeklyStreakEnding(weekKey,save.weeklyRewards):weeklyStreakEnding(weekOffsetKey(weekKey,-1),save.weeklyRewards),weeklyProspective=weeklyCurrent+1,weeklyBonus=weeklyStreakBonusFor(weeklyProspective);
    return {dayKey,weekKey,dailyClaimed,dailyCurrent,dailyProspective,dailyBonus,weeklyClaimed,weeklyCurrent,weeklyProspective,weeklyBonus};
  }
  function appendRetentionLadder(parent,summary=challengeRetentionSummary()){
    const wrap=document.createElement('section');wrap.className='challenge-passport';wrap.setAttribute('aria-label',T.challengePassport);
    const head=document.createElement('div');head.className='challenge-passport-head';const title=document.createElement('strong');title.textContent=`🎫 ${T.challengePassport}`;const desc=document.createElement('small');desc.textContent=T.challengePassportDesc;head.append(title,desc);wrap.appendChild(head);
    const daily=document.createElement('div');daily.className='challenge-retention-row';const dcopy=document.createElement('div');dcopy.innerHTML=`<small>${T.challengeToday}</small><strong>🔥 ${T.challengeDailyLadder}: ${summary.dailyCurrent} → ${summary.dailyProspective}</strong>`;const dots=document.createElement('div');dots.className='streak-ladder';dots.setAttribute('role','progressbar');dots.setAttribute('aria-valuemin','0');dots.setAttribute('aria-valuemax','7');dots.setAttribute('aria-valuenow',String(Math.min(7,summary.dailyProspective)));for(let i=1;i<=7;i++){const dot=document.createElement('span');dot.textContent=String(i);if(i<=Math.min(7,summary.dailyCurrent))dot.classList.add('done');if(i===Math.min(7,summary.dailyProspective))dot.classList.add('next');dots.appendChild(dot);}daily.append(dcopy,dots);wrap.appendChild(daily);
    const week=document.createElement('div');week.className='challenge-retention-row weekly';const wcopy=document.createElement('div');const status=summary.weeklyClaimed?T.challengeClaimed:T.challengeReady;wcopy.innerHTML=`<small>${T.challengeWeek}</small><strong>📆 ${T.weeklyStreak}: ${summary.weeklyCurrent} → ${summary.weeklyProspective} · ${status}</strong>`;const bonus=document.createElement('b');bonus.className='challenge-bonus';bonus.textContent=`${T.challengeNextBonus}: +${summary.weeklyBonus} ${T.coins}`;week.append(wcopy,bonus);wrap.appendChild(week);parent.appendChild(wrap);return wrap;
  }

  function normalizeVkEntitlements(value){
    const src=value&&typeof value==='object'?value:{},out={};
    for(const [k,v] of Object.entries(src)){if(!/^[A-Za-z0-9._:-]{1,64}$/.test(k))continue;const qty=safeInt(v,0,999,0);if(qty>0)out[k]=qty;}
    return out;
  }
  function normalizeVkPendingSpend(value){
    if(!value||typeof value!=='object')return null;
    const requestId=String(value.requestId||''),context=String(value.context||''),carId=safeInt(value.carId,0,9,-1),cost=safeInt(value.cost,0,100000,0),localPart=safeInt(value.localPart,0,100000,0),serverPart=safeInt(value.serverPart,0,100000,0),createdAt=safeInt(value.createdAt,0,9_000_000_000_000_000,0);
    if(!/^[A-Za-z0-9._:-]{12,128}$/.test(requestId)||!/^garage_car:[0-9]+$/.test(context)||carId<0||cost<=0||localPart+serverPart!==cost)return null;
    return {requestId,context,carId,cost,localPart,serverPart,createdAt};
  }

  function normalizeSaveData(data={}){
    if(!data||typeof data!=='object')data={};
    const level=safeInt(data.level,1,1_000_000,1),legacyCount=safeInt(data.unlockedCars,1,10,1);
    const migratedOwned=Array.isArray(data.ownedCars)?data.ownedCars.map(Number).filter(v=>Number.isInteger(v)&&v>=0&&v<10):Array.from({length:legacyCount},(_,i)=>i);
    const ownedCars=[...new Set([0,...migratedOwned])].sort((a,b)=>a-b);
    const purchasedCars=Array.isArray(data.purchasedCars)?[...new Set(data.purchasedCars.map(Number).filter(v=>Number.isInteger(v)&&v>0&&v<10&&ownedCars.includes(v)))].sort((a,b)=>a-b):[];
    const starsByLevel=normalizeStarsMap(data.starsByLevel,level),starsSum=Object.values(starsByLevel).reduce((n,v)=>n+v,0);
    const reportedStars=Math.min(safeInt(data.totalStars,0,3_000_000,0),level*3),totalStars=Math.max(starsSum,reportedStars);
    const maxClaimed=Math.floor(totalStars/15),claimedRaw=Number(data.starMilestonesClaimed),claimed=Number.isFinite(claimedRaw)?Math.min(safeInt(claimedRaw,0,200_000,0),maxClaimed):maxClaimed;
    return {
      schemaVersion:SAVE_SCHEMA_VERSION, level, coins:safeInt(data.coins,0,1_000_000_000_000,0), vkPaidCoinsCredited:safeInt(data.vkPaidCoinsCredited,0,1_000_000_000_000,0), vkEntitlements:normalizeVkEntitlements(data.vkEntitlements), vkPendingSpend:normalizeVkPendingSpend(data.vkPendingSpend), totalStars, starsByLevel,
      sound:data.sound!==false, sfx:data.sfx===undefined?data.sound!==false:data.sfx!==false, musicLevel:data.musicLevel===undefined?(data.sound===false?0:3):safeInt(data.musicLevel,0,3,3), langMode:normalizeLanguageMode(data.langMode), ownedCars, purchasedCars, favoriteCar:ownedCars.includes(safeInt(data.favoriteCar,0,9,0))?safeInt(data.favoriteCar,0,9,0):0, sessions:safeInt(data.sessions,0,1_000_000_000,0),
      dailyBest:normalizeDailyBest(data.dailyBest), dailyBestCompat:normalizeChallengeCompatMap(data.dailyBestCompat), dailyRewards:normalizeDailyRewards(data.dailyRewards),
      starMilestonesClaimed:claimed, bestFlow:safeInt(data.bestFlow,0,9999,0), missionCompleted:normalizeMissionMap(data.missionCompleted,level), medalsByLevel:normalizeMedalMap(data.medalsByLevel,level), achievements:normalizeAchievements(data.achievements), weeklyBest:normalizeDailyBest(data.weeklyBest), weeklyBestCompat:normalizeChallengeCompatMap(data.weeklyBestCompat), weeklyRewards:normalizeDailyRewards(data.weeklyRewards), endlessBestScore:safeInt(data.endlessBestScore,0,1_000_000_000,0), endlessBestWave:safeInt(data.endlessBestWave,0,1_000_000,0), scenarioProgress:normalizeScenarioProgress(data.scenarioProgress), greenWaveProgress:normalizeGreenWaveProgress(data.greenWaveProgress), campaignRewardedThrough:(()=>{const raw=Number(data.campaignRewardedThrough);if(Number.isFinite(raw))return safeInt(raw,0,level,0);const currentPaid=Number(starsByLevel[String(level)]||0)>0?level:Math.max(0,level-1);return currentPaid;})(), revision:safeInt(data.revision,0,9_000_000_000_000_000,0), updatedAt:safeInt(data.updatedAt,0,9_000_000_000_000_000,0)
    };
  }
  function backupSaveRaw(raw){
    if(!raw||raw==='{}')return false;
    try { if(!localStorage.getItem(SAVE_BACKUP_KEY)){localStorage.setItem(SAVE_BACKUP_KEY,String(raw));return true;} } catch (_) {}
    return false;
  }
  function loadSave(){
    let raw='{}';
    try {
      const currentRaw=localStorage.getItem(SAVE_KEY);
      const legacyRaw=!currentRaw?OLD_SAVE_KEYS.map(k=>localStorage.getItem(k)).find(Boolean):null;
      raw=currentRaw||legacyRaw||'{}';
      let parsed;
      try { parsed=JSON.parse(raw); } catch (_) { backupSaveRaw(raw); return normalizeSaveData({}); }
      const sourceSchema=safeInt(parsed?.schemaVersion,0,1_000_000,0);
      if(raw!=='{}'&&sourceSchema<SAVE_SCHEMA_VERSION)backupSaveRaw(raw);
      return normalizeSaveData(parsed);
    } catch (_) { backupSaveRaw(raw); return normalizeSaveData({}); }
  }
  function betterDaily(a,b){
    if(!a)return b;if(!b)return a;if((b.stars||0)!==(a.stars||0))return (b.stars||0)>(a.stars||0)?b:a;
    if((b.switches??9999)!==(a.switches??9999))return (b.switches??9999)<(a.switches??9999)?b:a;
    return (b.maxQueue??9999)<(a.maxQueue??9999)?b:a;
  }
  function mergeProgress(localData,cloudData){
    const a=normalizeSaveData(localData||{}),b=normalizeSaveData(cloudData||{}),stars={...a.starsByLevel};
    for(const [k,v] of Object.entries(b.starsByLevel||{}))stars[k]=Math.max(Number(stars[k]||0),Number(v||0));
    const dailyBest={...a.dailyBest};for(const [k,v] of Object.entries(b.dailyBest||{}))dailyBest[k]=betterDaily(dailyBest[k],v);
    const dailyBestCompat={...a.dailyBestCompat};for(const [dateKey,cats] of Object.entries(b.dailyBestCompat||{})){const inner={...(dailyBestCompat[dateKey]||{})};for(const [compat,v] of Object.entries(cats||{}))inner[compat]=betterDaily(inner[compat],v);dailyBestCompat[dateKey]=inner;}
    const dailyRewards={...a.dailyRewards};for(const [k,v] of Object.entries(b.dailyRewards||{}))if(v)dailyRewards[k]=true;
    const ownedCars=[...new Set([...a.ownedCars,...b.ownedCars,0])].sort((x,y)=>x-y);
    const purchasedCars=[...new Set([...(a.purchasedCars||[]),...(b.purchasedCars||[])])].sort((x,y)=>x-y);
    const missionCompleted={...a.missionCompleted};for(const [k,v] of Object.entries(b.missionCompleted||{}))if(v)missionCompleted[k]=true;
    const medalsByLevel={...a.medalsByLevel};for(const [k,v] of Object.entries(b.medalsByLevel||{})){const mask=((Number(medalsByLevel[k])||0)|(Number(v)||0))&7;if(mask)medalsByLevel[k]=mask;}
    const achievements={...a.achievements};for(const [k,v] of Object.entries(b.achievements||{}))if(v)achievements[k]=true;
    const weeklyBest={...a.weeklyBest};for(const [k,v] of Object.entries(b.weeklyBest||{}))weeklyBest[k]=betterDaily(weeklyBest[k],v);
    const weeklyBestCompat={...a.weeklyBestCompat};for(const [dateKey,cats] of Object.entries(b.weeklyBestCompat||{})){const inner={...(weeklyBestCompat[dateKey]||{})};for(const [compat,v] of Object.entries(cats||{}))inner[compat]=betterDaily(inner[compat],v);weeklyBestCompat[dateKey]=inner;}
    const weeklyRewards={...a.weeklyRewards};for(const [k,v] of Object.entries(b.weeklyRewards||{}))if(v)weeklyRewards[k]=true;
    const scenarioProgress={...a.scenarioProgress};for(const [k,v] of Object.entries(b.scenarioProgress||{})){const best=betterScenario(scenarioProgress[k],v);scenarioProgress[k]={...best,clears:Math.max(safeInt(a.scenarioProgress?.[k]?.clears,0,1_000_000,0),safeInt(b.scenarioProgress?.[k]?.clears,0,1_000_000,0))};}
    const greenWaveProgress={...a.greenWaveProgress};for(const [k,v] of Object.entries(b.greenWaveProgress||{})){const best=betterGreenWave(greenWaveProgress[k],v);greenWaveProgress[k]={...best,clears:Math.max(safeInt(a.greenWaveProgress?.[k]?.clears,0,1_000_000,0),safeInt(b.greenWaveProgress?.[k]?.clears,0,1_000_000,0))};}
    const totalStars=Math.max(Number(a.totalStars||0),Number(b.totalStars||0),Object.values(stars).reduce((n,v)=>n+Number(v||0),0));
    // A revision is a per-branch write counter, not a globally causal clock. Keep the conservative
    // revision-first policy for spendable currency, but use cross-device epoch timestamps for
    // user preferences. M132+ persists Yandex serverTime when the SDK is available; older saves
    // still carry epoch-millisecond Date.now values, so timestamps remain comparable enough for
    // non-economic settings. Exact timestamp ties fall back to revision, then local state.
    const balanceNewerIsCloud=(b.revision||0)!==(a.revision||0)?(b.revision||0)>(a.revision||0):(b.updatedAt||0)>(a.updatedAt||0),balanceNewer=balanceNewerIsCloud?b:a,balanceOlder=balanceNewerIsCloud?a:b;
    const preferenceNewerIsCloud=(b.updatedAt||0)!==(a.updatedAt||0)?(b.updatedAt||0)>(a.updatedAt||0):(b.revision||0)>(a.revision||0),preferenceNewer=preferenceNewerIsCloud?b:a;
    const favoriteCar=preferenceNewer.favoriteCar;
    // Currency is spendable, so max(local,cloud) is unsafe: an older pre-purchase snapshot can resurrect spent coins.
    // Use the conservative balance branch, then charge any purchase receipt imported only from the other branch exactly once.
    const newerPurchases=new Set(balanceNewer.purchasedCars||[]);let coins=balanceNewer.coins;
    for(const id of balanceOlder.purchasedCars||[])if(!newerPurchases.has(id))coins=Math.max(0,coins-(CAR_COSTS[id]||0));
    return normalizeSaveData({ ...a, level:Math.max(a.level,b.level), coins, vkPaidCoinsCredited:Math.max(a.vkPaidCoinsCredited||0,b.vkPaidCoinsCredited||0), vkEntitlements:{...a.vkEntitlements,...b.vkEntitlements}, vkPendingSpend:balanceNewer.vkPendingSpend||balanceOlder.vkPendingSpend||null, totalStars, starsByLevel:stars, ownedCars, purchasedCars, favoriteCar, sessions:Math.max(a.sessions,b.sessions), dailyBest, dailyBestCompat, dailyRewards, starMilestonesClaimed:Math.max(a.starMilestonesClaimed||0,b.starMilestonesClaimed||0), bestFlow:Math.max(a.bestFlow||0,b.bestFlow||0), missionCompleted, medalsByLevel, achievements, weeklyBest, weeklyBestCompat, weeklyRewards, endlessBestScore:Math.max(a.endlessBestScore||0,b.endlessBestScore||0), endlessBestWave:Math.max(a.endlessBestWave||0,b.endlessBestWave||0), scenarioProgress, greenWaveProgress, campaignRewardedThrough:Math.max(a.campaignRewardedThrough||0,b.campaignRewardedThrough||0), sound:preferenceNewer.sound, sfx:preferenceNewer.sfx, musicLevel:preferenceNewer.musicLevel, langMode:preferenceNewer.langMode, revision:Math.max(a.revision||0,b.revision||0), updatedAt:Math.max(a.updatedAt||0,b.updatedAt||0) });
  }
  function persist(){
    save.dailyBest=normalizeDailyBest(save.dailyBest); save.dailyBestCompat=normalizeChallengeCompatMap(save.dailyBestCompat); save.dailyRewards=normalizeDailyRewards(save.dailyRewards); save.missionCompleted=normalizeMissionMap(save.missionCompleted,save.level||1); save.medalsByLevel=normalizeMedalMap(save.medalsByLevel,save.level||1); save.achievements=normalizeAchievements(save.achievements); save.weeklyBest=normalizeDailyBest(save.weeklyBest); save.weeklyBestCompat=normalizeChallengeCompatMap(save.weeklyBestCompat); save.weeklyRewards=normalizeDailyRewards(save.weeklyRewards); save.scenarioProgress=normalizeScenarioProgress(save.scenarioProgress); save.greenWaveProgress=normalizeGreenWaveProgress(save.greenWaveProgress);
    save.revision=safeInt((save.revision||0)+1,0,9_000_000_000_000_000,0);
    save.updatedAt=(typeof platform!=='undefined'&&platform?.now)?platform.now():Date.now();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (_) {}
    cloudSaveHook?.();
    if(typeof platform!=='undefined')platform.queueLeaderboardSync?.();
  }

  // M111: external transitions (mobile ad hand-offs and browser/app departure) can suspend/kill the page
  // before an asynchronous cloud write starts. Mirror the already-committed in-memory save
  // synchronously to localStorage without advancing revision/timestamps: this is a durability
  // barrier, not a gameplay save event.
  function snapshotLocalBeforeExternalTransition(){
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); return true; } catch (_) { return false; }
  }

  // Load only after every save registry/normalizer above is initialized. Profiles with
  // scenarioProgress/greenWaveProgress must never touch a const registry in its TDZ.
  save = loadSave();

  function withTimeout(promise,ms,label='operation'){
    let timer;return Promise.race([Promise.resolve(promise).finally(()=>clearTimeout(timer)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label} timeout`)),ms);})]);
  }

  // VK Play browser release: no embedded advertising, no VK Mini Apps bridge and no external SDK.
  const normalizePlatformLanguage=(raw)=>/^ru(?:[_-]|$)/i.test(String(raw||''))?'ru':'en';
  const platform = {
    target:PLATFORM_TARGET, ready:false, booting:true, pausedByPlatform:false, browserPaused:Boolean(document.hidden), adPaused:false, adBusy:false, adKind:'', gameplayActive:false, cloudReady:false, cloudTimer:0, cloudWriting:false, cloudWriteAwaitingSettlement:false, cloudDirty:false, cloudFlushRequested:false, cloudFailureStreak:0, cloudNextRetryAt:0, cloudInitInFlight:false, cloudInitNextRetryAt:0, cloudInitFailureStreak:0, leaderboardTimer:0, leaderboardBusy:false, leaderboardLastSubmittedStars:-1, leaderboardLastSubmittedMastery:-1, leaderboardLastError:'', leaderboardLastErrors:{}, player:null,
    sessionStartedAt:performance.now(), activeGameplayMs:0, lastFullscreenAttemptAt:-Infinity, lastRewardedExposureAt:-Infinity, campaignCompletionsSinceRewarded:999,
    noteActiveGameplay(ms){if(Number.isFinite(ms)&&ms>0)this.activeGameplayMs=Math.min(86_400_000,this.activeGameplayMs+ms);},
    noteCampaignCompletion(){}, noteRewardedExposure(){},
    localFallback(reason='vkplay'){
      this.ready=true;this.booting=false;YandexAudit.state.sdk=reason;YandexAudit.mark(`sdk:${reason}`,this.target);
      const q=new URLSearchParams(location.search),raw=q.get('lang')||navigator.language;platformLang=normalizePlatformLanguage(raw);applyResolvedLanguage();YandexAudit.state.lang=lang;startApp();void VKBilling.sync('boot');
    },
    async init(){this.localFallback('vkplay');},
    canAcquirePlayer(){return false;}, async acquirePlayer(){return null;}, async initCloudSave(){return false;}, async recoverCloudAfterReconnect(){return false;}, queueCloudSave(){return false;}, async flushCloud(){return false;},
    leaderboardStarsScore(){return safeInt(save?.totalStars,0,999999,0);}, leaderboardMasteryScore(){return encodeLeaderboardScore(save);}, leaderboardAuthorized(){return false;}, leaderboardSupported(){return false;}, queueLeaderboardSync(){return false;}, async submitLeaderboardScores(){return false;}, async getLeaderboardEntries(){return{supported:false,authorized:false,entries:[],userRank:0,error:'unsupported',mode:'mastery'};}, async authorizeForLeaderboard(){return false;},
    now(){const e=YandexAudit.state.environment;e.clockSource='local';e.clockSamples++;return Date.now();},
    gameplayStart(){if(this.gameplayActive)return;this.gameplayActive=true;YandexAudit.state.gameplayStart++;YandexAudit.mark('Gameplay.start');},
    gameplayStop(){if(!this.gameplayActive)return;this.gameplayActive=false;YandexAudit.state.gameplayStop++;YandexAudit.mark('Gameplay.stop');},
    shouldRequestFullscreen(){return false;}, showFullscreen(){return Promise.resolve(false);}, showRewarded(){return Promise.resolve(false);}
  };

  // M195 Hotfix08: VK Play payment hardening.
  // Paid currency is mirrored from the server wallet, purchases restore by VK Play UID,
  // paid-wallet spending is idempotent, and transaction history is read back from D1.
  const VKPLAY_BILLING_API='https://traffic-pulse-billing.anhelos1987.workers.dev';
  const VKPLAY_GMRID=50363;
  const VKPLAY_PRODUCTS=Object.freeze({
    coins_500:{id:'coins_500',coins:500,price:99,titleRu:'500 монет',titleEn:'500 coins',description:'500 монет Traffic Pulse'},
    coins_1500:{id:'coins_1500',coins:1500,price:249,titleRu:'1 500 монет',titleEn:'1,500 coins',description:'1500 монет Traffic Pulse'},
    coins_3500:{id:'coins_3500',coins:3500,price:499,titleRu:'3 500 монет',titleEn:'3,500 coins',description:'3500 монет Traffic Pulse'},
    supporter_pack:{id:'supporter_pack',coins:800,price:199,titleRu:'Supporter Pack',titleEn:'Supporter Pack',description:'Supporter Pack Traffic Pulse: тема Gold Pulse + 800 монет',supporter:true}
  });

  const VKBilling={
    externalApi:null,connected:false,connecting:false,loginStatus:-1,uid:'',error:'',busy:false,pollTimer:0,lastSyncAt:0,
    authResolve:null,authReject:null,authTimer:0,serverState:{coins:0,entitlements:{},transactions:[],spends:[]},lastProductId:'',
    t(ru,en){return lang==='ru'?ru:en;},
    productTitle(product){return lang==='ru'?product.titleRu:product.titleEn;},
    supporterOwned(){return Boolean((this.serverState.entitlements?.supporter_pack||save.vkEntitlements?.supporter_pack||0)>0);},
    applySupporterTheme(){document.body?.classList.toggle('vk-supporter',this.supporterOwned());},
    refreshGarage(){if(overlayVisible()&&String($('modal-title')?.textContent||'').includes(T.garage))showGarage('rerender');},
    statusText(){
      if(this.error==='iframe_api_missing')return this.t('VK Play API не найден в тестовом iFrame','VK Play API was not found in the test iFrame');
      if(this.error)return this.t(`Ошибка VK Play API: ${this.error}`,`VK Play API error: ${this.error}`);
      if(!this.connected)return this.t('Подключение к VK Play…','Connecting to VK Play…');
      if(this.loginStatus===0)return this.t('Нужно войти в VK Play','Sign in to VK Play');
      if(this.loginStatus===1)return this.t('Нужно подтвердить регистрацию в игре','Game registration is required');
      if(this.loginStatus>=2&&!this.uid)return this.t('Получение профиля VK Play…','Loading VK Play profile…');
      if(this.loginStatus>=2&&this.uid)return `VK Play · UID ${this.uid}`;
      return this.t('Проверка авторизации VK Play…','Checking VK Play authorization…');
    },
    actionLabel(){
      if(!this.connected)return this.t('Подключение…','Connecting…');
      if(this.loginStatus===0)return this.t('Войти','Sign in');
      if(this.loginStatus===1)return this.t('Регистрация','Register');
      return this.canOffer()?T.vkBillingBuy:this.t('Пока недоступно','Unavailable');
    },
    canOffer(){return PLATFORM_TARGET==='vkplay'&&this.connected&&this.loginStatus>=2&&Boolean(this.uid)&&Boolean(this.externalApi);},
    async init(){
      if(PLATFORM_TARGET!=='vkplay'||this.connecting||this.connected)return false;
      this.connecting=true;this.error='';this.applySupporterTheme();
      try{
        if(typeof window.iframeApi!=='function'){this.error='iframe_api_missing';return false;}
        const callbacks={
          appid:VKPLAY_GMRID,getLoginStatusCallback:(status)=>this.onLoginStatus(status),userInfoCallback:(info)=>this.onUserInfo(info),userProfileCallback:()=>{},registerUserCallback:(info)=>this.onRegistered(info),paymentFrameUrlCallback:()=>{},getAuthTokenCallback:(token)=>this.onAuthToken(token),paymentReceivedCallback:(data)=>this.onPaymentReceived(data),paymentWindowClosedCallback:()=>this.onPaymentWindowClosed(),userConfirmCallback:()=>{},paymentFrameItem:()=>{},getGameInventoryItems:()=>{}
        };
        this.externalApi=await withTimeout(window.iframeApi(callbacks),5000,'vkplay iframeApi');
        this.connected=Boolean(this.externalApi);if(!this.connected)throw new Error('connect_failed');
        YandexAudit.mark('vkplay:jsapi:connected',String(VKPLAY_GMRID));this.externalApi.getLoginStatus();return true;
      }catch(err){this.error=String(err?.message||err||'connect_failed');YandexAudit.mark('vkplay:jsapi:error',this.error);return false;}
      finally{this.connecting=false;this.refreshGarage();}
    },
    onLoginStatus(status){
      if(status?.status!=='ok'){this.error=String(status?.errmsg||status?.errcode||'login_status_error');this.refreshGarage();return;}
      this.error='';this.loginStatus=safeInt(status.loginStatus,0,3,-1);YandexAudit.mark('vkplay:login-status',String(this.loginStatus));
      if(this.loginStatus>=2){try{this.externalApi?.userInfo();}catch(err){this.error=String(err?.message||err);}}this.refreshGarage();
    },
    onUserInfo(info){if(info?.status==='ok'&&info?.uid!=null){this.uid=String(info.uid);this.error='';YandexAudit.mark('vkplay:user-info','ok');void this.sync('userinfo');}else this.error=String(info?.errmsg||info?.errcode||'user_info_error');this.refreshGarage();},
    onRegistered(info){if(info?.status==='ok'&&info?.uid!=null){this.uid=String(info.uid);this.loginStatus=2;this.error='';YandexAudit.mark('vkplay:registered','ok');void this.sync('registered');}else this.error=String(info?.errmsg||info?.errcode||'register_error');this.refreshGarage();},
    onAuthToken(token){
      clearTimeout(this.authTimer);this.authTimer=0;const resolve=this.authResolve,reject=this.authReject;this.authResolve=null;this.authReject=null;
      if(token?.status==='ok'&&token?.uid!=null&&token?.hash){resolve?.({uid:String(token.uid),hash:String(token.hash)});}else reject?.(new Error(String(token?.errmsg||token?.errcode||'auth_token_error')));
    },
    getAuthToken(){
      if(!this.canOffer()||!this.externalApi?.getAuthToken)return Promise.reject(new Error('vkplay_not_authorized'));
      if(this.authResolve)return Promise.reject(new Error('auth_token_busy'));
      return new Promise((resolve,reject)=>{this.authResolve=resolve;this.authReject=reject;this.authTimer=setTimeout(()=>{this.authTimer=0;this.authResolve=null;this.authReject=null;reject(new Error('auth_token_timeout'));},6000);try{this.externalApi.getAuthToken();}catch(err){clearTimeout(this.authTimer);this.authTimer=0;this.authResolve=null;this.authReject=null;reject(err);}});
    },
    async request(path,payload){
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);
      try{const response=await fetch(VKPLAY_BILLING_API+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),cache:'no-store',credentials:'omit',signal:controller.signal});let data=null;try{data=await response.json();}catch(_){}if(!response.ok){const err=new Error(data?.message||data?.error||`billing_http_${response.status}`);err.data=data;throw err;}return data||{};}finally{clearTimeout(timer);}
    },
    reconcilePendingSpend(spends){
      const pending=normalizeVkPendingSpend(save.vkPendingSpend);if(!pending)return false;
      const hit=(spends||[]).find(x=>String(x?.request_id||'')===pending.requestId);if(!hit)return false;
      save.coins=Math.max(0,safeInt(save.coins,0,1_000_000_000_000,0)-pending.localPart);
      const carId=pending.carId;if(carId>=0&&carId<CAR_NAMES.length){save.ownedCars=[...new Set([...ownedStyleIds(),carId])].sort((a,b)=>a-b);save.purchasedCars=[...new Set([...(save.purchasedCars||[]),carId])].sort((a,b)=>a-b);save.favoriteCar=carId;garagePreviewId=carId;}
      save.vkPendingSpend=null;return true;
    },
    applyServerState(data,reason='sync'){
      const serverWallet=safeInt(data?.coins,0,1_000_000_000_000,0),mirrored=safeInt(save.vkPaidCoinsCredited,0,1_000_000_000_000,0),delta=serverWallet-mirrored;
      let changed=false;if(delta!==0){save.coins=Math.max(0,safeInt(save.coins,0,1_000_000_000_000,0)+delta);save.vkPaidCoinsCredited=serverWallet;changed=true;}
      const ent=normalizeVkEntitlements(data?.entitlements),oldEnt=JSON.stringify(normalizeVkEntitlements(save.vkEntitlements));save.vkEntitlements=ent;if(JSON.stringify(ent)!==oldEnt)changed=true;
      this.serverState={coins:serverWallet,entitlements:ent,transactions:Array.isArray(data?.transactions)?data.transactions.slice(0,12):[],spends:Array.isArray(data?.spends)?data.spends.slice(0,20):[]};
      for(const spend of this.serverState.spends){const m=/^garage_car:([0-9]+)$/.exec(String(spend?.context||''));if(!m)continue;const carId=safeInt(m[1],0,CAR_NAMES.length-1,-1);if(carId>0&&!ownedStyleIds().includes(carId)){save.ownedCars=[...new Set([...ownedStyleIds(),carId])].sort((a,b)=>a-b);save.purchasedCars=[...new Set([...(save.purchasedCars||[]),carId])].sort((a,b)=>a-b);changed=true;}}
      if(this.reconcilePendingSpend(this.serverState.spends))changed=true;
      this.applySupporterTheme();
      if(changed){persist();updateHud();if(delta>0&&reason!=='boot')toast(`${T.vkBillingReceived}: +${delta} ${T.coins}`);}
      this.refreshGarage();return changed;
    },
    async sync(reason='manual'){
      if(!this.canOffer())return false;const now=Date.now();if(!['poll','spend','payment','payment-close','registered','userinfo','boot'].includes(reason)&&now-this.lastSyncAt<900)return false;this.lastSyncAt=now;
      try{const auth=await this.getAuthToken();const data=await this.request('/api/player/state-auth',auth);return this.applyServerState(data,reason);}catch(err){YandexAudit.mark('vkplay:billing:sync-error',String(err?.message||err));return false;}
    },
    beginPolling(){
      if(this.pollTimer)clearInterval(this.pollTimer);const startWallet=safeInt(save.vkPaidCoinsCredited,0,1_000_000_000_000,0),started=Date.now();
      this.pollTimer=setInterval(async()=>{const changed=await this.sync('poll');if(changed||save.vkPaidCoinsCredited!==startWallet||Date.now()-started>120000){clearInterval(this.pollTimer);this.pollTimer=0;}},2500);
    },
    async handleAuthAction(){
      if(!this.connected){await this.init();return false;}if(this.loginStatus===0){try{this.externalApi?.authUser();return true;}catch(err){this.error=String(err?.message||err);this.refreshGarage();return false;}}if(this.loginStatus===1){try{this.externalApi?.registerUser();return true;}catch(err){this.error=String(err?.message||err);this.refreshGarage();return false;}}return this.canOffer();
    },
    async buyProduct(productId){
      const product=VKPLAY_PRODUCTS[productId];if(!product||this.busy)return false;if(!this.canOffer()){await this.handleAuthAction();return false;}
      this.busy=true;this.lastProductId=productId;this.refreshGarage();
      try{snapshotLocalBeforeExternalTransition();const orderId=(crypto?.randomUUID?.()||`tp-${Date.now()}-${Math.random().toString(16).slice(2)}`);this.externalApi.paymentFrame({merchant_param:{amount:product.price,currency:'RUB',description:product.description,item_id:product.id,additional_param:orderId}});this.beginPolling();toast(T.vkBillingPending);YandexAudit.mark('vkplay:billing:frame-open',`${product.id}:${orderId}`);return true;}
      catch(err){this.error=String(err?.message||err||'payment_frame_error');YandexAudit.mark('vkplay:billing:create-error',this.error);toast(T.vkBillingError);return false;}
      finally{this.busy=false;this.refreshGarage();}
    },
    async spendForGarageCar(carId,cost){
      const mirrored=safeInt(save.vkPaidCoinsCredited,0,1_000_000_000_000,0),localEarned=Math.max(0,safeInt(save.coins,0,1_000_000_000_000,0)-mirrored),serverPart=Math.max(0,cost-localEarned),localPart=cost-serverPart;
      if(serverPart<=0)return {localOnly:true,localPart:cost,serverPart:0};
      if(!this.canOffer()){toast(T.vkBillingSpendError);return null;}
      const requestId=(crypto?.randomUUID?.()||`spend-${Date.now()}-${Math.random().toString(16).slice(2)}`),context=`garage_car:${carId}`;
      save.vkPendingSpend={requestId,context,carId,cost,localPart,serverPart,createdAt:Date.now()};persist();
      try{const auth=await this.getAuthToken();await this.request('/api/wallet/spend-auth',{...auth,request_id:requestId,amount:serverPart,context});await this.sync('spend');if(save.vkPendingSpend){toast(T.vkBillingSpendPending);return false;}return {localOnly:false,localPart,serverPart};}
      catch(err){YandexAudit.mark('vkplay:billing:spend-error',String(err?.message||err));await this.sync('spend-error');if(save.vkPendingSpend){save.vkPendingSpend=null;persist();toast(T.vkBillingSpendError);}return null;}
    },
    onPaymentReceived(data){if(data?.uid!=null)this.uid=String(data.uid);YandexAudit.mark('vkplay:billing:received',this.uid||'unknown');toast(T.vkBillingReceived);this.beginPolling();setTimeout(()=>void this.sync('payment'),800);},
    onPaymentWindowClosed(){YandexAudit.mark('vkplay:billing:window-closed');setTimeout(()=>void this.sync('payment-close'),900);}
  };

  // M115: compact recorded vehicle audio scene; distinct emergency recordings stay embedded/offline-friendly.
  const EMBEDDED_AUDIO_SAMPLES = Object.freeze({
    emergencySiren: 'UklGRmQzAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YUAzAAAAABMAsf/w/sH+JADsASECYQE+/4f88vso/2kD7gQ/BLf/6fq/+PH7DAMmCOEH+gGO+9D1lPYvAGsJTAqFBmn+3/S+8jT8IQgHDKoK3gBN9Qbw3ve+BQ8O0A4eBLn3oO6z8UIBAw9+EYMI2vsF7vrrPPx1DrcS6Q6wAHLu/+Zy9L8JrBPiFIAGcfNc51juiwINEg8XwQo1+lPqXumv/GAQgxVqDk7/POwu5nv31A2IFIgShwP/7ULkFPM+C8AU0xXPBXXwweTe7sQG1xY3GWoJiPWH5JfmY/+7FvAZFg7M/ALnsODE+LYUmxiOEygCGejP3JfyVhIRG2cZxgP+6jjfWuyZC6YfaB6xBZzur9wq4n0E6SIhIvQOefbG2YDVvPjIHuskUxv0ANPdl9MK73wVdyMyItIDL+P01rPpWBBaJgsmQAV653DTrdyTCJcuciq5Dobw7MzJzCP8dyyLMfsfPfoVzbfDbu5FIio0wTFsAl3UucNV3AcU7TlGOggNTeJjv03HUAAKOLBAqyCr9Z/D6Lor7UQnQziBMTUFg8+3vSDhHRdPMVE4NQ1F3W3F89mKCikucDcXErfrt8fQzrYALy7uMuUZtPfYy/HGdvRuJuMvuSQj/w3Sd8Nu6rYeyTBWMuAFUdjixGbeChCjLw03hg7C5dbH19TiBE8uljOtGC7zdsmrx9f3eif0Lk8jPP620DzGovA0IS8tEirDASfV5sMp508afzHeM7gJJ+A6xXLXwAknL/s1eRS87RrL7Mrq+hEqRDBsHlD9PdI1xxzxTSAUKNgkaALx2CDLce7SG3coFyr6A07ce8sh5hYVxywbLNgF2OM2zO3Zaw1vM8IvUw9B6snGO8nf/rExrjJCIiz5lMt7webuPSS3MD0ssgLu1EDGX+jVGaAwnzABBOjZecZH3HwQuDaBN2MPauWUxNHLdAD/Mfk1aB2B9SfHgMEl9YwqRDIdKgEAZc3uwOXqjB3zMfk0jgal1f/CQt8qEKowzzhSEA/lPMc70gQDUS2uM5QYtfTXzAjL9fl2JT0puh6u/xHTqMqy9c0f0SSBIx8CKNcUzizxcxuUKFcngP652RzN1uojGnMvNSwqBO3ficje2WsPkzOaK6AOWe0QyezQTAUEMZ8rxBWv8rLH5cfF/eQw3zNlJCL2N8iEv5PurCeSOQMxOACf09O9Jd1sGas69DWNC4bh5cC00LIInDWeNRMU2e4zx0nI1P0zMV8zHR1V9krJMsQw9QErFDQZJ437Ss4gv6rr5SGaNdcw2gDA1erDQOKtFS01KzXxCH3g58Qu1hQLIjSDNBURv+sWyHjL1AAEMZgwnxpF9x/MS8N59mcp9y0kI8j99tH2xAPxbCJKMGIqeP6O1TTGh+epGKIzyDHbAyjf9coI3LUMfjJ8L44IQegkz0/WRwndL6sp0QzA7IPKs87pCEsy4y1rGTfx/MZPxvT7BStcMo8l9/WgznzJ2vA8JFk26CnP9r3Rg8XI5tQgJjvYMAAAftmwwinXOhTyOnAzQwzz5XDDRM0VCncz7zAPFkHt6cb2y1MEMTHlL+YaIu2lxcPJCf1AMRE5sCOM7TvFb8Mg8PMtYkH5Lhn1q8ucvSPhQiRtQhU3/wFl04S65dMVGKpBezsADk/cormuyY0JST/xP5kZMeTyt4+/F/wcOydEDiqC7qu7f7cr7icyiUOdNEn6g8Nvt8HkTiUOQgA8pwBly964ANusGpJCRUIPCzLUXLU4zvkMIz/rQ5wWION1uNjDlQJiO+I+mhw965G8Yb86/bI4WT4qKSzwmLryt8nxazK3Qs42Afnsv3600uayJPhBEkBnAk/ImbTS2o4bHETAQvsKsdO1szDP3BEZQoBBXBVb3k60fsWgCQdBgUNrHrrlGrFuuB/+UzyBR4cu9/QEto2tK+0lMCBHSDswAJy+c60I4RIj2EOjQTYKlcuysKzYhxltPtRB4w4Z1nm0ktHnElw8a0JmFZjf6bQ+yO4KlTsUQ4MdOehJtMq7tv4vNwhFECsu98q6B7RY8I0srD43MTkCW8XYtBHqbyVwOQ4zggX8y7W2/+UDIZk18TZECSPR5bft4GodoTWMOKUK1dYuuf7Z3RliOvE6GwxU3Fa42s4YE8g9UEB6E1HkLLg9wZcG4jy8QMkc3O4gu+O5JfwpOIY+OyXV9Fi8vLUK9u00xj1ALkP5aL5sshfsUjDlQtc4ev1uw9quwd6mKd1F00C9A3HMQa68080gykfAR5wLANPNq5fF9hPESJZMNBrh3/+rdbm3Aw5CyUuiI4/qCbJusoL4Ij4cTOIuEfTAtYmpX+qSNlRJKDgpABi/IKm632YsUkZWPsQGOca+qNnZmCKiQ0NFPg1Mzo+rUs/MF4JBMkkVFRjZcbCOx/kMIz1rSZ0bnuICturC0wLdN0VI4CFx6qG5Mr3d+682uEZ7JU3xqLv3tS7xDDRLR+csqPz4wAavq+ZsLT9DyjNNBWvFYK6q4GonjEB4OCwKlMohrBDa1CD7Pq5DcxGjzsmsAtHiFfQ8MEmEGNLaALNlyO0H8DViSAwcRugIvsPFh/4IMUFDPBxJ7+DDQcSK+SUwo0AzHaP0YsZkwSD1fC63Pl0im/i9xQi+8fDlK4Q+7il0/dfFubjs5+QmUj5CMl8Fl8wjt1nehBzYNvE3XwwK1YW89d16FCowvThCC+rYacEp3xQT5zBSOVAJfdr8v87bxRJ8NAA+bgyj20C9hdQoDAY3pkTNFY7ij7qFyrIB+jFiRRwhLe1AvgHFyPcTK6dApiYJ9kbEpcEQ8WkmlTxSK4X8ScozvvvpYyG/NyUwBwU/0LC7seWaG/QwDzShDeHUSLw15GwW6CqGMlUQFtwAv5zh0BPbJ5wzThKd38DBut52DoQmRzOpEuviM8jm3v8KICaVM7gSCOT+x+HYKQg9KGg22RdU7MXLhtRIAdEjyjI1FwPyQ88n0mH/5yR4MbgZufe00cXPmfjNHc8pVxvY/wPZLdRF+DMbyyIhF2P+K9q911v8vh1TH4wUJPxt1wHWJf6/IhYjVBem+v3T09BD+swk1yYwHa39cNQWyy3z5SFpJxgg6wDx2sbL//ANIG4mPyHD/z7b+soq74kdeCdbI0sB994FzcjugRpTJ+EhbP203Z/PwvErHCoskCSF+uDZuMww7qccAjQNK3f8Jdh1xu3jsBhhOfAx+QKl3GTEgNpDEtU5VDNPB63hFcWg05oL2Dg5NMANmedjxc3NpQfKNq8yJRHR7PvG+8gFAwQ0LTI/Fh3w+ch5xl0BpjLhMGAZNvHJx5vEXv96Mqc0QR508B3G2sJl+0svRzc1JnPzi8cFwSz0+ynKNoop2fWWyxXF5/LGJiA1xSna9AzLpsW78mIpPjj9KkHzj8m8whrwNCoBPYUvPPR3yTW/aerUKYNCazPk9W7I6rle5Eso+kfsOy/7NceSsrja5iE6TLlCOATry1euOdBZGuZNKkn8DIHQjapvxA0POU3eTa0Xfdoorea8ewQcSDRNsx534TKvobjx/oxDxEumJVTp5bGDs1L4pz0iSUkrBvD8teKy4/OmOItGrDAE9Vq3l69q8OAzCUUaNZX69Lq/r1HtAC6+Qzk4pvx1vNKvwehIKe9EoDxlAOXALrC95PEjP0EYPrID9sSAssHj1yGBQJ49sAQEyMKypeCmHzVAuT7JBfHKFLS03pcePUKmQHIHm8ursF/ZKBtmQwZFHww+0Oav99NfF8hC/EYBEDjUKa4Gz4YUH0CSR2EUqdkusMvKXA8+PiNH/RYH3sqxc8mIDEg9B0dbF5rfVLLvxhELCj5MR1UZyOIvs6zCOAipPsFH6Bph5LKxAL7yBVBBq0mNH1nn3bBqt5X/Xz/QSbckYuyqshW19fwwPXNIRyf+756yDK8y+Eg8PkqTLsj0hrNnrCnyFzdXSMcyJvkUuGqsYe+jM8tFzTOk+Nu6l6+x7coyuEd8NYz4Mrr7qyPrITKESAc68/yVu/Kphua6LuRHhDvBADO+z6l745osW0c4PWADScAUqLPfESoZSBpAVwYWwkOnVNtSJhFI5EICCwnEWKVx2L0jpkjvRV0OrcVPpJvSCx+lSWxKyhKiycykuc1PGVVHGE5eFwLPPKZkyDkSnUOmTxQbuNTPqvnHsA0+QJBOWBrO1/CsFMYGCso+D1HtHbbcK7AGw5UDZzn+TcoeweLOtArGigOGNotLDx2U49u1msSMATs320whHvzmF7cZw03/FjQqS2Qgf+ppuNfDXv10MvdJiSBc7XS5+cPN/OAwtEeYIZPvurrexHb8nC6NRjEh8e9BvITF9/rxLTRGPiId8c+9C8Wu+Ssr4kN5I3Xyfr9Sxx75ZynBQjkiFvLgwBDG/vjDKWlCcyXr9LvBNMQ39tcmZkB2JQv35MSfxK31qyWNPggmrfpTx13EPfNWIkY7QSUU/jzMpcZX9CwgOTULIFz9e8+byw/6QCJbMQQbBPrczdnNof1OJUUxhRjG99jLh80XAHkofTFrF9f0ZcgqzU4BdSocMzQZY/XcxvnLrgB/Kr4xphgC9WnGl8saAc4sujLVGGr0tMYNzGEBfixgMjIXufK3xaPL1ALjMLA1dRYl8JXDxcn6AKoxxjeJGI3xO8Tgx6cApzLpN0gXwO9DwzTHMQGiNRo6thbA7sfCZsQwAKw2ZjwNF3DvK8M4wqL+jza0PdIYUu9Qww3CrPw5NPE7zRjQ8AjGn8R2/mIz8jopFlPuIMURxjABtDSROmsWhOxmw1HGDQN8NYI8TBfI6tjAhMXxAnA1SD5XGGrpF8FoxzMEAjTEPOcXM+kjwevHmwW9NUU9+hUH5jm/oMjHBwk4YD7QFbjke76Kx0oHMjq7QPoUy+GQu1nH0Aj5PAFDmxUi4DW5H8YeCS8/T0XJFardY7WHw78JRUNISUUYUNw6surAzQeqRPdLqxkd3Livw778B4VG5k3CGjrc266qvbUHnUbSTc8aidsYrsO9Wwk1SQZQBxt32Riq1LuKCalKcVNmHkfauKd3uWcH0kmfVUIh4do2pr24ogbvSFtWhiNL3NakNre2BfBIBFkFJkrc8qFBszgDn0dEXOYrTuGCowWxav0oQbNYlizD5bKo2bWq/tQ8lFWLKtTknqnVt2UApzwQVSgpw+NOqkK5+gDOO/9TQSiT5ASrFLpFAvw66lLcJlfkKqzAvCkE1zmrT3Aj8OPOrZa/4AW1OYRQrCDV4YWv3sL/Bxk6Fk2kG2Pf969mxhANAD1MTNMWrdmYrWrJrRKvQdhOcRW609OmmMaGFbNGAVNRGI7SRKL9wX0TW0diV1EcxNJMoUnAFxD+RRRXPB7x1BOjJ8CCDhBD/VUrH0bV2qTJwy4Qm0D8T5kbTdOgpaXHjRWIRGxQ5Bi8zaygEManF1BIe1MyHLLMG567wwIVYkfqU+IeSM1EninEeRQFR7hTyR/XzLme/MMyE9JGr1FDIBPO5J/7xawSf0SKUPcgls7PoQXIJhLhQltNsh9Azoujd8rnEk9CtEvjH77NWqPWzIQUx0GTSRgeBM3GpHzNRRRjQn1JaB6uzNekSM4UFLxB3UgfHinNTKdUz7gR1T44Ro8dk9DlrB/SahLRPEtASxi0z5+vBdcwFv8+PD1ZEwHPILEg2PcWcUFuPfYREs5rsUDY2BWlQSE8ORF90Gm11NlHEw8/Kzk3EEPSYrsy3n0SdDyWM0EMfNHGv7DkwRX+PCQwHwe/zlLBLOcTF6Q+AS6VBMnPMMUU6qwX6DwMK2AA6cyDxxLuihiaPnIr+f0uy1TJDvDbFwU83imo/VXN5syN8TYWAjgEJtr7cs+c0ib3IBfVNFchA/bHzcnXcfySGKsyWR5r8jfMt9peAJgauTBGG6Xutctp3XQFOx38LVYYJuv3yHbeuAhGH4Itohhd6WTIgeAqCX8eLSoSF83o0cng4xcM/B3KJYMU3eeryvTmpA5FHnEh/BCb5ivOEe05EcEcIhyfDCjjPtDN8pIWjh/tF6wHFOCU0cL2kxmOIUIT3gHk3SvVt/ysHTEjUw/A+w/Zqdf7ARciJyd3DEr1GNTp2G4GYSafK+YLM/Duzh/YNAlwKTYu/Qr47fXMt9mhDAsrJS50CLrp3cop3QgQ4ixCMCEGSeTVx0jfyhMULzsycwXm3sTDleFPF+Uw8DNCBePao8Bc4wcaYzFaMwEFHdifv8HlfBwzMXYxCQND03K+XeocIjo0/jAWAIvMnLmC6z0mwDjyM5wBO8iStAfpOSXrOUA1TgWpyUu2lukBIz83PTG1BBzKirl97CAkEjhgLVYBB8kavVvwLyXsODkpmv3WxkS/ovU4KFc6dSZn+ojDCsHo9/YoxDu8JFf5m8M7xRP6BSc7O9og5PQQxCPMwgB4J8c40hpl7i3CSNJKCPEqsznsFCXncb7Q1XQPiy+rOnYRjt6AuF7XdRMoNPI/oxOE2lCyxdSvEsozo0FnF7ra47Gs1UYSLTEkP+oXFdtpsnLYdROOLuA76Rd92r+1b9x1E+wqrTTeFInaj7ml4x4YliuQLt0OhdYJvV3pCR1kLu0oJgiM0Zu+ze7EIo8zsSboAs3MYb4X8UIl9jcqJuf/A8rXv8/y7ySbOQslEf/Iyc7DPPaoI0w44iDH+gbJ78nD/N8k0DeEHdr0kMaYzkMBdyWzNjwa2PAaxpzTMgfLJuk00RV36DXCttgEDqIq1TUgFJfhp7zR2cQRdS30NjkWjN+7uQTZbxE4LO00aRfU4Oq8PNuoEV0qnS7HFAbgK8Fe4AoU/Sp0KeAQtt2lxBXkfxU+LKglXA6W3MHIuueXFoosnSDcCs3c187H7DgXgiuHGnoEDdvw1vD03BlvLOYUiPxP1TDbuvwrHfYtGxI19XLRl99iAjIfvi7SD2Pv7Mtr4QsIGCE7L4EQ4+u3yNjirgnlHystWhAB6jXI3+YuDUcfwChXDxTnLMgM6lIPLR6tJEQOOeYfy2/uDxKhHe0exgoU427NUfIMFYgfMhznCcHhVdCd9EwUiR65Fy8IweJH19r5/hS+HPcQgQJJ4t3fz/8jFmcc0woq+27gbeeoBzwZ2BulBaXzL9xS7F4NwRrbGwgEUe+a2uHwYxDUGNcYOAID7TzbxvcMFUAWfxFJ/RzpetwiAF4cqBZlCm/4guTj3b4GUiIXF3QDb/NV4LbfkgynKMsaBP597QjbHuGcEE4t9x4a+4TpP9i645AT1y7gICb4veVu16vonhYCLlgfXvNh4kLZ3fEZHd0sThzA7Cjbo9ex+tAkLS3mGAToENVZ1aAB+CwHMN0VT+MQzYTQKQbZM9ozGxT94ZrIv82gB7I2TTZcEfjgnMX6zbILWjnlNisM0t5NwwbRww/JO2Y46wYL237BTtVZFFI9UzmZAiTXOMCL28MYNT08OQ79VdJawNziMx6iPO43DflDzZG/9OoAJTk74TLm82PI5b2p8UgsKzybL8zwCcN8vXz3kDB2PLUpVu63wBS+K/ssM8M7zyOg7IvAOcSiAZA0MDo2GPXkZ7+1zSkNQDoPOcQM+NvSvOnWkxZ5PeA4BwOU0tu6uuAjId1BGDqa+73Gz7RU5woqt0VEOmD4E8CrsBXtezBNRi43hPTcubCuH/NpN6xH6DGS8Zq1TK46+Lw77UckLMnul7I/sDv+HEANSZwkTOlkr5S0MgMiRPhLbB+i5TutabjAB6dFAU3wGRbh+ay2v84LGUTlS+QUJ90+r6nJahG3QeBFsw1d11CxgNVuGaBAUT8pBeTP67EF4GgiN0E3OG3+4Mgms6TpWSl3QS4wxPewwuq0LvPgME9Doii/8cq9/7h6+eoz90QoIs/sVbujv5sBbTdbRMYYC+W6uGbIBAuEO7FEhRHY3Nu1ns8bEtg96USyC5PU27OX2Pgahz85QPcFWMzwsFLgOiN5Qjw8mQAExLuvuejFKuBEQzY4/DG9eK9k7w8x2Uc3Lmz2tLhts+H27jZFS9ol4e57s3a4Z/6MOyZQHCA65+yuib1yBJI+YlE4GwLhtKzhxd4KDD4KUAAWXtkrq9/OVBKEPk5LihFf0nypmNcjGuo+p0RfDJjL5ami3yghL0EJPbIHRsWjqpDmcSdMRJs1egOYwVKthus3K9NHCC9S/qG/2bRl8foqXEgBJwT4SL+Mvr35sSxzR6oeUe/vvFvIagJmLd9Eahhl5x270dH2CYouKEDVEiXfw7mU2toQ3C6DOQUQtNnjuf7hPhaOL40xigsP1QO+w+kdG88wtCj/BZzRw8O/8Ywe3TJmIaP/os72yz760h+SMpkYefcezFPWPwTrIXsy9RGU7jTIet61C1YiFi/IDBboPMfe56YTfSG1JtIGqeKNyZ3yRRsXIZ0co//A3EzMI/yVI+cjrBMD+PbVBNF5BSUqOycyC77vWNCA16MOHS+PK+sDvuZTypPcWxaQMy8uqf6z35nGrONDHEQzeSxo+i/a+sVv7OAhZDFWJuH0oNRfx7H21ShvMMUd1O8dz5/JfAAgL04xBRUv6d/JWs+MC0U01TLSC/vhF8UB1SsVSDmgNY4EytmSv6Lc9R62O4c3Xv5X0bm7e+NhJpA8tDRq+cvMiLof60EtRTtsLeTzjsdCu1n0DjQ3O28kJu2ewie/Kv16Ou08ahsG5iK+HsTUBa0+ij6gEsvd4roszS0QOkJgQCQKX9TxtnHVvhnWRD1AIgPczJa0L97tIvNE5zsw/OHEILME6dAsy0X2NPX0d7yosU7xBTVCSGgugfDyt8+yLvdLOS1J6CUb6uy0SbsCAdM9uUqQHNTg6a9LwqIKgUHNTCkWptl9rXPL5BJlQSVKFA+d0gytnNZJHGNAwUJEB9nKLa6f41InSEDHN0z/3cHirRzuRTFVRCIvyvjiu8qwuPR4NadGOybg8lG6wLh1/L83Lke0G07qoLi2xO4HyTmsRvURZt98tc7PKxP5OwFF8gnQ1VuyFtrQHUM9UD57Ap3NRLLx5XEofD7NM6v5RcR5sxPwATItQ1ks4PKYva62FvhuN+tFTiKS6eS4X7/LA289RkluGBDeULMbyOUNEkBYSu4RktS+r/bRdRilQQ5FwQo5zBis6tt9I29DAj6/A3vE2av35Mor4kXQNAv9iL+Zr+Xs2jHgSLAqZ/MGu864iPeUN5ZMbiB05+20zMHaArw7fE/qGF3bQa9fy+UN8z6DTW8TMdLzqUDTIxfSQEFJJg+cyh6o1do6HgJCC0G6CoPGaauQ4k0jLEPCNj4DTMPls/frHCh3RRYs7Pmrv3m9OPavKhNHGSOL77G8gMrYAZ0rSkNwGTPkbrk11w0Pby4nPVERFtp+tpjgWhhkMVs23wss1Mu36OjdHsAyBytPA23QE8At9MMkOjW3H3D3MssRykYA5ym+ONQVu+pIxZXUxgxwLTA4xA1a397Ait6VFnkuoTTtCMnWF78o6O4edy4gLNkCy89awJbydSfYMKIiPfuSyVnE1fsaLZw0KhrB8srEJsvoBL8w0TfqEsjpP8Fi06INZjF5NlIMdOEIwN3d5xbXL0EvIgad2YPAKenyIY4wPiXw/nfRP8K+8kQqdzOZHCT4Nsz3x9n7zi92NeYSDO/Vx8XRWQWvMg04mAu15V7EiNzEDzAzxTMNA7Lb08HL6NIbgTOgLd39DtP0v4Lx8SSEMygjFfkRzvLC3Pq6LFE0Uxdb8bzKp8qQBEcz+TbaC3rmvMVj1BAO4zahOmUEatzzwc3ewRfRNmk29/2t09vAjurRIN41cC7P92jLfsCK9UYqdDYRJG3ycsY7xLj+VTBlN3UYLOu5w4nNBwngNGI4egxy4VjBtNl4FPU1nzfHAqXWU8D95v8fGzY8MBf5ZM06wIX0uivcNLklrPAExbLC6ADVNqU2TxkB5/y9rMgXDE4/PzoHDk/dNrm50fMWVkQrPKMCGNEWtjfdkyKVR4A7tvmExVyzEum5LZhIZjQl8Te7GbMh9aI4lUndKr7pRbKptaz/WEHXSz4grOGNrEq9awqwRqNNlBTK1oOpUMn8FntK90tbCazKJaVf1hclHk6bSbUAXb5jorTggy7sTj5BofuuuJelquqCNZZNbjO782a0gq+I+AI9Ok0+I9XmRa+ovCIIBUR7T+gVeNhhqYLJDRaTR0FO7QqNy7emZddfI95H/kbBASLA0KZp5ZUwnkiFOnf4/bZ4qbfxKDsAS4guie6NsBGzOP7MQshMeiBx4ourg78EDE1Hbk0VFMTUnqidzWsZR0mjRxUJxMi4pojcOCcLSgw+BP7kvZmoiOl3M6BMtjJb9Ni1Mq/A9v08506PJeTm+64/urwEdURZUSMb6NgWqbnGfRJYSFNOuxBKy+GkxtNJIG1LkEZuCK3AOKTB3tEr9U1aO9b+zbexqbjqcjUXUREvhPNXsduzNPd/PGlT7SIi5RisKcIlBjNB0k93FiTWKqgB0T8WAEZUSG4L58ZipTfeXyWBS909CQFIu2emCOi0MW5S9zNZ93KyZ67H8nc4w1aiKY7q3KtAuvz+VT1PVrEgRd/9prHHWQupP/xOmhZ407OkeNTdGGBD0ETADrnIIaYX35EiCUjIOSwFAcIDrfPo+ik+TI8uUPltvCq6zvTwLZFN8SM762S2csghAmsx0khPHCveRrEK1KUMbTMwQHEWeNaGsuXewBXyNbEzQg4O0ca6x+qIHIk44iWrAdLM28cL+bIi0TgjGozysMZ41cUGFyZaNUsRxuVZwyXimRJhKEMrsQkY3NXET+5GHJQqnh+qAC3VIM35+o8jdSwjEiz0/c5G2kAKhCnELQ8HeeUAyTbnaBcYLS8o8v542qzE8vL0IpYuHh5k9/bRpceD/q8sYzGyERTuAsuFz6sJqjMLNQkHVOJixhXdTBWwNnAz0Pwg1rjCEOw0Ikk4hit09A7LH8EQ+jgtQzllH3/tycNrw4cFXzYHO/AQKOQJv63NABJCPaQ9igN+12y7c9ocHqxAuzvQ+PjL9Lk16oMpikB/Mb/u+sFMu1v64DUkQVEhuOQKugvC+glHQK1DRBBs1+2z5cxVGDRIt0bhAeLJOrAo3EAny0tdQ5j0wLu/rVTrTjV7TvM5b+pXsd+uPfnNPvVOXisu4airlrc2CFtH1E8UGbTSmKbUxqQY8k3bUN4I2cIGo6PXHyk0UpRLGvqps0aiIemYOFhVW0Dn7AamPaTA+XdGo1k1Mnbf+pvsq/UHk1CqXlIkD9HqlcC4QxbSVoVevRZ0weuRHMkiJbxZnFhiCoiz8ZJD2o4ym1sjSqf9Kqg4mPzrYD9dX945Y+3MnY6jovx3STFkUCvX27qVGLOUDadOa2JQHq7KMJKfxXgeqVJAV9APqbrNkTXYni/4VzVJvQL1rFeXm+iBO8ddmzmh88OkeqTe+MNC5GCIKmDhNZ6qtlEMjEgRXIQbT83Ol/vIER/2TqZTcg9JvKKWxdiELcFUM0aMA0SwhJwq6dc4CVrDNiHz4aYdqhL79UD4W7UnPuDin9G63g1SR2xWPBp1zkqb5srsHnhNnks4DZi/4p2+2w4tWlRyP4r+SbPspg3srDUeWA4yOe4Pqwy2tf/uPHdU8yI424+jOsU3E+lEK0ymFkDLzqCQ0s0hrkupQGoJfb+gp0DhLC3WUmc0wfj5tFyzXfK5NVBUsylf592sAsJkBBA7mE2sHULW/Kg60dgWTkK7QO0Qh8emqe/eyyUwSqMzwQKMvBGzhO7hMM9PuyU173OzkcAt//I47U+wGhXciKxrzlgPZz/7RpgSzcxvqs/bIx3QRew5SweCwO+xNeqZKMFNRywC+Ie1K70g+ksxJFDgIJHnUK2DypgJrTeNSekVR9iNqk/XZxeOP/89IwqZyrSv3uRpIpBIuzGn/Ge+ALp086Mpkk2mJnjtP7Vyx7MC5y6aSr0b/96fr6LUhRE+NeI/ARF50p6w3+AlHUg+wTP2A4XIPLpT7kQkqkVaJ9Pydr8uyXz+zChERvYcfOIEuA3YCQ48LOw8HxOK1Yi26OX7G6YyiS9bBY7KKr6i9MsmLTsLIvPz68DayrIEBy1ZP2cXLeEhuY/ZRRQ5MB06BA690T+2OOcxIhU18S47AzTFY7vY9EctSzzvIrf01rqExoUDwDNVQYcZzuPjshHUCxKtNh8+whF71MSuk+A4H1I5eDPzCRLJ6LP67G4pUz5RJs78TL/gwED7aTAaQtAaLeydt/TR7QqQMyY+tRAg2zyyTOJTG1U2TTIzCQbOgLNf73gnCju1I0j9RMSsvzT9qC+CP1EWiO3yu7HQggwJM7s8hwzs3cy28eI+HGc0MC/qA8TQt7YI83Mq0zh6H5z45MVEwSQCqTNBPpEPGeigvLrRPxNjOnk+dAO41tW0QeJDI4A9PTRq+pTIELOm8sgxx0G6JPDuh7x6u5wCkDv3R4AV4ODss6vKURMiQFhHEwhh0f+tV92XJOlBPz0m/XzDu6xF7oMzDEV7LELxi7k0tRf/PD4+Skca6t/7sOXFKRJVRVJLWArxzJaoPNiCJQ1JsUNe/lC9JqZ16fg1Oky8NC3yVbLXrC/6XkIVUeEjAeFWqnG95AznSYNRSRPNzL2iqtB7IV1Ok0jZBL66RKDR4940QFNwOfX1HKw6pGH1A0VwWtMquuPkobCyhwY3Tqhcbxxuz7eaNMXxGURU2lPLDq27eJf511gsnlkARYcBy6xRnR7qVjugX/Ezme2XoCetZf5pRppiDiXV1lCXRb8yElZOD1qAGKrD4JOB0d0kqVTzSB0Ks7Onm3Xl6TT6XMs2vPWKpcCqGfp0QANhmieE3rGaE77UDrJHB1kLGrTIF5WE0EAiz1DzSosMw7a/mYvh9DE1W1s75fvSqIemdvP5O+5fGS6o52SdR7gLB3RDwFqRIXLSB5ZIyZUZT0xjTsAUrsA5mTPZgChLV7c/7gOGstylDOxZMuJZyDBt77imNLmZARQ7ElQiIzbazZ4Xy18VsERyR0EVzsiCoSvdDyUrT3s5HALRuNCs4vC6MJ1TZCw07Uyst7y4BKU5PU2ZHwfZRaW7zGsXwEQcQqcRJ8jFpo/dbyYYUAU3p/5EuUCxA/DFME9URi0M6j6tYr6mAq4430w6JIvYWKhOzE0TcEHyPvEVf8mOrcndkyIQTIAxcACYujy48fDZLg9R5Shi6qiugMOnAtc3tEknItPYmarAz4YSpUH+PBIWYMlPsV/eEx+zSmIw1gODvHG93u+pKI9LRiYk7zizmsqjAccx/kKeHe3bQbAp1pERUT4SOGUSJMx7t6LiPxyRR+UsKQJVv8DD+vJwJTRGSyPu7vG1gtCMAqUuYj3yGpXd6bUM3SgQazlyMUoNks2Yvy3sqxs2Qj4nxvxWv+LKp/qpJEZATx9M7Fy3CNYgCC0v5TfQFpzc+bhk4A8SjDrRLUgKCM6VwkjuPRr4PzclLfs6wU/O1/vXIdU7Uh+X7ce6xtiSBoUq7TGCFzzitMAH5GEN/jMyJwoKLdY/zSDyrRKONaIe9/oQy4/arP8rGZ0u6hdM7iHHyOUyCmci+SJqDk3k/s0g8mwQ5CuyGA4ARtr12jkA5BPJKkERqvHm0VTo9Qw7GFwhCguc5l7SV/WMFdkeeBNF/0DdT9xsBEgbdSUdCF7vTtRF6bETix7wIvEA8+AQz1X1MiB3I40ZVfr61XfTNAFvJ2wqSA1k7l7MT96ZD/0qWy15BHbgGMWk6iAduSsmJk/+dNX7xQD3sSdgLtwYnPULzCjQ0gTnLVwyMgwx6ILD1t8eFUIwsy6XAcfZ0r0w71kl/TJHI+T4WM0xwXX8eDCQN/8Umu2owyrPjQszNg861QfV3d+6n+GWHAo4/DIV/jXPa7YV8mEsQTscJKL0ZMTGvJ7/QDZLQBwVGugmvGnNtw5XOsY+3ge22Ay12OHeH5A7ODMJ/tvJzLN59K8v6j8UIsTyF77zu1cEETurRpsSS+Jgs5jMkhQLQFdEcgcR0v+rf98VJPBCBTeU/gnFLK778XIwcUefJIbyULttu8IExzhqSV4SgOBCspbPMhj0PdNCJQUYzwqs4OLtKEZDDjOC+nvCbbCE9Z001knWIILsgLj3vlMJ+jrySWAQOtz/r0DRLxwIPxdAKQSUzdatieIHKk1EwS/g+FjDu7YP9j4zsUnIHQbobLkRx0cLZzgKR6cPH9jMsaPXlB0lPG45RQMhzNuzR+hxK6xDVygq87fBKMC9+4ozO0gNGT7hMLhj0K4QNDfNQCcM/9EntOzgkiPdPCcxV/5xxvu5AvGKMMBEHiBq6zu9QclHBPk20kX4EV/XfLTZ2X4YajttPFAHScg+s+7nHikXQvos4vk0vne9y/dcNBRIDR1Q5uO1Q86UCTI5h0TWD07TrbEm31IbJD08N/EDwsUQtzLv2yl1QzAnePOfuznFPAADMx5Faxg44d20etagEV43bjtbC0PQhrXO5ychDz1oLHv87sJTv5H5qS1rQ2odo+l3uJ/PJgxSNck/uQ8N1wiz8+BTHcM7FTMaA6LHSrc28RIqHkOpI47y9LvpxUMEOjPNRPoUwN6Kso3Xaxe1Oag7JAkszrKx/OeQJVtAGyxx+1bBY7z3+XwvQEazHEjpLLcUzmwNojQRQfMOCdfisXbhGCC9OQoynAGgxx239vNjLlNCxSDC75i6J8aDCDI3PUXMEbHaZ6+r2CgdDj0bPfgFhMh6q23pai0iRFguOvmJurG0ZftiODFMOh9o5heuksUqDyA+NkrjErrTWaU31yAhEUL7PYwIG8VpqXfo5C26RwYtRfkiuV65qP2MNstJwhwv5KGtrcxwE048IUJsEBXS2KgW3qIkrkHJMsECqsOqst3xdjFmSPYiHe90tS7DlAcKOlJG3BUS3B+ratSRG5Y/xDlJCe/MPa4n50ErqEUmKBX3ir/DvM79pTYKRzMXeOFds4zPDBXQPvc98Ajmzp2tCOI0KQlHXy8K+ai/7LSq9Ug3T06VIAHmLbMjw14KcD9iSPsRS9S+q9/Unh6zRuY6PgPpxPKumOcyLm5OVSzs8Mm3hLuA/bA4Hk6rHUXdt61yy6oT9EA3QnQOP8zFqhPcoyZ1S90zJ/zJvQe0x++rM4tS1yb45jmxMcI9BuI8zEtOGl/UuqlE0CYamEVUPWgLb8bFrvrgKSkqT9QuZfaXud673vUeM8xPMyMy4UKw78oVDKw70ELYFUzQ566I2UkfIUdANCECs8EtubrrXSx5TegnROxztTHH3wCnNRpGYhx92FOwDdXvFFJAOTgaDbPJc7fR5AAkSkjUKWn34r08xqX4tC5LRsgdqeActTjUpQxuOec6IxMa0Hq2POE2HAdEQS1/ACjCzsJQ8lwoTEe0IZXqi7cO0UUFQzIkPo0XiNfktX3e1RY6PhkwTwhdx9++ge6QJGVG+yP98kG59cvi/94uwEIiG5HepLKl2M4QbzmgNoQQ2c7YuL3lsx0NRCQqyf6oweDGrfawJn5CDR9+6+K4YNUcB8svejZgFE3abLxF4zsWKD1dJ0IA5Mjqy8v4KiPxPTAbOOygu4fYagnFLt82hxGd2j26OuQjFyI7MivMAivLNMQl874ha0IgIcLwB70w0T0Dzys6PaYYBeG4tcfc9BDWNscxxwwZ0x29oOo4G6VAxyaA+nLEbspf+1gkVD/sHeDpYLkP16MKEC80NXkTR9v0ufDjexa5O5wqoAMmzbTEGvPoHj5BGSK58bS/79BVA2gowDpFGrfiW7g+2woQ5DSdMIIN8NUMv8jowRn1P2UnNvvPxgzK//jGIqpAciA66rC5iNPjB3wuQjnUGHzdOrd53JASyDuRMM4K/9BbwOnovBhnQn0pqPp5xNDMePgKIKw87SGs6827BdfpBp4stzM8F0/fHL9A4esPnThxKxoI8dGbyEnu8BZFPIMkSfgQxvzSGfsTH8k2GB8F7Ne/R9seBtorUy8KFSrg18R55XoNozWlJ3UG09PZzyvypxOdNC0g2ffmybXamf4vHdYujBkl6ybH3OOZCBopQCdlDoTej82n7tkPbTGxH/3/5tFx10z6Exd/MI0ZmPKmyEPgogQIIVYrOxMv55XIkud4DLosniRfCafaC89q8f4SOzNOHrj8Q85v2Pj77xkMMrEZufAaxsPfsARgI0gs3BNU5QbIdufeC3Iu5iReCQfZftDK8K8R8jOfHk/9Uc0M2kf7jBgvMVQasPFHxnDhJAVuIu4pexMO5U/JM+lPDX4ubiIOCIvWydHp8loU9DTCHWD8uchO2a/8kRuzM9cacvBkwr/dFQXrJvkt7RXV4qfE1+QzDc4x+iWzC8nUus0n78YUzzfhIN/+vsYE1kD6ZxwTNqsdrfHYwEjb2QImJqgveBke5OvCA+JQC4QxbCiTDxDWK8uJ65kSGjgrI6YCuskP1FP32BkENWce/fMKxLvbPwJsI4otoBht5ObEPOR3DTIvrSWLDsfVQsvk7R4WczgTINj/IslU09j5Sh7ONxocqe/gwG7aMAXUJuYxJRnW4Hu/muHND8ExsSnLD0fT0cSw69oZ9jusIgwAr8chzSf3SSFuPagexu/ivUbV4gNQKB84rRux4Mq6gN26Dwky4i5MEubTbb4P574aNj07J04DZch0xq3y/iGKQRMiB/IivnrQ0AC+KAg9zhzp4Ty4gtnuDnkxpjQZForVurcg4vQaezziK/IG38mbv8/tuiM3RZElP/SFvSjJdvyGKwdFWyG/4+KyeNGKC1QzYT5zGvTWCLCj2WIYIz33NesN4MvvtATlnCJTRn4tF/y4v/q+qPRuKxRKVCbh6byzBcnzBQgzbUYBHtHZq6zt0zsWujuzPVoRQ8wcrPvevSPoRho2qwKNv7+xzezGLZ5OAi7q8GuzY7v7/AQ1NVDIJPzgf6q3xmwNmDv5SUwa8dKnpU/TkRzNQ8BBwAwYxZGnjeEQKZdLkTdV/Se5cq+K8kUzPlJOKxvrC67/uiQEETseUtYfFtpepbDIARWwQYlMVhNpyieicdevI89HqUFOByu/hqYf6LUtG0yOM1X4S7eosnD4vjQbTo8lV+k0sbrBKwiwOCpLNhhm2mSuONJRFqI7RkIEDRzOxK3o4Wci0T5nNqQBCMV/s+zv9SodQvMpuPb4vg+9cPxzMONDyB1K6ni7xMpjCOMyPUGlE8bef7m+2PwSHzSNOYgK79U9u/flTxvpM5wusAJT0HnAYPGiIVs0miLp+QDNmsoJ/GwlaTRsF+rv38uq1v8FjSeVMRoO1+axy7bicw52J20rjgYQ4GzNZO0sFWwmXyJZAPTbV9Jv9toZuCW7GE/6bNoh2Qf+khwaJVEQ0fN/2hbiRwSqHLYiEQrm7uPbceo8CYEbxx3vBJXr79788csMjRlmF/8A6uny4j744w56F+QQrf3d6RXoKf2UD/0UPguw+nTrvu3HABIP8xHVBpj4/u1/80gDrg1vDk8Dcfcd8XP4xQSeC3MKsAB395T0OPwVBdsIzAZS/7/4Jvih/lwE1AWiA+b+Jfu1++L/xQLSAjsBPv8y/uD+GgBkAAAA',
    carHorn: 'UklGRqQWAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YYAWAAAAAAYAFgAJABsAPwBeAFkA/f/a/8//KQBKAJIA9wCJAJgA7f/f/vP/9wGv/y//yAEpAmwBKgKPATL+hP17/mH+E/8AAC//pP9EAUf/s/uV/ikEIQVNAa/9G/xj/b3/rP9z/8AAJQKI/+v8sf5xAWECKwFyAXoBZADjAgcEHgPLAZ4E7AJN/1cD+AaJAqv8cfiq+g0AuASVAkcAZvsG90j7dQBvAcMAlP2U+3gAhgGm/7cAxf/7/h39DP2z/hIEogihAYj7R/75AY8D/wCU/8gBbf6RAUwLuwj5+s/2agS0CYgC2v9TBBADZQIVBS7+4vRN96X8i/yWBFsM1Qmr/HH14fz0AIIFbAR5ADr3TPLY/skKTQoaACX4k/V8/BYIdgeWAkMBaf0zAJ8FAQW+/+n8afw4/tkCOgPrAFIDEfwG/DQEHAVL/rH9MQECADMA1QJrCL0GsgQwAav6sPXm/EUOKRGmCToG8/2e+aH/2QRzBd3/4wBW/kwA3AQRBtz/DwFCAKoBTQO5BDcANffKAI0NdwTY+EP5lvxmAvcCvPvB/OT7iPxaBfEHOf9h+RD/xAAs+Ob+DQU7/cz5awIICPIB9vrL/wsEEgBx/NL/tAAzAY76WvtrAxQEhv0H/Uf8N/n1/Y0E5wfKA7z+0/16/PkDqATaCBgKMwJk/9sARwcbCeIDWQFY/FL7m/zxAOEBcAGLAhEAevce9rX89f/w/Nb7HQAKBIMAyQJjBlkAyfyA/i4DWAQzAGj9YgJtB8kEQwViCCoELv7I/oL9yvwlAjEFKvr7+eAE3wg1BJT7XvWz+UcC+Qv2Cm/9pfnLAPQGggpSDrYO9gpnAXb7q/1VBNkGJwXvAAgARAPZBegGTgajASX9Dv5nBLgCpPoU++/8RPx0/HUBPfrv91b9RQKlApMJIg6PAXTwBvg6/1IAgAABBrUB7PiN+XcDggesBaACqQSJBmEBTfu9+P79AP/7AOICPQND/zD9cwQmCQYGbAClBGcDnQN5/9n9CwJwAzP9gv1ZAycGdAlhB7UDEAP2/5f54vn5+c/9rAC7AkcEWQIN/+z56Pg1/6MClgZbA737Rvkp/bgBowg8CeIGSgJ2Ah8CQvzO+YT9oP7nBrQGm/ok8nb6CQPL/nH5ivxzAcIDRgUzAT3/LAB4Bc8GFwVBA9wF0wqBBhH6uvf0/yMK1QSqAHb/hv2b+PX+fgWrA/z3VvGM+hwDigB4An4A0/wS+mcBoQaOBPv+VALRAm79p/sx/HUCTQrxA3cBawVqA3r7WwJABTH9a/rX//H/LPl5+mMEvQYjAFz6GQDYBP0COQCS/mj+Yv3DAeUHSwbC+4D6lwT7BvgCCfwl/LX7iwEaBMMAKwiiBsb6f/c0/Tf8zAbjBjf8yPx7+sz7oQSZ/vIAVwkADr0CO/kp/2ELfgJJC24U2gDG9RsJe/qA8Sz/TAOfAmUI1APhADcAT/zU/PT8UP4AAX7+xQRyBZv5/v2HAtr7mAK8AyT7z/6vB4MSngus95P67gUQ/U7+Egm+B0P+E/pr/9f/tv43/Rb+hP4VAnwCeAX5/hAB/wPaBg0M7gTO9Ur+oQl5DJoCSvrP8oj/bA2iCfAAXPsd/Yr+KQu8BKf2xAeHBvL8bPzt/HT+VP9dCe786v3rAuIPaACV86AFAwuPB779S/dCCGQOHwKyDCMNewhICHf43/U+BqQUVwtT+o7yxfK8+9QAmAEM8/v4XgoB/I4AKge79jD1RwWMDikJ5vwLBgn+bfbE94gGYgenBQwAofmr7t8MxQ+j9rED/RSODX38mwaA/TfnIfwf/WIIIwud+PgAyf1g5N7i+vwBDOTvzALtHYHoBODOC74W4STRKKT5m+MpApwIe/SrA/4eIwPn0dLrM/kaxlTr7jBUMr4foM9HxlUjyESEBXzfD/8GG1fTTu0JKk/hcKwF02Aq81Y9H8jKDO0rOVn3Y8rGEoxu8yD8srroCgMTwP26qRqjcPpFNJPHqvYx7DZf8H7ogVvdG7ORqfurbcz9dqAg57xpJk0ZwvTF2Dk4P7DbRcgvHLlRgPRp26srHexcj0Lio3DPb/3Q6KDkEYY5WhZz7w0OOl+021WxaQtVOkLbW68EO6BcC+TxyTUSFDyzElLauum8VuMelbbECkdDB81tpLvtrGhjYd/AM722GsQqIhDk099FxkkytyPl1kxN/A6mqQlSbRgTzMta4e8Rth4EDur8G/qiFKEC/O73NBMI1JxTCfVeVByF0zkRYwg12eMpzQ1q1loswBAc+KbtCgRu8xTpnitDLPrvXgupA8DUfBG/SQfhJOgjKIHlNeD8OHDzP8M1EANFTg/TyNIQRvvS/yBcm+4Kze8hbxYF3MoK4hWfr3DilmECKxPPE+BIGMoTKQRL/RT7tB66JjLm+egs/V38SQU8GZQjYdqe5mQTkv6mEycPWAfkASXiIPbhDLMc3Ae69ScF4R2c/kzgAfnFH/8OKerV/zML+QBf+NkKMe8C3SUFFxPtMlwd9c5P27AMJyBAApsL9gGD4MH+gRHV4W3sNxyCE7X9kt8a5lQIPCb2HBv8LfTO+6f/XgVgCAzliOhfBd4CPwl7CKr1aPsU/Zb1Svp8GrUe1QGq/Mz8ndtG8y0oSgCN+F4Xn+vS3aEQRRAd/jECFPr052YLzhIe7xr/dRZh7ufs7DYC/WDI7RJCGt3crgO6COPyUA6mFj7M4scPHc8asQkoMH/vV8OpBjwfdOZEBFUhPN7G90gfptKwym8eCiPc+5wBHfWf6SQfSx718vPz+wQ+9SQEOxua6DDJVRscFAbjLQ51FcPpmQIy93zsJQW7LlULP/uAEAPYc7w6Ht416/Va/NoKE9cq9osQ9wG8BYf90OVF+OwjyA7j3PgBNRU67ywDXQhm8LcDigaD7J3sivwmB4kS9BoI2baxb/d6P28i8gev/i3aoOW1GGoMqPtjBWAADvfQ9qrsB9hYDuo72Omp2nn9IwPfFKQcgfTG7OAArQhk/HoCCfnz4GYCKRBP8TsKzxiN3/bl0Qxj8/f6yivbGQLtfvOg88Xc9PviCpgNIxW3CYDRYeV8FdT7wfLJEngDgOflDrIaNe2d8NcF4Qc5/30J8Odb+QIdQPds12EFFyGQ/JD1TPbf34TuPzCbMMr+jgB1+6nuye+59bLsEBv9KRL79edm9NbgB/ILGqQFD/LpCUkZXwQ0AI4G/ej//v0RR+ci4FIclBlg54Tpdg/q+8Dwgw7dAQTvh+0l894cGy0J8ereRA928/7IfQBgNg0ayuT8/kb6Wdsi5eEH4w/+GwMAauxMBEUKJ/VpCakS8/sg82sAoxmqB9bkxt2cBFQN/vK19u4eLQlM7P/9/xbACiYJthMB+m/Wxte0+vQvLjN38RnSefTC4obkjBqoI9QU9ACqC2X7kvtYBF7xE/u0B1DqAu4RKXoVueVe9mz5QvHwDTgaLxIxFhf1XNSgD68wEAKn68oLuP0Az/4F5SXTEEX7e/qf+l7wJvpT4kYCqSW6/8ryZRN3A0rjrAZ6BRXpYv8sJgEZMfAm79Pce+yFFgr+ienHCrAdut2M+5kndAig/98IrPKJ6An6MQFo8EwdNg3K2VP/4gn93cH13jD9JlDdpgApJ0wGtvXQ/7nrjv09FHEV+AAQBRzj8O2MKeUK9tch+Vwx4Q717zYMwAfa+aQRbAZ24pT/0vxr/A4NRxws6aPaxRVmB+rXEflIE3j5tPRQHRUFtuOJ8sL5o//HGuv3at/nAOIcDu1y46kAaPXI8Nsa9xdF94Dmo/sCEV4jwfth3YoPAxpa7wL6uwsh+9r3xgpL+lzs7f5WBBYV1SzP7h3qvfuzDwD26/c8HIkA1+kZCKj5HvlW/nfx2f1cJlcJZuV8DMoT0ud9+DwUpQIt/oURewFj6HICOwekApcv5xLU0fjoKQ/tAML1bxWlD671Jgs0AijkRfv1+w8ARxxCCJHvJwZNCYXmdN0dAaQgPQexC1wAZvU27WQJ8QnPBU4Ll/inA0n4zvPt+EoBNwD4CLf9HOrw7pz9YfxXDWgYcQQV9Rv8KPT+9lsEGhEQAMcP/RSb9knkQe1t3p/+7yDxExL/bQmG/x/3+f11/NgFuwi+D7L7GPqD9QH0pw/EGjzysN3v/a4Gx/PAAisPCveH8rYYgw9H5y/sHPeHAtAZ1hOsAUz/+QSJ9FDwQQec/i/dUxQyJwX9wu4CAioDxf9s+ynvywLBCpgO0RFVByzoJfELGdQZ1eXB3SkF2hQ0IG4Wef9y8VD5jgnM+w0FiAdNAMQW2xpp+V3zFgQ6DUgEjwAw5hjzXBABG/8OjwQR+qvefPIaDFQBiAX2FooIOPY5/0L2rfhaB8n7RO+1Dv0cI/YEC4QVv+Uk4CP/nROc/iX/2wQ3+U8HiA3T8FICKwMX29nqRiN0CAz7EwmtA6/tpvkf9bLybw0/BdD/qBP+FDjdF/GeJaDwstu1DjAgTAM3B7wHP++N+yQL4e5CB3whnPVI8uwLnQRz7qoVTBFB7zbrB/kE+IETGRAS/VQHKBCl48HdnxrzCC3lphodGanmV/cDIIn9DN6b/i/7gPwLHjMJS+Cy/qAJvew7A5wShfb38C8MXgM47AIA4hSxDCP8R/7b91AUMhZJ8tH/EhAZ+l31LQ2LCSPynPpyF1MRx/ahADL+Hv1OBP3xz/bIFH8Vz+rW/ToCfO/y/E0dnwR+59r8QP9g+Sz6tgmPB9UAjQ5iB3j9ZfkV/x759gDpC8QGkAPT/rn78/RcAOb7NAQSCE4CFP75Akb3UfzYDUUNWPEJ8L4IzBWO+OX51AJW8SjsvQ74AsX8C/5iAqEJ3RfiAv/wKP1PF1z71OvdDYcOcwQADicMC/S55n36EwlSGgcSbv9m8zcGugUT9FkGkhBg9IX45Q9QDYP4B++qANwB5/Od95QFNAYN/h755g3kCj/6x/umCqX1TOtQAzwKYQA0C/4AdPxJ7p3rc/Et8jsSDA5T+f39EQdZ+uPpwP9wDIH5gfI6DREPY/lf79b2Uv7c/Pb8JQTjBvP+jPZkAScXZwi57UsBBBBE9QTuY/1bF4IQTfVv98P+YPrz+/oMARhA+JjqPQxkFiX/wvHh+OwNP/zO9jQBkgSbAF73d/6l8z70IvfQCrgW8f4p+LX0YgMoEcIBwPxn/93/AgcVDcQN2ww57hbx5AP9AZD7+QncEHQC9vkgC+wJ3vOr870XZiAwBAn7nwjUCuj7bvip/MDwIgdoGasFx/uF//L06/+7Gi0MNeuDAVATR/qU9roER/+nACgIQQXf94b8zv4iBlMUNPwT5yb8ARP+/TLzkwfb/d72dQgsERf7yOl19sIGnQXVBgsGX/8lBar5F+4e+aAMehW1EE8FnfeW8An9gQteBRD9dAMOBIP9ufJi67zumgdOD6cDfQa0Bi/2Z/oLEBAN8fgP7Uz98gxMAN0AWgs6/qn5xf3TC64D7+1P+fsJRgOCA+MFKQk7BXz4o/qiCyf/DP75GWQTuupo7OsEvAlGClIDgvbN+zQNzABU8RsFtgfk/30H1g0/9EjskgtyE5IER/x+9c7yMAroCFX7bAQ+CBb6af/VDPb/t/HtALUGEfh1/vYMCwO99vL3/PTEBI8HmP85AI4B6/H3878IQg4fC2UEAvij91QEOQLH/McLWxAkArH9Bggw/HDw6/2RB5cLEQYk+5r8MBdGBWrpFvY4C3YHegUpBgv4ovJH9v32qgD4B/cAa/weBjMAauhl/+oj2Qxt9OH8Nviu9rcLVg3L+sv8KAFn/WEGmAJW8xz9cQ2ZAOrwBPvLAwP7SQJ3CHAJRQbt+lf3MgPH/4Du0Pf2C5gIWPy//kwBn/OJ+1AIqwZ7A3MCNQAY/rQFYvoY+GUNgRL79tTw1vy2A3YFfAQ0/Mb5VgfeCpsD8wTi9Tf0NAjSFj8IT/h5/5wHagLw/U3+9vYVAGoOXAp/Bo3/4fq+/U4GuQPO9cnylP85DqMGH/ro+G0CxwGw91r8zgYCBLD6awJSCor62vLLAtQM2AAf9boGAxHP/lDxLvW5ATP+uP5cA+kP2gaZ7br0oAq4A0n3+AKwC4YBj/3b/fICDP76/M4HQBXqAhDyyAIaEXv/5u0ZACEKKf8HBQcOJ/1Z9Sz+kwStCcQK2fot8kb8xfyA+CcH2BE4BuD7vgL6/Ir/RwWIAqID5Qx2B0f8DgOPBSn4YvYsBBMEL//IArEI8fyM8YwBCwPm+ML14PodA5EF3v3kAzcM9QLD9Wj1J/4/+1v72wMADPME5vxD/8v5CfqR+4X+iQR0CVEBdP6vB6f+cev49v8SjwsbAFQK5hCS+UPwUQCeDkwIaQMUAjgCcPyZ9/79iA4uCRP23PxPCMj9nPTPAiEN2gJY+qX83vgK+q7/BwLoC18KOAArBhEXPgtO8j/wJwIMChUF6QPOCHoKiPfV9WABdwqb+7r7tgmjB+T3vvQj/1sJav2A9qn86PrS9/n9AAkZCDzz6vUbDRgFC/SO+s7/jAMOCGr/x/mdAeP8DvWN8ywACgbj/ScK7wi28dDx4fYcAA4OPQrY8uT9pwzpBj8B/QBQ9wzyWQcSGkIIx/WJAU4Fi/7PBjQK3AHjBUEBQvGe/akSHAKh9jIHev0C9df51gk3BWH/PPqj+FwA3goy+XL3gQeFBcX5HgR4BMD1svqoBOQGxAFwAv4DXf/c+F4EGw6bAyf5UgPJBer/vPkF/yYFbQjTBloEsPmn+3L9uPo4AI4Ccf5UA0cIj/3L9r3/tgSOBWP9NvVM/JgH7wPc/d8FsgOi/QX+8AJM9+v1zwQCBFUBTgSBA+/+UwPx/374hQhwCUP2TPt1BWMBs/zUAEQCyADjAJMChgEoA0ICSwCB/kYGdv3W834F9gxU9qT2AQPhAdb95gBp/gb5zgFo+5v22QNYAeD95wrqDqD4+O4VAO4G7f+R+nUBYPxjAWcEAP40/IoATgawAncGnP108Y34rwcWA/L9pv9h/v7/aPvW9/YD/AQlAcL8sQbVBkf74PpuAp/+WfwpBTYGavpV8X78HwPWBEgD1wAVAvoCn/dr9V0D7Ava/z/91/uC+WX8YwkQCz4BDPzm/8wCwwefBd4HMQZ5A+r7Z/az+u0HEw1Z/M767vvf/c0ERwej/Sb6a/7W/A38m/Ty+WkM1w8h/3L9MgTZB1IIcgY8//n6fgJ8ALL/oAKeADH+LgMeBP79JvwOBgn98PwTAi7+EAUMBhYDjv1m9Vj42/ywCjIT8QHZ9RQDaAYR/9j9PgAlAPgLmwcp/Db/E/0S+ZEHRwtb/G/sZ/9IDWwAx/txA1wBFAImA/n53vix/a/8sQXuDtgDXfTH/zsB8f1zAtMJMgCO+30GugVbAVv9Nu++9hoLTQkx89IC9gfp8uf2Fvzn92j8DQsaDpUB1v129VT6XxKVD3b2rPNlBLYGl/+0DBcKIPs/AzsJKv9f9TT18ghxDvb9ru5D9RIPoQtZ+vz2a/q++QoBGAoPBED8rf4RAbv+av9qACIG5A1ACEX/APn9AQkGaAZrAWz+D/+Y/on+Pv9Z/iX9p/39/2X/S/7J/o4AT/5R/mUB8gT0AeH8zP3UAuMB8AHJAU0BFAEHAYn//P03/2f/6wCbAvYA+PuD/OsA0wCb/t3+6v8AAJz/KQBJAQoBFQD7/4EADgB//4v/PgA2APL/AAA='
  });

  const AudioFx = {
    ctx:null, enabled:Boolean(save.sfx||save.musicLevel>0), failed:false,
    playbackBlocked(){return Boolean(platform.pausedByPlatform||platform.browserPaused||platform.adPaused||(typeof Game!=='undefined'&&(Game.userPaused||Game.externalPaused)));},
    musicGain:null, sfxGain:null, musicTimer:null, musicStarted:false, musicStep:0, nextMusicAt:0, musicNodes:new Set(), musicThemeBand:-1, musicTheme:null,
    sampleBuffers:Object.create(null), sampleLoadPromise:null, sampleDecodeFailures:0, lastEmergencyCueAt:-99, lastEmergencyByKind:Object.create(null), lastHornAt:-99, vehicleSamplePlays:0, stereoPanPlays:0, vehicleVoices:new Set(), vehicleSampleCounts:Object.create(null), dangerSwitchWarnings:0, emergencyApproachPlays:0,
    generatedBuffers:Object.create(null), transientVoices:new Set(), roadBedSource:null, roadBedGain:null, roadBedFilter:null, roadBedStarts:0, roadBedUpdates:0, lastRoadBedLevel:0,
    brakeScrubPlays:0, busAirBrakePlays:0, crashImpactPlays:0, crashLayerPlays:0, lastBrakeScrubAt:-99, lastBusAirAt:-99,
    resumePromise:null, needsGestureResume:false, resumeAttempts:0, resumeSuccesses:0, externalResumeTimer:0, externalRecoveryBatches:0, externalRecoveryCoalesced:0,
    embeddedBytes(base64){
      try{const raw=atob(base64),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes.buffer;}catch(_){return null;}
    },
    prepareSamples(){
      const ac=this.ctx;if(!ac||typeof ac.decodeAudioData!=='function')return Promise.resolve(false);
      if(this.sampleBuffers.emergencySiren&&this.sampleBuffers.carHorn)return Promise.resolve(true);
      if(this.sampleLoadPromise)return this.sampleLoadPromise;
      const decode=async(name,b64)=>{
        const bytes=this.embeddedBytes(b64);if(!bytes)return false;
        try{const buffer=await ac.decodeAudioData(bytes.slice(0));if(this.ctx===ac&&buffer){this.sampleBuffers[name]=buffer;YandexAudit.mark('audio:sample:ready',name);return true;}}catch(err){this.sampleDecodeFailures++;YandexAudit.mark('audio:sample:error',`${name}:${err?.message||'decode'}`);}return false;
      };
      this.sampleLoadPromise=Promise.all(Object.entries(EMBEDDED_AUDIO_SAMPLES).map(([name,b64])=>decode(name,b64))).then(v=>v.every(Boolean)).finally(()=>{this.sampleLoadPromise=null;});
      return this.sampleLoadPromise;
    },
    prepareGeneratedBuffers(){
      const ac=this.ctx;if(!ac||typeof ac.createBuffer!=='function')return false;if(this.generatedBuffers.brakeNoise&&this.generatedBuffers.roadNoise)return true;
      const sr=Math.max(8000,Math.min(22050,Number(ac.sampleRate)||22050));
      const make=(name,seconds,mode)=>{
        const n=Math.max(256,Math.floor(sr*seconds)),buf=ac.createBuffer(1,n,sr),data=buf.getChannelData(0);let seed=(0x5eeda11^name.length*2654435761)>>>0,last=0;
        for(let i=0;i<n;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;const white=((seed>>>0)/4294967295)*2-1;last=mode==='brown'?Math.max(-1,Math.min(1,last*.985+white*.075)):white;const edge=Math.min(1,i/(sr*.012),(n-1-i)/(sr*.035));data[i]=(mode==='brown'?last:white)*Math.max(0,edge);}
        this.generatedBuffers[name]=buf;
      };
      make('brakeNoise',.48,'white');make('airNoise',.82,'white');make('crashNoise',.62,'white');make('roadNoise',1.6,'brown');return true;
    },
    playGenerated(name,{rate=1,gain=.04,pan=0,duration=0,filterType='bandpass',filterFreq=950,q=.8,attack=.006,release=.18}={}){
      if(!save.sfx)return false;const ac=this.ensure();if(!ac||!this.prepareGeneratedBuffers())return false;const buffer=this.generatedBuffers[name];if(!buffer||typeof ac.createBufferSource!=='function'||typeof ac.createGain!=='function'||this.transientVoices.size>=6)return false;
      try{const source=ac.createBufferSource(),g=ac.createGain(),now=ac.currentTime;source.buffer=buffer;source.playbackRate.value=Math.max(.5,Math.min(1.7,rate));let node=source;
        if(typeof ac.createBiquadFilter==='function'){const f=ac.createBiquadFilter();f.type=filterType;f.frequency.value=Math.max(80,Math.min(6000,filterFreq));f.Q.value=Math.max(.1,Math.min(4,q));node.connect(f);node=f;}
        node.connect(g);const pval=Math.max(-.8,Math.min(.8,Number(pan)||0));if(typeof ac.createStereoPanner==='function'){const p=ac.createStereoPanner();p.pan.value=pval;g.connect(p);p.connect(this.sfxGain||ac.destination);if(Math.abs(pval)>.02)this.stereoPanPlays++;}else g.connect(this.sfxGain||ac.destination);
        const life=Math.max(.05,Math.min(buffer.duration/Math.max(.5,rate),duration||buffer.duration/Math.max(.5,rate))),peak=Math.max(.0002,Math.min(.35,gain));g.gain.setValueAtTime(.0001,now);g.gain.linearRampToValueAtTime(peak,now+Math.min(attack,life*.2));g.gain.exponentialRampToValueAtTime(.0001,now+Math.max(.03,life-Math.min(release,life*.45)));
        this.transientVoices.add(source);source.onended=()=>this.transientVoices.delete(source);source.start(now);source.stop(now+life);return true;}catch(_){return false;}
    },
    brakeScrub(kind='car',dir='',intensity=.7){
      if(!save.sfx||RenderQuality.level===0)return false;const ac=this.ensure();if(!ac)return false;const now=Number(ac.currentTime||0),level=Math.max(.35,Math.min(1,Number(intensity)||.7));if(now-this.lastBrakeScrubAt<.17||this.transientVoices.size>=5)return false;
      const heavy=kind==='truck'||kind==='bus',played=this.playGenerated('brakeNoise',{rate:heavy?.78:1.04,gain:(heavy?.030:.020)*level,pan:this.panForDir(dir)*.72,duration:.20+.08*level,filterType:'bandpass',filterFreq:heavy?560:980,q:.65,release:.12});
      if(played){this.lastBrakeScrubAt=now;this.brakeScrubPlays++;YandexAudit.mark('audio:vehicle:brake',`${kind}:${dir||'center'}:${level.toFixed(2)}`);}return played;
    },
    busAirBrake(dir=''){
      if(!save.sfx||RenderQuality.level===0)return false;const ac=this.ensure();if(!ac)return false;const now=Number(ac.currentTime||0);if(now-this.lastBusAirAt<.7)return false;
      const played=this.playGenerated('airNoise',{rate:.88,gain:.043,pan:this.panForDir(dir)*.72,duration:.48,filterType:'highpass',filterFreq:920,q:.55,release:.30});if(played){this.lastBusAirAt=now;this.busAirBrakePlays++;YandexAudit.mark('audio:vehicle:bus-air',dir||'center');}return played;
    },
    vehicleMotion(car,previousSpeed,currentSpeed,dt){ return false; },
    ensureRoadBed(){
      const ac=this.ctx;if(!save.sfx||RenderQuality.level===0||this.playbackBlocked()||!ac||String(ac.state||'')!=='running')return false;if(!this.prepareGeneratedBuffers())return false;if(this.roadBedSource)return true;try{const source=ac.createBufferSource(),g=ac.createGain();source.buffer=this.generatedBuffers.roadNoise;source.loop=true;g.gain.value=.0001;let node=source;if(typeof ac.createBiquadFilter==='function'){const f=ac.createBiquadFilter();f.type='lowpass';f.frequency.value=520;f.Q.value=.4;source.connect(f);node=f;this.roadBedFilter=f;}node.connect(g);g.connect(this.sfxGain||ac.destination);source.onended=()=>{if(this.roadBedSource===source){this.roadBedSource=null;this.roadBedGain=null;this.roadBedFilter=null;}};source.start();this.roadBedSource=source;this.roadBedGain=g;this.roadBedStarts++;return true;}catch(_){return false;}
    },
    updateRoadBed(carCount=0){ this.stopRoadBed(); this.lastRoadBedLevel=0; return false; },
    stopRoadBed(){if(this.roadBedSource){try{this.roadBedSource.stop();}catch(_){}try{this.roadBedSource.disconnect();}catch(_){}}this.roadBedSource=null;this.roadBedGain=null;this.roadBedFilter=null;this.lastRoadBedLevel=0;},
    stopTransientAudio(){for(const set of [this.vehicleVoices,this.transientVoices]){for(const source of [...set]){try{source.onended=null;source.stop();}catch(_){}try{source.disconnect();}catch(_){}}set.clear();}this.stopRoadBed();},
    crashImpact(a=null,b=null){
      if(!save.sfx)return false;this.duckMusic(.08,1.75);this.stopRoadBed();const dirs=[a?.dir,b?.dir].filter(Boolean),pan=dirs.length?dirs.map(d=>this.panForDir(d)).reduce((x,y)=>x+y,0)/dirs.length:0;let layers=0;
      if(this.playGenerated('crashNoise',{gain:.105,pan,duration:.25,filterType:'bandpass',filterFreq:1150,q:.72,release:.14}))layers++;if(this.playGenerated('roadNoise',{rate:.72,gain:.095,pan:pan*.5,duration:.34,filterType:'lowpass',filterFreq:240,q:.45,release:.23}))layers++;if(RenderQuality.level>=1&&this.playGenerated('crashNoise',{rate:1.28,gain:.045,pan:-pan*.35,duration:.16,filterType:'highpass',filterFreq:2500,q:.55,release:.10}))layers++;
      this.tone(78,.24,.048,'sawtooth');setTimeout(()=>this.tone(146,.11,.022,'square'),48);this.crashImpactPlays++;this.crashLayerPlays+=layers+2;YandexAudit.mark('audio:crash:layers',String(layers+2));return true;
    },
    playSample(name,{rate=1,gain=.32,when=0,pan=0}={}){
      if(!save.sfx)return false;const ac=this.ensure();if(!ac)return false;
      const buffer=this.sampleBuffers[name];if(!buffer){void this.prepareSamples();return false;}
      if(typeof ac.createBufferSource!=='function'||typeof ac.createGain!=='function'||this.vehicleVoices.size>=6)return false;
      try{
        const source=ac.createBufferSource(),g=ac.createGain();source.buffer=buffer;source.playbackRate.value=Math.max(.45,Math.min(1.65,rate));g.gain.value=Math.max(.001,Math.min(.75,gain));source.connect(g);
        const pval=Math.max(-.8,Math.min(.8,Number(pan)||0));
        if(typeof ac.createStereoPanner==='function'){const p=ac.createStereoPanner();p.pan.value=pval;g.connect(p);p.connect(this.sfxGain||ac.destination);if(Math.abs(pval)>.02)this.stereoPanPlays++;}else g.connect(this.sfxGain||ac.destination);
        this.vehicleVoices.add(source);source.onended=()=>this.vehicleVoices.delete(source);source.start(ac.currentTime+Math.max(0,when));this.vehicleSamplePlays++;this.vehicleSampleCounts[name]=(this.vehicleSampleCounts[name]||0)+1;return true;
      }catch(_){return false;}
    },
    panForDir(dir=''){
      if(dir==='W')return -.48;if(dir==='E')return .48;if(dir==='N')return -.16;if(dir==='S')return .16;return 0;
    },
    emergencyProfile(kind='ambulance'){
      if(kind==='police')return {sample:'emergencySiren',rate:1.05,gain:.38,repeatRate:1.18,repeatDelay:.31,accentRate:.91,accentDelay:.60};
      if(kind==='fire')return {sample:'emergencySiren',rate:.76,gain:.46,repeatRate:.69,repeatDelay:.42,accentRate:.84,accentDelay:.74};
      return {sample:'emergencySiren',rate:1.23,gain:.40,repeatRate:.98,repeatDelay:.35,accentRate:1.31,accentDelay:.66};
    },
    emergencyApproach(kind='ambulance',dir='',proximity=.7){
      if(!save.sfx)return false;const ac=this.ensure();if(!ac)return false;void this.prepareSamples();
      const now=Number(ac.currentTime||0),lastKind=Number(this.lastEmergencyByKind[kind]??-99);if(now-this.lastEmergencyCueAt<.42||now-lastKind<1.9)return false;
      const near=Math.max(.15,Math.min(1,Number(proximity)||.7)),p=this.emergencyProfile(kind),pan=this.panForDir(dir)*(.62+near*.30),played=this.playSample(p.sample,{rate:p.rate,gain:p.gain*(.24+near*.30),pan});
      if(played){this.lastEmergencyCueAt=now;this.lastEmergencyByKind[kind]=now;this.emergencyApproachPlays++;YandexAudit.mark('audio:vehicle:siren',`${kind}:approach:${dir||'center'}:${near.toFixed(2)}`);}return played;
    },
    trafficHorn(kind='car',dir=''){
      if(!save.sfx)return false;const ac=this.ensure();if(!ac)return false;void this.prepareSamples();
      const now=Number(ac.currentTime||0);if(now-this.lastHornAt<2.8||now-this.lastEmergencyCueAt<1.35||this.vehicleVoices.size>=5)return false;
      const heavy=kind==='truck'||kind==='bus',variation=((Math.floor(now*10)+(kind==='bus'?1:0))%3-1)*.035;
      const played=this.playSample('carHorn',{rate:(heavy?.72:1.0)+variation,gain:heavy?.34:.25,pan:this.panForDir(dir)*.72});
      if(played){this.lastHornAt=now;YandexAudit.mark('audio:vehicle:horn',`${kind}:${dir||'center'}`);}return played;
    },
    dangerSwitch(severity=1){
      if(!save.sfx)return false;const level=Math.max(.4,Math.min(1,Number(severity)||1));this.dangerSwitchWarnings++;this.duckMusic(.58,.38);this.tone(205,.065,.020*level,'square');setTimeout(()=>this.tone(152,.085,.018*level,'square'),58);YandexAudit.mark('audio:signal:danger-switch',level.toFixed(2));return true;
    },
    attachContextStateGuard(){
      if(!this.ctx||this.ctx.__tpStateGuard)return;
      try{this.ctx.__tpStateGuard=true;}catch(_){}
      const onState=()=>{
        const state=String(this.ctx?.state||'');
        YandexAudit.state.audio.stateChanges++;YandexAudit.state.audio.state=state||'unknown';YandexAudit.mark('audio:state',state||'unknown');
        if(state==='running'){this.needsGestureResume=false;return;}
        if(state==='suspended'||state==='interrupted')this.needsGestureResume=true;
      };
      try{this.ctx.addEventListener?.('statechange',onState);}catch(_){}
    },
    tryResume(reason='ensure'){
      this.enabled=Boolean(save.sfx||save.musicLevel>0);
      if(!this.enabled||this.failed||!this.ctx)return Promise.resolve(false);
      // M159: authoritative external/manual pause owns WebAudio state. Delayed SFX timers or
      // gesture fallback must never wake a suspended context until the pause is actually released.
      if(this.playbackBlocked()){if(String(this.ctx.state||'')!=='running')this.needsGestureResume=true;return Promise.resolve(false);}
      const state=String(this.ctx.state||'');
      if(state==='running'){this.needsGestureResume=false;this.startMusic();return Promise.resolve(true);}
      if(state==='closed'){this.needsGestureResume=true;return Promise.resolve(false);}
      if(typeof this.ctx.resume!=='function'){this.needsGestureResume=true;return Promise.resolve(false);}
      if(this.resumePromise)return this.resumePromise;
      this.needsGestureResume=true;this.resumeAttempts++;YandexAudit.state.audio.lastReason=String(reason);YandexAudit.mark('audio:resume:attempt',`${reason}:${state||'unknown'}`);
      const ctx=this.ctx;
      this.resumePromise=Promise.resolve().then(()=>ctx.resume()).then(async()=>{
        let running=this.ctx===ctx&&String(ctx.state||'')==='running';
        // M160: pause authority can change while AudioContext.resume() is in flight. Re-check
        // after the promise settles so a late WebKit/browser resume cannot leak audio through
        // a platform/ad/browser/manual pause that arrived during the asynchronous operation.
        if(running&&this.playbackBlocked()){
          YandexAudit.mark('audio:resume:revoked',reason);
          try{if(typeof ctx.suspend==='function')await ctx.suspend();}catch(err){YandexAudit.mark('audio:resume:revoke-error',err?.message||'blocked');}
          running=false;
        }
        this.needsGestureResume=!running;
        if(running){this.resumeSuccesses++;YandexAudit.mark('audio:resume:success',reason);this.startMusic();}
        else YandexAudit.mark('audio:resume:not-running',`${reason}:${String(ctx.state||'unknown')}`);
        return running;
      }).catch(err=>{this.needsGestureResume=true;YandexAudit.mark('audio:resume:error',`${reason}:${err?.message||'blocked'}`);return false;}).finally(()=>{this.resumePromise=null;});
      return this.resumePromise;
    },
    cancelExternalResumeRetry(){
      if(this.externalResumeTimer){clearTimeout(this.externalResumeTimer);this.externalResumeTimer=0;}
    },
    recoverAfterExternalResume(){
      if(!Boolean(save.sfx||save.musicLevel>0)||this.failed)return;
      YandexAudit.state.audio.externalRecoveries++;YandexAudit.mark('audio:external-recovery',String(this.ctx?.state||'none'));
      // M144: platform resume, focus and pageshow can arrive as one lifecycle burst. Keep the
      // Hotfix03 recovery authority bounded to one immediate attempt plus one settle retry for the
      // whole burst instead of stacking independent 160 ms timers against WebKit's audio session.
      const coalesced=Boolean(this.externalResumeTimer);
      if(coalesced){this.externalRecoveryCoalesced++;clearTimeout(this.externalResumeTimer);YandexAudit.mark('audio:external-recovery:coalesced');}
      else {this.externalRecoveryBatches++;void this.tryResume('external');}
      this.externalResumeTimer=setTimeout(()=>{
        this.externalResumeTimer=0;
        if(!this.enabled||this.failed||platform.pausedByPlatform||platform.browserPaused||platform.adPaused)return;
        const state=String(this.ctx?.state||'');
        if(state!=='running')void this.tryResume('settle');
      },160);
    },
    ensure(){
      this.enabled=Boolean(save.sfx||save.musicLevel>0); if(!this.enabled || this.failed || this.playbackBlocked()) return null;
      if(this.ctx&&String(this.ctx.state||'')==='closed'){
        this.ctx=null;this.musicGain=null;this.sfxGain=null;this.resumePromise=null;this.musicStarted=false;this.needsGestureResume=true;
      }
      if(!this.ctx){
        const Ctx=window.AudioContext||window.webkitAudioContext; if(typeof Ctx!=='function'){this.failed=true;return null;}
        try{
          this.ctx=new Ctx();
          this.attachContextStateGuard();
          if(typeof this.ctx.createGain==='function'){
            this.musicGain=this.ctx.createGain();
            this.musicGain.gain.value=this.musicGainValue();
            this.musicGain.connect(this.ctx.destination);
            this.sfxGain=this.ctx.createGain();
            this.sfxGain.gain.value=.88;
            this.sfxGain.connect(this.ctx.destination);
          }
          void this.prepareSamples();this.prepareGeneratedBuffers();
        }catch(_){this.failed=true;return null;}
      }
      const state=String(this.ctx.state||'');
      if(state==='running'){this.needsGestureResume=false;this.startMusic();}
      else if(state==='suspended'||state==='interrupted')void this.tryResume('ensure');
      else if(state!=='closed')void this.tryResume('ensure');
      return this.ctx;
    },
    tone(freq=440,duration=.06,gain=.025,type='sine'){
      if(!save.sfx)return; const ac = this.ensure(); if(!ac) return;
      if(typeof ac.createOscillator!=='function'||typeof ac.createGain!=='function')return;
      const o=ac.createOscillator(), g=ac.createGain();
      o.type=type; o.frequency.value=freq; g.gain.value=gain;
      o.connect(g); g.connect(this.sfxGain||ac.destination); o.start();
      g.gain.exponentialRampToValueAtTime(.0001,ac.currentTime+duration); o.stop(ac.currentTime+duration);
    },
    musicVoice(freq,at,duration=.16,gain=.018,type='triangle',detune=0){
      const ac=this.ctx;if(!ac||!this.musicGain||!this.enabled||save.musicLevel<=0)return;
      if(typeof ac.createOscillator!=='function'||typeof ac.createGain!=='function')return;
      const o=ac.createOscillator(),g=ac.createGain();
      o.type=type;o.frequency.setValueAtTime(freq,at);if(o.detune)o.detune.setValueAtTime(detune,at);
      g.gain.setValueAtTime(.0001,at);
      g.gain.exponentialRampToValueAtTime(Math.max(.0002,gain),at+.018);
      g.gain.exponentialRampToValueAtTime(.0001,at+duration);
      o.connect(g);g.connect(this.musicGain);this.musicNodes.add(o);
      o.onended=()=>this.musicNodes.delete(o);
      try{o.start(at);o.stop(at+duration+.035);}catch(_){this.musicNodes.delete(o);}
    },
    musicGainValue(){ return [0,.28,.45,.60][safeInt(save.musicLevel,0,3,3)]||0; },
    musicLabel(){ return ['0%','45%','75%','100%'][safeInt(save.musicLevel,0,3,3)]; },
    setMusicLevel(level){
      save.musicLevel=safeInt(level,0,3,3);save.sound=Boolean(save.sfx||save.musicLevel>0);this.enabled=save.sound;persist();
      if(this.musicGain&&this.ctx){try{this.musicGain.gain.setValueAtTime(this.musicGainValue(),this.ctx.currentTime);}catch(_){this.musicGain.gain.value=this.musicGainValue();}}
      if(save.musicLevel<=0){this.stopMusic();if(!this.enabled)this.suspend(true);}else this.ensure();
    },
    cycleMusic(){this.setMusicLevel((safeInt(save.musicLevel,0,3,3)+3)%4);},
    setSfxEnabled(v){save.sfx=Boolean(v);save.sound=Boolean(save.sfx||save.musicLevel>0);this.enabled=save.sound;persist();if(save.sfx)this.ensure();else this.stopTransientAudio();if(!this.enabled)this.suspend(true);},
    musicProfile(){
      // M84: every ten campaign levels have a distinct arrangement identity, not just a new key.
      // All music remains procedural WebAudio to keep the Yandex build tiny and offline-friendly.
      const level=typeof Game!=='undefined'&&Game?.level?Math.max(1,Game.level):1;
      const band=Math.max(0,Math.floor((level-1)/10));
      if(this.musicThemeBand!==band||!this.musicTheme){
        const roots=[261.63,293.66,246.94,277.18,233.08,220.00,329.63,196.00,311.13,207.65,349.23,174.61];
        const progressions=[[1,5/6,2/3,3/4],[1,3/4,5/6,2/3],[1,2/3,3/4,5/6],[1,5/6,3/4,2/3],[1,4/5,2/3,5/6],[1,3/4,2/3,4/5]];
        const arrangements=[
          {name:'Green Pulse',lead:'triangle',bass:'sine',accent:'square',bpm:92,gate:.72,pulse:[0,4,8,12],octave:1},
          {name:'Coast Drive',lead:'sine',bass:'triangle',accent:'sine',bpm:98,gate:.86,pulse:[2,6,10,14],octave:1},
          {name:'Downtown Sync',lead:'square',bass:'sine',accent:'triangle',bpm:104,gate:.48,pulse:[0,3,6,8,11,14],octave:2},
          {name:'Airport Run',lead:'triangle',bass:'square',accent:'sine',bpm:108,gate:.60,pulse:[0,2,4,8,10,12],octave:2},
          {name:'Harbor Beat',lead:'sine',bass:'triangle',accent:'square',bpm:94,gate:.78,pulse:[0,5,8,13],octave:1},
          {name:'Night Circuit',lead:'triangle',bass:'sine',accent:'sine',bpm:102,gate:.92,pulse:[1,4,7,9,12,15],octave:2},
          {name:'Neon Express',lead:'square',bass:'triangle',accent:'square',bpm:110,gate:.42,pulse:[0,2,5,8,10,13],octave:2},
          {name:'Metro Flow',lead:'triangle',bass:'square',accent:'triangle',bpm:100,gate:.66,pulse:[0,4,7,8,12,15],octave:1},
          {name:'Blue Hour',lead:'sine',bass:'sine',accent:'triangle',bpm:90,gate:.96,pulse:[2,6,10,14],octave:2},
          {name:'Pulse Rush',lead:'square',bass:'triangle',accent:'sine',bpm:112,gate:.38,pulse:[0,2,4,6,8,10,12,14],octave:2}
        ];
        const arrangement=arrangements[band%arrangements.length];
        const rng=seeded((0x51f15e5d^Math.imul(band+1,0x9e3779b1))>>>0),melody=[];
        let degree=(band*3)%5;
        for(let i=0;i<16;i++){
          if(i===0||i===8)degree=(band+i/8)%3;
          else {const steps=[-2,-1,1,2,3],step=steps[Math.floor(rng()*steps.length)];degree=Math.max(0,Math.min(7,degree+step));}
          melody.push(degree);
        }
        const rests=Array.from({length:16},(_,i)=>i!==0&&i!==8&&rng()<(.10+(band%4)*.025));
        this.musicThemeBand=band;
        this.musicTheme={themeBand:band,name:arrangement.name,root:roots[band%roots.length],bpm:arrangement.bpm+((band*3)%5),melody,chordRoots:progressions[band%progressions.length],leadType:arrangement.lead,bassType:arrangement.bass,accentType:arrangement.accent,gate:arrangement.gate,pulse:arrangement.pulse,octave:arrangement.octave,rests};
      }
      const base=this.musicTheme,weather=typeof weatherForLevel==='function'&&typeof Game!=='undefined'?weatherForLevel(level):'clear';
      if(weather==='fog')return {...base,bpm:Math.max(82,base.bpm-7),gate:Math.min(.98,base.gate+.12)};
      if(weather==='rain')return {...base,bpm:Math.max(86,base.bpm-3)};
      if(weather==='sunset')return {...base,root:base.root*.9439,bpm:Math.max(88,base.bpm-1),gate:Math.min(.96,base.gate+.08)};
      return base;
    },
    refreshMusicTheme(){
      const level=typeof Game!=='undefined'&&Game?.level?Math.max(1,Game.level):1,band=Math.max(0,Math.floor((level-1)/10));
      if(this.musicThemeBand===band&&this.musicTheme)return;
      this.musicThemeBand=-1;this.musicTheme=null;
      if(this.musicStarted&&this.ctx){
        for(const o of [...this.musicNodes]){try{o.stop();}catch(_){} try{o.disconnect();}catch(_){} }
        this.musicNodes.clear();this.musicStep=0;this.nextMusicAt=this.ctx.currentTime+.06;this.scheduleMusic();
      }
    },
    scheduleMusic(){
      const ac=this.ctx;if(!ac||!this.musicStarted||!this.enabled||save.musicLevel<=0||this.playbackBlocked()||ac.state==='closed')return;
      const horizon=ac.currentTime+.85;
      const scale=[1,9/8,5/4,4/3,3/2,5/3,15/8,2];
      while(this.nextMusicAt<horizon){
        const profile=this.musicProfile(),melody=profile.melody,chordRoots=profile.chordRoots,stepDur=60/profile.bpm/2,step=this.musicStep%16,bar=Math.floor(this.musicStep/16)%4;
        const root=profile.root*chordRoots[bar%chordRoots.length],rest=Boolean(profile.rests?.[step]);
        if(step%2===0&&!rest){
          const degree=melody[step%melody.length],freq=profile.root*scale[degree]*(profile.octave||1);
          this.musicVoice(freq,this.nextMusicAt,stepDur*(profile.gate||.7),.018,profile.leadType||'triangle');
          if(typeof Game!=='undefined'&&(Game.flowStreak||0)>=7)this.musicVoice(freq*2,this.nextMusicAt+.015,stepDur*.40,.0055,'sine');
        }
        if(step%4===0)this.musicVoice(root/2,this.nextMusicAt,stepDur*2.25,.021,profile.bassType||'sine');
        if(step===0||step===8){
          [1,5/4,3/2].forEach((r,i)=>this.musicVoice(root*r,this.nextMusicAt+i*.012,stepDur*7.0,.0058,'sine',i===1?3:-2));
        }
        if((profile.pulse||[]).includes(step))this.musicVoice(profile.root*2.02,this.nextMusicAt,stepDur*.10,.0038,profile.accentType||'square');
        this.nextMusicAt+=stepDur;this.musicStep++;
      }
    },
    startMusic(){
      if(!this.enabled||save.musicLevel<=0||this.failed||!this.ctx||this.musicStarted||!this.musicGain||this.playbackBlocked())return;
      this.musicStarted=true;this.musicStep=0;this.nextMusicAt=this.ctx.currentTime+.06;
      this.scheduleMusic();this.musicTimer=setInterval(()=>this.scheduleMusic(),360);
    },
    stopMusic(){
      if(this.musicTimer){clearInterval(this.musicTimer);this.musicTimer=null;}
      this.musicStarted=false;
      for(const o of [...this.musicNodes]){try{o.stop();}catch(_){} try{o.disconnect();}catch(_){} }
      this.musicNodes.clear();
    },
    duckMusic(ratio=.42,duration=.65){
      const ac=this.ctx,g=this.musicGain;if(!ac||!g||!this.enabled)return;
      const base=this.musicGainValue(),target=Math.max(.001,base*Math.max(.05,Math.min(1,ratio)));
      try{g.gain.cancelScheduledValues(ac.currentTime);g.gain.setValueAtTime(Math.max(.001,g.gain.value),ac.currentTime);g.gain.linearRampToValueAtTime(target,ac.currentTime+.04);g.gain.linearRampToValueAtTime(base,ac.currentTime+duration);}catch(_){}
    },
    switch(){ this.tone(410,.035,.019,'square'); setTimeout(()=>this.tone(620,.045,.016,'square'),32); },
    sync(streak=1){if(!save.sfx)return;const root=Math.min(960,640+streak*22);[1,5/4,3/2].forEach((r,i)=>setTimeout(()=>this.tone(root*r,.07,.013,'triangle'),i*26));},
    priority(kind='ambulance',dir=''){
      if(!save.sfx)return;this.duckMusic(.22,1.10);const ac=this.ensure();if(!ac)return;void this.prepareSamples();const p=this.emergencyProfile(kind),pan=this.panForDir(dir);
      const played=this.playSample(p.sample,{rate:p.rate,gain:p.gain,pan});
      if(played){this.lastEmergencyCueAt=Number(ac.currentTime||0);this.lastEmergencyByKind[kind]=this.lastEmergencyCueAt;this.playSample(p.sample,{rate:p.repeatRate,gain:p.gain*.68,when:p.repeatDelay,pan:pan*.8});if(kind!=='police')this.playSample(p.sample,{rate:p.accentRate,gain:p.gain*.46,when:p.accentDelay,pan:pan*.58});YandexAudit.mark('audio:vehicle:siren',`${kind}:priority:${dir||'center'}`);return;}
      // Decode/autoplay fallback: preserve the old lightweight signal until the real sample is ready.
      this.tone(740,.08,.024,'square');setTimeout(()=>this.tone(560,.09,.022,'square'),90);setTimeout(()=>this.tone(820,.08,.020,'square'),190);
    },
    pass(streak=1){ const f=Math.min(940,600+streak*26);this.tone(f,.040,.013,'triangle');if(streak===3||streak===5||streak===8)setTimeout(()=>this.tone(f*1.25,.055,.010,'sine'),28); },
    fail(){ this.stopRoadBed(); this.duckMusic(.12,1.55); this.tone(138,.26,.05,'sawtooth'); setTimeout(()=>this.tone(82,.32,.045,'square'),55); },
    win(){ this.stopRoadBed(); this.duckMusic(.38,1.15); [520,660,820,1040].forEach((f,i)=>setTimeout(()=>this.tone(f,.11,.026,'triangle'),i*78)); },
    suspend(recoverIfReenabled=false){
      this.cancelExternalResumeRetry();this.stopMusic();this.stopTransientAudio();
      if(this.ctx&&this.enabled)this.needsGestureResume=true;
      const ctx=this.ctx;
      if(ctx?.state === 'running') Promise.resolve(ctx.suspend()).then(()=>{
        // M157: a user can mute all audio and immediately turn it back on before an async
        // WebAudio suspend settles (notably on mobile WebKit). In that race ensure() can observe
        // the still-running context and return, after which the old suspend leaves audio silent.
        // Only silence-driven suspends may self-recover; lifecycle/ad pauses remain authoritative.
        if(recoverIfReenabled&&this.ctx===ctx&&this.enabled&&!platform.pausedByPlatform&&!platform.browserPaused&&!platform.adPaused&&!Game.userPaused)void this.tryResume('silence-race');
      }).catch(()=>{});
    },
    setEnabled(v){
      const on=Boolean(v);save.sfx=on;save.musicLevel=on?3:0;save.sound=on;this.enabled=on;persist();
      if(!on){this.stopMusic();this.suspend();}else this.ensure();
    }
  };

  const Haptics = {
    pulse(pattern){
      if(typeof navigator==='undefined'||typeof navigator.vibrate!=='function')return;
      try{navigator.vibrate(pattern);}catch(_){}
    },
    switch(){this.pulse(12);},
    priority(){this.pulse([12,45,12]);},
    pass(streak=1){if(streak>=6)this.pulse([8,22,8]);},
    fail(){this.pulse([45,28,65,35,85]);},
    win(){this.pulse([18,30,18,30,30]);}
  };

  function resolvedLanguage(){return save?.langMode==='ru'||save?.langMode==='en'?save.langMode:platformLang;}
  function languageModeLabel(mode=save?.langMode||'auto'){
    const normalized=normalizeLanguageMode(mode);
    return normalized==='ru'?T.languageRussian:normalized==='en'?T.languageEnglish:T.languageAuto;
  }
  function applyResolvedLanguage(){lang=resolvedLanguage();applyLanguage();}
  function cycleLanguageMode(){
    const modes=['auto','ru','en'],current=normalizeLanguageMode(save?.langMode),next=modes[(modes.indexOf(current)+1)%modes.length];
    save.langMode=next;persist();applyResolvedLanguage();YandexAudit.state.lang=lang;return next;
  }

  function applyLanguage(){
    T = TEXT[lang] || TEXT.en;
    if(typeof HUD_CACHE!=='undefined') for(const k of Object.keys(HUD_CACHE)) delete HUD_CACHE[k];
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(el=>el.textContent=T[el.dataset.i18n]);
    $('signal-label').textContent=T.switchLight;
    $('tap-hint-text').textContent=T.tapSignal;
    $('coin-btn').setAttribute('aria-label',T.garage);
    $('pause-btn').setAttribute('aria-label',T.pauseAction);
    $('daily-btn').setAttribute('aria-label',T.modesHub);$('map-btn')?.setAttribute('aria-label',T.campaignMap);
    $('restart-btn').setAttribute('aria-label',T.restart);
    $('hint-btn').setAttribute('aria-label',T.hint);
    $('signal-btn').setAttribute('aria-label',T.switchLight);
    canvas.setAttribute('aria-label',T.boardLabel);
    document.querySelector('.game-card')?.setAttribute('aria-label',T.boardLabel);
    document.querySelector('.controls')?.setAttribute('aria-label',T.controlsLabel);
    const progressEl=document.querySelector('.progress');if(progressEl)progressEl.setAttribute('aria-label',T.progressLabel);
    document.querySelector('.mini-status')?.setAttribute('aria-label',T.statusLabel);
    document.querySelector('#desktop-insight')?.setAttribute('aria-label',T.progressOverviewLabel);
    document.querySelector('#greenwave-controls')?.setAttribute('aria-label',T.independentControlsLabel);
    $('record-badge')?.setAttribute('aria-label',T.personalBestLabel);
    $('modal-stars')?.setAttribute('aria-label',T.starsLabel);
    const starsPill=$('total-stars')?.closest('.pill');if(starsPill){starsPill.setAttribute('title',T.starsLabel);starsPill.setAttribute('aria-label',T.starsLabel);}
    const insightTitle=$('insight-title');if(insightTitle)insightTitle.textContent=T.insightTitle;
    updateHud();
  }

  const DIRS = ['N','S','E','W'];
  const AXIS = { N:'V', S:'V', E:'H', W:'H' };
  const COLORS = ['#ff5964','#55d5ff','#ffd166','#7be495','#b28cff','#ff9f68','#f6f7fb','#31d2b3'];
  const CAR_NAMES = ['car1','car2','car3','car4','car5','car6','car7','car8','car9','car10'];
  const CAR_COSTS = [0,180,330,580,850,1200,1750,2500,3500,5000];
  const CAR_REQUIREMENTS = [0,3,6,10,15,20,30,45,65,90];
  const CAR_SWATCHES = ['#55d5ff','#ffd34d','#ff9f68','#ff5964','#2c7be5','#53dfbd','#d6b36a','#bd5cff','#f2d7a4','#111827'];

  const EARLY_LEVELS = [
    {plan:'NNNNN',start:'H',interval:1.45,speed:120,maxQueue:5},
    {plan:'WWWNNN',start:'V',interval:1.34,speed:122,maxQueue:5},
    {plan:'NNWWEENN',start:'H',interval:1.28,speed:124,maxQueue:5},
    {plan:'WWWNNNEE',start:'H',interval:1.22,speed:125,maxQueue:4},
    {plan:'NNNEEEWWW',start:'V',interval:1.18,speed:126,maxQueue:4},
    {plan:'WWNNEESSNN',start:'H',interval:1.16,speed:127,maxQueue:4},
    {plan:'NNWWNNWWEESS',start:'V',interval:1.13,speed:128,maxQueue:4},
    {plan:'WWWNNNEEESSS',start:'H',interval:1.10,speed:129,maxQueue:4},
    {plan:'NNWWEESSWWNN',start:'V',interval:1.08,speed:130,maxQueue:4},
    {plan:'WWWWNNNNEESS',start:'H',interval:1.05,speed:131,maxQueue:4},
    {plan:'NNNEEEWWWSSSNN',start:'V',interval:1.04,speed:132,maxQueue:4},
    {plan:'WWNNWWEESSNNEE',start:'H',interval:1.02,speed:133,maxQueue:4},
    {plan:'NNNNWWWEEEESSS',start:'H',interval:1.00,speed:134,maxQueue:4},
    {plan:'WWEENNSSWWNNEE',start:'V',interval:.98,speed:135,maxQueue:4},
    {plan:'NNWWWNNNEEESSSW',start:'H',interval:.96,speed:136,maxQueue:4},
    {plan:'WWWNNNEEESSSWWW',start:'V',interval:.95,speed:137,maxQueue:4},
    {plan:'NNWWEESSNNWWEE',start:'H',interval:.94,speed:138,maxQueue:4},
    {plan:'EEEEWWWNNNSSSEEE',start:'V',interval:.92,speed:139,maxQueue:4},
    {plan:'NNNNWWWWEEEESSSS',start:'H',interval:.91,speed:140,maxQueue:4},
    {plan:'WWNNEESSWWNNEESS',start:'V',interval:.90,speed:141,maxQueue:4},
    {plan:'NNWWWSSSEENNNWWW',start:'H',interval:.89,speed:142,maxQueue:4},
    {plan:'EEEEENNSSSWWWNNN',start:'V',interval:.88,speed:143,maxQueue:4},
    {plan:'NNWWNNWWEEESSSWWW',start:'H',interval:.87,speed:144,maxQueue:4},
    {plan:'WWWNNNEEESSSWWWNN',start:'V',interval:.86,speed:145,maxQueue:4},
    {plan:'NNNNEEEEWWWWSSSSNN',start:'H',interval:.85,speed:146,maxQueue:4},
    {plan:'WWEENNSSWWEENNSSWW',start:'V',interval:.84,speed:147,maxQueue:4},
    {plan:'NNWWWNNNEEESSSWWWNN',start:'H',interval:.83,speed:148,maxQueue:4},
    {plan:'EEEESSSWWWWNNNEEESS',start:'V',interval:.82,speed:149,maxQueue:4},
    {plan:'NNWWEEWWSSNNEESSWWNN',start:'H',interval:.81,speed:150,maxQueue:4},
    {plan:'WWWWNNNNEEEESSSSWWNN',start:'V',interval:.80,speed:151,maxQueue:4}
  ];

  function seeded(seed){ let s=seed>>>0; return ()=>((s=(s*1664525+1013904223)>>>0)/4294967296); }
  function approachValue(current,target,delta){ return current<target?Math.min(target,current+delta):Math.max(target,current-delta); }

  const TURN_START=365, TURN_END=700; // legacy envelope retained for compatibility diagnostics
  const CROSSWALK_STOP_A=268, CROSSWALK_STOP_B=632;
  function isEmergencyVehicle(c){return Boolean(c&&['ambulance','police','fire'].includes(c.kind));}
  function trafficDirectionArrow(dir){return dir==='W'?'→':dir==='E'?'←':dir==='N'?'↓':'↑';}
  function emergencyReadabilityState(c,game=Game){
    if(!isEmergencyVehicle(c))return{visible:false,needsPriority:false,urgency:0,distance:Infinity,junctionId:null};
    const lanes=Math.max(1,game.config?.lanes||1);let distance=Infinity,signal='green',junctionId=null,lineProgress=null;
    if(isLinkedJunctionType(game.config?.junctionType)&&c.linkedRouteId){
      const gate=linkedNextGate(c,lanes);if(!gate)return{visible:false,needsPriority:false,urgency:0,distance,junctionId:null};
      junctionId=gate.junctionId;lineProgress=gate.lineProgress;distance=gate.stopTarget-c.progress;signal=signalStateForAxis(gate.axis,game,gate.junctionId);
    }else{
      const stop=stopTargetProgress(c,lanes);lineProgress=signalLineProgress();distance=stop-c.progress;signal=signalStateForAxis(c.axis,game);
    }
    const approaching=distance<=210&&distance>=-24;
    const needsPriority=Boolean(signal==='red'&&approaching&&c.progress<(lineProgress??Infinity)+44);
    const visible=Boolean(c.emergencyPriorityActive||needsPriority);
    const urgency=Math.max(0,Math.min(1,1-Math.max(0,distance)/210));
    return{visible,needsPriority,urgency,distance:Number.isFinite(distance)?distance:9999,junctionId,signal,arrow:trafficDirectionArrow(c.dir),active:Boolean(c.emergencyPriorityActive)};
  }
  function emergencyFocusVehicle(game=Game){
    let best=null,bestScore=-Infinity;
    for(const car of game.cars||[]){
      const state=emergencyReadabilityState(car,game);if(!state.visible)continue;
      const score=(state.active?1000:0)+(state.urgency*100)-Math.max(0,state.distance)*.02;
      if(score>bestScore){bestScore=score;best={car,state};}
    }
    return best;
  }
  function maybeCueEmergencyApproach(c,distance){
    if(!isEmergencyVehicle(c)||c.audioApproachAnnounced||(c.audioAge||0)<.36)return false;const d=Number(distance);if(!Number.isFinite(d)||d>235||d<-18)return false;const proximity=Math.max(.18,Math.min(1,1-(Math.max(0,d)/235)));const played=AudioFx.emergencyApproach(c.kind,c.dir,proximity);if(played)c.audioApproachAnnounced=true;return played;
  }
  function renderedTrafficScale(lanes=(Game.config?.lanes||1)){return lanes>=3?.78:lanes===2?.80:1;}
  function vehicleBodyMetrics(c){
    const bus=c?.kind==='bus',fire=c?.kind==='fire',truck=c?.kind==='truck',van=c?.style===2||truck||fire,sport=c?.archetype==='sport'||c?.style===3,compact=c?.archetype==='compact';
    return {length:bus?126:fire?118:truck?108:van?98:sport?92:compact?82:92,width:bus?62:fire?60:truck?58:van?56:sport?52:compact?48:53};
  }
  function vehiclesOverlap(a,b,lanes=(Game.config?.lanes||1)){
    const pa=carXY(a),pb=carXY(b),scale=renderedTrafficScale(lanes),ma=vehicleBodyMetrics(a),mb=vehicleBodyMetrics(b);
    // Rounded toy-car bodies are slightly smaller than their painted rectangles. SAT follows the
    // actual rotated bodies through curves instead of treating the whole junction as one collision box.
    const ahL=ma.length*scale*.43,ahW=ma.width*scale*.43,bhL=mb.length*scale*.43,bhW=mb.width*scale*.43;
    const af=[Math.cos(pa.rot),Math.sin(pa.rot)],ar=[-af[1],af[0]],bf=[Math.cos(pb.rot),Math.sin(pb.rot)],br=[-bf[1],bf[0]],d=[pb.x-pa.x,pb.y-pa.y];
    for(const axis of [af,ar,bf,br]){
      const dist=Math.abs(d[0]*axis[0]+d[1]*axis[1]);
      const ra=ahL*Math.abs(af[0]*axis[0]+af[1]*axis[1])+ahW*Math.abs(ar[0]*axis[0]+ar[1]*axis[1]);
      const rb=bhL*Math.abs(bf[0]*axis[0]+bf[1]*axis[1])+bhW*Math.abs(br[0]*axis[0]+br[1]*axis[1]);
      if(dist>=ra+rb-1.5)return false;
    }
    return true;
  }
  function signalLineProgress(){return CROSSWALK_STOP_A+70;}
  function stopTargetProgress(c,lanes=(Game.config?.lanes||1)){
    // Progress coordinates place a vehicle's centre on the painted stop line at 338.
    // Use the actual painted body length (not only the traffic-spacing proxy length), then pull the
    // centre back by a safety margin. This keeps long buses/fire engines and sport-car bodywork out
    // of the zebra at red even when their rendered silhouette differs from their spacing length.
    const bodyLength=vehicleBodyMetrics(c).length;
    return signalLineProgress()-(bodyLength*renderedTrafficScale(lanes)*.5+9);
  }
  function turnCurveBounds(lanes=(Game.config?.lanes||1)){
    const layout=roadLayout(lanes);
    // straightCarPose maps progress to screen coordinates with a 70 px origin offset.
    // Start/end the curve exactly at the geometric edges of the crossing so cars no longer begin
    // turning out in the approach/corner area on narrow one-lane intersections.
    return {start:layout.edgeMin+70,end:layout.edgeMax+70};
  }
  function pedestrianPose(ped,lanes=(Game.config?.lanes||1)){
    const layout=roadLayout(lanes),a=layout.edgeMin,b=layout.edgeMax,t=Math.max(0,Math.min(1,ped?.t||0)),side=ped?.laneSide||0;
    if(ped?.junctionId){
      const center=linkedJunctionCenter(ped.junctionId),half=(b-a)/2,u=ped.reverse?1-t:t;
      const from=-half-22,to=half+22,offset=ped.crossing?half+17:-half-17;
      if(ped.roadAxis==='V')return{x:center.x+from+(to-from)*u,y:center.y+offset+side*6,rot:ped.reverse?Math.PI:0};
      return{x:center.x+offset+side*6,y:center.y+from+(to-from)*u,rot:ped.reverse?-Math.PI/2:Math.PI/2};
    }
    const near=CROSSWALK_STOP_A+17,far=CROSSWALK_STOP_B-17,start=a-22,end=b+22,u=ped?.reverse?1-t:t;
    if(ped?.roadAxis==='V')return{x:start+(end-start)*u,y:(ped.crossing?far:near)+side*6,rot:ped.reverse?Math.PI:0};
    return{x:(ped?.crossing?far:near)+side*6,y:start+(end-start)*u,rot:ped?.reverse?-Math.PI/2:Math.PI/2};
  }
  function emergencyApproachingAxis(axis,game=Game,junctionId=null){
    const lanes=Math.max(1,game.config?.lanes||1);
    if(isLinkedJunctionType(game.config?.junctionType))return game.cars.some(c=>{
      if(!isEmergencyVehicle(c))return false;
      const route=linkedRouteSpec(c.linkedRouteId),turningIntoAxis=Boolean(route?.turn&&AXIS[route.turnOutDir||route.exitDir]===axis);
      if(c.axis!==axis&&!turningIntoAxis)return false;
      const gate=turningIntoAxis?linkedRouteGates(c,lanes).find(g=>g.junctionId===route.turnAt):linkedNextGate(c,lanes);
      return Boolean(gate&&(!junctionId||gate.junctionId===junctionId)&&signalStateForAxis(axis,game,gate.junctionId)==='red'&&c.progress>=linkedStopTargetProgress(c,gate,lanes)-180&&c.progress<gate.lineProgress+44);
    });
    return game.cars.some(c=>isEmergencyVehicle(c)&&c.axis===axis&&signalStateForAxis(axis,game)==='red'&&c.progress>=stopTargetProgress(c,lanes)-180&&c.progress<turnCurveBounds(lanes).end+44);
  }
  function pedestrianSignalState(axis,game=Game,junctionId=null){
    // Never invite a new crossing during local all-red clearance or while an emergency unit is pre-empting red.
    if(signalTransitionTimer(game,junctionId)>0)return game.pedestriansOnAxis(axis,junctionId)?'walk':'hold';
    if(emergencyApproachingAxis(axis,game,junctionId))return game.pedestriansOnAxis(axis,junctionId)?'walk':'hold';
    return signalStateForAxis(axis,game,junctionId)==='red'?'walk':'stop';
  }
  function turnExitDir(dir,turn){
    if(!turn||turn==='straight')return dir;
    if(turn==='right')return dir==='W'?'S':dir==='E'?'N':dir==='N'?'W':'E';
    return dir==='W'?'N':dir==='E'?'S':dir==='N'?'E':'W';
  }
  function junctionClosedArm(type='cross'){
    return type==='t-north'?'N':type==='t-east'?'E':type==='t-south'?'S':type==='t-west'?'W':null;
  }

  // M93 RouteGraph foundation -------------------------------------------------
  // Topology is now described independently from car presentation/progress. Existing cross/T boards
  // are represented by the same graph API that later multi-junction layouts use.
  const ROUTE_TURNS=['straight','right','left'];
  const ROUTE_GRAPH_CACHE=new Map();
  const LINKED_TURN_GEOMETRY_CACHE=new Map();
  function buildSingleJunctionRouteGraph(type='cross'){
    const closed=junctionClosedArm(type),arms=['N','S','E','W'].filter(a=>a!==closed);
    const ports=Object.fromEntries(arms.map(arm=>[arm,{id:arm,arm,kind:'port'}]));
    const nodes={J0:{id:'J0',kind:'junction',x:450,y:450}};
    const edges=arms.map(arm=>({id:`${arm}-J0`,a:arm,b:'J0',axis:(arm==='E'||arm==='W')?'H':'V'}));
    const routes={};
    for(const dir of DIRS){
      const entry=physicalEntryArm(dir);if(!ports[entry])continue;
      for(const turn of ROUTE_TURNS){
        const exit=routeExitArm(dir,turn);if(!ports[exit]||exit===entry)continue;
        routes[`${dir}:${turn}`]={id:`${dir}:${turn}`,entry,exit,turn,junctions:['J0'],axis:AXIS[dir]};
      }
    }
    return {type,kind:'single',closedArm:closed,nodes,ports,edges,routes,entryDirs:DIRS.filter(d=>ports[physicalEntryArm(d)])};
  }
  function buildDoubleHorizontalRouteGraph(){
    const nodes={J0:{id:'J0',kind:'junction',x:230,y:450},J1:{id:'J1',kind:'junction',x:670,y:450}};
    const ports={W:{id:'W',arm:'W',kind:'port'},E:{id:'E',arm:'E',kind:'port'},N0:{id:'N0',arm:'N',kind:'port',junction:'J0'},S0:{id:'S0',arm:'S',kind:'port',junction:'J0'},N1:{id:'N1',arm:'N',kind:'port',junction:'J1'},S1:{id:'S1',arm:'S',kind:'port',junction:'J1'}};
    const edges=[
      {id:'W-J0',a:'W',b:'J0',axis:'H'},{id:'J0-J1',a:'J0',b:'J1',axis:'H'},{id:'J1-E',a:'J1',b:'E',axis:'H'},
      {id:'N0-J0',a:'N0',b:'J0',axis:'V'},{id:'J0-S0',a:'J0',b:'S0',axis:'V'},
      {id:'N1-J1',a:'N1',b:'J1',axis:'V'},{id:'J1-S1',a:'J1',b:'S1',axis:'V'}
    ];
    const routes={
      'W>E':{id:'W>E',entry:'W',exit:'E',entryDir:'W',axis:'H',junctions:['J0','J1']},
      'E>W':{id:'E>W',entry:'E',exit:'W',entryDir:'E',axis:'H',junctions:['J1','J0']},
      'N0>S0':{id:'N0>S0',entry:'N0',exit:'S0',entryDir:'S',axis:'V',junctions:['J0']},
      'S0>N0':{id:'S0>N0',entry:'S0',exit:'N0',entryDir:'N',axis:'V',junctions:['J0']},
      'N1>S1':{id:'N1>S1',entry:'N1',exit:'S1',entryDir:'S',axis:'V',junctions:['J1']},
      'S1>N1':{id:'S1>N1',entry:'S1',exit:'N1',entryDir:'N',axis:'V',junctions:['J1']}
    };
    // M95B: linked arterial turns use explicit junction paths. Right turns leave at the first or
    // second node; left turns cross the node and use the matching outer port. Gate order remains
    // route order, so the signal controller can grant/release one node at a time.
    const linkedTurns=[
      ['W>S0','W','S0','W','S',['J0'],'J0','right'],
      ['W>S1','W','S1','W','S',['J0','J1'],'J1','right'],
      ['E>N1','E','N1','E','N',['J1'],'J1','right'],
      ['E>N0','E','N0','E','N',['J1','J0'],'J0','right'],
      ['W>N0','W','N0','W','N',['J0'],'J0','left'],
      ['W>N1','W','N1','W','N',['J0','J1'],'J1','left'],
      ['E>S1','E','S1','E','S',['J1'],'J1','left'],
      ['E>S0','E','S0','E','S',['J1','J0'],'J0','left']
    ];
    for(const [id,entry,exit,entryDir,exitDir,junctions,turnAt,turn] of linkedTurns){
      routes[id]={id,entry,exit,entryDir,exitDir,axis:'H',junctions,turn,turnAt,turnOutDir:exitDir,
        entryLaneRule:turn==='right'?'curb':'inner',exitLaneRule:turn==='right'?'curb':'inner'};
    }
    return {type:'double-horizontal',kind:'multi',closedArm:null,nodes,ports,edges,routes,entryDirs:Object.keys(routes)};
  }
  function routeGraphForJunction(type='cross'){
    const key=String(type||'cross');let graph=ROUTE_GRAPH_CACHE.get(key);
    if(!graph){graph=key==='double-horizontal'?buildDoubleHorizontalRouteGraph():buildSingleJunctionRouteGraph(key);ROUTE_GRAPH_CACHE.set(key,graph);}return graph;
  }
  function isLinkedJunctionType(type=Game.config?.junctionType){return type==='double-horizontal';}

  function isRoundaboutJunction(type=Game.config?.junctionType){return type==='roundabout';}
  const ROUNDABOUT_GEOMETRY_CACHE=new Map();

  function linkedRouteSpec(routeId,type='double-horizontal'){return routeGraphForJunction(type).routes[String(routeId)]||null;}
  function axisForPlanItem(item){const s=String(item||'');if(s.includes('>'))return linkedRouteSpec(s)?.axis||(s[0]==='N'||s[0]==='S'?'V':'H');return AXIS[s]||null;}
  function baseDirForPlanItem(item){const s=String(item||'');return linkedRouteSpec(s)?.entryDir||s;}
  function linkedEntryLaneBlocked(cars,dir,lane,routeId=null,lanes=(Game.config?.lanes||1)){
    const route=routeId?linkedRouteSpec(routeId):null,entryKey=route?`road:${linkedRoadCorridorId(dir,route,'entry')}:${lane}`:null;
    return cars.some(c=>(entryKey?linkedTrafficLaneKey(c,lanes)===entryKey:baseDirForPlanItem(c.linkedRouteId)===dir)&&
      (((c.lane||0)===lane)||(c.laneChangeT<1&&c.laneTarget===lane))&&c.progress<150);
  }
  function linkedRoadCorridorId(dir,route,endpoint='entry'){
    if(dir==='W'||dir==='E')return `H:${dir}`;
    const port=endpoint==='exit'?route?.exit:route?.entry;
    return `V:${String(port||'J0').endsWith('1')?'J1':'J0'}:${dir}`;
  }
  function linkedTrafficLaneKey(c,lanes=(Game.config?.lanes||1)){
    const route=linkedRouteSpec(c?.linkedRouteId),lane=c?.lane||0;
    if(!route)return `road:${c?.dir||''}:${lane}`;
    const entry=`road:${linkedRoadCorridorId(route.entryDir,route,'entry')}:${lane}`;
    const geometry=linkedTurnGeometry(c,lanes);
    if(!geometry)return entry;
    // Different route IDs still share the same physical inlet lane. Keep them in one following
    // queue until the turning body has cleared the shared approach envelope; after that, group by
    // its own curve and then by the real exit corridor/lane.
    const entryClearance=Math.max(120,vehicleBodyMetrics(c).length*renderedTrafficScale(lanes)+20);
    if(c.progress<geometry.startProgress+entryClearance)return entry;
    if(c.progress<=geometry.endProgress+16)return `turn:${route.id}:${lane}`;
    return `road:${linkedRoadCorridorId(geometry.outDir,route,'exit')}:${geometry.endLane||0}`;
  }
  function linkedStraightEntryLane(cars,dir,openLanes,plan=[],nextIndex=0,lanes=(Game.config?.lanes||1)){
    if(openLanes.length<=1)return openLanes[0]??0;
    const corridor=linkedRoadCorridorId(dir,linkedRouteSpec(plan[nextIndex]),'entry'),upcoming=plan.slice(nextIndex+1,nextIndex+10);
    const ranked=openLanes.map(lane=>{
      let score=0;
      for(const c of cars){
        const route=linkedRouteSpec(c.linkedRouteId);
        if(!route||route.entryDir!==dir||linkedRoadCorridorId(dir,route,'entry')!==corridor||(c.lane||0)!==lane)continue;
        score+=1+(route.turn&&c.progress<700?1.75:0);
      }
      for(const id of upcoming){
        const route=linkedRouteSpec(id);
        if(route?.turn&&route.entryDir===dir&&linkedRoadCorridorId(dir,route,'entry')===corridor){
          const preferred=route.entryLaneRule==='curb'?lanes-1:0;
          if(preferred===lane)score+=.8;
        }
      }
      return {lane,score,centerDistance:Math.abs(lane-(lanes-1)/2)};
    }).sort((a,b)=>a.score-b.score||a.centerDistance-b.centerDistance||a.lane-b.lane);
    return ranked[0]?.lane??openLanes[0];
  }
  function routeGraphRoute(dir,turn='straight',type='cross'){
    return routeGraphForJunction(type).routes[`${dir}:${turn}`]||null;
  }
  function validateRouteGraph(graph){
    if(!graph||!graph.nodes||!graph.ports||!graph.routes)return {ok:false,errors:['missing graph sections']};
    const errors=[];
    for(const edge of graph.edges||[])if(!graph.nodes[edge.a]&&!graph.ports[edge.a]||!graph.nodes[edge.b]&&!graph.ports[edge.b])errors.push(`bad edge ${edge.id}`);
    for(const route of Object.values(graph.routes)){
      if(!graph.ports[route.entry])errors.push(`missing entry ${route.id}`);
      if(!graph.ports[route.exit])errors.push(`missing exit ${route.id}`);
      for(const j of route.junctions||[])if(!graph.nodes[j])errors.push(`missing junction ${route.id}:${j}`);
      const chain=[route.entry,...(route.junctions||[]),route.exit];
      for(let i=0;i<chain.length-1;i++){
        const connected=(graph.edges||[]).some(e=>(e.a===chain[i]&&e.b===chain[i+1])||(e.b===chain[i]&&e.a===chain[i+1]));
        if(!connected)errors.push(`disconnected route ${route.id}:${chain[i]}>${chain[i+1]}`);
      }
    }
    return {ok:errors.length===0,errors,nodeCount:Object.keys(graph.nodes).length,portCount:Object.keys(graph.ports).length,routeCount:Object.keys(graph.routes).length};
  }
  function physicalEntryArm(dir){return dir==='W'?'W':dir==='E'?'E':dir==='N'?'S':'N';}
  function physicalExitArmForTravel(dir){return dir==='W'?'E':dir==='E'?'W':dir==='N'?'N':'S';}
  function routeExitArm(dir,turn='straight'){return physicalExitArmForTravel(turn==='straight'?dir:turnExitDir(dir,turn));}
  function junctionRouteAllowed(dir,turn,type='cross'){
    return Boolean(routeGraphRoute(dir,turn,type));
  }
  function allowedTurnsForJunction(dir,type='cross'){
    return ROUTE_TURNS.filter(turn=>Boolean(routeGraphRoute(dir,turn,type)));
  }
  function junctionArmOpen(type='cross',arm){
    if(type==='double-horizontal')return true;
    return Boolean(routeGraphForJunction(type).ports?.[arm]);
  }
  function junctionTypeForLevel(level,variant='standard'){
    // Multi-junction boards arrive only in late standard campaign levels. Special-event boards keep
    // their original topology so the new route graph is learned separately from event rules.
    if(level>=140&&variant==='standard'&&level%16===3)return 'double-horizontal';
    if(level<46||variant!=='standard'||level%14!==6)return 'cross';
    return ['t-north','t-east','t-south','t-west'][Math.floor(level/14)%4];
  }
  function pedestrianCrossingsForAxis(axis,type='cross'){
    const closed=junctionClosedArm(type);if(!closed)return [0,1];
    if(axis==='V'){if(closed==='N')return [1];if(closed==='S')return [0];}
    if(axis==='H'){if(closed==='W')return [1];if(closed==='E')return [0];}
    return [0,1];
  }
  function directionAngle(dir){return dir==='W'?0:dir==='E'?Math.PI:dir==='N'?-Math.PI/2:Math.PI/2;}
  function angleFromVector(dx,dy){return Math.atan2(dy,dx);}

  function utcDayKey(ts=platform.now()){
    try { return new Date(ts).toISOString().slice(0,10); } catch (_) { return new Date().toISOString().slice(0,10); }
  }
  function hashText(text){
    let h=2166136261>>>0; for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)>>>0;} return h>>>0;
  }
  function dailyConfig(dayKey){
    const seed=hashText(`traffic-pulse:${dayKey}`),rng=seeded(seed);
    const effectiveLevel=24+(seed%13),total=20+(seed%5),startPhase=(seed&1)?'H':'V';
    const plan=proceduralPlan(effectiveLevel,total,DIRS,seed^0x9e3779b9),parSwitches=estimateParSwitches(plan,startPhase);
    return {total,interval:.80-(seed%4)*.012,maxQueue:4,perfectQueue:2,lanes:1,parSwitches,perfectSwitchBudget:parSwitches+3,dirs:DIRS.slice(),speed:158+(seed%9),seed,plan,startPhase,clearance:1.22,effectiveLevel,variant:'daily',junctionType:'cross',...trafficProfile(effectiveLevel,'standard')};
  }
  function todayDailyKey(){ return utcDayKey(platform.now()); }
  function weekStartKey(ts=platform.now()){
    const d=new Date(ts);if(!Number.isFinite(d.getTime()))return utcDayKey(ts);const day=d.getUTCDay()||7;d.setUTCDate(d.getUTCDate()-day+1);return d.toISOString().slice(0,10);
  }
  function weeklyConfig(weekKey){
    const seed=hashText(`traffic-pulse-week:${weekKey}`),effectiveLevel=58+(seed%18),variant=['express','freight','service','pulse'][seed%4],total=29+(seed%5),startPhase=(seed&1)?'H':'V',lanes=2;
    const plan=proceduralPlan(effectiveLevel,total,DIRS,seed^0x85ebca6b),parSwitches=estimateParSwitches(plan,startPhase),profile=trafficProfile(effectiveLevel,variant);
    return {total,interval:.61-(seed%3)*.012,maxQueue:7,perfectQueue:4,lanes,parSwitches,perfectSwitchBudget:perfectSwitchBudget(parSwitches,lanes,variant,total)+1,dirs:DIRS.slice(),speed:188+(seed%11),seed,plan,startPhase,clearance:1.18,effectiveLevel,variant,junctionType:'cross',...profile};
  }


  function pbText(key,n=0){
    const ru={ahead:`На ${n} авто впереди рекорда`,behind:`На ${n} авто позади рекорда`,even:'Идёшь ровно по рекорду',live:'Личный рекорд',newBest:'Новый личный рекорд',compare:'Сравнение с прошлым рекордом',noTrace:'Итоговый рекорд есть, живой след недоступен',stars:'Звёзды',switches:'Переключения',queue:'Пиковая пробка',show:'Показать сравнение',hide:'Скрыть сравнение'};
    const en={ahead:`${n} cars ahead of your best`,behind:`${n} cars behind your best`,even:'Matching your best run',live:'Personal best',newBest:'New personal best',compare:'Compared with previous best',noTrace:'Final best is available; live trace is not',stars:'Stars',switches:'Switches',queue:'Peak queue',show:'Show comparison',hide:'Hide comparison'};
    return (lang==='ru'?ru:en)[key]||key;
  }
  function challengeConfigSignature(mode,key,config,rescued=false,assisted=false){
    const core={mode,key,rules:CHALLENGE_RULE_VERSION,seed:config?.seed||0,total:config?.total||0,interval:Math.round((config?.interval||0)*10000),maxQueue:config?.maxQueue||0,perfectQueue:config?.perfectQueue||0,lanes:config?.lanes||1,parSwitches:config?.parSwitches||0,perfectSwitchBudget:config?.perfectSwitchBudget||0,startPhase:config?.startPhase||'H',clearance:Math.round((config?.clearance||0)*1000),effectiveLevel:config?.effectiveLevel||0,variant:config?.variant||'standard',junctionType:config?.junctionType||'cross',speed:config?.speed||0,plan:(config?.plan||[]).join(',')};
    const configHash=hashText(JSON.stringify(core)).toString(16).padStart(8,'0');
    const compat=`${mode}:${key}:r${CHALLENGE_RULE_VERSION}:${configHash}:rs${rescued?1:0}:as${assisted?1:0}`;
    return {compat,configHash,rules:CHALLENGE_RULE_VERSION,rescued:Boolean(rescued),assisted:Boolean(assisted)};
  }
  function challengeRunId(mode,key){
    const stamp=Date.now().toString(36),perf=Math.floor((performance?.now?.()||0)*1000).toString(36),serial=((challengeRunId._n=(challengeRunId._n||0)+1)%46656).toString(36);
    return cleanToken(`${mode}:${key}:${stamp}:${perf}:${serial}`,96);
  }
  function isBetterBest(candidate,previous){
    if(!previous)return true;if((candidate.stars||0)!==(previous.stars||0))return (candidate.stars||0)>(previous.stars||0);
    if((candidate.switches??9999)!==(previous.switches??9999))return (candidate.switches??9999)<(previous.switches??9999);
    return (candidate.maxQueue??9999)<(previous.maxQueue??9999);
  }
  const ChallengeTraceStore={
    load(){try{const raw=JSON.parse(localStorage.getItem(CHALLENGE_TRACE_KEY)||'{"items":[]}'),items=Array.isArray(raw?.items)?raw.items:[];return items.filter(x=>x&&['daily','weekly'].includes(x.mode)&&validDayKey(x.key)&&cleanToken(x.compat,160)&&cleanToken(x.runId,96)&&Array.isArray(x.points)).map(x=>({mode:x.mode,key:x.key,compat:cleanToken(x.compat,160),runId:cleanToken(x.runId,96),updatedAt:safeInt(x.updatedAt,0,9_000_000_000_000_000,0),points:x.points.slice(0,CHALLENGE_TRACE_MAX_POINTS).map(p=>[safeInt(p?.[0],0,100000,0),safeInt(p?.[1],0,9999,0),safeInt(p?.[2],0,9999,0),safeInt(p?.[3],0,999,0)])}));}catch(_){return[];}},
    find(mode,key,compat,runId){return this.load().find(x=>x.mode===mode&&x.key===key&&x.compat===compat&&x.runId===runId)||null;},
    save(mode,key,compat,runId,points){
      try{
        let items=this.load().filter(x=>!(x.mode===mode&&x.key===key&&x.compat===compat));items.push({mode,key,compat,runId,updatedAt:Date.now(),points:points.slice(0,CHALLENGE_TRACE_MAX_POINTS)});
        const keepByMode=(m,limit)=>{const keys=[...new Set(items.filter(x=>x.mode===m).map(x=>x.key))].sort().slice(-limit);const set=new Set(keys);items=items.filter(x=>x.mode!==m||set.has(x.key));};keepByMode('daily',DAILY_TRACE_LIMIT);keepByMode('weekly',WEEKLY_TRACE_LIMIT);
        items.sort((a,b)=>a.updatedAt-b.updatedAt);let payload=JSON.stringify({items});while(payload.length>CHALLENGE_TRACE_BYTES&&items.length>1){items.shift();payload=JSON.stringify({items});}localStorage.setItem(CHALLENGE_TRACE_KEY,payload);return true;
      }catch(_){return false;}
    },
    stats(){const items=this.load();let bytes=0;try{bytes=JSON.stringify({items}).length;}catch(_){}return{items:items.length,bytes,daily:[...new Set(items.filter(x=>x.mode==='daily').map(x=>x.key))].length,weekly:[...new Set(items.filter(x=>x.mode==='weekly').map(x=>x.key))].length};}
  };
  const PersonalBestService={
    session:null,liveVisible:true,
    begin(mode,key,config,game){
      if(!['daily','weekly'].includes(mode)){this.session=null;this.renderBadge(game);return;}
      const sig=challengeConfigSignature(mode,key,config,game?.rescueUsed,game?.assistActive),map=mode==='daily'?save.dailyBestCompat:save.weeklyBestCompat,overall=(mode==='daily'?save.dailyBest:save.weeklyBest)?.[key]||null;
      let previous=map?.[key]?.[sig.compat]||null;if(!previous&&overall&&(!overall.compat||overall.compat===sig.compat))previous=overall;
      const trace=previous?.runId?ChallengeTraceStore.find(mode,key,sig.compat,previous.runId):null;
      try{const pref=localStorage.getItem('traffic_pulse_pb_live_v1');this.liveVisible=pref!=='0';}catch(_){}
      this.session={mode,key,config,sig,runId:challengeRunId(mode,key),previous,baselineTrace:trace?.points||null,points:[],nextSample:0,sampleEvery:1,lastLive:null};this.sample(game,true);this.renderBadge(game);
    },
    currentSignature(game){const s=this.session;if(!s)return null;return challengeConfigSignature(s.mode,s.key,game?.config||s.config,game?.rescueUsed,game?.assistActive);},
    sample(game,force=false){
      const s=this.session;if(!s||!game||!['daily','weekly'].includes(game.mode))return;const elapsed=Math.max(0,game.elapsed||0);if(!force&&elapsed+1e-6<s.nextSample)return;
      const t=Math.floor(elapsed),point=[t,safeInt(game.exited,0,9999,0),safeInt(game.switches,0,9999,0),safeInt(game.maxObservedQueue,0,999,0)],last=s.points[s.points.length-1];if(!last||last[0]!==t)s.points.push(point);else s.points[s.points.length-1]=point;
      if(s.points.length>CHALLENGE_TRACE_MAX_POINTS){s.points=s.points.filter((_,i)=>i%2===0);s.sampleEvery=Math.min(16,s.sampleEvery*2);}s.nextSample=(Math.floor(elapsed/s.sampleEvery)+1)*s.sampleEvery;
      const sig=this.currentSignature(game);if(!sig||sig.compat!==s.sig.compat){s.lastLive=null;this.renderBadge(game);return;}if(!s.baselineTrace?.length){s.lastLive=null;this.renderBadge(game);return;}
      let base=null;for(const p of s.baselineTrace){if(p[0]<=t)base=p;else break;}if(!base){s.lastLive=null;this.renderBadge(game);return;}s.lastLive={t,cars:point[1]-base[1],switches:point[2]-base[2],queue:point[3]-base[3]};this.renderBadge(game);
    },
    finish(game,stars){
      const s=this.session;if(!s)return{record:null,previous:null,comparison:null,categoryImproved:false};this.sample(game,true);const sig=this.currentSignature(game)||s.sig,record={stars,switches:game.switches,maxQueue:game.maxObservedQueue,runId:s.runId,compat:sig.compat,rules:sig.rules,configHash:sig.configHash,rescued:sig.rescued||undefined,assisted:sig.assisted||undefined,finishedAt:Date.now()};
      const map=s.mode==='daily'?save.dailyBestCompat:save.weeklyBestCompat,overall=(s.mode==='daily'?save.dailyBest:save.weeklyBest)?.[s.key]||null;let previous=map?.[s.key]?.[sig.compat]||null;if(!previous&&overall&&(!overall.compat||overall.compat===sig.compat))previous=overall;
      const categoryImproved=isBetterBest(record,previous);const comparison=previous?{previous,current:record,delta:{stars:record.stars-previous.stars,switches:record.switches-previous.switches,maxQueue:record.maxQueue-previous.maxQueue},hadLiveTrace:Boolean(previous.runId&&ChallengeTraceStore.find(s.mode,s.key,sig.compat,previous.runId)),newBest:categoryImproved}:null;
      if(categoryImproved){save[s.mode==='daily'?'dailyBestCompat':'weeklyBestCompat']=save[s.mode==='daily'?'dailyBestCompat':'weeklyBestCompat']||{};const root=save[s.mode==='daily'?'dailyBestCompat':'weeklyBestCompat'];root[s.key]=root[s.key]||{};root[s.key][sig.compat]=record;ChallengeTraceStore.save(s.mode,s.key,sig.compat,record.runId,s.points);}
      return{record,previous,comparison,categoryImproved};
    },
    toggle(){this.liveVisible=!this.liveVisible;try{localStorage.setItem('traffic_pulse_pb_live_v1',this.liveVisible?'1':'0');}catch(_){}this.renderBadge(Game);},
    liveText(){const l=this.session?.lastLive;if(!l)return'';if(l.cars>0)return`🏁 +${l.cars} 🚗`;if(l.cars<0)return`🏁 ${l.cars} 🚗`;return'🏁 =';},
    renderBadge(game){const el=$('record-badge');if(!el)return;const s=this.session,live=s?.lastLive,sig=s?this.currentSignature(game):null,compatible=Boolean(s&&sig?.compat===s.sig.compat&&s.baselineTrace?.length),show=Boolean(['daily','weekly'].includes(game?.mode)&&compatible);el.classList.toggle('ui-hidden',!show);if(show){if(this.liveVisible&&live){el.textContent=this.liveText();const n=Math.abs(live.cars);el.title=live.cars>0?pbText('ahead',n):live.cars<0?pbText('behind',n):pbText('even');}else{el.textContent='🏁';el.title=pbText('show');}el.setAttribute('aria-label',el.title);}},
    clear(){this.session=null;this.renderBadge(Game);},
    diagnostics(){const s=this.session;return{active:Boolean(s),mode:s?.mode||'',key:s?.key||'',runId:s?.runId||'',compat:s?.sig?.compat||'',points:s?.points?.length||0,baselinePoints:s?.baselineTrace?.length||0,lastLive:s?.lastLive||null,visible:this.liveVisible,traceStore:ChallengeTraceStore.stats()};}
  };

  function endlessConfig(wave,sessionSeed){
    const w=Math.max(1,Math.floor(Number(wave)||1)),effectiveLevel=Math.min(220,28+w*5),seed=(sessionSeed^Math.imul(w,0x9e3779b1))>>>0;
    const variants=['standard','standard','rush','express','heavy','service','freight','pulse','standard','roadwork'];
    const variant=variants[(w-1)%variants.length],lanes=w>=9?3:w>=4?2:1;
    const junctionType=(w>=5&&w%3===2)?['t-north','t-east','t-south','t-west'][Math.floor(w/3)%4]:'cross';
    const closedArm=junctionClosedArm(junctionType),dirs=DIRS.filter(d=>physicalEntryArm(d)!==closedArm);
    const total=Math.min(lanes>=3?36:lanes===2?32:28,14+w*2),startPhase=(w&1)?'H':'V';
    const plan=proceduralPlan(effectiveLevel,total,dirs,seed^0x85ebca6b),parSwitches=estimateParSwitches(plan,startPhase),profile=trafficProfile(effectiveLevel,variant);
    const base=Math.max(lanes>=3?.53:lanes===2?.57:.63,.91-w*.024),interval=base*(variant==='rush'?.88:variant==='express'?.84:variant==='freight'?1.04:variant==='roadwork'?1.06:1);
    const maxQueue=(lanes>=3?9:lanes===2?7:5)+((variant==='rush'||variant==='freight'||variant==='roadwork')?1:0);
    return {total,interval,maxQueue,perfectQueue:lanes>=3?4:3,lanes,closedLane:(variant==='roadwork'&&lanes>1)?1:null,parSwitches,perfectSwitchBudget:perfectSwitchBudget(parSwitches,lanes,variant,total),dirs,speed:160+Math.min(42,w*2),seed,plan,startPhase,clearance:1.16,effectiveLevel,variant,junctionType,pacing:'endless',...profile};
  }

  function proceduralPlan(n,total,dirs,seed){
    const rng=seeded(seed); const plan=[]; let lastAxis=null;
    while(plan.length<total){
      const desiredAxis = lastAxis && rng()<.52 ? lastAxis : (rng()<.5?'H':'V');
      const candidates=dirs.filter(d=>axisForPlanItem(d)===desiredAxis);
      if(!candidates.length){ lastAxis=desiredAxis==='H'?'V':'H'; continue; }
      // Keep the original straight-flow feel while turns are introduced gradually on late boards.
      // New paths stay deterministic and do not change the sequence of non-linked levels.
      let selected=candidates;
      const straight=candidates.filter(d=>!linkedRouteSpec(d)?.turn),turns=candidates.filter(d=>Boolean(linkedRouteSpec(d)?.turn));
      if(turns.length){
        const eligible=turns.filter(d=>linkedRouteSpec(d).turn==='right'||n>=163);
        selected=eligible.length&&rng()<(n>=163?.22:.16)?eligible:(straight.length?straight:eligible);
      }
      const run=1+Math.floor(rng()*(n>45?4:3));
      for(let i=0;i<run && plan.length<total;i++) plan.push(selected[Math.floor(rng()*selected.length)]);
      lastAxis=desiredAxis;
      if(rng()<.55) lastAxis=lastAxis==='H'?'V':'H';
    }
    // Make the first left-turn board teach the new route instead of leaving its appearance to chance.
    const leftRoutes=n>=163?dirs.filter(d=>linkedRouteSpec(d)?.turn==='left'):[];
    if(leftRoutes.length&&!plan.some(d=>linkedRouteSpec(d)?.turn==='left')){
      const slot=plan.findIndex(d=>axisForPlanItem(d)==='H');
      if(slot>=0)plan[slot]=leftRoutes[(seed>>>0)%leftRoutes.length];
    }
    return plan;
  }

  function campaignPlanForVariant(n,total,dirs,seed,variant){
    if(variant!=='alternating')return proceduralPlan(n,total,dirs,seed);
    const rng=seeded((seed^0x51ed270b)>>>0),byAxis={H:dirs.filter(d=>axisForPlanItem(d)==='H'),V:dirs.filter(d=>axisForPlanItem(d)==='V')};
    if(!byAxis.H.length||!byAxis.V.length)return proceduralPlan(n,total,dirs,seed);
    const out=[];let axis=n%2?'H':'V';
    while(out.length<total){
      const pool=byAxis[axis],run=Math.min(total-out.length,3+Math.floor(rng()*3));
      for(let i=0;i<run;i++)out.push(pool[Math.floor(rng()*pool.length)]);
      axis=axis==='H'?'V':'H';
    }
    return out;
  }

  function estimateParSwitches(plan,start){
    if(!plan.length) return 0;
    let switches=axisForPlanItem(plan[0])===start?0:1, axis=axisForPlanItem(plan[0]);
    for(let i=1;i<plan.length;i++){
      const next=axisForPlanItem(plan[i]);
      if(next!==axis){ switches++; axis=next; }
    }
    return Math.max(1,switches);
  }

  function variantForLevel(n){
    if(n>=52&&n%27===0)return 'roadwork';
    if(n>=31&&n%13===0)return 'service';
    if(n>=26&&n%19===0)return 'freight';
    if(n>=22&&n%17===0)return 'express';
    if(n>=24&&n%23===0)return 'pulse';
    if(n>=32&&n%16===0)return 'alternating';
    if(n>=15&&n%15===0)return 'heavy';
    if(n>=10&&n%10===0)return 'rush';
    return 'standard';
  }
  function trafficProfile(n,variant){
    let baseBus=n>=16?.11:0,baseAmbulance=n>=31?.07:0,baseTruck=n>=10?.10:0,baseSport=n>=18?.13:0,baseCompact=n>=6?.14:0;
    if(n>=11&&n<=20){baseCompact+=.05;baseBus+=.03;}
    else if(n>=21&&n<=30){baseSport+=.08;baseCompact+=.05;}
    else if(n>=31&&n<=45){baseAmbulance+=.07;baseCompact+=.02;}
    else if(n>=46&&n<=60){baseTruck+=.10;baseBus+=.08;}
    else if(n>=61){baseSport+=.10;baseCompact+=.08;baseAmbulance+=.02;}
    if(variant==='heavy')return {busChance:.34,ambulanceChance:Math.min(.04,baseAmbulance),truckChance:.18,sportChance:.05,compactChance:.08};
    if(variant==='service')return {busChance:.08,ambulanceChance:.24,truckChance:.05,sportChance:.10,compactChance:.14};
    if(variant==='express')return {busChance:.04,ambulanceChance:baseAmbulance,truckChance:.03,sportChance:.34,compactChance:.28};
    if(variant==='freight')return {busChance:.13,ambulanceChance:.03,truckChance:.36,sportChance:.04,compactChance:.08};
    if(variant==='pulse')return {busChance:.07,ambulanceChance:baseAmbulance,truckChance:.08,sportChance:.18,compactChance:.22};
    if(variant==='alternating')return {busChance:.08,ambulanceChance:baseAmbulance,truckChance:.08,sportChance:.16,compactChance:.24};
    if(variant==='roadwork')return {busChance:.15,ambulanceChance:.04,truckChance:.16,sportChance:.07,compactChance:.10};
    return {busChance:baseBus,ambulanceChance:baseAmbulance,truckChance:baseTruck,sportChance:baseSport,compactChance:baseCompact};
  }

  function perfectSwitchBudget(parSwitches,lanes,variant,total){
    return parSwitches+2+(lanes>1?2:0)+(variant==='service'?3:variant==='heavy'?1:variant==='freight'?2:variant==='express'?2:variant==='pulse'?2:variant==='alternating'?2:variant==='roadwork'?3:0)+(total>=28?1:0);
  }

  function levelConfig(n){
    if(n<=EARLY_LEVELS.length){
      const d=EARLY_LEVELS[n-1]; const plan=d.plan.split('');
      const variant=variantForLevel(n),profile=trafficProfile(n,variant),parSwitches=estimateParSwitches(plan,d.start);
      const earlySpeed=d.speed*(1+Math.min(.30,(n-1)*.018));
      const earlyInterval=d.interval*(1-Math.min(.16,(n-1)*.007));
      const earlyClearance=Math.max(1.16,1.36-(n-1)*.008);
      return { total:plan.length, interval:earlyInterval*(variant==='rush'?.88:variant==='express'?.84:variant==='pulse'?.92:1), maxQueue:d.maxQueue+((variant==='rush'||variant==='freight')?1:0), perfectQueue:n>=21?3:2, lanes:1, parSwitches, perfectSwitchBudget:perfectSwitchBudget(parSwitches,1,variant,plan.length), dirs:[...new Set(plan)], speed:earlySpeed, seed:9173+n*7919, plan, startPhase:d.start, clearance:earlyClearance,variant,junctionType:'cross',...profile };
    }
    const tier=Math.min(8,1+Math.floor((n-1)/10)),variant=variantForLevel(n),profile=trafficProfile(n,variant),junctionType=junctionTypeForLevel(n,variant);
    const lanes=n>=90?3:n>=46?2:1;
    const maxTotal=lanes>=3?36:lanes>1?32:28;
    const baseTotal=Math.min(maxTotal,17+Math.floor((n-30)*.18)),total=Math.min(maxTotal,baseTotal+(variant==='rush'?2:0));
    const recoveryLevel=variant==='standard'&&n>30&&variantForLevel(n-1)!=='standard';
    const baseInterval=Math.max(lanes>1?.61:.66,.84-(n-30)*.0024),recoveryFactor=recoveryLevel?1.08:1,interval=baseInterval*(variant==='rush'?.88:variant==='express'?.82:variant==='freight'?1.06:variant==='pulse'?.92:variant==='alternating'?.98:variant==='roadwork'?1.08:recoveryFactor);
    const maxQueue=(lanes>=3?(n>=140?9:8):lanes>1?(n>=100?7:6):(n<60?4:5))+((variant==='rush'||variant==='freight'||variant==='roadwork')?1:0);
    const closedArm=junctionClosedArm(junctionType),dirs=isLinkedJunctionType(junctionType)?Object.keys(routeGraphForJunction(junctionType).routes):DIRS.filter(d=>physicalEntryArm(d)!==closedArm); const seed=9173+n*7919; const startPhase=n%2?'H':'V';
    const plan=campaignPlanForVariant(n,total,dirs,seed,variant),parSwitches=estimateParSwitches(plan,startPhase),closedLane=(variant==='roadwork'&&lanes>1&&!isLinkedJunctionType(junctionType))?1:null;
    return {total,interval,maxQueue,perfectQueue:n>=21?3:2,lanes,closedLane,parSwitches,perfectSwitchBudget:perfectSwitchBudget(parSwitches,lanes,variant,total),dirs,speed:154+tier*4,seed,plan,startPhase,clearance:1.16,variant,junctionType,pacing:recoveryFactor>1?'recovery':'normal',...profile};
  }


  // M146: deterministic mid-level road incidents. They add new situations without another control.
  // Incident timing/type is derived from the campaign level seed, so retries are learnable and fair.
  const ROAD_INCIDENT_TYPES=Object.freeze(['broken','roadworks','slow']);
  function campaignRoadIncidentDefinition(level,config){
    const n=Math.max(1,safeInt(level,1,1_000_000,1));
    if(n<66||((n-66)%28)!==0||!config||Math.max(1,config.lanes||1)<2||config.closedLane!=null||isLinkedJunctionType(config.junctionType))return null;
    const cycle=Math.floor((n-66)/28),type=ROAD_INCIDENT_TYPES[cycle%ROAD_INCIDENT_TYPES.length],rng=seeded(((config.seed||n)^0x146c1d3)>>>0);
    const axis=rng()<.5?'H':'V',dirs=axis==='H'?['W','E']:['N','S'],dir=dirs[rng()<.5?0:1],lane=Math.max(0,Math.min((config.lanes||1)-1,1));
    const startAt=6.8+rng()*1.8,warningLead=3.8,duration=type==='roadworks'?12:type==='broken'?10:9;
    return Object.freeze({id:`L${n}-${type}`,level:n,type,axis,dir,lane,startAt,duration,warningLead,blockPoint:type==='broken'?182:196,speedFactor:type==='slow'?.58:1});
  }
  function incidentLabel(def){if(!def)return'';return def.type==='broken'?T.incidentBrokenCar:def.type==='roadworks'?T.incidentRoadworks:T.incidentSlowZone;}
  function createRoadIncidentDirector(def){
    if(!def)return null;
    return {
      def,elapsed:0,warned:false,active:false,completed:false,activationCount:0,
      update(dt,game){
        this.elapsed+=Math.max(0,Number(dt)||0);
        if(!this.warned&&this.elapsed>=Math.max(0,def.startAt-def.warningLead)){
          this.warned=true;game.hudDirty=true;toast(`⚠️ ${T.incidentWarning}: ${incidentLabel(def)}`);
        }
        if(!this.active&&!this.completed&&this.elapsed>=def.startAt){
          this.active=true;this.activationCount++;game.hudDirty=true;toast(`🚧 ${incidentLabel(def)} · ${T.incidentActive}`);
        }
        if(this.active&&this.elapsed>=def.startAt+def.duration){
          this.active=false;this.completed=true;game.hudDirty=true;toast(`✅ ${T.incidentCleared}`);
        }
      },
      remaining(){return this.active?Math.max(0,def.startAt+def.duration-this.elapsed):Math.max(0,def.startAt-this.elapsed);},
      hudText(){
        if(this.completed)return'';
        const sec=Math.max(0,Math.ceil(this.remaining()));
        return `${this.active?'🚧':'⚠️'} ${incidentLabel(def)} · ${sec}s`;
      },
      snapshot(){return{id:def.id,type:def.type,axis:def.axis,dir:def.dir,lane:def.lane,elapsed:Number(this.elapsed.toFixed(3)),warned:this.warned,active:this.active,completed:this.completed,remaining:Number(this.remaining().toFixed(3)),activationCount:this.activationCount};}
    };
  }
  function activeRoadIncident(game=Game){const d=game?.incidentDirector;return d?.active?d.def:null;}
  function incidentMatchesApproach(def,dir,lane){
    if(!def||def.type==='slow')return false;
    if(Number(lane)!==Number(def.lane))return false;
    return def.type==='broken'?dir===def.dir:AXIS[dir]===def.axis;
  }
  function incidentBlocksSpawn(game,dir,lane){return incidentMatchesApproach(activeRoadIncident(game),dir,lane);}
  function incidentBlocksCarLane(game,c,lane=(c?.lane||0)){
    const def=activeRoadIncident(game);if(!def||!c||!incidentMatchesApproach(def,c.dir,lane))return false;
    if(c.laneChangeT<1&&c.laneTarget!=null&&!incidentMatchesApproach(def,c.dir,c.laneTarget))return false;
    return c.progress<def.blockPoint+18;
  }
  function incidentStopProgress(game,c){
    const def=activeRoadIncident(game);if(!def||!incidentBlocksCarLane(game,c))return null;
    return def.blockPoint-Math.max(54,(c.length||76)*.52+22);
  }
  function incidentSpeedFactor(game,c){
    const def=activeRoadIncident(game);if(!def||def.type!=='slow'||!c||c.axis!==def.axis)return 1;
    return c.progress>=70&&c.progress<360?def.speedFactor:1;
  }
  function incidentLaneAvailable(game,dir,lane){return lane!==game.config?.closedLane&&!incidentBlocksSpawn(game,dir,lane);}
  function tryIncidentLaneMerge(game,c,laneCount){
    if(laneCount<2||!incidentBlocksCarLane(game,c)||c.laneChangeT<1||c.mergeT<.92||c.inside||c.progress>activeRoadIncident(game).blockPoint-10)return false;
    const current=c.lane||0,candidates=[];for(let delta=1;delta<laneCount;delta++){for(const lane of [current-delta,current+delta])if(lane>=0&&lane<laneCount&&incidentLaneAvailable(game,c.dir,lane)&&!candidates.includes(lane))candidates.push(lane);}
    for(const target of candidates){
      const targetCars=game.cars.filter(o=>o!==c&&o.dir===c.dir&&(((o.lane||0)===target)||(o.laneChangeT<1&&o.laneTarget===target)));
      const safe=targetCars.every(o=>Math.abs(o.progress-c.progress)>Math.max(92,((o.length||76)+(c.length||76))*.62+46));
      if(!safe)continue;c.laneFrom=current;c.laneTarget=target;c.laneChangeT=0;c.laneChanged=true;return true;
    }
    return false;
  }

  function districtInfo(level){
    if(level<=10) return {key:'district1',id:'park',accent:'#55d5ff',bg:'#173a5b'};
    if(level<=20) return {key:'district2',id:'coast',accent:'#ffd166',bg:'#284f64'};
    if(level<=30) return {key:'district3',id:'downtown',accent:'#a8e6ff',bg:'#293b54'};
    if(level<=45) return {key:'district4',id:'airport',accent:'#7be495',bg:'#24473e'};
    if(level<=60) return {key:'district5',id:'harbor',accent:'#6ec8ff',bg:'#1d405a'};
    if(level<=75) return {key:'district6',id:'night',accent:'#b28cff',bg:'#221c4d'};
    if(level<=90) return {key:'district7',id:'oldtown',accent:'#f0b96a',bg:'#5c4038'};
    if(level<=110) return {key:'district8',id:'tech',accent:'#64f1d2',bg:'#173e49'};
    if(level<=130) return {key:'district9',id:'winter',accent:'#9ee7ff',bg:'#35526d'};
    const cycle=Math.floor((level-131)/20)%4;
    return cycle===0?{key:'district6',id:'night',accent:'#b28cff',bg:'#221c4d'}:cycle===1?{key:'district7',id:'oldtown',accent:'#f0b96a',bg:'#5c4038'}:cycle===2?{key:'district8',id:'tech',accent:'#64f1d2',bg:'#173e49'}:{key:'district9',id:'winter',accent:'#9ee7ff',bg:'#35526d'};
  }


  const CITY_PROFILE_KEYS=Object.freeze({
    park:['cityProfilePark','cityLifePark','🌳'],coast:['cityProfileCoast','cityLifeCoast','🌊'],downtown:['cityProfileDowntown','cityLifeDowntown','🏙️'],airport:['cityProfileAirport','cityLifeAirport','✈️'],harbor:['cityProfileHarbor','cityLifeHarbor','⚓'],night:['cityProfileNight','cityLifeNight','🌃'],oldtown:['cityProfileOldtown','cityLifeOldtown','🏛️'],tech:['cityProfileTech','cityLifeTech','⚡'],winter:['cityProfileWinter','cityLifeWinter','❄️']
  });
  function cityProfileForLevel(level){const d=districtInfo(level),p=CITY_PROFILE_KEYS[d.id]||CITY_PROFILE_KEYS.park;return{...d,profileKey:p[0],lifeKey:p[1],icon:p[2]};}
  function districtGrowthSummaryForLevel(level,completionAdjust=0){
    const ch=campaignChapterForLevel(level),total=Math.max(1,ch.end-ch.start+1);let completed=0;
    for(let n=ch.start;n<=ch.end;n++)if(campaignLevelCompleted(n))completed++;
    completed=Math.max(0,Math.min(total,completed+completionAdjust));const ratio=completed/total;
    const stage=ratio>=1?4:ratio>=.75?3:ratio>=.45?2:ratio>=.18?1:0;
    const labels=['cityGrowthSeed','cityGrowthGrowing','cityGrowthActive','cityGrowthLandmark','cityGrowthComplete'];
    const thresholds=[Math.max(1,Math.ceil(total*.18)),Math.max(2,Math.ceil(total*.45)),Math.max(3,Math.ceil(total*.75)),total];
    const nextTarget=stage>=4?total:thresholds[stage],remaining=Math.max(0,nextTarget-completed),profile=cityProfileForLevel(level);
    return{chapter:ch,total,completed,ratio,stage,labelKey:labels[stage],nextTarget,remaining,profile};
  }
  function districtGrowthBars(level){const g=districtGrowthSummaryForLevel(level),seed=(g.profile.id.length*11+g.chapter.start*3)%17;return Array.from({length:8},(_,i)=>{const base=18+((seed+i*13)%26),boost=i<2+g.stage?12+g.stage*5:0;return Math.min(68,base+boost);});}
  function appendCityGrowthPanel(container,level){
    const growth=districtGrowthSummaryForLevel(level),profile=growth.profile,panel=document.createElement('section');panel.className=`city-growth-panel stage-${growth.stage}`;panel.style.setProperty('--city-accent',profile.accent);panel.setAttribute('aria-label',T.cityGrowth);
    const head=document.createElement('div');head.className='city-growth-head';const title=document.createElement('strong');title.textContent=`${profile.icon} ${T.cityGrowth}`;const stage=document.createElement('span');stage.textContent=`${T.cityGrowthStage}: ${T[growth.labelKey]}`;head.append(title,stage);
    const skyline=document.createElement('div');skyline.className='city-growth-skyline';for(const h of districtGrowthBars(level)){const b=document.createElement('i');b.style.height=`${h}%`;skyline.appendChild(b);}const pulse=document.createElement('span');pulse.className='city-growth-pulse';pulse.style.width=`${Math.max(5,Math.round(growth.ratio*100))}%`;skyline.appendChild(pulse);
    const meta=document.createElement('div');meta.className='city-growth-meta';const identity=document.createElement('div');identity.innerHTML=`<small>${T.cityIdentity}</small><strong>${T[profile.profileKey]}</strong>`;const life=document.createElement('div');life.innerHTML=`<small>${T.cityLife}</small><strong>${T[profile.lifeKey]}</strong>`;meta.append(identity,life);
    const foot=document.createElement('div');foot.className='city-growth-foot';foot.textContent=growth.stage>=4?`${growth.completed}/${growth.total} · ${T.cityGrowthComplete}`:`${growth.completed}/${growth.total} · ${T.cityGrowthNext}: ${growth.remaining} ${T.cityGrowthLevels}`;
    panel.append(head,skyline,meta,foot);container.appendChild(panel);return growth;
  }
  function drawDistrictIdentityMarker(g,game){
    if(game.mode!=='campaign')return;const p=cityProfileForLevel(game.level),growth=districtGrowthSummaryForLevel(game.level),stage=growth.stage,t=performance.now()/1000;
    const x=94,y=96;g.save();g.translate(x,y);g.globalAlpha=.72;g.strokeStyle=p.accent;g.fillStyle='rgba(7,22,35,.72)';g.lineWidth=2;roundRect(g,-34,-31,68,62,14,true);roundRect(g,-34,-31,68,62,14,false);
    g.fillStyle=p.accent;g.globalAlpha=.82;
    if(p.id==='park'){g.beginPath();g.arc(0,5,13,0,Math.PI*2);g.fill();g.fillRect(-3,17,6,11);g.beginPath();g.arc(-13,-3,9,0,Math.PI*2);g.fill();g.beginPath();g.arc(13,-3,9,0,Math.PI*2);g.fill();}
    else if(p.id==='coast'){g.lineWidth=4;g.beginPath();for(let i=-24;i<=24;i+=8){const yy=Math.sin(i*.22+t*.7)*3;g.lineTo(i,yy);}g.stroke();g.fillRect(-2,-22,4,20);g.beginPath();g.arc(0,-23,7,Math.PI,0);g.fill();}
    else if(p.id==='downtown'){for(let i=0;i<3;i++){const h=20+i*8;g.fillRect(-25+i*18,24-h,13,h);}g.fillStyle='#fff2b8';g.globalAlpha=.55;for(let i=0;i<5;i++)g.fillRect(-21+i*9,5-(i%2)*7,3,3);}
    else if(p.id==='airport'){g.fillRect(-25,8,50,5);g.beginPath();g.moveTo(-4,5);g.lineTo(26,-3);g.lineTo(-2,-9);g.lineTo(-16,-18);g.lineTo(-12,-3);g.lineTo(-27,3);g.closePath();g.fill();}
    else if(p.id==='harbor'){for(let i=0;i<3;i++){g.globalAlpha=.45+i*.15;g.fillRect(-27+i*18,5,15,16);}g.globalAlpha=.8;g.fillRect(-21,-20,5,25);g.fillRect(-21,-20,28,4);}
    else if(p.id==='night'){g.shadowColor=p.accent;g.shadowBlur=10;g.fillRect(-22,-14,44,28);g.fillStyle='#ff80de';g.fillRect(-16,-8,32,4);g.fillStyle='#6cf2ff';g.fillRect(-16,2,24,4);g.shadowBlur=0;}
    else if(p.id==='oldtown'){g.beginPath();g.arc(0,-3,18,0,Math.PI*2);g.fill();g.fillStyle='rgba(7,22,35,.9)';g.beginPath();g.arc(0,-3,13,0,Math.PI*2);g.fill();g.strokeStyle=p.accent;g.beginPath();g.moveTo(0,-3);g.lineTo(0,-12);g.moveTo(0,-3);g.lineTo(8,2);g.stroke();}
    else if(p.id==='tech'){g.strokeStyle=p.accent;g.lineWidth=4;roundRect(g,-18,-20,36,40,8,false);g.fillRect(-4,20,8,8);g.beginPath();g.moveTo(-8,-5);g.lineTo(2,-5);g.lineTo(-2,4);g.lineTo(9,4);g.stroke();}
    else {g.beginPath();g.arc(0,4,14,0,Math.PI*2);g.fill();g.beginPath();g.arc(0,-14,9,0,Math.PI*2);g.fill();g.fillStyle='#ff8e8e';g.fillRect(-10,-8,20,4);}
    if(stage>0){g.globalAlpha=.9;g.fillStyle='#ffd166';for(let i=0;i<stage;i++){g.beginPath();g.arc(-22+i*14,26,2.5,0,Math.PI*2);g.fill();}}g.restore();
  }
  function drawCityGrowthEdge(g,game){
    if(game.mode!=='campaign')return;const growth=districtGrowthSummaryForLevel(game.level),bars=districtGrowthBars(game.level),p=growth.profile;g.save();g.globalAlpha=.17+.035*growth.stage;g.fillStyle=p.accent;
    const baseY=190,startX=705;for(let i=0;i<Math.min(4+growth.stage,bars.length);i++){const h=8+bars[i]*.38;roundRect(g,startX+i*23,baseY-h,17,h,3,true);if(growth.stage>=2){g.fillStyle='rgba(255,239,174,.5)';for(let wy=baseY-h+5;wy<baseY-4;wy+=8)g.fillRect(startX+i*23+5,wy,3,3);g.fillStyle=p.accent;}}
    g.restore();
  }

  function nextDistrictUnlock(level){
    const next=level+1; if([11,21,31,46,61,76,91,111].includes(next)) return T[districtInfo(next).key];
    return '';
  }

  const FIXED_CAMPAIGN_CHAPTERS=Object.freeze([
    {start:1,end:10,key:'district1'},{start:11,end:20,key:'district2'},{start:21,end:30,key:'district3'},
    {start:31,end:45,key:'district4'},{start:46,end:60,key:'district5'},{start:61,end:75,key:'district6'},
    {start:76,end:90,key:'district7'},{start:91,end:110,key:'district8'},{start:111,end:130,key:'district9'}
  ]);
  function campaignChapterForLevel(level){
    const n=Math.max(1,safeInt(level,1,1_000_000,1)),fixed=FIXED_CAMPAIGN_CHAPTERS.find(c=>n>=c.start&&n<=c.end);if(fixed)return{...fixed,cycle:1};
    const cycleIndex=Math.floor((n-131)/20),start=131+cycleIndex*20,themeIndex=cycleIndex%4,key=['district6','district7','district8','district9'][themeIndex];
    return{start,end:start+19,key,cycle:2+Math.floor(cycleIndex/4)};
  }
  function campaignPrevChapter(ch){if(ch.start<=1)return null;return campaignChapterForLevel(ch.start-1);}
  function campaignNextChapter(ch){return campaignChapterForLevel(ch.end+1);}
  function campaignLevelUnlocked(level){const n=safeInt(level,1,1_000_000,1);return n<=save.level;}
  function campaignLevelCompleted(level){const n=safeInt(level,1,1_000_000,1);return n<save.level||Number(save.starsByLevel?.[String(n)]||0)>0;}
  function campaignChapterTitle(ch){const base=T[ch.key]||ch.key;return ch.cycle>1?`${base} • ${T.campaignCycle} ${ch.cycle}`:base;}
  function campaignCatalog(chapter=campaignChapterForLevel(save.level)){
    const levels=[];for(let n=chapter.start;n<=chapter.end;n++){const config=levelConfig(n),mission=missionForLevel(n,config);levels.push({level:n,unlocked:campaignLevelUnlocked(n),completed:campaignLevelCompleted(n),current:n===save.level,stars:Number(save.starsByLevel?.[String(n)]||0),mission:Boolean(mission),missionDone:Boolean(save.missionCompleted?.[String(n)]),medals:medalCount(save.medalsByLevel?.[String(n)]),variant:config.variant,lanes:config.lanes});}
    return{chapter:{...chapter,title:campaignChapterTitle(chapter)},levels,prev:campaignPrevChapter(chapter),next:campaignNextChapter(chapter)};
  }

  function campaignProgressSummary(chapter=campaignChapterForLevel(save.level)){
    const catalog=campaignCatalog(chapter),levels=catalog.levels,completed=levels.filter(x=>x.completed).length;
    const chapterStars=levels.reduce((n,x)=>n+Math.max(0,Math.min(3,Number(x.stars)||0)),0),chapterStarsMax=levels.length*3,chapterMedals=levels.reduce((n,x)=>n+(Number(x.medals)||0),0),chapterMedalsMax=levels.length*3;
    const levelProgress=levels.length?Math.max(0,Math.min(1,completed/levels.length)):0;
    const nextPurchase=nextGaragePurchase();
    let nextCar=null;
    if(nextPurchase){
      if(!nextPurchase.unlocked){nextCar={name:nextPurchase.name,status:`${T.level} ${nextPurchase.level}`,remaining:Math.max(0,nextPurchase.level-save.level),ready:false};}
      else if(nextPurchase.missing>0){nextCar={name:nextPurchase.name,status:`${nextPurchase.missing} 🪙`,remaining:0,ready:false};}
      else nextCar={name:nextPurchase.name,status:T.campaignReady,remaining:0,ready:true};
    }
    const starsInto=Math.max(0,save.totalStars%15),starsToBonus=starsInto===0?15:15-starsInto;
    const missions=Object.keys(save.missionCompleted||{}).length,missionsInto=missions%5,missionsToBonus=missionsInto===0?5:5-missionsInto;
    const nextChapter=catalog.next,levelsToDistrict=Math.max(0,nextChapter.start-save.level);
    return {chapter:catalog.chapter,completed,total:levels.length,levelProgress,chapterStars,chapterStarsMax,chapterMedals,chapterMedalsMax,nextCar,starsToBonus,missions,missionsToBonus,nextDistrict:{title:campaignChapterTitle(nextChapter),level:nextChapter.start,remaining:levelsToDistrict},totalStars:save.totalStars,coins:save.coins};
  }
  function campaignNextGoalText(){
    const p=campaignProgressSummary(campaignChapterForLevel(save.level));
    if(p.nextCar){
      if(p.nextCar.ready)return `${T.campaignNextCar}: ${p.nextCar.name} · ${T.campaignReady}`;
      if(p.nextCar.remaining>0)return `${T.campaignNextCar}: ${p.nextCar.name} · ${p.nextCar.remaining} ${T.campaignLevelsToGo}`;
      return `${T.campaignNextCar}: ${p.nextCar.name} · ${p.nextCar.status}`;
    }
    return `${T.campaignMasteryBonus}: ${p.starsToBonus} ${T.campaignStarsToGo}`;
  }
  const GREEN_WAVE_UNLOCK_LEVEL=25;
  const GREEN_WAVE_DEFINITIONS=Object.freeze({
    catch_wave:Object.freeze({
      id:'catch_wave',version:1,order:1,icon:'🟢',unlockLevel:GREEN_WAVE_UNLOCK_LEVEL,nameKey:'greenWaveCatch',descriptionKey:'greenWaveCatchDesc',goalKey:'greenWaveCatchGoal',hintKey:'greenWaveHint',seed:0x6a7101,
      board:{level:147,lanes:1,maxQueue:6,perfectQueue:3,interval:.84,speed:150,clearance:1.16,junctionType:'double-horizontal',variant:'standard',startPhases:{J0:'H',J1:'V'},busChance:.02,ambulanceChance:0,truckChance:.02,sportChance:.04,compactChance:.12},
      plan:['W>E','W>E','W>E','N0>S0','N1>S1','W>E','W>E','E>W','S0>N0','S1>N1','W>E','W>E','E>W','E>W','N0>S0','S1>N1','W>E','E>W'],
      objectives:{twoStarRatio:.55,threeStarRatio:.70,maxSideQueue3:3}
    }),
    both_sides:Object.freeze({
      id:'both_sides',version:1,order:2,prerequisite:'catch_wave',icon:'↔️',unlockLevel:GREEN_WAVE_UNLOCK_LEVEL,nameKey:'greenWaveBoth',descriptionKey:'greenWaveBothDesc',goalKey:'greenWaveBothGoal',hintKey:'greenWaveHintBoth',seed:0x6a7102,
      board:{level:147,lanes:1,maxQueue:6,perfectQueue:3,interval:.82,speed:151,clearance:1.16,junctionType:'double-horizontal',variant:'standard',startPhases:{J0:'H',J1:'H'},busChance:.03,ambulanceChance:0,truckChance:.02,sportChance:.05,compactChance:.12},
      plan:['W>E','W>E','E>W','E>W','N0>S0','W>E','E>W','N1>S1','W>E','W>E','E>W','S0>N0','E>W','E>W','S1>N1','W>E','E>W','W>E','N0>S0','N1>S1','E>W','W>E'],
      objectives:{twoStarRatio:.58,threeStarRatio:.72,maxSideQueue3:3}
    }),
    side_streets:Object.freeze({
      id:'side_streets',version:1,order:3,prerequisite:'both_sides',icon:'🚦',unlockLevel:GREEN_WAVE_UNLOCK_LEVEL,nameKey:'greenWaveSide',descriptionKey:'greenWaveSideDesc',goalKey:'greenWaveSideGoal',hintKey:'greenWaveHintSide',seed:0x6a7103,
      board:{level:147,lanes:1,maxQueue:7,perfectQueue:4,interval:.74,speed:151,clearance:1.15,junctionType:'double-horizontal',variant:'standard',startPhases:{J0:'H',J1:'H'},busChance:.03,ambulanceChance:0,truckChance:.02,sportChance:.04,compactChance:.14},
      plan:['W>E','N0>S0','N1>S1','W>E','S0>N0','E>W','S1>N1','W>E','N0>S0','N1>S1','E>W','S0>N0','W>E','S1>N1','W>E','E>W','N0>S0','N1>S1','W>E','S0>N0','S1>N1','E>W','W>E','N0>S0','N1>S1','E>W'],
      objectives:{twoStarRatio:.50,threeStarRatio:.65,maxSideQueue3:3}
    }),
    pedestrian_hour:Object.freeze({
      id:'pedestrian_hour',version:1,order:4,prerequisite:'side_streets',icon:'🚶',unlockLevel:GREEN_WAVE_UNLOCK_LEVEL,nameKey:'greenWavePed',descriptionKey:'greenWavePedDesc',goalKey:'greenWavePedGoal',hintKey:'greenWaveHintPed',seed:0x6a7104,
      board:{level:147,lanes:1,maxQueue:7,perfectQueue:4,interval:.78,speed:150,clearance:1.18,junctionType:'double-horizontal',variant:'standard',startPhases:{J0:'H',J1:'H'},busChance:.04,ambulanceChance:0,truckChance:.02,sportChance:.04,compactChance:.14},
      plan:['W>E','W>E','N0>S0','E>W','N1>S1','W>E','S0>N0','W>E','E>W','S1>N1','W>E','N0>S0','E>W','N1>S1','W>E','W>E','S0>N0','S1>N1','E>W','W>E','N0>S0','E>W','N1>S1','W>E'],
      events:[{id:'ped_j1_h',at:7.5,type:'pedestrian',axis:'H',junctionId:'J1'},{id:'ped_j0_v',at:18.0,type:'pedestrian',axis:'V',junctionId:'J0'},{id:'ped_j1_h2',at:29.0,type:'pedestrian',axis:'H',junctionId:'J1'}],
      objectives:{twoStarRatio:.52,threeStarRatio:.68,maxSideQueue3:4}
    }),
    long_transport:Object.freeze({
      id:'long_transport',version:1,order:5,prerequisite:'pedestrian_hour',icon:'🚌',unlockLevel:GREEN_WAVE_UNLOCK_LEVEL,nameKey:'greenWaveLong',descriptionKey:'greenWaveLongDesc',goalKey:'greenWaveLongGoal',hintKey:'greenWaveHintLong',seed:0x6a7105,
      board:{level:147,lanes:1,maxQueue:7,perfectQueue:4,interval:.86,speed:146,clearance:1.18,junctionType:'double-horizontal',variant:'standard',startPhases:{J0:'H',J1:'H'},busChance:0,ambulanceChance:0,truckChance:0,sportChance:.02,compactChance:.08},
      plan:['W>E','W>E','E>W','N0>S0','W>E','E>W','N1>S1','W>E','S0>N0','E>W','W>E','S1>N1','E>W','W>E','N0>S0','E>W','N1>S1','W>E','S0>N0','E>W','S1>N1','W>E'],
      vehicleKinds:{0:'bus',1:'truck',4:'bus',5:'truck',7:'bus',9:'truck',10:'bus',12:'truck',13:'bus',15:'truck',17:'bus',19:'truck',21:'bus'},
      objectives:{twoStarRatio:.48,threeStarRatio:.64,maxSideQueue3:4}
    }),
    dispatcher_duty:Object.freeze({
      id:'dispatcher_duty',version:1,order:6,prerequisite:'long_transport',icon:'🎛️',unlockLevel:GREEN_WAVE_UNLOCK_LEVEL,nameKey:'greenWaveDispatcher',descriptionKey:'greenWaveDispatcherDesc',goalKey:'greenWaveDispatcherGoal',hintKey:'greenWaveHintDispatcher',seed:0x6a7106,
      board:{level:147,lanes:2,maxQueue:8,perfectQueue:4,interval:.74,speed:154,clearance:1.18,junctionType:'double-horizontal',variant:'standard',startPhases:{J0:'H',J1:'V'},busChance:.05,ambulanceChance:0,truckChance:.04,sportChance:.05,compactChance:.12},
      plan:['W>E','N0>S0','W>S1','E>W','N1>S1','E>N0','W>E','S0>N0','W>N1','E>W','S1>N1','W>E','E>S0','N0>S0','E>W','W>S0','N1>S1','W>E','E>N1','S0>N0','E>W','S1>N1','W>E','W>N0','E>W','N0>S0','W>E','S1>N1'],
      vehicleKinds:{6:'ambulance',16:'fire'},
      announceEmergency:true,
      events:[{id:'dispatch_ped_j0',at:10.5,type:'pedestrian',axis:'H',junctionId:'J0'},{id:'dispatch_ped_j1',at:24.0,type:'pedestrian',axis:'V',junctionId:'J1'}],
      objectives:{twoStarRatio:.46,threeStarRatio:.62,maxSideQueue3:4,priorityRequired:1}
    })
  });
  const GREEN_WAVE_ORDER=Object.freeze(['catch_wave','both_sides','side_streets','pedestrian_hour','long_transport','dispatcher_duty']);
  function greenWaveDefinition(id='catch_wave'){return GREEN_WAVE_DEFINITIONS[String(id)]||null;}
  function greenWaveSaveKey(def){return `${def.id}@${def.version}`;}
  function greenWaveCatalog(){return GREEN_WAVE_ORDER.map(id=>GREEN_WAVE_DEFINITIONS[id]).filter(Boolean);}
  function greenWavePrevious(def){if(!def?.prerequisite)return null;return greenWaveDefinition(def.prerequisite);}
  function greenWaveNext(def){const i=GREEN_WAVE_ORDER.indexOf(def?.id);return i>=0&&i+1<GREEN_WAVE_ORDER.length?greenWaveDefinition(GREEN_WAVE_ORDER[i+1]):null;}
  function greenWaveUnlocked(def=greenWaveDefinition(),progress=save){if(!def||safeInt(progress?.level,1,1_000_000,1)<safeInt(def.unlockLevel,1,1_000_000,1))return false;const prev=greenWavePrevious(def);if(!prev)return true;return safeInt(progress?.greenWaveProgress?.[greenWaveSaveKey(prev)]?.clears,0,1_000_000,0)>0;}
  // M120 Vehicle Behavior & Personality. Profiles are derived from vehicle identity/type and
  // consume no RNG, so campaign plans and progression remain deterministic relative to M119.
  function vehiclePersonality(kind='car',archetype='standard',id=0){
    if(kind==='ambulance'||kind==='police'||kind==='fire')return{id:'priority',speed:1,gap:0,lookahead:112,hornDelay:99};
    if(kind==='truck')return{id:'heavy',speed:.97,gap:18,lookahead:158,hornDelay:2.85};
    if(kind==='bus')return{id:'patient',speed:.985,gap:14,lookahead:150,hornDelay:2.15};
    if(archetype==='sport')return{id:'brisk',speed:1.035,gap:-6,lookahead:108,hornDelay:2.35};
    if(archetype==='compact')return{id:'nimble',speed:1.018,gap:-3,lookahead:116,hornDelay:2.55};
    const bucket=Math.abs(Number(id)||0)%5;
    if(bucket===1)return{id:'cautious',speed:.965,gap:12,lookahead:146,hornDelay:3.0};
    if(bucket===3)return{id:'brisk',speed:1.025,gap:-4,lookahead:112,hornDelay:2.35};
    return{id:'steady',speed:1,gap:3,lookahead:128,hornDelay:2.65};
  }
  function personalityForCar(c){return vehiclePersonality(c?.kind||'car',c?.archetype||'standard',c?.id||0);}
  function vehicleFollowGapExtra(c){if(c?.linkedRouteId)return 0;const v=Number(c?.followGapExtra);return Number.isFinite(v)?v:personalityForCar(c).gap;}
  function vehicleStopLookahead(c,fallback=120){if(c?.linkedRouteId)return fallback;const v=Number(c?.stopLookahead);return Number.isFinite(v)&&v>0?v:(personalityForCar(c).lookahead||fallback);}
  function vehicleHornDelay(c){const v=Number(c?.hornDelay);return Number.isFinite(v)&&v>0?v:(personalityForCar(c).hornDelay||2.65);}
  // M121 presentation-only vehicle dynamics. These helpers never feed back into simulation.
  function vehicleBrakeIntensity(c){
    if(c?.stopped)return 1;const top=Math.max(1,Number(c?.topSpeed||c?.baseSpeed||1)),speed=Math.max(0,Number(c?.currentSpeed||0));
    return Math.max(0,Math.min(1,(.72-speed/top)/.52));
  }
  function vehicleChassisShift(c){
    if(reducedMotion||RenderQuality.level===0||c?.stopped)return 0;
    const speed=Math.max(0,Number(c?.currentSpeed||0)),top=Math.max(1,Number(c?.topSpeed||c?.baseSpeed||1)),motion=Math.min(1,speed/top);
    const mass=(c?.kind==='truck'||c?.kind==='bus'||c?.kind==='fire')?.55:1;
    return Math.sin(performance.now()/145+(Number(c?.id||0)*1.73))*1.15*motion*mass;
  }
  function greenWaveConfig(def){const b=def.board,plan=def.plan.slice(),parSwitches=8;return{...b,total:plan.length,plan,dirs:[...new Set(plan)],seed:def.seed,parSwitches,perfectSwitchBudget:12,effectiveLevel:b.level,greenWave:true,greenWaveChallengeId:def.id,forcedVehicleKinds:{...(def.vehicleKinds||{})},announceEmergency:Boolean(def.announceEmergency)};}
  function createGreenWaveDirector(def){
    const events=(def?.events||[]).map(e=>({...e})).sort((a,b)=>a.at-b.at),fired=new Set(),warned=new Set(),pendingPedestrians=[];
    return {
      def,elapsed:0,events,fired,warned,pendingPedestrians,
      update(dt,game){
        this.elapsed+=Math.max(0,Number(dt)||0);
        for(const event of events){
          const remaining=event.at-this.elapsed;if(!fired.has(event.id)&&!warned.has(event.id)&&remaining>0&&remaining<=3){warned.add(event.id);if(event.type==='pedestrian')toast(`🚶 ${T.greenWavePedIncoming}`);}
          if(fired.has(event.id)||this.elapsed+1e-6<event.at)continue;fired.add(event.id);if(event.type==='pedestrian')pendingPedestrians.push({id:event.id,axis:event.axis,junctionId:event.junctionId||null});
        }
        if(pendingPedestrians.length){const req=pendingPedestrians[0];if(canStartScenarioPedestrian(game,req.axis,req.junctionId)){game.spawnPedestrianWave(req.axis,req.junctionId);pendingPedestrians.shift();}}
      },
      completeReady(game){return fired.size===events.length&&pendingPedestrians.length===0&&game.pedestrians.length===0;},
      hudText(game){const stats=game.greenWaveStats||{},defn=this.def;const base=T[defn.goalKey]||T.greenWaveMode,through=`${T.greenWaveThrough}: ${stats.throughNoStop||0}/${stats.throughCompleted||0}/${stats.throughTotal||0}`;if(events.length){const done=fired.size;return `${base} · ${through} · 🚶 ${done}/${events.length}`;}return `${base} · ${through}`;},
      snapshot(){return{id:def.id,elapsed:Number(this.elapsed.toFixed(3)),fired:[...fired],warned:[...warned],pendingPedestrians:pendingPedestrians.map(x=>({...x})),eventCount:events.length};}
    };
  }

  const SCENARIO_DEFINITIONS=Object.freeze({
    after_school:Object.freeze({
      id:'after_school',version:2,icon:'🎒',seed:0x5c4002,unlockRule:{minLevel:21},nameKey:'scenarioAfterSchool',descriptionKey:'scenarioAfterSchoolDesc',goalKey:'scenarioAfterSchoolGoal',ruleKey:'scenarioAfterSchoolRule',
      board:{level:10,startPhase:'H',lanes:1,maxQueue:5,perfectQueue:2,interval:.67,speed:154,clearance:1.20,junctionType:'cross',variant:'heavy',busChance:.38,ambulanceChance:0,truckChance:.02,sportChance:.04,compactChance:.16},
      stages:[
        {id:'clear',start:0,labelKey:'scenarioStageSchoolOpen',events:[{id:'opening',at:0,type:'traffic',wave:'opening'}]},
        {id:'school1',start:10,labelKey:'scenarioStageSchoolRush',events:[{id:'students_a',at:10,type:'pedestrian',axis:'V'},{id:'bus_a',at:13,type:'traffic',wave:'bus_a'}]},
        {id:'school2',start:22,labelKey:'scenarioStageSchoolSecond',events:[{id:'students_b',at:22,type:'pedestrian',axis:'H'},{id:'bus_b',at:25,type:'traffic',wave:'bus_b'},{id:'students_c',at:31,type:'pedestrian',axis:'V'}]},
        {id:'final',start:36,labelKey:'scenarioStageSchoolFinal',events:[{id:'final',at:36,type:'traffic',wave:'final'}]}
      ],
      trafficPlan:{opening:['W','E','W','E','N','S','W','E'],bus_a:['W','E','W','E','W','E'],bus_b:['N','S','N','S','W','E'],final:['W','E','N','S','W','E','N','S','W','E']},
      objectives:{maxQueue:4,maxSwitches:12},starThresholds:{twoStarQueue:4,threeStarSwitches:12}
    }),
    green_corridor:Object.freeze({
      id:'green_corridor',version:1,icon:'🚑',seed:0x5c4011,unlockRule:{minLevel:25},nameKey:'scenarioGreenCorridor',descriptionKey:'scenarioGreenCorridorDesc',goalKey:'scenarioGreenCorridorGoal',ruleKey:'scenarioGreenCorridorRule',
      board:{level:36,startPhase:'V',lanes:2,maxQueue:6,perfectQueue:3,interval:.66,speed:162,clearance:1.18,junctionType:'cross',variant:'service',busChance:.06,ambulanceChance:.30,truckChance:.03,sportChance:.07,compactChance:.12},
      stages:[
        {id:'prep',start:0,labelKey:'scenarioStageEmergencyPrep',events:[{id:'opening',at:0,type:'traffic',wave:'opening'}]},
        {id:'convoy',start:10,labelKey:'scenarioStageEmergencyWave',events:[{id:'service_a',at:10,type:'traffic',wave:'service_a'},{id:'service_b',at:20,type:'traffic',wave:'service_b'}]},
        {id:'final',start:31,labelKey:'scenarioStageEmergencyFinal',events:[{id:'service_c',at:31,type:'traffic',wave:'service_c'}]}
      ],
      trafficPlan:{opening:['W','E','N','S','W','E','N','S'],service_a:['N','S','W','E','N','S','W','E'],service_b:['W','E','W','E','N','S','N','S'],service_c:['N','S','W','E','N','S','W','E','N','S']},
      objectives:{maxQueue:5,maxSwitches:13,priorityRequired:3},starThresholds:{twoStarQueue:5,threeStarSwitches:13}
    }),
    stadium_exit:Object.freeze({
      id:'stadium_exit',version:1,icon:'🏟️',seed:0x5c4021,unlockRule:{minLevel:35},nameKey:'scenarioStadium',descriptionKey:'scenarioStadiumDesc',goalKey:'scenarioStadiumGoal',ruleKey:'scenarioStadiumRule',
      board:{level:66,startPhase:'H',lanes:2,maxQueue:7,perfectQueue:4,interval:.60,speed:166,clearance:1.22,junctionType:'cross',variant:'pulse',busChance:.12,ambulanceChance:.02,truckChance:.04,sportChance:.15,compactChance:.20},
      stages:[
        {id:'prep',start:0,labelKey:'scenarioStageCrowdPrep',events:[{id:'opening',at:0,type:'traffic',wave:'opening'}]},
        {id:'crowd',start:10,labelKey:'scenarioStageCrowdWave',events:[{id:'crowd_a',at:10,type:'pedestrian',axis:'V'},{id:'traffic_a',at:13,type:'traffic',wave:'rush_a'},{id:'crowd_b',at:20,type:'pedestrian',axis:'H'},{id:'traffic_b',at:23,type:'traffic',wave:'rush_b'},{id:'crowd_c',at:30,type:'pedestrian',axis:'V'},{id:'crowd_d',at:38,type:'pedestrian',axis:'H'}]},
        {id:'final',start:41,labelKey:'scenarioStageCrowdFinal',events:[{id:'final',at:41,type:'traffic',wave:'final'}]}
      ],
      trafficPlan:{opening:['W','E','N','S','W','E','N','S'],rush_a:['W','E','W','E','N','S','W','E'],rush_b:['N','S','N','S','W','E','N','S'],final:['W','E','N','S','W','E','N','S','W','E','N','S']},
      objectives:{maxQueue:6,maxSwitches:15},starThresholds:{twoStarQueue:6,threeStarSwitches:15}
    }),
    airport_priority:Object.freeze({
      id:'airport_priority',version:1,icon:'✈️',seed:0x5c4031,unlockRule:{minLevel:45},nameKey:'scenarioAirportPriority',descriptionKey:'scenarioAirportPriorityDesc',goalKey:'scenarioAirportPriorityGoal',ruleKey:'scenarioAirportPriorityRule',
      board:{level:42,startPhase:'V',lanes:2,maxQueue:7,perfectQueue:4,interval:.58,speed:168,clearance:1.20,junctionType:'cross',variant:'service',busChance:.24,ambulanceChance:.24,truckChance:.08,sportChance:.10,compactChance:.15},
      stages:[
        {id:'rush',start:0,labelKey:'scenarioStageAirportRush',events:[{id:'opening',at:0,type:'traffic',wave:'opening'}]},
        {id:'service',start:12,labelKey:'scenarioStageAirportService',events:[{id:'service_a',at:12,type:'traffic',wave:'service_a'},{id:'ped_a',at:19,type:'pedestrian',axis:'H'},{id:'service_b',at:23,type:'traffic',wave:'service_b'}]},
        {id:'final',start:34,labelKey:'scenarioStageAirportFinal',events:[{id:'final',at:34,type:'traffic',wave:'final'}]}
      ],
      trafficPlan:{opening:['N','S','W','E','N','S','W','E','W','E'],service_a:['N','S','N','S','W','E','W','E'],service_b:['W','E','N','S','W','E','N','S','W','E'],final:['N','S','W','E','N','S','W','E','N','S']},
      objectives:{maxQueue:6,maxSwitches:15,priorityRequired:4},starThresholds:{twoStarQueue:6,threeStarSwitches:15}
    }),
    roadworks_detour:Object.freeze({
      id:'roadworks_detour',version:1,icon:'🚧',seed:0x5c4041,unlockRule:{minLevel:50},nameKey:'scenarioRoadworks',descriptionKey:'scenarioRoadworksDesc',goalKey:'scenarioRoadworksGoal',ruleKey:'scenarioRoadworksRule',
      board:{level:52,startPhase:'H',lanes:2,closedLane:1,maxQueue:7,perfectQueue:4,interval:.62,speed:160,clearance:1.24,junctionType:'cross',variant:'roadwork',busChance:.12,ambulanceChance:.03,truckChance:.18,sportChance:.05,compactChance:.12},
      stages:[
        {id:'prep',start:0,labelKey:'scenarioStageRoadworksPrep',events:[{id:'opening',at:0,type:'traffic',wave:'opening'}]},
        {id:'rush',start:14,labelKey:'scenarioStageRoadworksRush',events:[{id:'rush_a',at:14,type:'traffic',wave:'rush_a'},{id:'ped_a',at:22,type:'pedestrian',axis:'V'},{id:'rush_b',at:28,type:'traffic',wave:'rush_b'}]},
        {id:'final',start:40,labelKey:'scenarioStageRoadworksFinal',events:[{id:'final',at:40,type:'traffic',wave:'final'}]}
      ],
      trafficPlan:{opening:['W','E','N','S','W','E','N','S'],rush_a:['W','E','W','E','N','S','W','E'],rush_b:['N','S','N','S','W','E','N','S'],final:['W','E','N','S','W','E','N','S','W','E']},
      objectives:{maxQueue:6,maxSwitches:14},starThresholds:{twoStarQueue:6,threeStarSwitches:14}
    }),

    roundabout_trial:Object.freeze({
      id:'roundabout_trial',version:1,icon:'🔄',seed:0x5c4071,unlockRule:{minLevel:12},nameKey:'roundaboutTrial',descriptionKey:'roundaboutTrialDesc',goalKey:'roundaboutTrialGoal',ruleKey:'roundaboutTrialRule',experimental:true,
      board:{level:27,startPhase:'H',lanes:1,maxQueue:6,perfectQueue:3,interval:.78,speed:146,clearance:1.18,junctionType:'roundabout',variant:'standard',busChance:.04,ambulanceChance:0,truckChance:.03,sportChance:.08,compactChance:.18},
      stages:[
        {id:'warmup',start:0,labelKey:'roundaboutWarmup',events:[{id:'opening',at:0,type:'traffic',wave:'opening'}]},
        {id:'mixed',start:10,labelKey:'roundaboutMixed',events:[{id:'mixed_a',at:10,type:'traffic',wave:'mixed_a'},{id:'mixed_b',at:21,type:'traffic',wave:'mixed_b'}]},
        {id:'final',start:32,labelKey:'roundaboutFinal',events:[{id:'final',at:32,type:'traffic',wave:'final'}]}
      ],
      trafficPlan:{opening:['W','E','N','S','W','E'],mixed_a:['N','W','S','E','W','N'],mixed_b:['E','S','W','N','E','S'],final:['W','N','E','S','W','E','N','S']},
      roundaboutTurns:['right','straight','left','right','straight','left','straight','right','left','straight','right','left','straight','right','left','straight','right','left','straight','right','left','straight','right','left','straight','right'],
      objectives:{maxQueue:5,maxSwitches:14},starThresholds:{twoStarQueue:5,threeStarSwitches:14}
    }),
    freight_port:Object.freeze({
      id:'freight_port',version:1,icon:'🚛',seed:0x5c4051,unlockRule:{minLevel:60},nameKey:'scenarioFreightPort',descriptionKey:'scenarioFreightPortDesc',goalKey:'scenarioFreightPortGoal',ruleKey:'scenarioFreightPortRule',
      board:{level:58,startPhase:'V',lanes:3,maxQueue:8,perfectQueue:5,interval:.66,speed:158,clearance:1.26,junctionType:'cross',variant:'freight',busChance:.12,ambulanceChance:.02,truckChance:.42,sportChance:.03,compactChance:.06},
      stages:[
        {id:'prep',start:0,labelKey:'scenarioStageFreightPrep',events:[{id:'opening',at:0,type:'traffic',wave:'opening'}]},
        {id:'rush',start:13,labelKey:'scenarioStageFreightRush',events:[{id:'freight_a',at:13,type:'traffic',wave:'freight_a'},{id:'freight_b',at:25,type:'traffic',wave:'freight_b'}]},
        {id:'final',start:38,labelKey:'scenarioStageFreightFinal',events:[{id:'final',at:38,type:'traffic',wave:'final'}]}
      ],
      trafficPlan:{opening:['W','E','N','S','W','E','N','S','W','E'],freight_a:['W','E','W','E','N','S','N','S','W','E'],freight_b:['N','S','N','S','W','E','W','E','N','S'],final:['W','E','N','S','W','E','N','S','W','E','N','S']},
      objectives:{maxQueue:7,maxSwitches:15},starThresholds:{twoStarQueue:7,threeStarSwitches:15}
    })
  });
  function scenarioDefinition(id='after_school'){return SCENARIO_DEFINITIONS[String(id)]||null;}
  function scenarioSaveKey(def){return `${def.id}@${def.version}`;}
  function scenarioUnlocked(def,progress=save){return Boolean(def&&safeInt(progress?.level,1,1_000_000,1)>=safeInt(def.unlockRule?.minLevel,1,1_000_000,1));}
  function scenarioEvents(def){return (def?.stages||[]).flatMap(stage=>(stage.events||[]).map(event=>({...event,stageId:stage.id,stageLabelKey:stage.labelKey}))).sort((a,b)=>a.at-b.at);}
  function scenarioTrafficTotal(def){return Object.values(def?.trafficPlan||{}).reduce((n,wave)=>n+(Array.isArray(wave)?wave.length:0),0);}
  function scenarioConfig(def){
    const b=def.board,totalTraffic=scenarioTrafficTotal(def);
    return {total:0,interval:b.interval,maxQueue:b.maxQueue,perfectQueue:b.perfectQueue,lanes:b.lanes,closedLane:b.closedLane??null,parSwitches:def.objectives?.maxSwitches||0,perfectSwitchBudget:def.starThresholds.threeStarSwitches,dirs:DIRS.slice(),speed:b.speed,seed:def.seed,plan:[],startPhase:b.startPhase,clearance:b.clearance,effectiveLevel:b.level,variant:b.variant,junctionType:b.junctionType,pacing:'scenario',roundaboutTurns:Array.isArray(def.roundaboutTurns)?def.roundaboutTurns.slice():null,busChance:b.busChance,ambulanceChance:b.ambulanceChance,truckChance:b.truckChance,sportChance:b.sportChance,compactChance:b.compactChance,scenarioTotalTraffic:totalTraffic};
  }
  function canStartScenarioPedestrian(game,roadAxis,junctionId=null){
    if(!roadAxis||signalTransitionTimer(game,junctionId)>0||signalStateForAxis(roadAxis,game,junctionId)!=='red'||game.pedestriansOnAxis(roadAxis,junctionId))return false;
    const lanes=game.config?.lanes||1;
    if(isLinkedJunctionType(game.config?.junctionType)){
      if(game.cars.some(c=>linkedCarOccupiesPedestrianCrossing(c,roadAxis,junctionId,lanes)))return false;
      return !emergencyApproachingAxis(roadAxis,game,junctionId);
    }
    const turningToward=game.cars.some(c=>c.turn&&c.turn!=='straight'&&AXIS[c.turnOutDir||turnExitDir(c.dir,c.turn)]===roadAxis&&c.progress>=stopTargetProgress(c,lanes)-90&&c.progress<turnCurveBounds(lanes).end+12);
    return !turningToward&&!emergencyApproachingAxis(roadAxis,game);
  }
  function createScenarioDirector(def){
    const events=scenarioEvents(def),fired=new Set(),warned=new Set(),pendingPedestrians=[];
    return {
      def,elapsed:0,events,fired,warned,pendingPedestrians,stageIndex:0,totalTraffic:scenarioTrafficTotal(def),lastStageId:'',
      currentStage(){const stages=def.stages||[];let idx=0;for(let i=0;i<stages.length;i++)if(this.elapsed>=stages[i].start)idx=i;this.stageIndex=idx;return stages[idx]||null;},
      stageLabel(){const stage=this.currentStage();return stage?T[stage.labelKey]||stage.id:'';},
      update(dt,game){
        this.elapsed+=Math.max(0,Number(dt)||0);
        for(const event of events){
          const remaining=event.at-this.elapsed;
          if(!fired.has(event.id)&&!warned.has(event.id)&&remaining>0&&remaining<=4){warned.add(event.id);toast(`⏱ ${T.scenarioNextEvent}: ${event.type==='pedestrian'?T.scenarioPedWave:T.scenarioTrafficWave}`);}
          if(fired.has(event.id)||this.elapsed+1e-6<event.at)continue;
          fired.add(event.id);
          if(event.type==='traffic'){
            const wave=def.trafficPlan[event.wave]||[];for(const route of wave)game.config.plan.push(route);game.config.total=game.config.plan.length;
          }else if(event.type==='pedestrian')pendingPedestrians.push({id:event.id,axis:event.axis,junctionId:event.junctionId||null});
        }
        if(pendingPedestrians.length){const req=pendingPedestrians[0];if(canStartScenarioPedestrian(game,req.axis,req.junctionId)){game.spawnPedestrianWave(req.axis,req.junctionId);pendingPedestrians.shift();}}
        const stage=this.currentStage();if(stage&&stage.id!==this.lastStageId){this.lastStageId=stage.id;if(this.elapsed>.05)toast(`🎯 ${T[stage.labelKey]||stage.id}`);}
      },
      completeReady(game){return fired.size===events.length&&pendingPedestrians.length===0&&game.spawned>=game.config.total&&game.cars.length===0&&game.pedestrians.length===0;},
      hudText(game){const stage=this.currentStage(),pedEvents=events.filter(e=>e.type==='pedestrian'),pedDone=pedEvents.filter(e=>fired.has(e.id)).length,priorityReq=def.objectives?.priorityRequired||0,base=`${stage?T[stage.labelKey]||stage.id:T[def.goalKey]}`;if(priorityReq)return `${base} · 🚨 ${game.prioritySaved||0}/${priorityReq} · 🚗 ${game.exited}/${this.totalTraffic}`;if(pedEvents.length)return `${base} · 🚶 ${pedDone}/${pedEvents.length} · 🚗 ${game.exited}/${this.totalTraffic}`;return `${base} · 🚗 ${game.exited}/${this.totalTraffic}`;},
      snapshot(){const stage=this.currentStage();return{id:def.id,version:def.version,key:scenarioSaveKey(def),elapsed:Number(this.elapsed.toFixed(3)),stage:stage?.id||'',stageLabel:stage?T[stage.labelKey]||stage.id:'',fired:[...fired],warned:[...warned],pendingPedestrians:pendingPedestrians.map(x=>({...x})),totalEvents:events.length,totalTraffic:this.totalTraffic};}
    };
  }

  function ownedStyleIds(){ const ids=Array.isArray(save.ownedCars)?save.ownedCars:[0]; return ids.length?ids:[0]; }
  const sessionFailCounts=new Map();

  function spawnDelayFactor(config,spawned,total){
    const variant=config?.variant||'standard';
    const i=Math.max(0,spawned-1);
    if(variant==='rush'){
      // A compact city platoon followed by a real decision window.
      const slot=i%6;return slot<=2?.58:slot===3?.68:slot===4?1.42:1.10;
    }
    if(variant==='pulse'){
      // Three-car burst, then a readable switching window.
      const slot=i%4;
      return slot===3?1.72:(slot===2?0.66:0.58);
    }
    if(variant==='service'){
      // Emergency/service traffic arrives as a recognizable convoy rather than random noise.
      const slot=i%7;return slot===0?1.34:(slot>=2&&slot<=5?.72:.92);
    }
    if(variant==='alternating'){
      // Axis groups are shaped in the plan; this extra pause marks the hand-off between pressure waves.
      const slot=i%5;return slot===4?1.46:.76;
    }
    if(variant==='heavy') return i%4===3?1.30:1.08;
    if(variant==='express') return i%5===4?1.20:.82;
    if(variant==='freight') return i%3===2?1.30:1.05;
    return 1;
  }

  function missionForLevel(level,config){
    if(level<6||!config)return null;
    const slot=level%3;
    if(slot===1){
      const target=Math.max(2,Math.min(config.maxQueue-1,config.perfectQueue||2));
      return {type:'queue',target,label:`${T.missionQueue} ${target}`};
    }
    if(slot===2){
      const target=Math.max(2,config.perfectSwitchBudget||((config.parSwitches||1)+2));
      return {type:'switch',target,label:`${T.missionSwitch} ${target}`};
    }
    const target=Math.min(8,Math.max(4,3+Math.floor(level/25)));
    return {type:'flow',target,label:`${T.missionFlow} ×${target}`};
  }
  function missionSucceeded(mission){
    if(!mission||Game.rescueUsed||Game.assistActive)return false;
    if(mission.type==='queue')return Game.maxObservedQueue<=mission.target;
    if(mission.type==='switch')return Game.switches<=mission.target;
    return (Game.maxFlowStreak||0)>=mission.target;
  }
  function medalObjectivesForLevel(level,config=levelConfig(level)){
    const queueTarget=Math.max(2,Math.min(config.maxQueue||6,(config.perfectQueue||2)+1));
    const switchTarget=Math.max(1,(config.parSwitches||4)+(config.lanes>1?2:1));
    const incident=campaignRoadIncidentDefinition(level,config);
    let context={id:'flow',bit:4,label:T.medalFlow,target:Math.max(4,Math.min(8,4+Math.floor(level/60)))};
    if(incident)context={id:'incident',bit:4,label:T.medalIncident,target:Math.max(2,(config.maxQueue||6)-1)};
    else if(config.variant==='service')context={id:'priority',bit:4,label:T.medalPriority,target:1};
    return [{id:'queue',bit:1,label:T.medalQueue,target:queueTarget},{id:'switch',bit:2,label:T.medalSwitch,target:switchTarget},context];
  }
  function medalMaskForRun(level=Game.level,config=Game.config){
    if(Game.mode!=='campaign'||Game.rescueUsed||Game.assistActive)return 0;
    let mask=0;
    for(const objective of medalObjectivesForLevel(level,config)){
      let ok=false;
      if(objective.id==='queue')ok=Game.maxObservedQueue<=objective.target;
      else if(objective.id==='switch')ok=Game.switches<=objective.target;
      else if(objective.id==='priority')ok=(Game.prioritySaved||0)>=objective.target;
      else if(objective.id==='incident')ok=Boolean(Game.incidentDirector?.completed)&&Game.maxObservedQueue<=objective.target;
      else ok=(Game.maxFlowStreak||0)>=objective.target;
      if(ok)mask|=objective.bit;
    }
    return mask&7;
  }
  function medalLabels(mask,level=Game.level,config=Game.config){return medalObjectivesForLevel(level,config).filter(x=>(Number(mask)||0)&x.bit).map(x=>x.label);}
  function medalResultForRun(level=Game.level,config=Game.config){
    const key=String(level),previous=(Number(save.medalsByLevel?.[key])||0)&7,runMask=medalMaskForRun(level,config),savedMask=(previous|runMask)&7,newMask=savedMask&~previous;
    return {level,previous,runMask,savedMask,newMask,count:medalCount(savedMask),newCount:medalCount(newMask),labels:medalLabels(savedMask,level,config),newLabels:medalLabels(newMask,level,config),objectives:medalObjectivesForLevel(level,config)};
  }
  function unlockAchievements(stars){
    save.achievements=save.achievements||{};const unlocked=[];
    const tryUnlock=(key,label,condition)=>{if(condition&&!save.achievements[key]){save.achievements[key]=true;unlocked.push({key,label});}};
    tryUnlock('perfect',T.achPerfect,stars===3&&!Game.rescueUsed&&!Game.assistActive);
    tryUnlock('flow',T.achFlow,(Game.maxFlowStreak||0)>=8);
    tryUnlock('priority',T.achPriority,(Game.prioritySaved||0)>=2);
    tryUnlock('roadwork',T.achRoadwork,Game.config?.variant==='roadwork'&&stars>=2);
    tryUnlock('missions',T.achMissions,Object.keys(save.missionCompleted||{}).length>=5);
    return unlocked;
  }

  function tutorialCueForLevel(level){
    if(level===1)return `☝ ${T.tapSignal}`;
    if(level===2)return `🚦 ${T.tutorialGoal2}`;
    if(level===3)return `👀 ${T.tutorialGoal3}`;
    if(level===4)return `🛡 ${T.tutorialGoal4}`;
    if(level===5)return `⚡ ${T.tutorialGoal5}`;
    if(level===6)return `🚶 ${T.tutorialPedestrians}`;
    if(level===8)return `↪ ${T.tutorialTurns}`;
    if(level===14)return `🟡 ${T.tutorialYellow}`;
    if(level===18)return `↰ ${T.tutorialLeftTurns}`;
    if(level===46)return `🛣 ${T.tutorialLanes}`;
    if(level===90)return `🛣 ${T.tutorialLanes3}`;
    return '';
  }
  function firstSessionCoachActive(game=Game){
    return Boolean(game&&game.mode==='campaign'&&game.level<=5&&save.level<=5);
  }
  function hideFirstSessionCoach(){
    const hint=$('tap-hint');if(!hint)return;hint.style.display='none';hint.setAttribute('aria-hidden','true');hint.classList.remove('coach-warning');
  }
  function showFirstSessionCoach(key,text,duration=3000){
    if(!firstSessionCoachActive()||!text)return false;
    Game.coachFlags=Game.coachFlags||{};if(Game.coachFlags[key])return false;Game.coachFlags[key]=true;
    const hint=$('tap-hint');if(!hint)return false;clearTimeout(Game.tutorialCueTimer);
    $('tap-hint-text').textContent=text;hint.classList.add('milestone');hint.classList.toggle('coach-warning',key==='occupied'||key==='queue');hint.style.display='flex';hint.setAttribute('aria-hidden','false');
    Game.tutorialCueTimer=setTimeout(()=>{if(hint){hint.style.display='none';hint.setAttribute('aria-hidden','true');hint.classList.remove('coach-warning');}},duration);return true;
  }
  function updateFirstSessionCoach(){
    if(!firstSessionCoachActive()||Game.state!=='playing'||Game.externalPaused||Game.userPaused)return;
    Game.coachFlags=Game.coachFlags||{};const q=countQueues(),h=q.E+q.W,v=q.N+q.S,mq=Math.max(q.N,q.S,q.E,q.W),redAxis=Game.phase==='H'?'V':'H',redWaiting=redAxis==='H'?h:v;
    if(Game.elapsed>4.2&&Game.switches===0&&redWaiting>0)showFirstSessionCoach('waiting',T.tutorialCoachOpenWaiting,3200);
    if(Game.level>=3&&mq>=Math.max(1,(Game.config?.maxQueue||4)-1))showFirstSessionCoach('queue',T.tutorialCoachQueue,3000);
    if(Game.level>=5&&Game.switches>=3&&Game.elapsed<18)showFirstSessionCoach('rhythm',T.tutorialCoachRhythm,3000);
  }

  const Game = {
    state:'boot', mode:'campaign', dailyKey:'', weeklyKey:'', scenarioId:'', scenarioDirector:null, incidentDirector:null, greenWaveId:'', greenWaveDirector:null, signalMode:'shared', signalControllers:null, greenWaveStats:null, level:save.level, config:null, cars:[], spawned:0, exited:0, phase:'H', pendingPhase:null, transitionTimer:0, endlessWave:0, endlessScore:0, endlessSessionSeed:0,
    switches:0, spawnTimer:0, maxObservedQueue:0, elapsed:0, externalPaused:false, userPaused:false, rescueUsed:false, assistActive:false,
    firstInput:false, tutorialCueTimer:0, noticeTimers:[], failureUiTimer:0, coachFlags:{}, crashPair:null, crashFx:null, cameraKick:0, turnOwnerId:null, roundaboutOwnerId:null, rng:Math.random, lastTs:0, lastDrawTs:0, lastHudTs:0, hudDirty:true, hudRefreshCount:0, frameId:0, accumulator:0, renderAlpha:1, particles:[], pedestrians:[], pedestrianSerial:0, pedestrianSpawnTimer:.4, pedestrianHold:false, phaseElapsed:0, emergencyPriorityId:null, flowStreak:0, maxFlowStreak:0, syncStreak:0, maxSyncStreak:0, prioritySaved:0, mission:null, lastMedalResult:null, lastPassAt:-99, failureReplayFrames:[], failureReplayClock:0, replayPlayback:null, replayTimer:0, lastFailType:'',

    clearNoticeTimers(){for(const id of this.noticeTimers||[])clearTimeout(id);this.noticeTimers=[];},
    scheduleNotice(fn,delay=0){const id=setTimeout(()=>{const i=this.noticeTimers.indexOf(id);if(i>=0)this.noticeTimers.splice(i,1);fn();},Math.max(0,Number(delay)||0));this.noticeTimers.push(id);return id;},
    clearFailureUiTimer(){if(this.failureUiTimer){clearTimeout(this.failureUiTimer);this.failureUiTimer=0;}},
    scheduleFailureUi(fn,delay=0){this.clearFailureUiTimer();this.failureUiTimer=setTimeout(()=>{this.failureUiTimer=0;fn();},Math.max(0,Number(delay)||0));return this.failureUiTimer;},
    startLevel(n,rescued=false,mode='campaign'){
      if(mode==='scenario'){this.startScenario(this.scenarioId||'after_school',rescued);return;}
      this.clearNoticeTimers();this.clearFailureUiTimer();
      this.mode=mode==='daily'?'daily':mode==='weekly'?'weekly':mode==='endless'?'endless':'campaign'; this.dailyKey=this.mode==='daily'?todayDailyKey():''; this.weeklyKey=this.mode==='weekly'?weekStartKey():''; this.scenarioId='';this.scenarioDirector=null;this.incidentDirector=null;this.greenWaveId='';this.greenWaveDirector=null;this.signalMode='shared';this.signalControllers=null;this.greenWaveStats=null;this.level=Math.max(1,n);
      if(this.mode==='campaign'){save.level=Math.max(save.level,this.level);persist();}
      if(this.mode==='endless'){if(!this.endlessWave)this.endlessWave=1;if(!this.endlessSessionSeed)this.endlessSessionSeed=hashText(`endless:${platform.now()}:${save.sessions}`);this.level=Math.min(130,20+this.endlessWave*8);}
      this.config=this.mode==='daily'?dailyConfig(this.dailyKey):this.mode==='weekly'?weeklyConfig(this.weeklyKey):this.mode==='endless'?endlessConfig(this.endlessWave,this.endlessSessionSeed):levelConfig(this.level);
      this.incidentDirector=this.mode==='campaign'?createRoadIncidentDirector(campaignRoadIncidentDefinition(this.level,this.config)):null;
      this.assistActive=this.mode==='campaign'&&(sessionFailCounts.get(this.level)||0)>=2;
      if(this.assistActive)this.config={...this.config,maxQueue:this.config.maxQueue+1};
      this.mission=this.mode==='campaign'?missionForLevel(this.level,this.config):null;this.lastMedalResult=null;
      this.rng=seeded(this.config.seed); this.cars=[]; this.spawned=0; this.exited=0;
      this.phase=this.config.startPhase; this.pendingPhase=null; this.transitionTimer=0; this.switches=0; this.spawnTimer=.42; this.phaseElapsed=0; this.pedestrians=[]; this.pedestrianSerial=0; this.pedestrianSpawnTimer=.38; this.pedestrianHold=false; this.emergencyPriorityId=null; AudioFx.stopTransientAudio();AudioFx.refreshMusicTheme();
      this.maxObservedQueue=0; this.elapsed=0; this.accumulator=0; this.renderAlpha=1; this.state='playing'; this.externalPaused=Boolean(platform.pausedByPlatform||platform.browserPaused||platform.adPaused); this.userPaused=false;
      this.rescueUsed=rescued; this.crashPair=null; this.crashFx=null; this.cameraKick=0; this.turnOwnerId=null; this.particles=[]; this.flowStreak=0; this.maxFlowStreak=0; this.prioritySaved=0; this.lastPassAt=-99; this.failureReplayFrames=[];this.failureReplayClock=0;this.replayPlayback=null;clearTimeout(this.replayTimer);this.lastFailType=''; this.firstInput=this.mode!=='campaign'||this.level>1; this.coachFlags={};
      if(typeof PersonalBestService!=='undefined')PersonalBestService.begin(this.mode,this.mode==='daily'?this.dailyKey:this.mode==='weekly'?this.weeklyKey:'',this.config,this);
      clearTimeout(this.tutorialCueTimer);this.tutorialCueTimer=0;
      const cue=this.mode==='campaign'?tutorialCueForLevel(this.level):'',hint=$('tap-hint');
      if(cue){$('tap-hint-text').textContent=cue;hint.classList.toggle('milestone',this.level!==1);hint.classList.remove('coach-warning');hint.style.display='flex';hint.setAttribute('aria-hidden','false');if(this.level!==1)this.tutorialCueTimer=setTimeout(()=>{if(hint){hint.style.display='none';hint.setAttribute('aria-hidden','true');}},3600);}
      else {hint.classList.remove('milestone','coach-warning');hint.style.display='none';hint.setAttribute('aria-hidden','true');}
      closeOverlay(); applyDistrictTheme(); updateHud();
      this.primeTraffic();
      const event=eventLabel(this.config?.variant||'standard'); if(event)this.scheduleNotice(()=>{if(this.state==='playing'&&this.level===n)toast(`⚡ ${event}`);},420);
      const traitKey=n===11?'trait2':n===21?'trait3':n===31?'trait4':n===46?'trait5':n===61?'trait6':'';
      if(traitKey)this.scheduleNotice(()=>{if(this.state==='playing'&&this.level===n)toast(`🌆 ${T[traitKey]}`);},event?1500:620);
      if(this.mode==='campaign'&&(n===12||n===28))this.scheduleNotice(()=>{if(this.state==='playing'&&this.level===n)toast(`⚠️ ${T.violatorTip}`);},event?2450:1500);
      if(!this.externalPaused && !platform.booting){platform.gameplayStart();AudioFx.recoverAfterExternalResume();}
    },
    startScenario(id='after_school',rescued=false){
      this.clearNoticeTimers();this.clearFailureUiTimer();
      const def=scenarioDefinition(id);if(!def){toast(T.scenarioMode);return false;}if(!scenarioUnlocked(def)){toast(T.scenarioLocked);return false;}
      this.mode='scenario';this.scenarioId=def.id;this.incidentDirector=null;this.greenWaveId='';this.greenWaveDirector=null;this.signalMode='shared';this.signalControllers=null;this.greenWaveStats=null;this.dailyKey='';this.weeklyKey='';this.level=def.board.level;this.config=scenarioConfig(def);this.scenarioDirector=createScenarioDirector(def);this.assistActive=false;this.mission=null;
      this.rng=seeded(def.seed);this.cars=[];this.spawned=0;this.exited=0;this.phase=this.config.startPhase;this.pendingPhase=null;this.transitionTimer=0;this.switches=0;this.spawnTimer=.42;this.phaseElapsed=0;this.pedestrians=[];this.pedestrianSerial=0;this.pedestrianSpawnTimer=99;this.pedestrianHold=false;this.emergencyPriorityId=null;this.roundaboutOwnerId=null;AudioFx.stopTransientAudio();AudioFx.refreshMusicTheme();
      this.maxObservedQueue=0;this.elapsed=0;this.accumulator=0;this.renderAlpha=1;this.state='playing';this.externalPaused=Boolean(platform.pausedByPlatform||platform.browserPaused||platform.adPaused);this.userPaused=false;this.rescueUsed=rescued;this.crashPair=null;this.crashFx=null;this.cameraKick=0;this.turnOwnerId=null;this.particles=[];this.flowStreak=0;this.maxFlowStreak=0;this.syncStreak=0;this.maxSyncStreak=0;this.prioritySaved=0;this.lastPassAt=-99;this.failureReplayFrames=[];this.failureReplayClock=0;this.replayPlayback=null;clearTimeout(this.replayTimer);this.lastFailType='';this.firstInput=true;if(typeof PersonalBestService!=='undefined')PersonalBestService.clear();
      clearTimeout(this.tutorialCueTimer);this.tutorialCueTimer=0;$('tap-hint').style.display='none';closeOverlay();applyDistrictTheme();this.scenarioDirector.update(0,this);updateHud();this.primeTraffic();toast(`${def.icon||'🎒'} ${T[def.nameKey]}`);this.scheduleNotice(()=>{if(this.state==='playing'&&this.mode==='scenario'&&this.scenarioId===def.id)toast(`⚙️ ${T[def.ruleKey]||T.scenarioRule}`);},1450);if(!this.externalPaused&&!platform.booting){platform.gameplayStart();AudioFx.recoverAfterExternalResume();}return true;
    },
    startGreenWave(id='catch_wave'){
      this.clearNoticeTimers();this.clearFailureUiTimer();
      const def=greenWaveDefinition(id);if(!def){toast(T.greenWaveMode);return false;}if(!greenWaveUnlocked(def)){toast(T.greenWaveLocked);return false;}
      this.mode='greenwave';this.greenWaveId=def.id;this.greenWaveDirector=createGreenWaveDirector(def);this.scenarioId='';this.scenarioDirector=null;this.incidentDirector=null;this.dailyKey='';this.weeklyKey='';this.level=def.board.level;this.config=greenWaveConfig(def);this.assistActive=false;this.mission=null;
      this.signalMode='independent';this.signalControllers={J0:createSignalController(def.board.startPhases?.J0||'H'),J1:createSignalController(def.board.startPhases?.J1||'V')};this.phase=this.signalControllers.J0.phase;this.pendingPhase=null;this.transitionTimer=0;this.phaseElapsed=0;this.pedestrianHold=false;
      this.rng=seeded(def.seed);this.cars=[];this.spawned=0;this.exited=0;this.switches=0;this.spawnTimer=.48;this.pedestrians=[];this.pedestrianSerial=0;this.pedestrianSpawnTimer=99;this.emergencyPriorityId=null;this.roundaboutOwnerId=null;AudioFx.stopTransientAudio();AudioFx.refreshMusicTheme();
      const throughTotal=def.plan.filter(x=>(linkedRouteSpec(x)?.junctions||[]).length>1).length;this.greenWaveStats={throughTotal,throughCompleted:0,throughNoStop:0,maxSideQueue:0,blockEvents:0,switches:{J0:0,J1:0}};
      this.maxObservedQueue=0;this.elapsed=0;this.accumulator=0;this.renderAlpha=1;this.state='playing';this.externalPaused=Boolean(platform.pausedByPlatform||platform.browserPaused||platform.adPaused);this.userPaused=false;this.rescueUsed=false;this.crashPair=null;this.crashFx=null;this.cameraKick=0;this.turnOwnerId=null;this.particles=[];this.flowStreak=0;this.maxFlowStreak=0;this.syncStreak=0;this.maxSyncStreak=0;this.prioritySaved=0;this.lastPassAt=-99;this.failureReplayFrames=[];this.failureReplayClock=0;this.replayPlayback=null;clearTimeout(this.replayTimer);this.lastFailType='';this.firstInput=true;if(typeof PersonalBestService!=='undefined')PersonalBestService.clear();
      clearTimeout(this.tutorialCueTimer);this.tutorialCueTimer=0;$('tap-hint').style.display='none';closeOverlay();applyDistrictTheme();updateHud();this.primeTraffic();toast(`${def.icon||'🟢'} ${T[def.nameKey]}`);if(!this.externalPaused&&!platform.booting){platform.gameplayStart();AudioFx.recoverAfterExternalResume();}return true;
    },
    primeTraffic(){
      const desired=this.mode==='daily'?5:this.mode==='weekly'?6:this.mode==='endless'?Math.min(7,4+Math.floor(this.endlessWave/3)):(this.level<=3?3:this.level<=12?4:5);
      const staged=[];
      for(let i=0;i<desired && this.spawned<this.config.total;i++){
        if(!this.trySpawn()) break;
        const c=this.cars[this.cars.length-1],linked=isLinkedJunctionType(this.config?.junctionType),laneCount=this.config?.lanes||1;
        const same=staged.filter(x=>(linked?linkedTrafficLaneKey(x,laneCount)===linkedTrafficLaneKey(c,laneCount):x.dir===c.dir&&(x.lane||0)===(c.lane||0))).sort((a,b)=>b.progress-a.progress);
        if(!same.length){
          if(linked){const gate=linkedRouteGates(c,this.config?.lanes||1)[0];c.progress=(gate?linkedStopTargetProgress(c,gate,this.config?.lanes||1):160)-18-(i%2)*12;}
          else c.progress=(this.level<=3?270:300)-(i%2)*18;
        }else{
          const front=same[same.length-1];
          const safe=((front.length||76)+(c.length||76))/2+44;
          c.progress=front.progress-safe;
        }
        if(!linked)c.progress=Math.min(c.progress,stopTargetProgress(c,this.config?.lanes||1)-4);
        c.currentSpeed=Math.min(c.topSpeed||c.baseSpeed||0,(c.topSpeed||0)*.70);
        c.inside=false;c.stopped=false;
        staged.push(c);
      }
      this.spawnTimer=.12;
    },
    setExternalPause(v){ this.externalPaused=Boolean(v); },
    activeAxis(junctionId=null){const c=signalControllerState(this,junctionId);return (c.transitionTimer||0)>0?null:c.phase;},
    pedestriansOnAxis(axis,junctionId=null){ return this.pedestrians.some(p=>p.roadAxis===axis&&(!junctionId||p.junctionId===junctionId)&&p.t<1); },
    spawnPedestrianWave(roadAxis,junctionId=null){
      if(!roadAxis||this.pedestrians.length>=8)return;
      const serial=this.pedestrianSerial++,crossings=pedestrianCrossingsForAxis(roadAxis,this.config?.junctionType||'cross');
      for(const crossing of crossings)for(let dir=0;dir<2;dir++){
        this.pedestrians.push({id:serial*4+crossing*2+dir+1,roadAxis,junctionId,crossing,reverse:Boolean(dir),laneSide:dir?1:-1,t:0,duration:2.25+crossing*.12+dir*.08,shirt:(serial+crossing+dir)%6});
      }
      this.pedestrianSpawnTimer=4.6;
    },
    updatePedestrians(dt){
      for(const p of this.pedestrians){
        const controller=signalControllerState(this,p.junctionId||null),clearing=(controller.transitionTimer||0)>0&&controller.pendingPhase===p.roadAxis,rate=clearing?1.55:1;
        p.t=Math.min(1,(p.t||0)+(dt*rate)/Math.max(.8,p.duration||2.3));
      }
      this.pedestrians=this.pedestrians.filter(p=>p.t<1);
      if(independentSignals(this)){for(const c of Object.values(this.signalControllers))if((c.transitionTimer||0)<=0)c.phaseElapsed+=dt;if(this.mode==='greenwave'){this.pedestrianSpawnTimer=99;return;}}
      if(this.transitionTimer>0)return;
      if(this.mode==='scenario'){this.phaseElapsed+=dt;this.pedestrianSpawnTimer=99;return;}
      // M83 onboarding: Levels 1-5 teach only traffic-light timing. Pedestrians join at Level 6,
      // after the player has already learned the core horizontal/vertical decision.
      if(this.mode==='campaign'&&this.level<6){this.phaseElapsed+=dt;this.pedestrianSpawnTimer=.45;return;}
      this.phaseElapsed+=dt;this.pedestrianSpawnTimer-=dt;
      const redAxis=this.phase==='H'?'V':'H';
      if(isLinkedJunctionType(this.config?.junctionType)){
        // Each node owns its own crossing. An approaching emergency unit suppresses only the
        // crossing at its next node; existing pedestrians keep the node until fully clear.
        const junctionId=this.pedestrianSerial%2?'J1':'J0',lanes=this.config?.lanes||1;
        const occupied=this.cars.some(c=>linkedCarOccupiesPedestrianCrossing(c,redAxis,junctionId,lanes));
        if(this.phaseElapsed>=.28&&this.pedestrianSpawnTimer<=0&&!occupied&&!emergencyApproachingAxis(redAxis,this,junctionId)&&!this.pedestriansOnAxis(redAxis,junctionId))this.spawnPedestrianWave(redAxis,junctionId);
        return;
      }
      const turningTowardRed=this.cars.some(c=>c.turn&&c.turn!=='straight'&&AXIS[c.turnOutDir||turnExitDir(c.dir,c.turn)]===redAxis&&c.progress>=stopTargetProgress(c,this.config?.lanes||1)-90&&c.progress<turnCurveBounds(this.config?.lanes||1).end+12);
      const emergencyApproach=emergencyApproachingAxis(redAxis,this);
      if(this.phaseElapsed>=.28&&this.pedestrianSpawnTimer<=0&&!turningTowardRed&&!emergencyApproach&&this.pedestrians.filter(p=>p.roadAxis===redAxis).length<4)this.spawnPedestrianWave(redAxis);
    },
    toggle(junctionId=null){
      if(independentSignals(this))return this.toggleJunction(junctionId);
      if(this.state!=='playing'||this.externalPaused||this.userPaused||this.transitionTimer>0) return false;
      const occupiedNow=this.cars.some(c=>c.inside);if(occupiedNow){AudioFx.dangerSwitch(1);const b=$('signal-btn');if(b&&!reducedMotion){b.classList.remove('danger-pulse');void b.offsetWidth;b.classList.add('danger-pulse');setTimeout(()=>b.classList.remove('danger-pulse'),360);}}
      const nextPhase=this.phase==='H'?'V':'H',q=countQueues(),waiting=nextPhase==='H'?(q.E+q.W):(q.N+q.S);
      const perfect=!this.cars.some(c=>c.inside)&&waiting>0&&(this.elapsed-this.lastPassAt)>=0&&(this.elapsed-this.lastPassAt)<=.72;
      if(perfect){this.syncStreak++;this.maxSyncStreak=Math.max(this.maxSyncStreak||0,this.syncStreak);toast(`⚡ ${T.perfectSwitch} ×${this.syncStreak}`);if(!reducedMotion){for(let i=0;i<8&&this.particles.length<MAX_PARTICLES;i++)this.particles.push({x:450,y:450,vx:(this.rng()-.5)*90,vy:(this.rng()-.5)*90,life:.42,max:.42,color:i%2?'#55d5ff':'#ffd166',kind:'spark',size:3});}}
      else this.syncStreak=0;
      const wasFirstInput=!this.firstInput;AudioFx.switch();if(perfect)AudioFx.sync(this.syncStreak);Haptics.switch();this.pendingPhase=nextPhase;this.pedestrianHold=false;this.transitionTimer=this.config.clearance;this.switches++;this.firstInput=true;
      clearTimeout(this.tutorialCueTimer);this.tutorialCueTimer=0;hideFirstSessionCoach();updateSignalIcon();updateHud();
      if(occupiedNow)showFirstSessionCoach('occupied',T.tutorialCoachOccupied,2800);else if(wasFirstInput&&this.level===1)setTimeout(()=>{if(this.state==='playing'&&this.level===1)showFirstSessionCoach('clearance',T.tutorialCoachClearance,2600);},260);
      return true;
    },
    toggleJunction(junctionId){
      const id=junctionId==='J1'?'J1':junctionId==='J0'?'J0':null;if(!id){toast(T.greenWaveChoose);return false;}const c=this.signalControllers?.[id];if(!c||this.state!=='playing'||this.externalPaused||this.userPaused||(c.transitionTimer||0)>0)return false;const occupiedNow=this.cars.some(car=>linkedJunctionInside(car,id,this.config?.lanes||1));if(occupiedNow){AudioFx.dangerSwitch(1);const b=$(id==='J0'?'signal-j0-btn':'signal-j1-btn');if(b&&!reducedMotion){b.classList.remove('danger-pulse');void b.offsetWidth;b.classList.add('danger-pulse');setTimeout(()=>b.classList.remove('danger-pulse'),360);}}
      c.pendingPhase=c.phase==='H'?'V':'H';c.pedestrianHold=false;c.transitionTimer=this.config.clearance;c.phaseElapsed=0;this.switches++;if(this.greenWaveStats){this.greenWaveStats.switches[id]=(this.greenWaveStats.switches[id]||0)+1;}this.firstInput=true;AudioFx.switch();Haptics.switch();updateSignalIcon();updateHud();return true;
    },
    pause(){ if(this.state!=='playing') return; this.userPaused=true; platform.gameplayStop(); showPause(); },
    resume(){ if(this.state!=='playing') return; closeOverlay(); resumePausedGameplay(); },
    restart(){ platform.gameplayStop(); if(this.mode==='greenwave'){this.startGreenWave(this.greenWaveId||'catch_wave');return;} if(this.mode==='endless'){const seed=this.endlessSessionSeed;this.endlessWave=1;this.endlessScore=0;this.endlessSessionSeed=seed;this.startLevel(28,false,'endless');return;} if(this.mode==='scenario'){this.startScenario(this.scenarioId,false);return;} this.startLevel(this.level,false,this.mode); },
    hint(){
      if(this.state!=='playing') return;
      if(this.mode==='greenwave'){const def=greenWaveDefinition(this.greenWaveId);toast(T[def?.hintKey]||T.greenWaveHint);pulseCanvas();return;}
      if(this.transitionTimer>0 || this.cars.some(c=>c.inside)){ toast(T.hintWait); return; }
      const q=countQueues(); const h=q.E+q.W, v=q.N+q.S;
      if(h===v && this.spawned<this.config.total){
        const nextAxis=axisForPlanItem(this.config.plan[this.spawned]); toast(nextAxis==='H'?T.hintHorizontal:T.hintVertical); return;
      }
      toast(h>=v?T.hintHorizontal:T.hintVertical); pulseCanvas();
    },
    captureFailureReplayFrame(dt=0){
      if(this.state!=='playing'||this.externalPaused||this.userPaused)return;
      this.failureReplayClock=(this.failureReplayClock||0)+Math.max(0,dt||0);if(this.failureReplayClock<.12)return;this.failureReplayClock=0;
      const cars=this.cars.map(c=>{const p=carXY(c);return{x:Number(p.x.toFixed(1)),y:Number(p.y.toFixed(1)),rot:Number(p.rot.toFixed(3)),color:c.color,kind:c.kind,style:c.style||0,stopped:Boolean(c.stopped),violation:c.violation||'none'};});
      const pedestrians=this.pedestrians.map(p=>{const q=pedestrianPose(p,this.config?.lanes||1);return{x:Number(q.x.toFixed(1)),y:Number(q.y.toFixed(1))};});
      this.failureReplayFrames.push({t:Number(this.elapsed.toFixed(2)),phase:this.phase,transition:this.transitionTimer>0,cars,pedestrians});if(this.failureReplayFrames.length>36)this.failureReplayFrames.shift();
    },
    playFailureReplay(){
      if((this.failureReplayFrames?.length||0)<2)return false;clearTimeout(this.replayTimer);closeOverlay();this.replayPlayback={frames:this.failureReplayFrames.map(f=>({...f,cars:f.cars.map(c=>({...c})),pedestrians:f.pedestrians.map(p=>({...p}))})),startedAt:performance.now(),frameMs:120};
      const duration=Math.max(900,(this.replayPlayback.frames.length-1)*120);this.replayTimer=setTimeout(()=>{this.replayPlayback=null;if(this.mode==='endless')showEndlessFail(this.lastFailType||'jam',false);else showFail(this.lastFailType||'jam');},duration+300);return true;
    },
    updateSignalControllers(dt){
      const laneCount=Math.max(1,this.config?.lanes||1),linked=isLinkedJunctionType(this.config?.junctionType);
      if(independentSignals(this)){
        let changed=false;for(const [junctionId,c] of Object.entries(this.signalControllers)){
          if((c.transitionTimer||0)<=0)continue;c.transitionTimer-=dt;if(c.transitionTimer>0)continue;
          const blockedByPedestrians=Boolean(c.pendingPhase&&this.pedestriansOnAxis(c.pendingPhase,junctionId));
          const blockedByCommittedVehicle=Boolean(c.pendingPhase&&this.cars.some(v=>v.axis!==c.pendingPhase&&(v.linkedCommittedJunction===junctionId||linkedJunctionInside(v,junctionId,laneCount))));
          if(blockedByPedestrians||blockedByCommittedVehicle){c.transitionTimer=.04;c.pedestrianHold=blockedByPedestrians;continue;}
          c.transitionTimer=0;c.phase=c.pendingPhase||c.phase;c.pendingPhase=null;c.phaseElapsed=0;c.pedestrianHold=false;changed=true;
        }
        const j0=this.signalControllers.J0;this.phase=j0.phase;this.pendingPhase=j0.pendingPhase;this.transitionTimer=Math.max(...Object.values(this.signalControllers).map(c=>c.transitionTimer||0));this.pedestrianHold=Object.values(this.signalControllers).some(c=>c.pedestrianHold);if(changed){updateSignalIcon();updateHud();}return;
      }
      if(this.transitionTimer<=0)return;this.transitionTimer-=dt;if(this.transitionTimer>0)return;
      const blockedByPedestrians=Boolean(this.pendingPhase&&this.pedestriansOnAxis(this.pendingPhase));const centerStart=365;
      const blockedByCommittedVehicle=Boolean(this.pendingPhase&&(linked?this.cars.some(c=>c.axis!==this.pendingPhase&&(c.inside||c.linkedCommittedJunction)):this.cars.some(c=>{if(c.axis===this.pendingPhase||(!c.signalCommitted&&!c.violationCommitted))return false;const stopTarget=stopTargetProgress(c,laneCount);return c.progress>=stopTarget-3&&(c.progress<centerStart||c.inside);})));if(blockedByPedestrians||blockedByCommittedVehicle){this.transitionTimer=.04;const nextPedestrianHold=blockedByPedestrians;if(this.pedestrianHold!==nextPedestrianHold){this.pedestrianHold=nextPedestrianHold;updateSignalIcon();updateHud();}}else{this.transitionTimer=0;this.phase=this.pendingPhase||this.phase;this.pendingPhase=null;this.phaseElapsed=0;this.pedestrianSpawnTimer=.34;this.pedestrianHold=false;updateSignalIcon();updateHud();}
    },
    update(dt){
      this.updateParticles(dt);
      if(this.state!=='playing'||this.externalPaused||this.userPaused) return;
      // HF05: fixed-step simulation never performs routine DOM work directly. Mark the HUD dirty
      // and let the rAF loop coalesce it to a low-frequency presentation refresh. This prevents a
      // slow frame from running updateHud() several times during catch-up and amplifying the hitch.
      this.hudDirty=true;
      this.elapsed+=dt;
      if(this.mode==='scenario'&&this.scenarioDirector)this.scenarioDirector.update(dt,this);
      if(this.incidentDirector)this.incidentDirector.update(dt,this);
      if(this.mode==='greenwave'&&this.greenWaveDirector)this.greenWaveDirector.update(dt,this);
      this.updatePedestrians(dt);
      this.updateSignalControllers(dt);
      this.spawnTimer-=dt;
      if(this.spawned<this.config.total && this.spawnTimer<=0){
        if(this.trySpawn()){ const ramp=1-Math.min(.14,(this.spawned/Math.max(1,this.config.total))*.14); this.spawnTimer=this.config.interval*(.80+this.rng()*.20)*ramp*spawnDelayFactor(this.config,this.spawned,this.config.total); }
        else this.spawnTimer=.18;
      }
      this.moveCars(dt); AudioFx.updateRoadBed(this.cars.length); this.captureFailureReplayFrame?.(dt); this.detectCollision(); if(this.state!=='playing') return;
      const queues=countQueues(); const mq=Math.max(queues.N,queues.S,queues.E,queues.W);
      this.maxObservedQueue=Math.max(this.maxObservedQueue,mq);if(this.mode==='greenwave'&&this.greenWaveStats)this.greenWaveStats.maxSideQueue=Math.max(this.greenWaveStats.maxSideQueue||0,queues.N||0,queues.S||0);if(typeof PersonalBestService!=='undefined')PersonalBestService.sample(this);
      if(mq>this.config.maxQueue){ this.fail('jam'); return; }
      if(this.spawned>=this.config.total && this.cars.length===0){if(this.mode==='endless')this.advanceEndlessWave();else if(this.mode==='scenario'){if(this.scenarioDirector?.completeReady(this))this.win();}else if(this.mode==='greenwave'){if(!this.greenWaveDirector||this.greenWaveDirector.completeReady(this))this.win();}else this.win();}
    },
    trySpawn(){
      const planItem=this.config.plan[this.spawned]; if(!planItem) return false;
      const linked=isLinkedJunctionType(this.config?.junctionType),route=linked?linkedRouteSpec(planItem):null,dir=route?.entryDir||planItem;
      const laneCount=Math.max(1,this.config.lanes||1),openLanes=Array.from({length:laneCount},(_,i)=>i).filter(i=>incidentLaneAvailable(this,dir,i));
      const lane=route?.turn?(route.entryLaneRule==='curb'?(openLanes[openLanes.length-1]??0):(openLanes[0]??0)):(linked?linkedStraightEntryLane(this.cars,dir,openLanes,this.config.plan,this.spawned,laneCount):(openLanes.length?openLanes[Math.floor(this.rng()*openLanes.length)]:0));
      const effectiveLevel=this.mode==='daily'||this.mode==='weekly'||this.mode==='endless'?(this.config.effectiveLevel||30):this.level;
      const spawnIndex=this.spawned,coastMerge=effectiveLevel>=11&&effectiveLevel<=20&&spawnIndex%5===3,parkingCandidate=!linked&&this.elapsed>.8 && effectiveLevel>=6 && spawnIndex>1 && (coastMerge||spawnIndex%7===3 || (effectiveLevel>=30&&spawnIndex%11===5));
      const spawnProgress=parkingCandidate?86:-34;
      const blockedSpawn=linked?linkedEntryLaneBlocked(this.cars,dir,lane,planItem,laneCount):this.cars.some(c=>{
        if(c.dir!==dir)return false;
        if(parkingCandidate)return Math.abs(c.progress-spawnProgress)<230;
        const occupiesLane=((c.lane||0)===lane)||(c.laneChangeT<1&&c.laneTarget===lane);
        return occupiesLane&&c.progress<150;
      });
      if(blockedSpawn) return false;
      const owned=ownedStyleIds(); const favorite=owned.includes(save.favoriteCar)?save.favoriteCar:0; const style=(this.rng()<.55?favorite:owned[Math.floor(this.rng()*owned.length)])||0;
      const specialRoll=this.rng(); let kind='car', archetype='standard';
      const amb=this.config.ambulanceChance||0,bus=this.config.busChance||0,truckChance=this.config.truckChance||0,sportChance=this.config.sportChance||0,compactChance=this.config.compactChance||0;
      if(this.config.variant==='heavy'&&spawnIndex%4===1)kind='bus';
      else if(this.config.variant==='service'&&spawnIndex%9===4)kind='fire';
      else if(this.config.variant==='service'&&spawnIndex%7===5)kind='police';
      else if(this.config.variant==='service'&&spawnIndex%7===2)kind='ambulance';
      else if(this.config.variant==='freight'&&(spawnIndex%5===1||spawnIndex%5===3))kind='truck';
      else if(this.config.variant==='express'&&(spawnIndex%4===1||spawnIndex%4===2))archetype='sport';
      else if(specialRoll<amb)kind='ambulance';
      else if(specialRoll<amb+bus)kind='bus';
      else if(specialRoll<amb+bus+truckChance)kind='truck';
      else if(specialRoll<amb+bus+truckChance+sportChance)archetype='sport';
      else if(specialRoll<amb+bus+truckChance+sportChance+compactChance)archetype='compact';
      const forcedRed=effectiveLevel>=28&&spawnIndex>4&&spawnIndex%17===8;
      const forcedYellow=effectiveLevel>=12&&spawnIndex>2&&spawnIndex%11===5;
      if((forcedRed||forcedYellow)&&!['ambulance','police','fire'].includes(kind)){kind='car';if(forcedRed)archetype='sport';}
      const forcedKind=this.mode==='greenwave'?this.config?.forcedVehicleKinds?.[spawnIndex]:null;if(forcedKind){if(forcedKind==='sport'){kind='car';archetype='sport';}else{kind=String(forcedKind);archetype='standard';}}
      const districtSpeed=(effectiveLevel>=21&&effectiveLevel<=30)?1.045:(effectiveLevel>=61?1.06:1);
      const progressRamp=(1+Math.min(.22,effectiveLevel*.005)+(this.spawned/Math.max(1,this.config.total))*.12)*districtSpeed;
      let speedMul=1,length=76,accel=250,brake=620,color=COLORS[Math.floor(this.rng()*COLORS.length)];
      if(kind==='bus'){speedMul=.82;length=108;accel=190;brake=540;color='#ff9f68';}
      else if(kind==='ambulance'){speedMul=1.18;length=84;accel=340;brake=760;color='#f6f7fb';}
      else if(kind==='police'){speedMul=1.15;length=78;accel=325;brake=750;color='#eaf4ff';}
      else if(kind==='fire'){speedMul=.94;length=112;accel=215;brake=590;color='#e95757';}
      else if(kind==='truck'){speedMul=.74;length=96;accel=170;brake=500;color='#6f90c7';}
      else if(archetype==='sport'){speedMul=1.22;length=72;accel=320;brake=760; if(style===0) color='#ff6f7d';}
      else if(archetype==='compact'){speedMul=1.08;length=70;accel=290;brake=700;}
      if(kind==='car'&&style===1) color='#ffd34d';
      else if(kind==='car'&&style===4) color='#2c7be5';
      else if(kind==='car'&&style===5) color='#53dfbd';
      else if(kind==='car'&&style===6) color='#202b3c';
      else if(kind==='car'&&style===7) color='#9b4dff';
      else if(kind==='car'&&style===8) color='#e9d2a6';
      else if(kind==='car'&&style===9) color='#121826';
      const supporterSkin=kind==='car'&&supporterSkinEnabled(style);if(supporterSkin)color='#f2c14e';
      const parkingSource=parkingCandidate;
      let turn=route?.turn||'straight';
      // Linked boards take their turn from the graph route. Legacy cross/T boards continue to draw
      // turns from the seeded level logic below.
      if(!linked&&!parkingSource&&kind==='car'&&effectiveLevel>=8){
        const turnRoll=this.rng();
        if(turnRoll<Math.min(.24,.12+effectiveLevel*.0015))turn='right';
        else if(effectiveLevel>=18&&turnRoll<Math.min(.36,.20+effectiveLevel*.0012))turn='left';
      }
      if(isRoundaboutJunction(this.config?.junctionType)&&Array.isArray(this.config.roundaboutTurns)&&this.config.roundaboutTurns.length)turn=this.config.roundaboutTurns[spawnIndex%this.config.roundaboutTurns.length]||'straight';
      const junctionType=this.config?.junctionType||'cross',allowedTurns=linked?(route?.turn?[route.turn]:['straight']):allowedTurnsForJunction(dir,junctionType);
      if(!allowedTurns.includes(turn)){
        const legal=allowedTurns.length?allowedTurns:['straight'];
        turn=legal[Math.floor(this.rng()*legal.length)];
      }
      // Traffic violators appear gradually. They are rare, fast, and clearly marked so the player
      // can react by forcing an all-red transition instead of being hit by invisible randomness.
      let violation='none';
      if(!linked&&!parkingSource&&kind==='car'&&effectiveLevel>=14){
        // Civilian traffic never runs a red light. The old red-light violator variant looked like a
        // signal bug to players and contradicted the rule that red means stop. Rare impatient drivers
        // may still commit on yellow; red-light authority is reserved for emergency services below.
        const vr=this.rng(),yellowChance=Math.min(.20,.05+(effectiveLevel-14)*.0015);
        if(forcedRed||forcedYellow||vr<yellowChance){violation='yellow';if(linked||junctionRouteAllowed(dir,'straight',junctionType))turn='straight';}
      }
      if(!linked&&!junctionRouteAllowed(dir,turn,junctionType)){const legal=allowedTurnsForJunction(dir,junctionType);turn=legal[0]||'straight';}
      if(violation==='yellow')speedMul*=1.12;
      const personality=vehiclePersonality(kind,archetype,this.spawned+1);
      const baseSpeed=this.config.speed*(.96+this.rng()*.16)*speedMul*progressRamp*(linked?1:personality.speed);
      const laneChangeIntent=!linked&&turn==='straight' && laneCount>1 && effectiveLevel>=46 && (archetype==='sport'||kind==='ambulance'||kind==='police'||personality.id==='brisk'||spawnIndex%5===2);
      const mergeSide=(dir==='W'||dir==='N')?1:-1;
      const startProgress=spawnProgress,turnOutLane=route?.turn?(route.exitLaneRule==='curb'?(openLanes[openLanes.length-1]??0):(openLanes[0]??0)):(turn==='right'?(openLanes.length?Math.max(...openLanes):0):0);
      const car={ dir,axis:route?.axis||AXIS[dir],progress:startProgress,baseSpeed,topSpeed:baseSpeed,currentSpeed:baseSpeed*(parkingSource?.34:.82),accel,brake,color,inside:false,stopped:false,waitTime:0,id:this.spawned+1,style,kind,archetype,lane,length,driverProfile:personality.id,followGapExtra:personality.gap,stopLookahead:personality.lookahead,hornDelay:personality.hornDelay,
        linkedTurnReservationJunction:null,linkedTurnReservationEntered:false,linkedApproachReservationJunction:null,linkedApproachReservationEntered:false,linkedRouteId:linked?String(planItem):null,linkedPassedGates:linked?[]:null,parkingSource,mergeSide,mergeT:parkingSource?0:1,laneChangeIntent:linked&&route?.turn?false:laneChangeIntent,laneChanged:false,laneFrom:lane,laneTarget:null,laneChangeT:1,turn,turnOutDir:route?.turnOutDir||turnExitDir(dir,turn),turnOutLane,busStopState:(this.mode!=='greenwave'&&kind==='bus'&&effectiveLevel>=20&&this.rng()<.62)?0:2,busStopTimer:0,supporterSkin,violation,violationCommitted:false,violationWarned:false,violationWarnTimer:0,signalCommitted:false,hornPlayed:false,audioApproachAnnounced:false,audioAge:0 };
      if(this.mode==='greenwave'&&linked){const routeSpec=linkedRouteSpec(car.linkedRouteId);car.greenWaveThrough=Boolean((routeSpec?.junctions||[]).length>1);car.greenWaveStopClock=0;car.greenWaveStoppedBetween=false;car.greenWaveMetricCounted=false;car.greenWaveForcedKind=forcedKind||'';if(this.config?.announceEmergency&&isEmergencyVehicle(car)){car.greenWavePreannounced=true;toast(`🚨 ${T.greenWaveEmergencyIncoming}`);}}
      this.cars.push(car); this.spawned++; return true;
    },
    moveCarsLinked(dt){
      const laneCount=Math.max(1,this.config.lanes||1),gap=86;
      for(const c of this.cars){
        c.audioAge=(c.audioAge||0)+dt;c.prevRenderPose=carXY(c);
        if(c.linkedCommittedJunction){const inside=linkedJunctionInside(c,c.linkedCommittedJunction,laneCount);if(inside)c.linkedCommitEntered=true;if(c.linkedCommitEntered&&!inside){c.linkedCommittedJunction=null;c.linkedCommitEntered=false;}}
        if(c.linkedApproachReservationJunction){
          const held=c.linkedApproachReservationJunction,inside=linkedJunctionInside(c,held,laneCount),gates=linkedRouteGates(c,laneCount),heldIndex=gates.findIndex(g=>g.junctionId===held),passedHeld=heldIndex>=0&&Boolean(c.linkedPassedGates?.[heldIndex]);
          if(inside)c.linkedApproachReservationEntered=true;
          if(c.linkedApproachReservationEntered&&!inside){c.linkedApproachReservationJunction=null;c.linkedApproachReservationEntered=false;}
          else if(!c.linkedApproachReservationEntered){
            const gate=linkedNextGate(c,laneCount),route=linkedRouteSpec(c.linkedRouteId),outOfWindow=!gate||gate.junctionId!==held||c.progress<gate.stopTarget-165||c.progress>=gate.lineProgress+16;
            if(passedHeld&&!inside){c.linkedApproachReservationJunction=null;c.linkedApproachReservationEntered=false;}
            else if(outOfWindow||signalTransitionTimer(this,gate.junctionId)>0||signalStateForAxis(gate.axis,this,gate.junctionId)!=='green'){
              c.linkedApproachReservationJunction=null;c.linkedApproachReservationEntered=false;
              if(route?.turnAt&&c.linkedTurnReservationJunction===route.turnAt&&!c.linkedTurnReservationEntered){c.linkedTurnReservationJunction=null;c.linkedTurnReservationEntered=false;}
            }
          }
        }
      }
      let emergencyOwner=null;
      // Per-junction emergency reservations. A red-running service vehicle reserves only the node it
      // is approaching; conflicting green traffic for that same node yields before the service unit
      // enters, while the second junction remains independent.
      for(const c of this.cars)c.emergencyPriorityActive=false;
      const emergencyReservations={};
      // Keep an acquired reservation until the whole vehicle has entered and then fully cleared its
      // conflict zone. This prevents the green cross-stream from entering one tick after the service
      // vehicle crosses the stop line but while its body is still physically inside the junction.
      for(const c of this.cars.filter(isEmergencyVehicle)){
        const held=c.emergencyReservationJunction;if(!held)continue;const inside=linkedJunctionInside(c,held,laneCount);if(inside)c.emergencyReservationEntered=true;
        if(c.emergencyReservationEntered&&!inside){c.emergencyReservationJunction=null;c.emergencyReservationEntered=false;continue;}
        emergencyReservations[held]=c;c.emergencyPriorityActive=true;
      }
      {
        for(const c of this.cars.filter(isEmergencyVehicle).sort((a,b)=>(b.progress-a.progress)||(a.id-b.id))){
          if(c.emergencyReservationJunction)continue;const gate=linkedNextGate(c,laneCount);if(!gate||signalTransitionTimer(this,gate.junctionId)>0||signalStateForAxis(gate.axis,this,gate.junctionId)!=='red'||c.progress<gate.stopTarget-150||c.progress>=gate.lineProgress+20||emergencyReservations[gate.junctionId])continue;
          const unsafe=this.cars.some(o=>{
            if(o===c)return false;if(o.linkedTurnReservationJunction===gate.junctionId)return true;if(o.axis===c.axis)return false;if(o.linkedCommittedJunction===gate.junctionId||linkedJunctionInside(o,gate.junctionId,laneCount))return true;
            const og=linkedNextGate(o,laneCount);return Boolean(og&&og.junctionId===gate.junctionId&&o.progress>=og.stopTarget-95&&o.progress<og.lineProgress+12&&(o.currentSpeed||0)>12);
          });
          if(!unsafe&&!this.pedestriansOnAxis(gate.axis,gate.junctionId)&&!linkedTurnPathBlocked(c,gate.junctionId,this)){c.emergencyReservationJunction=gate.junctionId;c.emergencyReservationEntered=false;emergencyReservations[gate.junctionId]=c;c.emergencyPriorityActive=true;}
        }
      }
      emergencyOwner=Object.values(emergencyReservations)[0]||null;
      const turnReservations={};
      // A turn owns its local node from entry until the whole vehicle has cleared. The reservation
      // is acquired only after nearby traffic, emergency leases, and the turn's exit crosswalk clear.
      for(const c of this.cars){
        const held=c.linkedTurnReservationJunction;if(!held)continue;
        const inside=linkedJunctionInside(c,held,laneCount);if(inside)c.linkedTurnReservationEntered=true;
        if(c.linkedTurnReservationEntered&&!inside){c.linkedTurnReservationJunction=null;c.linkedTurnReservationEntered=false;continue;}
        turnReservations[held]=c;
      }
      const approachReservations={};
      for(const c of this.cars)if(c.linkedApproachReservationJunction)approachReservations[c.linkedApproachReservationJunction]=c;
      {
        // A route that crosses one node before turning at another must reserve both nodes
        // atomically before entering the first. Otherwise two opposing linked turns can each hold
        // one node while waiting forever for the other (a circular wait across J0/J1).
        const pathCandidates=this.cars.filter(c=>{
          const route=linkedRouteSpec(c.linkedRouteId);return route?.turn&&route.turnAt!==route.junctions?.[0]&&route.junctions?.length>1&&!c.linkedTurnReservationJunction&&!c.linkedApproachReservationJunction;
        }).sort((a,b)=>(b.progress-a.progress)||(a.id-b.id));
        for(const c of pathCandidates){
          const route=linkedRouteSpec(c.linkedRouteId),gate=linkedNextGate(c,laneCount);if(!gate||gate.junctionId!==route.junctions[0]||c.progress<gate.stopTarget-165||c.progress>=gate.lineProgress+16||(signalTransitionTimer(this,gate.junctionId)>0||(signalStateForAxis(gate.axis,this,gate.junctionId)!=='green'&&emergencyReservations[gate.junctionId]?.id!==c.id)))continue;
          const nodes=[gate.junctionId,route.turnAt],leased=nodes.some(j=>Boolean((turnReservations[j]&&turnReservations[j].id!==c.id)||(approachReservations[j]&&approachReservations[j].id!==c.id)||(emergencyReservations[j]&&emergencyReservations[j].id!==c.id)));
          const occupied=nodes.some(j=>this.cars.some(o=>o!==c&&(o.linkedCommittedJunction===j||linkedJunctionInside(o,j,laneCount))));
          if(leased||occupied||this.pedestriansOnAxis(gate.axis,gate.junctionId)||linkedTurnPathBlocked(c,route.turnAt,this))continue;
          c.linkedApproachReservationJunction=gate.junctionId;c.linkedApproachReservationEntered=false;
          c.linkedTurnReservationJunction=route.turnAt;c.linkedTurnReservationEntered=false;
          approachReservations[gate.junctionId]=c;turnReservations[route.turnAt]=c;
        }
        const turnCandidates=this.cars.filter(c=>linkedRouteSpec(c.linkedRouteId)?.turn).sort((a,b)=>(b.progress-a.progress)||(a.id-b.id));
        for(const c of turnCandidates){
          const route=linkedRouteSpec(c.linkedRouteId),gate=linkedNextGate(c,laneCount);
          if(!gate?.turnHere||gate.junctionId!==route.turnAt||turnReservations[gate.junctionId]?.id===c.id||(turnReservations[gate.junctionId]&&turnReservations[gate.junctionId].id!==c.id)||(approachReservations[gate.junctionId]&&approachReservations[gate.junctionId].id!==c.id)||c.progress<gate.stopTarget-55||c.progress>=gate.lineProgress+12)continue;
          const emergencyLease=emergencyReservations[gate.junctionId]?.id===c.id;
          if(signalTransitionTimer(this,gate.junctionId)>0||(signalStateForAxis(gate.axis,this,gate.junctionId)!=='green'&&!emergencyLease))continue;
          if(linkedTurnPathBlocked(c,gate.junctionId,this))continue;
          const unsafe=this.cars.some(o=>{
            if(o===c)return false;
            if(o.linkedTurnReservationJunction===gate.junctionId||o.linkedCommittedJunction===gate.junctionId||linkedJunctionInside(o,gate.junctionId,laneCount))return true;
            const og=linkedNextGate(o,laneCount);
            return Boolean(og&&og.junctionId===gate.junctionId&&o.progress>=og.stopTarget-145&&o.progress<og.lineProgress+16&&(o.currentSpeed||0)>12);
          });
          if(unsafe)continue;
          c.linkedTurnReservationJunction=gate.junctionId;c.linkedTurnReservationEntered=false;turnReservations[gate.junctionId]=c;
        }
      }
      const groups={};
      for(const c of this.cars){const key=linkedTrafficLaneKey(c,laneCount);(groups[key]||(groups[key]=[])).push(c);}
      for(const arr of Object.values(groups)){
        arr.sort((a,b)=>b.progress-a.progress);
        for(let i=0;i<arr.length;i++){
          const c=arr[i],front=arr[i-1],baseGap=front?((front.length||76)+(c.length||76))*.58+20:gap,speedGap=(c.currentSpeed||c.topSpeed||0)*.08;
          const safeGap=Math.max(58,baseGap+speedGap+vehicleFollowGapExtra(c)),frontLimit=front?(front.progress-safeGap):Infinity,gates=linkedRouteGates(c,laneCount);c.linkedPassedGates=c.linkedPassedGates||[];
          let gateIndex=-1,gate=null,stopTarget=Infinity;
          for(let gi=0;gi<gates.length;gi++){if(c.linkedPassedGates[gi])continue;gateIndex=gi;gate=gates[gi];stopTarget=linkedStopTargetProgress(c,gate,laneCount);break;}
          const signalState=gate?signalStateForAxis(gate.axis,this,gate.junctionId):'green',reservation=gate?emergencyReservations[gate.junctionId]:null,turnReservation=gate?turnReservations[gate.junctionId]:null,approachReservation=gate?approachReservations[gate.junctionId]:null;
          const turnOwnerRequired=Boolean(gate?.turnHere),hasTurnLease=!turnOwnerRequired||turnReservation?.id===c.id;
          const yieldToEmergency=Boolean(reservation&&reservation.id!==c.id&&reservation.axis!==c.axis),yieldToTurn=Boolean(turnReservation&&turnReservation.id!==c.id);
          const yieldToPath=Boolean(approachReservation&&approachReservation.id!==c.id);
          const turnPathBlock=Boolean(gate&&linkedTurnPathBlocked(c,gate.junctionId,this)),wasConnectorBlocked=Boolean(c.connectorBlocked),connectorBlocked=Boolean(gate&&linkedConnectorBlocked(c,gate,this,laneCount));if(connectorBlocked&&!wasConnectorBlocked&&this.mode==='greenwave'&&this.greenWaveStats)this.greenWaveStats.blockEvents=(this.greenWaveStats.blockEvents||0)+1;c.connectorBlocked=connectorBlocked;const green=signalState==='green'&&!yieldToEmergency&&!yieldToTurn&&!yieldToPath&&!turnPathBlock&&!connectorBlocked&&hasTurnLease;
          let targetSpeed=(c.topSpeed||c.baseSpeed||0)*(this.flowStreak>=5&&green?Math.min(1.14,1.05+(this.flowStreak-5)*.012):1);
          const distToLine=gate?stopTarget-c.progress:Infinity,nearLine=gate&&distToLine<=140&&distToLine>=-4;if(gate)maybeCueEmergencyApproach(c,distToLine);
          const yellowCommit=gate&&signalState==='yellow'&&!yieldToEmergency&&!yieldToTurn&&!yieldToPath&&!turnPathBlock&&!connectorBlocked&&hasTurnLease&&nearLine&&c.violation==='yellow';
          const emergencyRedRun=Boolean(gate&&reservation?.id===c.id&&signalState==='red'&&nearLine&&!yieldToPath&&!turnPathBlock&&!connectorBlocked&&hasTurnLease);
          if(emergencyRedRun){c.emergencyPriorityActive=true;if(!c.priorityAnnounced){c.priorityAnnounced=true;AudioFx.priority(c.kind,c.dir);Haptics.priority();toast(`🚨 ${T.priorityAlert}: ${T.priorityYield}`);}}
          const canCommit=green||yellowCommit||emergencyRedRun;
          if(gate&&canCommit&&c.progress>=stopTarget-2){c.linkedPassedGates[gateIndex]=true;c.signalCommitted=true;c.linkedCommittedJunction=gate.junctionId;c.linkedCommitEntered=false;gate=null;stopTarget=Infinity;}
          const redApproach=Boolean(gate&&!canCommit&&c.progress<stopTarget+2);
          if(front&&front.progress-c.progress<safeGap+24)targetSpeed=Math.min(targetSpeed,Math.max(0,(front.currentSpeed||0)-10));
          if(redApproach){const d=Math.max(0,stopTarget-c.progress),lookahead=vehicleStopLookahead(c,130);if(d<=lookahead)targetSpeed=Math.min(targetSpeed,(d/lookahead)*(c.topSpeed||0));if(c.progress>=stopTarget-2)targetSpeed=0;}
          const incidentStop=incidentStopProgress(this,c);
          if(incidentStop!=null){
            const dist=Math.max(0,incidentStop-c.progress),lookahead=Math.max(90,vehicleStopLookahead(c,120)*.86);
            if(dist<=lookahead)targetSpeed=Math.min(targetSpeed,Math.max(0,(dist/lookahead)*(c.topSpeed||0)));
            if(c.progress>=incidentStop-2)targetSpeed=0;
          }
          const previousSpeed=c.currentSpeed||0,accelRate=(targetSpeed>previousSpeed?(c.accel||260):(c.brake||620))*dt;c.currentSpeed=approachValue(previousSpeed,targetSpeed,accelRate);AudioFx.vehicleMotion(c,previousSpeed,c.currentSpeed,dt);
          let next=c.progress+(c.currentSpeed||0)*dt;if(front)next=Math.min(next,frontLimit);if(redApproach&&next>stopTarget)next=stopTarget;if(next<c.progress)next=c.progress;
          c.stopped=(c.currentSpeed||0)<2||(front&&next>=frontLimit-.5)||(redApproach&&next>=stopTarget-.5);if(c.stopped)c.waitTime=(c.waitTime||0)+dt;if(c.stopped&&!c.hornPlayed&&!isEmergencyVehicle(c)&&(c.waitTime||0)>=vehicleHornDelay(c)&&(c.kind==='truck'||c.kind==='bus'||c.driverProfile==='brisk'||c.id%4===0)&&AudioFx.trafficHorn(c.kind,c.dir))c.hornPlayed=true;c.progress=next;
          // Once the vehicle's centre has cleared a gate line, that signal can never stop it again.
          for(let gi=0;gi<gates.length;gi++)if(!c.linkedPassedGates[gi]&&c.progress>gates[gi].lineProgress+8){c.linkedPassedGates[gi]=true;if(!c.linkedCommittedJunction){c.linkedCommittedJunction=gates[gi].junctionId;c.linkedCommitEntered=linkedJunctionInside(c,gates[gi].junctionId,laneCount);}}
          const occupied=linkedOccupiedJunction(c,laneCount);c.linkedJunctionId=occupied;c.inside=Boolean(occupied);updateGreenWaveCarMetric(this,c,dt,laneCount);
        }
      }
      this.emergencyPriorityId=emergencyOwner?.id||null;
      const remaining=[];let passed=0;
      for(const c of this.cars){if(c.progress>=linkedRouteExitAt(c,laneCount)){passed++;if(isEmergencyVehicle(c)&&(c.waitTime||0)<1.6)this.prioritySaved++;this.emitExitParticles(c);}else remaining.push(c);}this.cars=remaining;
      if(passed>0){this.exited+=passed;if(this.mode==='endless')this.endlessScore+=passed*(10+Math.min(40,this.endlessWave*2));if(this.elapsed-this.lastPassAt<1.7)this.flowStreak+=passed;else this.flowStreak=passed;this.maxFlowStreak=Math.max(this.maxFlowStreak||0,this.flowStreak);this.lastPassAt=this.elapsed;AudioFx.pass(this.flowStreak);Haptics.pass(this.flowStreak);}else if(this.elapsed-this.lastPassAt>2.4)this.flowStreak=0;
    },
    moveCars(dt){
      if(isLinkedJunctionType(this.config?.junctionType))return this.moveCarsLinked(dt);
      const laneCount=Math.max(1,this.config.lanes||1),layout=roadLayout(laneCount),turnBounds=turnCurveBounds(laneCount),centerStart=365,centerEnd=535,roundabout=isRoundaboutJunction(this.config?.junctionType),exitAt=roundabout?1160:955,gap=90; const active=this.activeAxis();

      // M79 render interpolation: snapshot the authoritative fixed-step pose before advancing it.
      // Traffic rules/collisions continue to use current simulation state; only drawing interpolates.
      for(const c of this.cars){c.audioAge=(c.audioAge||0)+dt;c.prevRenderPose=carXY(c);}

      // M197 experimental roundabout: one circulating reservation keeps the trial readable and safe.
      // The player's existing H/V signal still meters entry; once a car is on the circle it keeps priority.
      let roundaboutOwner=roundabout&&this.roundaboutOwnerId?this.cars.find(c=>c.id===this.roundaboutOwnerId):null;
      if(roundaboutOwner&&!roundaboutOccupiesCircle(roundaboutOwner,laneCount)&&roundaboutOwner.progress>roundaboutRouteEndProgress(roundaboutOwner,laneCount)){this.roundaboutOwnerId=null;roundaboutOwner=null;}
      if(roundabout&&!roundaboutOwner&&active){const candidates=this.cars.filter(c=>c.axis===active&&c.progress>=stopTargetProgress(c,laneCount)-26&&c.progress<turnBounds.start&&!this.pedestriansOnAxis(c.axis)).sort((a,b)=>(b.progress-a.progress)||(a.id-b.id));if(candidates[0]){roundaboutOwner=candidates[0];this.roundaboutOwnerId=roundaboutOwner.id;}}

      // One protected turning slot at a time. This keeps left/right turns readable and prevents
      // same-phase trajectories from cutting through each other without adding another control.
      let turnOwner=!roundabout&&this.turnOwnerId?this.cars.find(c=>c.id===this.turnOwnerId):null;
      if(turnOwner&&(!active||turnOwner.axis!==active||turnOwner.progress>turnBounds.end+16)){this.turnOwnerId=null;turnOwner=null;}
      if(!roundabout&&!turnOwner&&active&&!this.cars.some(c=>c.inside)){
        const candidates=this.cars.filter(c=>c.turn&&c.turn!=='straight'&&c.axis===active&&c.progress>=stopTargetProgress(c,laneCount)-22&&c.progress<centerStart&&!this.pedestriansOnAxis(AXIS[c.turnOutDir||turnExitDir(c.dir,c.turn)]))
          .sort((a,b)=>(b.progress-a.progress)||(a.id-b.id));
        if(candidates[0]){turnOwner=candidates[0];this.turnOwnerId=turnOwner.id;}
      }

      // Smooth parking-lot merges and visible lane changes are presentation + traffic-flow features.
      for(const c of this.cars){
        if(c.parkingSource && c.mergeT<1) c.mergeT=Math.min(1,c.mergeT+dt*1.15);
        if(c.laneChangeT<1){
          c.laneChangeT=Math.min(1,c.laneChangeT+dt*2.35);
          if(c.laneChangeT>=1&&c.laneTarget!=null){c.lane=c.laneTarget;c.laneFrom=c.lane;c.laneTarget=null;}
        }
      }

      // Decide lane changes before building lane groups. A car changes only if the target lane
      // has a large safety envelope both ahead and behind, so the manoeuvre cannot cause overlap.
      if(laneCount>1){
        for(const c of this.cars)tryIncidentLaneMerge(this,c,laneCount);
        for(const c of this.cars){
          if(!c.laneChangeIntent||c.laneChanged||c.laneChangeT<1||c.mergeT<.92||c.inside)continue;
          const green=signalStateForAxis(c.axis,this)==='green';
          const inApproach=(c.progress>155&&c.progress<300),afterJunction=(c.progress>610&&c.progress<790);
          if(!green||(!inApproach&&!afterJunction))continue;
          const currentLane=c.lane||0;
          const candidateTargets=laneCount>=3?(currentLane===0?[1]:currentLane===2?[1]:[0,2]):[currentLane===0?1:0];
          const targetLane=candidateTargets.find(t=>incidentLaneAvailable(this,c.dir,t)) ?? currentLane;
          if(targetLane===currentLane)continue;
          const sameLaneAhead=this.cars.filter(o=>o!==c&&o.dir===c.dir&&(o.lane||0)===currentLane&&o.progress>c.progress).sort((a,b)=>a.progress-b.progress)[0];
          const wantsPass=c.archetype==='sport'||(sameLaneAhead&&((sameLaneAhead.currentSpeed||0)+18<(c.currentSpeed||0)));
          if(!wantsPass && c.id%4!==0)continue;
          const targetCars=this.cars.filter(o=>o!==c&&o.dir===c.dir&&(((o.lane||0)===targetLane)||(o.laneChangeT<1&&o.laneTarget===targetLane)));
          const safe=targetCars.every(o=>{
            const need=((o.length||76)+(c.length||76))*.58+(laneCount>=3?78:62);
            return Math.abs(o.progress-c.progress)>need;
          });
          if(!safe)continue;
          c.laneFrom=currentLane;c.laneTarget=targetLane;c.laneChangeT=0;c.laneChanged=true;
        }
      }

      // Emergency services may cross a red signal, but only after conflicting traffic yields and
      // the zebra for their road is clear. This behaves like a simple emergency pre-emption without
      // changing the player's visible signal phase.
      // A service vehicle keeps priority until its whole body leaves the conflict zone. Its
      // progress can pass centerEnd while a wide road still places the body across another lane.
      const heldEmergency=this.cars.find(c=>c.id===this.emergencyPriorityId&&isEmergencyVehicle(c)&&c.inside);
      let emergencyOwner=heldEmergency||this.cars.filter(c=>isEmergencyVehicle(c)&&signalStateForAxis(c.axis,this)==='red'&&c.progress>=stopTargetProgress(c,laneCount)-150&&c.progress<centerEnd+32)
        .sort((a,b)=>(b.progress-a.progress)||(a.id-b.id))[0]||null;
      this.emergencyPriorityId=emergencyOwner?.id||null;
      for(const c of this.cars)c.emergencyPriorityActive=false;

      const groups={};this.cars.forEach(c=>{const routedOut=roundabout?c.progress>roundaboutRouteEndProgress(c,laneCount):(c.turn&&c.turn!=='straight'&&c.progress>turnBounds.end);const routeDir=routedOut?(c.turnOutDir||c.dir):c.dir;const routeLane=routedOut?(c.turnOutLane||0):(c.lane||0);const key=`${routeDir}:${routeLane}`;(groups[key]||(groups[key]=[])).push(c);});
      for(const arr of Object.values(groups)){
        arr.sort((a,b)=>b.progress-a.progress);
        for(let i=0;i<arr.length;i++){
          const c=arr[i],front=arr[i-1],signalState=signalStateForAxis(c.axis,this),green=signalState==='green';
          const baseGap=front?((front.length||76)+(c.length||76))*.58+22:gap;
          const speedGap=(c.currentSpeed||c.topSpeed||0)*0.09;
          const safeGap=Math.max(60,baseGap+speedGap+vehicleFollowGapExtra(c));
          const frontLimit=front?(front.progress-safeGap):Infinity;
          let targetSpeed=(c.topSpeed||c.baseSpeed||c.speed||0)*(this.flowStreak>=5&&green?Math.min(1.16,1.06+(this.flowStreak-5)*.015):this.flowStreak>=4?1.035:1);
          targetSpeed*=incidentSpeedFactor(this,c);
          if(c.parkingSource&&c.mergeT<1)targetSpeed*=.62+.38*c.mergeT;
          if(c.kind==='bus'&&c.busStopState===0&&c.progress>=650&&c.progress<705){c.busStopState=1;c.busStopTimer=.82;AudioFx.busAirBrake(c.dir);}
          if(c.busStopState===1){c.busStopTimer-=dt;targetSpeed=0;if(c.busStopTimer<=0){c.busStopState=2;c.busStopTimer=0;}}
          const stopTarget=stopTargetProgress(c,laneCount);
          const ownerActive=Boolean(turnOwner&&active&&turnOwner.axis===active&&turnOwner.progress<=turnBounds.end+58);
          const ownerWaiting=ownerActive&&c.id===turnOwner.id&&this.cars.some(o=>o!==c&&o.inside);
          const yieldToTurn=ownerActive&&c.id!==turnOwner.id&&c.axis===active&&c.progress<centerStart;
          const turnExitAxis=c.turn&&c.turn!=='straight'?AXIS[c.turnOutDir||turnExitDir(c.dir,c.turn)]:null;
          const waitingForPedestrian=c.progress<centerStart&&Boolean(turnExitAxis&&this.pedestriansOnAxis(turnExitAxis));
          const waitingForTurnSlot=!roundabout&&c.turn&&c.turn!=='straight'&&c.progress<centerStart&&(!turnOwner||c.id!==turnOwner.id);
          const nearLine=c.progress>=stopTarget-142&&c.progress<centerStart;
          if(c.violation&&c.violation!=='none'&&c.progress>=stopTarget-205&&c.progress<centerStart&&!c.violationWarned){c.violationWarned=true;c.violationWarnTimer=c.violation==='red'?.82:.28;toast(`⚠️ ${T.violatorAlert}`);}
          if(c.violationWarned&&!c.violationCommitted&&c.violationWarnTimer>0)c.violationWarnTimer=Math.max(0,c.violationWarnTimer-dt);
          const yellowRun=c.violation==='yellow'&&signalState==='yellow'&&nearLine&&c.violationWarnTimer<=0;
          const redRun=false; // M69: civilian cars never enter against a red signal.
          if((yellowRun||redRun)&&!c.violationCommitted)c.violationCommitted=true;
          const runningViolation=c.violationCommitted&&c.progress<centerEnd+26;
          const emergencyYield=Boolean(emergencyOwner&&c.id!==emergencyOwner.id&&c.axis!==emergencyOwner.axis&&emergencyOwner.progress>=stopTargetProgress(emergencyOwner,laneCount)-70&&c.progress<centerStart);
          const emergencyPathClear=Boolean(emergencyOwner&&c.id===emergencyOwner.id&&!this.pedestriansOnAxis(c.axis)&&!this.cars.some(o=>{
            if(o===c||o.axis===c.axis)return false;
            if(o.inside)return true;
            const otherStop=stopTargetProgress(o,laneCount);
            if((o.signalCommitted||o.violationCommitted)&&o.progress>=otherStop-3&&o.progress<centerStart)return true;
            // The cross stream must visibly yield before the emergency unit takes the red. A vehicle
            // still rolling toward its stop line is not yet a safe gap even if it has not committed.
            return o.progress>=otherStop-130&&o.progress<centerStart&&(o.currentSpeed||0)>8;
          }));
          const emergencyRedRun=isEmergencyVehicle(c)&&signalState==='red'&&nearLine&&emergencyPathClear;
          c.emergencyPriorityActive=Boolean(isEmergencyVehicle(c)&&signalState==='red'&&(emergencyRedRun||(c.signalCommitted&&c.progress<centerEnd+34)));
          if(emergencyRedRun&&!c.priorityAnnounced){c.priorityAnnounced=true;AudioFx.priority(c.kind,c.dir);Haptics.priority();toast(`🚨 ${T.priorityAlert}: ${T.priorityYield}`);}
          const roundaboutYield=Boolean(roundabout&&c.progress<centerStart&&(!roundaboutOwner||c.id!==roundaboutOwner.id));
          const mayCommitSignal=green&&!ownerWaiting&&!yieldToTurn&&!waitingForTurnSlot&&!waitingForPedestrian&&!emergencyYield&&!roundaboutYield;
          if((mayCommitSignal||emergencyRedRun)&&c.progress>=stopTarget-2)c.signalCommitted=true;
          if(runningViolation)targetSpeed=Math.max(targetSpeed,(c.topSpeed||targetSpeed)*1.05);
          if(emergencyRedRun)targetSpeed=Math.max(targetSpeed,(c.topSpeed||targetSpeed)*.94);
          maybeCueEmergencyApproach(c,stopTarget-c.progress);
          const redApproach=(!green||ownerWaiting||yieldToTurn||waitingForTurnSlot||waitingForPedestrian||emergencyYield||roundaboutYield)&&c.progress<centerStart&&!runningViolation&&!emergencyRedRun&&!c.signalCommitted;
          if(front){
            const distance=front.progress-c.progress;
            if(distance<safeGap+26) targetSpeed=Math.min(targetSpeed, Math.max(0,(front.currentSpeed||0)-12));
          }
          if(redApproach){
            const distToLine=stopTarget-c.progress,lookahead=vehicleStopLookahead(c,120);
            if(distToLine<=lookahead) targetSpeed=Math.min(targetSpeed, Math.max(0,(distToLine/lookahead)*(c.topSpeed||0)));
            if(c.progress>=stopTarget-2) targetSpeed=0;
          }
          const previousSpeed=c.currentSpeed||0,accelRate=(targetSpeed>previousSpeed?(c.accel||260):(c.brake||620))*dt;
          c.currentSpeed=approachValue(previousSpeed,targetSpeed,accelRate);AudioFx.vehicleMotion(c,previousSpeed,c.currentSpeed,dt);
          let next=c.progress+(c.currentSpeed||0)*dt;
          if(front) next=Math.min(next,frontLimit);
          if(redApproach && next>stopTarget) next=stopTarget;
          if(next<c.progress) next=c.progress;
          c.stopped=(c.currentSpeed||0)<2 || (front&&next>=frontLimit-0.5) || (redApproach&&next>=stopTarget-0.5);
          if(c.stopped)c.waitTime=(c.waitTime||0)+dt;
          if(c.stopped&&!c.hornPlayed&&!isEmergencyVehicle(c)&&(c.waitTime||0)>=vehicleHornDelay(c)&&(c.kind==='truck'||c.kind==='bus'||c.driverProfile==='brisk'||c.id%4===0)&&AudioFx.trafficHorn(c.kind,c.dir))c.hornPlayed=true;
          c.progress=next;
          const pose=carXY(c),bodyRadius=Math.max(22,(c.length||76)*renderedTrafficScale(laneCount)*.5);
          c.inside=pose.x>=layout.edgeMin-bodyRadius&&pose.x<=layout.edgeMax+bodyRadius&&pose.y>=layout.edgeMin-bodyRadius&&pose.y<=layout.edgeMax+bodyRadius;
        }
      }
      const remaining=[]; let passed=0;
      for(const c of this.cars){
        if(c.progress>=exitAt){ passed++; if(['ambulance','police','fire'].includes(c.kind)&&(c.waitTime||0)<1.35)this.prioritySaved++; this.emitExitParticles(c); }
        else remaining.push(c);
      }
      this.cars=remaining;
      if(this.turnOwnerId&&!this.cars.some(c=>c.id===this.turnOwnerId))this.turnOwnerId=null;if(this.roundaboutOwnerId&&!this.cars.some(c=>c.id===this.roundaboutOwnerId))this.roundaboutOwnerId=null;
      if(passed>0){
        this.exited+=passed;
        if(this.mode==='endless')this.endlessScore+=passed*(10+Math.min(40,this.endlessWave*2));
        if(this.elapsed-this.lastPassAt<1.7) this.flowStreak+=passed; else this.flowStreak=passed;
        this.maxFlowStreak=Math.max(this.maxFlowStreak||0,this.flowStreak);
        this.lastPassAt=this.elapsed; AudioFx.pass(this.flowStreak); Haptics.pass(this.flowStreak);
      } else if(this.elapsed-this.lastPassAt>2.4) this.flowStreak=0;
    },
    advanceEndlessWave(){
      if(this.mode!=='endless'||this.state!=='playing')return;
      const cleared=this.endlessWave;this.endlessScore+=cleared*75;this.endlessWave++;
      this.level=Math.min(130,20+this.endlessWave*8);this.config=endlessConfig(this.endlessWave,this.endlessSessionSeed);this.rng=seeded(this.config.seed);
      this.cars=[];this.spawned=0;this.exited=0;this.phase=this.config.startPhase;this.pendingPhase=null;this.transitionTimer=0;this.switches=0;this.spawnTimer=.48;this.phaseElapsed=0;
      this.pedestrians=[];this.pedestrianSerial=0;this.pedestrianSpawnTimer=.55;this.pedestrianHold=false;this.emergencyPriorityId=null;this.turnOwnerId=null;this.roundaboutOwnerId=null;this.maxObservedQueue=0;this.flowStreak=0;this.syncStreak=0;this.lastPassAt=-99;
      AudioFx.refreshMusicTheme();applyDistrictTheme();this.primeTraffic();updateHud();toast(`♾ ${T.endlessWave} ${this.endlessWave} · ${this.endlessScore}`);
    },
    emitExitParticles(car){
      const count=RenderQuality.particleCount(); if(!count)return; const p=carXY(car); for(let i=0;i<count&&this.particles.length<MAX_PARTICLES;i++) this.particles.push({x:p.x,y:p.y,vx:(this.rng()-.5)*55,vy:(this.rng()-.5)*55,life:.55+this.rng()*.25,max:.8,color:car.color,kind:'spark',size:4});
    },
    emitCelebration(stars=3){
      if(reducedMotion||RenderQuality.level===0)return;
      const palette=['#55d5ff','#56e39f','#ffd166','#ff7c8a','#a78bfa','#ffffff'];
      const count=Math.min(36+stars*10,MAX_PARTICLES-this.particles.length);
      for(let i=0;i<count;i++){
        const a=(Math.PI*2*i)/Math.max(1,count)+(this.rng()-.5)*.35,spd=85+this.rng()*150;
        this.particles.push({x:450+(this.rng()-.5)*80,y:455+(this.rng()-.5)*55,vx:Math.cos(a)*spd,vy:Math.sin(a)*spd-65,life:1.05+this.rng()*.7,max:1.75,color:palette[i%palette.length],kind:'confetti',size:5+this.rng()*5,rot:this.rng()*Math.PI,spin:(this.rng()-.5)*8});
      }
    },
    updateParticles(dt){
      for(const p of this.particles){
        p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;
        if(p.kind==='confetti'){p.vy+=115*dt;p.vx*=.985;p.vy*=.992;p.rot=(p.rot||0)+(p.spin||0)*dt;}
        else if(p.kind==='smoke'){p.vy-=12*dt;p.vx*=.985;p.vy*=.985;p.size=(p.size||8)+dt*12;}
        else if(p.kind==='debris'){p.vy+=90*dt;p.rot=(p.rot||0)+(p.spin||0)*dt;p.vx*=.985;}
        else {p.vx*=.96;p.vy*=.96;}
      }
      this.particles=this.particles.filter(p=>p.life>0);
      if(this.crashFx){this.crashFx.life-=dt;if(this.crashFx.life<=0)this.crashFx=null;} this.cameraKick=Math.max(0,(this.cameraKick||0)-dt*1.65);
    },
    emitCrashFx(a,b){
      const pa=carXY(a),pb=carXY(b),x=(pa.x+pb.x)/2,y=(pa.y+pb.y)/2;
      this.crashFx={x,y,life:1.55,max:1.55}; this.cameraKick=1.15;
      const room=Math.max(0,MAX_PARTICLES-this.particles.length),count=Math.min(room,46);
      const palette=['#ffd166','#ff8a5b','#ff5964','#ffffff'];
      for(let i=0;i<count;i++){
        const ang=this.rng()*Math.PI*2,spd=55+this.rng()*150;
        if(i<13){this.particles.push({x,y,vx:Math.cos(ang)*spd,vy:Math.sin(ang)*spd,life:.48+this.rng()*.36,max:.84,color:palette[i%palette.length],kind:'flame',size:5+this.rng()*5});}
        else if(i<29){this.particles.push({x:x+(this.rng()-.5)*12,y:y+(this.rng()-.5)*12,vx:(this.rng()-.5)*38,vy:-22-this.rng()*32,life:1.05+this.rng()*.75,max:1.8,color:'#4b5661',kind:'smoke',size:7+this.rng()*6});}
        else {this.particles.push({x,y,vx:Math.cos(ang)*spd*.75,vy:Math.sin(ang)*spd*.75-20,life:.72+this.rng()*.48,max:1.2,color:i%2?'#25313a':'#c4d2d9',kind:'debris',size:4+this.rng()*5,rot:this.rng()*Math.PI,spin:(this.rng()-.5)*10});}
      }
    },
    detectCollision(){
      const laneCount=this.config?.lanes||1;
      // M69: use pose-aware oriented vehicle bodies on every road width. The old 1/2-lane shortcut
      // considered any perpendicular vehicles inside a broad rectangle a crash, including safe corner exits.
      for(let i=0;i<this.cars.length;i++)for(let j=i+1;j<this.cars.length;j++){
        const a=this.cars[i],b=this.cars[j];if(a.axis===b.axis&&!(a.linkedRouteId&&b.linkedRouteId))continue;
        if(vehiclesOverlap(a,b,laneCount)){this.crashPair=[a,b];this.emitCrashFx(a,b);this.fail('crash');return;}
      }
    },
    fail(type){ if(this.state!=='playing')return; this.clearFailureUiTimer(); this.lastFailType=type; this.captureFailureReplayFrame(.2); this.state='failed'; const crashAudio=type==='crash'&&this.crashPair; if(this.mode==='campaign')sessionFailCounts.set(this.level,(sessionFailCounts.get(this.level)||0)+1); if(this.mode==='endless'){const improved=this.endlessScore>(save.endlessBestScore||0)||(this.endlessScore===(save.endlessBestScore||0)&&this.endlessWave>(save.endlessBestWave||0));save.endlessBestScore=Math.max(save.endlessBestScore||0,this.endlessScore);save.endlessBestWave=Math.max(save.endlessBestWave||0,this.endlessWave);persist();platform.gameplayStop();if(crashAudio)AudioFx.crashImpact(this.crashPair[0],this.crashPair[1]);else AudioFx.fail();Haptics.fail();this.scheduleFailureUi(()=>{if(this.state==='failed'&&this.mode==='endless')showEndlessFail(type,improved);},type==='crash'?900:0);return;} platform.gameplayStop(); if(crashAudio)AudioFx.crashImpact(this.crashPair[0],this.crashPair[1]);else AudioFx.fail(); navigator.vibrate?.(80); document.querySelector('.game-card')?.classList.add('impact-flash'); setTimeout(()=>document.querySelector('.game-card')?.classList.remove('impact-flash'),900); if(type==='crash')this.scheduleFailureUi(()=>{if(this.state==='failed')showFail(type);},1180);else showFail(type); },
    async rescue(){
      if(this.rescueUsed)return false;
      const rewarded=await platform.showRewarded();
      if(!rewarded)return false;
      this.rescueUsed=true; this.crashPair=null; this.crashFx=null;
      const insideIds=new Set(this.cars.filter(c=>c.inside).map(c=>c.id));
      if(insideIds.size)this.cars=this.cars.filter(c=>!insideIds.has(c.id));
      else {
        const q=countQueues(),worst=[...DIRS].sort((a,b)=>q[b]-q[a])[0];
        const candidates=this.cars.filter(c=>c.dir===worst&&c.stopped).sort((a,b)=>b.progress-a.progress);
        if(candidates[0])this.cars=this.cars.filter(c=>c.id!==candidates[0].id);
      }
      this.state='playing'; closeOverlay(); this.phase=bestPhase(); this.pendingPhase=null; this.transitionTimer=0; this.phaseElapsed=0; this.pedestrianHold=false;
      this.spawnTimer=Math.max(this.spawnTimer,.9); syncExternalPauseState(); updateHud(); return true;
    },
    win(){
      if(this.state!=='playing')return; this.state='won'; platform.gameplayStop(); AudioFx.win();
      let stars=1;
      if(this.maxObservedQueue<=Math.max(2,this.config.maxQueue-1))stars=2;
      if(this.maxObservedQueue<=(this.config.perfectQueue||2)&&this.switches<=(this.config.perfectSwitchBudget??this.config.parSwitches+2))stars=3;
      if(this.rescueUsed||this.assistActive)stars=Math.min(stars,2);
      this.emitCelebration(stars);
      if(this.mode==='scenario'){
        const def=this.scenarioDirector?.def||scenarioDefinition(this.scenarioId);if(!def)return;
        stars=1;if(this.maxObservedQueue<=def.starThresholds.twoStarQueue)stars=2;if(stars>=2&&this.switches<=def.starThresholds.threeStarSwitches)stars=3;if(this.rescueUsed)stars=Math.min(stars,2);
        const priorityReq=def.objectives?.priorityRequired||0;if(priorityReq&&this.prioritySaved<priorityReq)stars=Math.min(stars,this.prioritySaved>=Math.max(1,priorityReq-1)?2:1);const key=scenarioSaveKey(def),prev=save.scenarioProgress?.[key]||null,result={stars,bestQueue:this.maxObservedQueue,bestSwitches:this.switches,bestPriority:this.prioritySaved||0,clears:(prev?.clears||0)+1},best=betterScenario(prev,result);
        save.scenarioProgress=save.scenarioProgress||{};save.scenarioProgress[key]={...best,clears:result.clears};persist();showScenarioWin(def,stars,prev,best);return;
      }
      if(this.mode==='greenwave'){
        const def=greenWaveDefinition(this.greenWaveId)||greenWaveDefinition(),stats=this.greenWaveStats||{throughTotal:0,throughNoStop:0,maxSideQueue:999},ratio=(stats.throughNoStop||0)/Math.max(1,stats.throughTotal||0);stars=1;if(ratio>=(def.objectives?.twoStarRatio||.55))stars=2;if(ratio>=(def.objectives?.threeStarRatio||.70)&&(stats.maxSideQueue||0)<=(def.objectives?.maxSideQueue3||3))stars=3;const priorityReq=def.objectives?.priorityRequired||0;if(priorityReq&&this.prioritySaved<priorityReq)stars=Math.min(stars,this.prioritySaved>0?2:1);const key=greenWaveSaveKey(def),prev=save.greenWaveProgress?.[key]||null,result={stars,throughNoStop:stats.throughNoStop||0,throughTotal:stats.throughTotal||0,bestSideQueue:stats.maxSideQueue||0,bestSwitches:this.switches,bestPriority:this.prioritySaved||0,clears:(prev?.clears||0)+1},best=betterGreenWave(prev,result);save.greenWaveProgress=save.greenWaveProgress||{};save.greenWaveProgress[key]={...best,clears:result.clears};persist();showGreenWaveWin(def,stars,prev,result,best);return;
      }
      if(this.mode==='weekly'){
        const key=this.weeklyKey||weekStartKey(),prev=save.weeklyBest[key]||null,pb=typeof PersonalBestService!=='undefined'?PersonalBestService.finish(this,stars):{record:null,comparison:null},record=pb.record||{stars,switches:this.switches,maxQueue:this.maxObservedQueue};
        const improved=isBetterBest(record,prev);if(improved)save.weeklyBest[key]=record;
        const firstReward=!save.weeklyRewards[key],weeklyReward=weeklyFirstClearReward(stars,key),reward=firstReward?weeklyReward.reward:0;if(firstReward){save.weeklyRewards[key]=true;save.coins+=reward;}
        persist();showWeeklyWin(stars,reward,improved,pb.comparison,weeklyReward.streak,firstReward?weeklyReward.streakBonus:0);return;
      }
      if(this.mode==='daily'){
        const key=this.dailyKey||todayDailyKey(),prev=save.dailyBest[key]||null,pb=typeof PersonalBestService!=='undefined'?PersonalBestService.finish(this,stars):{record:null,comparison:null},record=pb.record||{stars,switches:this.switches,maxQueue:this.maxObservedQueue};
        const improved=isBetterBest(record,prev);if(improved)save.dailyBest[key]=record;
        const firstReward=!save.dailyRewards[key],streak=firstReward?dailyStreakIfCleared(key):dailyStreakEnding(key,save.dailyRewards);
        const streakBonus=firstReward?Math.min(6,Math.max(0,streak-1))*15:0,reward=firstReward?(120+stars*35+streakBonus):0;
        if(firstReward){save.dailyRewards[key]=true;save.coins+=reward;}
        persist(); showDailyWin(stars,reward,improved,streak,streakBonus,pb.comparison); return;
      }
      platform.noteCampaignCompletion();
      const old=Number(save.starsByLevel[this.level]||0),starImprovement=Math.max(0,stars-old); if(stars>old){save.totalStars+=stars-old;save.starsByLevel[this.level]=stars;}
      const firstClear=this.level>Number(save.campaignRewardedThrough||0);
      const flowBonus=firstClear?Math.min(60,Math.max(0,(this.maxFlowStreak||0)-2)*4):0,priorityBonus=firstClear?(this.prioritySaved||0)*12:0,syncBonus=firstClear?Math.min(60,Math.max(0,this.maxSyncStreak||0)*8):0;
      const missionSuccess=missionSucceeded(this.mission),missionKey=String(this.level),missionFirst=missionSuccess&&!save.missionCompleted?.[missionKey];
      const missionBonus=missionFirst?90:0;if(missionFirst){save.missionCompleted=save.missionCompleted||{};save.missionCompleted[missionKey]=true;}
      const missionCount=Object.keys(save.missionCompleted||{}).length,missionMilestoneBonus=missionFirst&&missionCount%5===0?200:0;
      const medalResult=medalResultForRun(this.level,this.config);this.lastMedalResult=medalResult;if(medalResult.savedMask){save.medalsByLevel=save.medalsByLevel||{};save.medalsByLevel[String(this.level)]=medalResult.savedMask;}
      const unlockedAchievements=unlockAchievements(stars),achievementBonus=unlockedAchievements.length*125;
      const previousBestFlow=save.bestFlow||0,newFlowRecord=(this.maxFlowStreak||0)>previousBestFlow;
      if(newFlowRecord)save.bestFlow=this.maxFlowStreak||0;
      const baseCore=50+Math.min(220,this.level*3),starReward=(firstClear?stars:starImprovement)*15,baseReward=firstClear?baseCore+starReward:starReward;
      // M112: rewarded bonus may duplicate ordinary clear/skill earnings, never one-time
      // mission milestones or achievement/progression awards.
      const rewardedBonus=baseReward+flowBonus+priorityBonus+syncBonus;
      const reward=rewardedBonus+missionBonus+missionMilestoneBonus+achievementBonus; save.coins+=reward;if(firstClear)save.campaignRewardedThrough=Math.max(save.campaignRewardedThrough||0,this.level); save.level=Math.max(save.level,this.level+1);
      sessionFailCounts.delete(this.level);
      const milestoneNow=Math.floor(save.totalStars/15),newMilestones=Math.max(0,milestoneNow-(save.starMilestonesClaimed||0));
      const starBonus=newMilestones*120;if(newMilestones){save.starMilestonesClaimed=milestoneNow;save.coins+=starBonus;}
      let unlocked='';
      const availableIndex=CAR_REQUIREMENTS.findIndex((req,i)=>i>0&&req===this.level);
      if(firstClear&&availableIndex>0&&!ownedStyleIds().includes(availableIndex))unlocked=T[CAR_NAMES[availableIndex]];
      const district=firstClear?nextDistrictUnlock(this.level):''; persist(); showWin(stars,reward,unlocked,district,starBonus,flowBonus,priorityBonus,newFlowRecord,missionSuccess,missionBonus,missionMilestoneBonus,unlockedAchievements,achievementBonus,syncBonus,firstClear,starImprovement,rewardedBonus);
    },
    async next(){
      if(this.mode==='daily'||this.mode==='weekly'||this.mode==='endless'||this.mode==='scenario'||this.mode==='greenwave'){this.startLevel(save.level,false,'campaign');return;}
      const completed=this.level;
      if(platform.shouldRequestFullscreen(completed)) await platform.showFullscreen();
      this.startLevel(completed+1,false,'campaign');
    },
    draw(){
      this.presentationDrawCount=(this.presentationDrawCount||0)+1;
      resizeCanvas(); const w=canvas.width,h=canvas.height,s=Math.min(w,h)/900;
      ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#07101e';ctx.fillRect(0,0,w,h);ctx.restore();
      const hotFlow=Math.min(1,Math.max(0,((this.flowStreak||0)-4)/8));
      const zoom=reducedMotion?1:(1+hotFlow*.008);
      const kick=(reducedMotion?0:(this.cameraKick||0));
      const shakeX=kick?Math.sin(performance.now()/22)*kick*5.5:0,shakeY=kick?Math.cos(performance.now()/19)*kick*4.5:0;
      let drawFailed=false;
      ctx.save();ctx.scale(s,s);const visW=w/s,visH=h/s,ox=(visW-900)/2,oy=(visH-900)/2;
      ctx.translate(ox+450+shakeX,oy+450+shakeY);ctx.scale(zoom,zoom);ctx.translate(-450,-450);
      if(renderFallbackActive){
        drawCoreWorldFallback(ctx,this);
      }else try{
        drawExtendedBackdrop(ctx,this,ox,oy,visW,visH);drawWorld(ctx,this);if(this.replayPlayback)drawFailureReplayOverlay(ctx,this);
      }catch(error){
        drawFailed=true;noteRenderFault(error);
        const fw=canvas.width,fh=canvas.height;canvas.width=fw;canvas.height=fh;
        const fs=Math.min(fw,fh)/900,fox=(fw/fs-900)/2,foy=(fh/fs-900)/2;
        ctx.setTransform(fs,0,0,fs,fox*fs,foy*fs);drawCoreWorldFallback(ctx,this);ctx.setTransform(1,0,0,1,0,0);
      }
      if(!drawFailed)ctx.restore();
    },
    loop(ts){
      const rawDt=Math.max(0,Math.min(.25,(ts-(this.lastTs||ts))/1000)); this.lastTs=ts;
      const active=this.state==='playing'&&!this.externalPaused&&!this.userPaused;
      RenderQuality.observe(rawDt*1000,active);if(active)YandexAudit.sampleFrame(rawDt*1000);
      if(active){
        platform.noteActiveGameplay(rawDt*1000);
        this.accumulator=Math.min(.25,this.accumulator+rawDt); let steps=0;
        while(this.accumulator>=SIM_STEP&&steps<MAX_CATCHUP_STEPS){ this.update(SIM_STEP); this.accumulator-=SIM_STEP; steps++; if(this.state!=='playing')break; }
        if(steps===MAX_CATCHUP_STEPS&&this.accumulator>=SIM_STEP)this.accumulator=0;
        this.renderAlpha=Math.max(0,Math.min(1,this.accumulator/SIM_STEP));
      } else { this.accumulator=0; this.renderAlpha=1; this.updateParticles(Math.min(.05,rawDt)); }
      // HUD is presentation state, not simulation state. Refresh at ~12.5 Hz and at most once
      // per animation frame. Critical interactions still call updateHud() immediately themselves.
      if(this.hudDirty && (ts-(this.lastHudTs||0)>=HUD_REFRESH_MS)){updateHud();}
      const minDrawInterval=this.replayPlayback?32:(active?(RenderQuality.level===0?30:0):80);
      // M127: presentation cadence is independent from the fixed 60 Hz simulation.
      // Low quality now actually honors the intended ~30 FPS Canvas cap instead of
      // drawing every animation frame because of the previous `active || ...` shortcut.
      if(minDrawInterval===0||ts-(this.lastDrawTs||0)>=minDrawInterval){this.draw();this.lastDrawTs=ts;}
      this.frameId=requestAnimationFrame(t=>this.loop(t));
    }
  };

  function countQueues(){
    const q={N:0,S:0,E:0,W:0};
    if(isLinkedJunctionType(Game.config?.junctionType)){
      const buckets={};for(const c of Game.cars){if(!c.stopped)continue;const gate=linkedNextGate(c,Game.config?.lanes||1),key=`${c.linkedRouteId}:${gate?.junctionId||'exit'}`;buckets[key]=(buckets[key]||0)+1;}
      for(const c of Game.cars){if(!c.stopped)continue;const gate=linkedNextGate(c,Game.config?.lanes||1),key=`${c.linkedRouteId}:${gate?.junctionId||'exit'}`;q[c.dir]=Math.max(q[c.dir]||0,buckets[key]||0);}return q;
    }
    Game.cars.forEach(c=>{if(c.stopped&&c.progress<365)q[c.dir]++;});return q;
  }
  function bestPhase(){ const q=countQueues(); return(q.E+q.W)>=(q.N+q.S)?'H':'V'; }

  function resizeCanvas(){
    if(canvasMetricsDirty||!cachedCanvasCssW||!cachedCanvasCssH){
      const r=canvas.getBoundingClientRect();cachedCanvasCssW=Math.max(1,r.width);cachedCanvasCssH=Math.max(1,r.height);canvasMetricsDirty=false;
    }
    const cssW=cachedCanvasCssW,cssH=cachedCanvasCssH;
    let dpr=Math.min(RenderQuality.dprCap(),Math.max(1,window.devicePixelRatio||1)); const maxPixels=RenderQuality.pixelBudget(),requested=cssW*cssH*dpr*dpr;
    if(requested>maxPixels)dpr*=Math.sqrt(maxPixels/requested);
    const w=Math.max(1,Math.round(cssW*dpr)),h=Math.max(1,Math.round(cssH*dpr));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;canvas.dataset.renderDpr=(w/cssW).toFixed(2);}
  }

  let renderFaultCount=0,renderFallbackActive=false;
  function noteRenderFault(error){
    renderFaultCount++;renderFallbackActive=true;
    const message=String(error?.message||error||'unknown render error');
    window.__trafficPulseRenderFault={count:renderFaultCount,message,build:BUILD_VERSION,at:Date.now()};
    if(renderFaultCount<=3){try{console.error('[TrafficPulse/RenderFallback]',message,error);}catch(_){}}
  }
  function drawCoreWorldFallback(g,game){
    const lanes=Math.max(1,Math.min(3,Number(game?.config?.lanes)||1)),layout=roadLayout(lanes),a=layout.edgeMin,b=layout.edgeMax,w=b-a;
    g.save();
    g.fillStyle='#102535';g.fillRect(0,0,900,900);
    g.fillStyle='#2d3c47';g.fillRect(0,a,900,w);g.fillRect(a,0,w,900);
    g.strokeStyle='rgba(255,255,255,.55)';g.lineWidth=3;g.setLineDash([14,16]);
    g.beginPath();g.moveTo(0,450);g.lineTo(900,450);g.moveTo(450,0);g.lineTo(450,900);g.stroke();g.setLineDash([]);
    g.strokeStyle='rgba(255,255,255,.9)';g.lineWidth=6;
    g.beginPath();g.moveTo(a-18,a+12);g.lineTo(a-18,b-12);g.moveTo(b+18,a+12);g.lineTo(b+18,b-12);g.moveTo(a+12,a-18);g.lineTo(b-12,a-18);g.moveTo(a+12,b+18);g.lineTo(b-12,b+18);g.stroke();
    const active=game?.activeAxis?.()||'H';
    const signalColor=axis=>axis===active?'#56e39f':'#ff5964';
    for(const [x,y,axis] of [[a-34,a-34,'H'],[b+34,b+34,'H'],[b+34,a-34,'V'],[a-34,b+34,'V']]){g.fillStyle='#07101e';g.beginPath();g.arc(x,y,13,0,Math.PI*2);g.fill();g.fillStyle=signalColor(axis);g.beginPath();g.arc(x,y,7,0,Math.PI*2);g.fill();}
    for(const c of (game?.cars||[])){
      let pose=null;
      try{pose=renderCarPose(c,game?.renderAlpha??1);}catch(_){try{pose=straightCarPose(c.dir,c.progress,c.lane||0);}catch(__){}}
      if(!pose)continue;
      g.save();g.translate(pose.x,pose.y);g.rotate(pose.rot||0);g.fillStyle=c.color||'#55d5ff';g.fillRect(-26,-12,52,24);g.fillStyle='rgba(230,247,255,.72)';g.fillRect(-7,-9,18,18);g.restore();
    }
    g.restore();
  }

  function roadLayout(lanes=(Game.config?.lanes||1)){
    const n=Math.max(1,Math.min(3,Number(lanes)||1));
    if(n>=3)return{lanes:3,edgeMin:285,edgeMax:615,laneBase:30,laneStep:54};
    if(n===2)return{lanes:2,edgeMin:278,edgeMax:622,laneBase:50,laneStep:80};
    return{lanes:1,edgeMin:330,edgeMax:570,laneBase:36,laneStep:0};
  }
  function laneOffset(dir,lane=0,lanes=(Game.config?.lanes||1)){
    const layout=roadLayout(lanes),li=Math.max(0,Math.min(layout.lanes-1,Number(lane)||0));
    const d=layout.laneBase+li*layout.laneStep;
    // Strict right-hand traffic in screen coordinates. Lane 0 is inner, larger indices move toward curb.
    if(dir==='E') return -d;
    if(dir==='W') return +d;
    if(dir==='N') return +d;
    return -d;
  }

  function straightCarPose(dir,p,lane){
    const off=laneOffset(dir,lane||0);
    if(dir==='W')return{x:p-70,y:450+off,rot:0};
    if(dir==='E')return{x:900-p+70,y:450+off,rot:Math.PI};
    if(dir==='N')return{x:450+off,y:900-p+70,rot:-Math.PI/2};
    return{x:450+off,y:p-70,rot:Math.PI/2};
  }

  function linkedJunctionCenter(id){return id==='J1'?{x:670,y:450}:{x:230,y:450};}
  function linkedTurnGeometry(c,lanes=(Game.config?.lanes||1)){
    const route=linkedRouteSpec(c?.linkedRouteId);if(!route?.turn||!route.turnAt)return null;
    const lane=Math.max(0,Number(c.lane)||0),outLane=Math.max(0,Number(c.turnOutLane??lane)||0),key=`${route.id}:${lane}:${outLane}:${lanes}`;
    let geometry=LINKED_TURN_GEOMETRY_CACHE.get(key);if(geometry)return geometry;
    const gate=linkedRouteGates(c,lanes).find(g=>g.junctionId===route.turnAt);if(!gate)return null;
    const center=linkedJunctionCenter(route.turnAt),half=(roadLayout(lanes).edgeMax-roadLayout(lanes).edgeMin)/2;
    const inDir=route.entryDir,outDir=route.turnOutDir||route.exitDir;
    const startProgress=gate.lineProgress+half-50;
    const p0=inDir==='W'?{x:center.x-60,y:center.y+laneOffset('W',lane,lanes)}:{x:center.x+60,y:center.y+laneOffset('E',lane,lanes)};
    const outOffset=laneOffset(outDir,outLane,lanes);
    const p3=outDir==='S'?{x:center.x+outOffset,y:center.y+half+65}:{x:center.x+outOffset,y:center.y-half-65};
    const a0=directionAngle(inDir),a1=directionAngle(outDir),radius=Math.max(90,Math.hypot(p3.x-p0.x,p3.y-p0.y)*.72),handle=radius*.55228475;
    const p1={x:p0.x+Math.cos(a0)*handle,y:p0.y+Math.sin(a0)*handle};
    const p2={x:p3.x-Math.cos(a1)*handle,y:p3.y-Math.sin(a1)*handle};
    const samples=[],steps=36;let distance=0,previous=p0;
    for(let i=0;i<=steps;i++){
      const t=i/steps,pose=cubicPose(p0,p1,p2,p3,t);
      if(i)distance+=Math.hypot(pose.x-previous.x,pose.y-previous.y);
      samples.push({...pose,distance});previous=pose;
    }
    geometry={routeId:route.id,junctionId:route.turnAt,startProgress,endProgress:startProgress+distance,
      length:distance,outDir,endLane:outLane,p0,p1,p2,p3,samples};
    if(LINKED_TURN_GEOMETRY_CACHE.size>=48)LINKED_TURN_GEOMETRY_CACHE.clear();
    LINKED_TURN_GEOMETRY_CACHE.set(key,geometry);return geometry;
  }
  function linkedRouteExitAt(c,lanes=(Game.config?.lanes||1)){
    const route=linkedRouteSpec(c?.linkedRouteId);if(!route?.turn)return 1045;
    const geometry=linkedTurnGeometry(c,lanes);return geometry?geometry.endProgress+340:1045;
  }
  function linkedCarOccupiesPedestrianCrossing(c,axis,junctionId,lanes=(Game.config?.lanes||1)){
    const inside=Boolean(c.linkedCommittedJunction===junctionId||linkedJunctionInside(c,junctionId,lanes));
    if(c.axis===axis&&inside)return true;
    const route=linkedRouteSpec(c.linkedRouteId);
    return Boolean(route?.turn&&route.turnAt===junctionId&&AXIS[route.turnOutDir||route.exitDir]===axis&&
      (c.linkedTurnReservationJunction===junctionId||inside));
  }
  function linkedTurnPedestrianBlocked(c,junctionId,game=Game){
    const route=linkedRouteSpec(c?.linkedRouteId);
    return Boolean(route?.turn&&route.turnAt===junctionId&&game.pedestriansOnAxis(AXIS[route.turnOutDir||route.exitDir],junctionId));
  }
  function linkedTurnExitBlocked(c,junctionId,game=Game,lanes=(game.config?.lanes||1)){
    const route=linkedRouteSpec(c?.linkedRouteId);
    if(!route?.turn||route.turnAt!==junctionId)return false;
    const geometry=linkedTurnGeometry(c,lanes);if(!geometry)return true;
    // Keep a vehicle length plus a short reaction gap free beyond the curve. Oriented-body samples
    // distinguish the actual exit lane from opposite lanes that merely look close on the canvas.
    const metrics=vehicleBodyMetrics(c),scale=renderedTrafficScale(lanes),lookAhead=Math.max(112,metrics.length*scale+42);
    for(const other of game.cars){
      if(other===c)continue;
      for(let offset=-18;offset<=lookAhead;offset+=28){
        const probe={...c,progress:geometry.endProgress+offset};
        if(vehiclesOverlap(probe,other,lanes))return true;
      }
    }
    return false;
  }
  function linkedTurnPathBlocked(c,junctionId,game=Game){
    return linkedTurnPedestrianBlocked(c,junctionId,game)||linkedTurnExitBlocked(c,junctionId,game,game.config?.lanes||1);
  }
  function linkedPoseAt(c,p=c.progress){
    const routeId=c.linkedRouteId||'',lane=c.lane||0,dir=baseDirForPlanItem(routeId);
    const linkedDir=(d)=>d==='W'?{x:p-70,y:450+laneOffset('W',lane),rot:0}:d==='E'?{x:970-p,y:450+laneOffset('E',lane),rot:Math.PI}:d==='N'?{x:450+laneOffset('N',lane),y:970-p,rot:-Math.PI/2}:{x:450+laneOffset('S',lane),y:p-70,rot:Math.PI/2};
    const geometry=linkedTurnGeometry(c,Game.config?.lanes||1);
    if(geometry){
      if(p<geometry.startProgress)return linkedDir(dir);
      if(p<=geometry.endProgress){
        const distance=p-geometry.startProgress,samples=geometry.samples;let i=1;
        while(i<samples.length&&samples[i].distance<distance)i++;
        const a=samples[Math.max(0,i-1)],b=samples[Math.min(samples.length-1,i)],span=Math.max(.001,b.distance-a.distance),t=Math.max(0,Math.min(1,(distance-a.distance)/span));
        return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,rot:lerpAngle(a.rot,b.rot,t)};
      }
      const extra=p-geometry.endProgress,sign=geometry.outDir==='S'?1:-1;
      return{x:geometry.p3.x,y:geometry.p3.y+sign*extra,rot:directionAngle(geometry.outDir)};
    }
    if(routeId==='W>E')return linkedDir('W');
    if(routeId==='E>W')return linkedDir('E');
    const cx=(routeId.includes('1>')||routeId.startsWith('N1')||routeId.startsWith('S1'))?670:230;
    if(dir==='N')return{x:cx+laneOffset('N',lane),y:970-p,rot:-Math.PI/2};
    return{x:cx+laneOffset('S',lane),y:p-70,rot:Math.PI/2};
  }
  function linkedRouteGates(c,lanes=(Game.config?.lanes||1)){
    const route=linkedRouteSpec(c.linkedRouteId),layout=roadLayout(lanes),half=(layout.edgeMax-layout.edgeMin)/2,margin=10;
    if(!route)return [];
    return route.junctions.map(junctionId=>{
      const center=linkedJunctionCenter(junctionId),dir=baseDirForPlanItem(c.linkedRouteId);let lineProgress=0;
      if(dir==='W')lineProgress=(center.x-half-margin)+70;
      else if(dir==='E')lineProgress=970-(center.x+half+margin);
      else if(dir==='S')lineProgress=(center.y-half-margin)+70;
      else lineProgress=970-(center.y+half+margin);
      return {junctionId,axis:route.axis,lineProgress,turnHere:Boolean(route.turn&&route.turnAt===junctionId)};
    }).sort((a,b)=>a.lineProgress-b.lineProgress);
  }
  function linkedStopTargetProgress(c,gate,lanes=(Game.config?.lanes||1)){
    return gate.lineProgress-(vehicleBodyMetrics(c).length*renderedTrafficScale(lanes)*.5+9);
  }
  function linkedJunctionInside(c,junctionId,lanes=(Game.config?.lanes||1)){
    const pose=linkedPoseAt(c),center=linkedJunctionCenter(junctionId),layout=roadLayout(lanes),half=(layout.edgeMax-layout.edgeMin)/2,bodyRadius=Math.max(22,(c.length||76)*renderedTrafficScale(lanes)*.45);
    return Math.abs(pose.x-center.x)<=half+bodyRadius&&Math.abs(pose.y-center.y)<=half+bodyRadius;
  }
  function linkedOccupiedJunction(c,lanes=(Game.config?.lanes||1)){
    const route=linkedRouteSpec(c.linkedRouteId);if(!route)return null;
    return (route.junctions||[]).find(j=>linkedJunctionInside(c,j,lanes))||null;
  }
  function linkedNextGate(c,lanes=(Game.config?.lanes||1)){
    if(!c?.linkedRouteId)return null;const gates=linkedRouteGates(c,lanes),passed=c.linkedPassedGates||[];
    for(let i=0;i<gates.length;i++)if(!passed[i])return {...gates[i],index:i,stopTarget:linkedStopTargetProgress(c,gates[i],lanes)};return null;
  }
  function linkedConnectorBlocked(c,gate,game=Game,lanes=(game.config?.lanes||1)){
    if(game.mode!=='greenwave'||!gate||!c?.linkedRouteId)return false;const gates=linkedRouteGates(c,lanes),idx=gates.findIndex(g=>g.junctionId===gate.junctionId);if(idx!==0||gates.length<2)return false;
    const key=linkedTrafficLaneKey(c,lanes),body=vehicleBodyMetrics(c).length*renderedTrafficScale(lanes),roadWidth=roadLayout(lanes).edgeMax-roadLayout(lanes).edgeMin,clearProgress=gate.lineProgress+roadWidth+body*.55+16;
    let nearest=null;for(const o of game.cars){if(o===c||linkedTrafficLaneKey(o,lanes)!==key||o.progress<=gate.lineProgress+8)continue;if(!nearest||o.progress<nearest.progress)nearest=o;}
    if(!nearest)return false;const safe=((nearest.length||76)+(c.length||76))*.58+28,frontLimit=nearest.progress-safe;return frontLimit<clearProgress;
  }
  function updateGreenWaveCarMetric(game,c,dt,lanes){
    if(game.mode!=='greenwave'||!c.greenWaveThrough||c.greenWaveMetricCounted)return;const gates=linkedRouteGates(c,lanes);if(gates.length<2)return;
    const a=gates[0].lineProgress+18,b=gates[1].lineProgress-18;if(c.progress>a&&c.progress<b){if((c.currentSpeed||0)<6)c.greenWaveStopClock=(c.greenWaveStopClock||0)+dt;else c.greenWaveStopClock=0;if((c.greenWaveStopClock||0)>=.22)c.greenWaveStoppedBetween=true;}
    if(c.progress>gates[1].lineProgress+18){c.greenWaveMetricCounted=true;game.greenWaveStats.throughCompleted++;if(!c.greenWaveStoppedBetween)game.greenWaveStats.throughNoStop++;}
  }
  function linkedEmergencyNeedsPriority(c,game=Game){
    if(!isEmergencyVehicle(c)||!c.linkedRouteId)return false;const gate=linkedNextGate(c,game.config?.lanes||1);if(!gate)return false;
    return signalStateForAxis(gate.axis,game,gate.junctionId)==='red'&&c.progress>=gate.stopTarget-150&&c.progress<gate.lineProgress+40;
  }

  function cubicPose(p0,p1,p2,p3,t){
    const u=1-t,tt=t*t,uu=u*u;
    const x=uu*u*p0.x+3*uu*t*p1.x+3*u*tt*p2.x+tt*t*p3.x;
    const y=uu*u*p0.y+3*uu*t*p1.y+3*u*tt*p2.y+tt*t*p3.y;
    const dx=3*uu*(p1.x-p0.x)+6*u*t*(p2.x-p1.x)+3*tt*(p3.x-p2.x);
    const dy=3*uu*(p1.y-p0.y)+6*u*t*(p2.y-p1.y)+3*tt*(p3.y-p2.y);
    return{x,y,rot:angleFromVector(dx,dy)};
  }


  function roundaboutEntryAngle(dir){return dir==='W'?Math.PI:dir==='E'?0:dir==='N'?Math.PI/2:-Math.PI/2;}
  function roundaboutExitAngle(dir){return dir==='W'?0:dir==='E'?Math.PI:dir==='N'?-Math.PI/2:Math.PI/2;}
  function roundaboutTravelVector(dir){const a=directionAngle(dir);return{x:Math.cos(a),y:Math.sin(a)};}
  function roundaboutRouteGeometry(c,lanes=(Game.config?.lanes||1)){
    if(!isRoundaboutJunction(Game.config?.junctionType))return null;
    const lane=Math.max(0,Number(c?.lane)||0),turn=(c?.turn&&c.turn!=='none')?c.turn:'straight',outDir=c?.turnOutDir||turnExitDir(c?.dir||'W',turn),outLane=Math.max(0,Number(c?.turnOutLane)||0),key=`${c?.dir||'W'}:${turn}:${lane}:${outLane}:${lanes}`;
    let cached=ROUNDABOUT_GEOMETRY_CACHE.get(key);if(cached)return cached;
    const bounds=turnCurveBounds(lanes),center={x:450,y:450},radius=lanes>1?104:92,blend=.38,quarters=turn==='right'?1:turn==='left'?3:2;
    const entryAngle=roundaboutEntryAngle(c.dir),ringStartAngle=entryAngle-blend,ringEndAngle=entryAngle-quarters*Math.PI/2+blend;
    const p0=straightCarPose(c.dir,bounds.start,lane),p3=straightCarPose(outDir,bounds.end,outLane);
    const ringStart={x:center.x+Math.cos(ringStartAngle)*radius,y:center.y+Math.sin(ringStartAngle)*radius};
    const ringEnd={x:center.x+Math.cos(ringEndAngle)*radius,y:center.y+Math.sin(ringEndAngle)*radius};
    const inV=roundaboutTravelVector(c.dir),outV=roundaboutTravelVector(outDir),entryTan={x:Math.sin(ringStartAngle),y:-Math.cos(ringStartAngle)},exitTan={x:Math.sin(ringEndAngle),y:-Math.cos(ringEndAngle)};
    const points=[];const pushPose=(pose)=>{const last=points[points.length-1];const d=last?last.distance+Math.hypot(pose.x-last.x,pose.y-last.y):0;points.push({...pose,distance:d});};
    const entryHandle=44;for(let i=0;i<=12;i++){const t=i/12;const pose=cubicPose(p0,{x:p0.x+inV.x*entryHandle,y:p0.y+inV.y*entryHandle},{x:ringStart.x-entryTan.x*entryHandle,y:ringStart.y-entryTan.y*entryHandle},ringStart,t);pushPose(pose);}
    const arcSteps=Math.max(16,Math.round(22*quarters));for(let i=1;i<=arcSteps;i++){const t=i/arcSteps,a=ringStartAngle+(ringEndAngle-ringStartAngle)*t;pushPose({x:center.x+Math.cos(a)*radius,y:center.y+Math.sin(a)*radius,rot:a-Math.PI/2});}
    const exitHandle=44;for(let i=1;i<=12;i++){const t=i/12;const pose=cubicPose(ringEnd,{x:ringEnd.x+exitTan.x*exitHandle,y:ringEnd.y+exitTan.y*exitHandle},{x:p3.x-outV.x*exitHandle,y:p3.y-outV.y*exitHandle},p3,t);pushPose(pose);}
    const startProgress=bounds.start,endProgress=startProgress+(points[points.length-1]?.distance||0);cached={key,startProgress,endProgress,outDir,outLane,p0,p3,points,length:endProgress-startProgress};
    if(ROUNDABOUT_GEOMETRY_CACHE.size>=48)ROUNDABOUT_GEOMETRY_CACHE.clear();ROUNDABOUT_GEOMETRY_CACHE.set(key,cached);return cached;
  }
  function roundaboutPoseAt(c,p,lanes=(Game.config?.lanes||1)){
    const geo=roundaboutRouteGeometry(c,lanes);if(!geo)return straightCarPose(c.dir,p,c.lane||0);if(p<=geo.startProgress)return straightCarPose(c.dir,p,c.lane||0);
    if(p>=geo.endProgress){const delta=p-geo.endProgress,v=roundaboutTravelVector(geo.outDir);return{x:geo.p3.x+v.x*delta,y:geo.p3.y+v.y*delta,rot:directionAngle(geo.outDir)};}
    const d=p-geo.startProgress,pts=geo.points;let hi=1;while(hi<pts.length&&pts[hi].distance<d)hi++;const b=pts[Math.min(hi,pts.length-1)],a=pts[Math.max(0,hi-1)],span=Math.max(.001,b.distance-a.distance),t=Math.max(0,Math.min(1,(d-a.distance)/span));return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,rot:lerpAngle(a.rot,b.rot,t)};
  }
  function roundaboutRouteEndProgress(c,lanes=(Game.config?.lanes||1)){return roundaboutRouteGeometry(c,lanes)?.endProgress||turnCurveBounds(lanes).end;}
  function roundaboutOccupiesCircle(c,lanes=(Game.config?.lanes||1)){const g=roundaboutRouteGeometry(c,lanes);return Boolean(g&&c.progress>=g.startProgress-4&&c.progress<=g.endProgress+18);}

  function carXY(c){
    const p=c.progress;
    if(c.linkedRouteId)return linkedPoseAt(c,p);
    const lt=c.laneChangeT==null?1:c.laneChangeT, ease=lt<1?(lt*lt*(3-2*lt)):1;
    const laneGoal=c.laneTarget==null?(c.lane||0):c.laneTarget;
    const visualLane=lt<1?(c.laneFrom+(laneGoal-c.laneFrom)*ease):(c.lane||0);
    let pose;
    const curveBounds=turnCurveBounds(Game.config?.lanes||1);
    if(isRoundaboutJunction(Game.config?.junctionType)){pose=roundaboutPoseAt(c,p,Game.config?.lanes||1);}
    else if(c.turn&&c.turn!=='straight'&&p>=curveBounds.start){
      const outDir=c.turnOutDir||turnExitDir(c.dir,c.turn),outLane=c.turnOutLane||0;
      if(p>=curveBounds.end){
        pose=straightCarPose(outDir,p,outLane);
      }else{
        const p0=straightCarPose(c.dir,curveBounds.start,visualLane),p3=straightCarPose(outDir,curveBounds.end,outLane);
        const a0=directionAngle(c.dir),a1=directionAngle(outDir);
        // Quarter-circle-equivalent cubic handle (~0.5523r) gives a natural tangent-continuous turn.
        // Radius follows the actual entry/exit lane centres, so wide left turns remain broad while
        // right turns hug the near corner without cutting across sidewalks.
        const radius=Math.max(34,Math.max(Math.abs(p3.x-p0.x),Math.abs(p3.y-p0.y)));
        const handle=radius*.55228475;
        const p1={x:p0.x+Math.cos(a0)*handle,y:p0.y+Math.sin(a0)*handle};
        const p2={x:p3.x-Math.cos(a1)*handle,y:p3.y-Math.sin(a1)*handle};
        const t=Math.max(0,Math.min(1,(p-curveBounds.start)/(curveBounds.end-curveBounds.start)));
        pose=cubicPose(p0,p1,p2,p3,t);
      }
    }else{
      pose=straightCarPose(c.dir,p,visualLane);
      if(lt<1){const steer=(laneGoal-c.laneFrom)*Math.sin(Math.PI*lt)*.16;pose.rot+=steer*(c.dir==='E'||c.dir==='S'?-1:1);}
    }
    let {x,y,rot}=pose;
    if(c.parkingSource&&c.mergeT<1&&p<TURN_START){
      // M69: curb merge uses a smoothstep envelope with a shallower steering angle. This removes
      // the old "turning out of the corner" snap while keeping parking-lot entries readable.
      const mt=c.mergeT,smooth=mt*mt*(3-2*mt),inv=1-smooth,side=c.mergeSide||1,lateral=92*inv*side,longitudinal=20*Math.sin(Math.PI*mt);
      if(c.axis==='V'){x+=lateral;y+=(c.dir==='N'?longitudinal:-longitudinal);rot+=side*(c.dir==='N'?-1:1)*.46*inv;}
      else {y+=lateral;x+=(c.dir==='W'?-longitudinal:longitudinal);rot+=side*(c.dir==='W'?1:-1)*.46*inv;}
    }
    return{x,y,rot};
  }

  function lerpAngle(a,b,t){
    let d=(b-a)%(Math.PI*2);if(d>Math.PI)d-=Math.PI*2;else if(d<-Math.PI)d+=Math.PI*2;return a+d*t;
  }
  function renderCarPose(c,alpha=Game.renderAlpha){
    const current=carXY(c),previous=c.prevRenderPose;
    if(!previous||!Number.isFinite(alpha))return current;
    const t=Math.max(0,Math.min(1,alpha));
    return{x:previous.x+(current.x-previous.x)*t,y:previous.y+(current.y-previous.y)*t,rot:lerpAngle(previous.rot,current.rot,t)};
  }

  function drawExtendedBackdrop(g,game,ox,oy,visW,visH){
    // M67: never extend legacy road geometry outside the canonical 900x900 scene.
    // If a browser momentarily gives the canvas a non-square box, fill only with the district surround.
    const theme=districtInfo(game.level);
    const grad=g.createLinearGradient(-ox,-oy,900+ox,900+oy);
    grad.addColorStop(0,themeColor(theme.id,0));grad.addColorStop(1,themeColor(theme.id,1));
    g.fillStyle=grad;g.fillRect(-ox,-oy,visW,visH);
    g.save();g.globalAlpha=.08;g.fillStyle='#ffffff';
    for(let i=0;i<20;i++){const x=-ox+40+(i*97)%Math.max(120,visW),y=-oy+36+((i*137)%Math.max(120,visH));g.beginPath();g.arc(x,y,18+(i%4)*9,0,Math.PI*2);g.fill();}
    g.restore();
  }

  function drawLinkedRoadSurface(g,lanes=1){
    const layout=roadLayout(lanes),w=layout.edgeMax-layout.edgeMin,half=w/2,yA=450-half,yB=450+half,centers=[230,670];
    const roadGrad=g.createLinearGradient(0,0,900,900);roadGrad.addColorStop(0,'#3c4e5b');roadGrad.addColorStop(.42,'#2d3c47');roadGrad.addColorStop(1,'#1e2932');g.fillStyle=roadGrad;
    g.fillRect(0,yA,900,w);for(const cx of centers)g.fillRect(cx-half,0,w,900);
    drawMicroTexture(g,0,yA,900,w,'road',71+lanes);for(let i=0;i<centers.length;i++)drawMicroTexture(g,centers[i]-half,0,w,900,'road',83+lanes+i*7);
    // Curbs / asphalt edges.
    g.fillStyle='rgba(255,255,255,.12)';g.fillRect(0,yA,900,7);g.fillRect(0,yB-7,900,7);for(const cx of centers){g.fillRect(cx-half,0,7,900);g.fillRect(cx+half-7,0,7,900);}
    // Center separators.
    g.strokeStyle='rgba(255,204,92,.84)';g.lineWidth=3;g.beginPath();g.moveTo(0,446);g.lineTo(900,446);g.moveTo(0,454);g.lineTo(900,454);for(const cx of centers){g.moveTo(cx-4,0);g.lineTo(cx-4,900);g.moveTo(cx+4,0);g.lineTo(cx+4,900);}g.stroke();
    // Same-direction lane dividers from the same lane geometry as vehicle placement.
    if(layout.lanes>1){g.strokeStyle='rgba(255,255,255,.50)';g.lineWidth=2.4;g.setLineDash([15,17]);for(let i=0;i<layout.lanes-1;i++){const d1=layout.laneBase+i*layout.laneStep,d2=layout.laneBase+(i+1)*layout.laneStep,sep=(d1+d2)/2;for(const sign of [-1,1]){const yy=450+sign*sep;g.beginPath();g.moveTo(0,yy);g.lineTo(900,yy);g.stroke();for(const cx of centers){const xx=cx+sign*sep;g.beginPath();g.moveTo(xx,0);g.lineTo(xx,900);g.stroke();}}}g.setLineDash([]);}
    // Stop lines and zebras at both independently reserved conflict zones.
    const stripe=10,gap=8,zebra=14,safety=16;g.strokeStyle='rgba(7,18,28,.62)';g.lineWidth=12;
    for(const cx of centers){const left=cx-half,right=cx+half,stopL=left-10,stopR=right+10,stopN=yA-10,stopS=yB+10;g.beginPath();g.moveTo(stopL,454);g.lineTo(stopL,yB-8);g.moveTo(stopR,yA+8);g.lineTo(stopR,446);g.moveTo(left+8,stopN);g.lineTo(cx-4,stopN);g.moveTo(cx+4,stopS);g.lineTo(right-8,stopS);g.stroke();}
    g.strokeStyle='rgba(255,255,255,.97)';g.lineWidth=6;
    for(const cx of centers){const left=cx-half,right=cx+half,stopL=left-10,stopR=right+10,stopN=yA-10,stopS=yB+10;g.beginPath();g.moveTo(stopL,454);g.lineTo(stopL,yB-8);g.moveTo(stopR,yA+8);g.lineTo(stopR,446);g.moveTo(left+8,stopN);g.lineTo(cx-4,stopN);g.moveTo(cx+4,stopS);g.lineTo(right-8,stopS);g.stroke();g.fillStyle='rgba(255,255,255,.70)';for(let q=yA+12;q<yB-12;q+=stripe+gap){g.fillRect(stopL+safety,q,zebra,stripe);g.fillRect(stopR-safety-zebra,q,zebra,stripe);}for(let q=left+12;q<right-12;q+=stripe+gap){g.fillRect(q,stopN+safety,stripe,zebra);g.fillRect(q,stopS-safety-zebra,stripe,zebra);}}
    // Small median island between the two vertical roads makes the corridor topology obvious.
    const gapL=230+half,gapR=670-half;if(gapR-gapL>18){g.fillStyle='rgba(103,151,117,.42)';roundRect(g,gapL+8,yA-36,Math.max(10,gapR-gapL-16),28,10,true);roundRect(g,gapL+8,yB+8,Math.max(10,gapR-gapL-16),28,10,true);}
  }

  const WORLD_CACHE_LIMIT=8,worldCache=new Map();
  let worldCacheReleases=0;
  function clearWorldCache(){
    for(const cached of worldCache.values()){if(cached){cached.width=1;cached.height=1;}}
    if(worldCache.size){worldCache.clear();worldCacheReleases++;}
  }
  function getWorldCache(theme,lanes=1,junctionType='cross'){
    const cacheKey=`${theme.id}:${lanes}:${junctionType}`;let cached=worldCache.get(cacheKey);
    if(cached){worldCache.delete(cacheKey);worldCache.set(cacheKey,cached);return cached;}
    cached=document.createElement('canvas');cached.width=900;cached.height=900;const g=cached.getContext('2d',{alpha:false});
    const grad=g.createLinearGradient(0,0,900,900);grad.addColorStop(0,themeColor(theme.id,0));grad.addColorStop(1,themeColor(theme.id,1));g.fillStyle=grad;g.fillRect(0,0,900,900);
    g.globalAlpha=.08; g.fillStyle='#ffffff';
    for(let i=0;i<18;i++){g.beginPath();g.arc(40+(i*53)%900,40+((i*79)%900),26+(i%4)*10,0,Math.PI*2);g.fill();}
    g.globalAlpha=1;
    drawDistrictDecor(g,theme.id);
    drawLivingCityShops(g,theme.id);
    drawNeighborhoodEdge(g,theme.id);
    if(isLinkedJunctionType(junctionType)){
      drawLinkedRoadSurface(g,lanes);
      for(const cx of [230,670]){g.save();const ring=g.createRadialGradient(cx,450,18,cx,450,104);ring.addColorStop(0,'rgba(255,255,255,.05)');ring.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=ring;g.beginPath();g.arc(cx,450,104,0,Math.PI*2);g.fill();g.restore();}
    }else{
      drawRoadSurface(g,lanes);drawSidewalkFrame(g,lanes);drawAsphaltSheen(g,lanes);drawApproachMarkings(g,lanes);drawRoadReflectors(g,lanes);drawJunctionClosure(g,junctionType,theme,lanes);if(isRoundaboutJunction(junctionType))drawRoundaboutOverlay(g,lanes,theme);
      g.save();const ring=g.createRadialGradient(450,450,18,450,450,110);ring.addColorStop(0,'rgba(255,255,255,.05)');ring.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=ring;g.beginPath();g.arc(450,450,110,0,Math.PI*2);g.fill();g.restore();
    }
    while(worldCache.size>=WORLD_CACHE_LIMIT){const oldestKey=worldCache.keys().next().value,old=worldCache.get(oldestKey);worldCache.delete(oldestKey);if(old){old.width=1;old.height=1;}}
    worldCache.set(cacheKey,cached);return cached;
  }

  function drawPhaseChevrons(g,axis,color){
    g.save();
    g.fillStyle=color; g.globalAlpha=.25;
    const shift=(reducedMotion||RenderQuality.level===0)?0:(performance.now()/18)%34;
    const rows=axis==='H'?
      [[76+shift,452,1],[180+shift,452,1],[284+shift,452,1],[616-shift,448,-1],[720-shift,448,-1],[824-shift,448,-1]]:
      [[448,78+shift,1],[448,182+shift,1],[448,286+shift,1],[452,614-shift,-1],[452,718-shift,-1],[452,822-shift,-1]];
    for(const [x,y,dir] of rows){
      g.save();g.translate(x,y); if(axis==='V')g.rotate(dir>0?Math.PI/2:-Math.PI/2); else if(dir<0)g.rotate(Math.PI);
      g.beginPath(); g.moveTo(-10,-11); g.lineTo(12,0); g.lineTo(-10,11); g.closePath(); g.fill();
      g.restore();
    }
    g.restore();
  }


  function drawDynamicAmbient(g,theme){
    if(theme.id!=='night'||RenderQuality.level===0)return;
    const t=performance.now()/1000;
    g.save();
    // faint pool lights in the night district
    const lamps=[[300,300],[600,600],[605,300],[300,605]];
    for(let i=0;i<lamps.length;i++){
      const [x,y]=lamps[i],pulse=(reducedMotion?0:.04*Math.sin(t*2.1+i));
      const rg=g.createRadialGradient(x,y,4,x,y,92);
      rg.addColorStop(0,`rgba(104,229,255,${.14+pulse})`);rg.addColorStop(1,'rgba(104,229,255,0)');
      g.fillStyle=rg;g.fillRect(x-94,y-94,188,188);
    }
    g.restore();
  }

  function weatherForLevel(level){
    if(districtInfo(level).id==='winter'&&level%5!==0)return 'snow';
    if(level>=25 && level%23===0) return 'fog';
    if(level>=12 && (level%17===0 || level%9===0)) return 'rain';
    if(level>=12 && level%11===0) return 'sunset';
    return 'clear';
  }
  function weatherLabel(kind){
    if(kind==='rain')return `🌧 ${T.weatherRain}`;
    if(kind==='fog')return `🌫 ${T.weatherFog}`;
    if(kind==='sunset')return `🌇 ${T.weatherSunset}`;
    if(kind==='snow')return `❄ ${T.weatherSnow}`;
    return '';
  }
  function drawWeatherOverlay(g,game){
    const kind=weatherForLevel(game.level);if(kind==='clear')return;
    g.save();
    if(kind==='sunset'){
      const rg=g.createLinearGradient(0,0,900,900);rg.addColorStop(0,'rgba(255,174,104,.15)');rg.addColorStop(.5,'rgba(255,120,92,.07)');rg.addColorStop(1,'rgba(89,79,162,.08)');g.fillStyle=rg;g.fillRect(0,0,900,900);
      g.globalAlpha=.14;g.fillStyle='#ffe4a1';g.beginPath();g.arc(735,120,52,0,Math.PI*2);g.fill();
    }else if(kind==='fog'){
      const t=(game.elapsed||0)*12;g.globalAlpha=.12;g.fillStyle='#d9edf5';g.fillRect(0,0,900,900);
      const fogCount=RenderQuality.level>=2?5:RenderQuality.level===1?3:1;for(let i=0;i<fogCount;i++){const x=((i*173+t*(i%2?1:-1))%1100)-100,y=150+i*145;const grad=g.createRadialGradient(x,y,10,x,y,150);grad.addColorStop(0,'rgba(235,248,255,.18)');grad.addColorStop(1,'rgba(235,248,255,0)');g.fillStyle=grad;g.fillRect(x-160,y-80,320,160);}
    }else if(kind==='snow'){
      g.globalAlpha=.08;g.fillStyle='#dff5ff';g.fillRect(0,0,900,900);
      const count=RenderQuality.level>=2?52:RenderQuality.level===1?30:8,t=(game.elapsed||0)*34;g.fillStyle='rgba(244,252,255,.80)';g.shadowColor='rgba(190,235,255,.55)';g.shadowBlur=RenderQuality.level>=1?5:0;
      for(let i=0;i<count;i++){const x=((i*83+t*(.35+(i%5)*.05))%970)-35,y=((i*59+t*(1.15+(i%3)*.12))%970)-35,r=1.6+(i%4)*.65;g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill();}
      g.shadowBlur=0;
    }else if(kind==='rain'){
      g.globalAlpha=.055;g.fillStyle='#78bfe8';g.fillRect(0,0,900,900);
      g.globalAlpha=.13;g.fillStyle='#b9ddf4';g.fillRect(0,405,900,3);g.fillRect(405,0,3,900);
    }
    g.restore();
  }
  function drawQueueBadges(g,game){
    const q=countQueues(),max=Math.max(1,game.config?.maxQueue||4);
    const items=[['N',450,105],['S',450,795],['W',105,450],['E',795,450]];
    g.save();g.textAlign='center';g.textBaseline='middle';g.font='900 18px system-ui';
    const closed=junctionClosedArm(game.config?.junctionType||'cross');
    for(const [dir,x,y] of items){
      if(physicalEntryArm(dir)===closed)continue;
      const n=q[dir]||0;if(!n)continue;
      const ratio=n/max,hot=ratio>=.8,warm=ratio>=.5;
      const color=hot?'#ff5964':warm?'#ffd166':'#55d5ff';
      g.shadowColor=color;g.shadowBlur=hot?18:10;g.fillStyle='rgba(6,18,29,.78)';g.beginPath();g.arc(x,y,23,0,Math.PI*2);g.fill();
      g.shadowBlur=0;g.strokeStyle=color;g.lineWidth=4;g.beginPath();g.arc(x,y,20,0,Math.PI*2);g.stroke();
      g.fillStyle='#ffffff';g.fillText(String(n),x,y+1);
    }
    g.restore();
  }
  function drawRain(g,game){
    if(weatherForLevel(game.level)!=='rain'||reducedMotion||RenderQuality.level===0)return;
    const count=RenderQuality.level>=2?38:22,t=(game.elapsed||0)*260;
    g.save();g.strokeStyle='rgba(194,231,255,.30)';g.lineWidth=2;
    for(let i=0;i<count;i++){
      const x=((i*97+t*.17)%980)-40,y=((i*61+t+i*19)%980)-40;
      g.beginPath();g.moveTo(x,y);g.lineTo(x-10,y+22);g.stroke();
    }
    g.restore();
  }
  function drawDynamicRoadIncident(g,game){
    const director=game.incidentDirector;if(!director||director.completed||(!director.warned&&!director.active))return;const def=director.def;
    const cone=(x,y,rot=0,alpha=1)=>{g.save();g.globalAlpha=alpha;g.translate(x,y);g.rotate(rot);g.fillStyle='#ff8a3d';g.beginPath();g.moveTo(0,-9);g.lineTo(7,7);g.lineTo(-7,7);g.closePath();g.fill();g.fillStyle='#fff3d6';g.fillRect(-4,0,8,3);g.fillStyle='#70412c';g.fillRect(-9,7,18,4);g.restore();};
    g.save();
    if(!director.active){
      const dir=def.type==='broken'?def.dir:(def.axis==='H'?'W':'N'),pose=straightCarPose(dir,def.blockPoint,def.lane);g.translate(pose.x,pose.y);g.fillStyle='rgba(255,209,102,.94)';g.strokeStyle='rgba(7,24,38,.85)';g.lineWidth=3;g.beginPath();g.moveTo(0,-18);g.lineTo(18,14);g.lineTo(-18,14);g.closePath();g.fill();g.stroke();g.fillStyle='#07182a';g.font='950 18px system-ui';g.textAlign='center';g.textBaseline='middle';g.fillText('!',0,4);g.restore();return;
    }
    if(def.type==='slow'){
      const lanes=Math.max(1,game.config?.lanes||1),layout=roadLayout(lanes),a=layout.edgeMin,b=layout.edgeMax;g.fillStyle='rgba(255,209,102,.13)';g.strokeStyle='rgba(255,209,102,.70)';g.lineWidth=5;g.setLineDash([15,12]);
      if(def.axis==='H'){g.fillRect(34,a,250,b-a);g.fillRect(616,a,250,b-a);g.beginPath();g.moveTo(70,a+12);g.lineTo(250,a+12);g.moveTo(650,b-12);g.lineTo(830,b-12);g.stroke();}
      else {g.fillRect(a,34,b-a,250);g.fillRect(a,616,b-a,250);g.beginPath();g.moveTo(a+12,70);g.lineTo(a+12,250);g.moveTo(b-12,650);g.lineTo(b-12,830);g.stroke();}
      g.setLineDash([]);g.restore();return;
    }
    const dirs=def.type==='broken'?[def.dir]:(def.axis==='H'?['W','E']:['N','S']);
    for(const dir of dirs){const pose=straightCarPose(dir,def.blockPoint,def.lane),rot=directionAngle(dir);for(const d of [-34,0,34]){const cx=pose.x+Math.cos(rot)*d,cy=pose.y+Math.sin(rot)*d;cone(cx,cy,rot+Math.PI/2,.98);}if(def.type==='broken'){g.save();g.translate(pose.x,pose.y);g.rotate(rot);g.fillStyle='#d75d5d';g.strokeStyle='rgba(15,28,38,.82)';g.lineWidth=3;roundRect(g,-34,-20,68,40,12,true);roundRect(g,-34,-20,68,40,12,false);g.fillStyle='#ffd166';g.beginPath();g.arc(-24,0,5,0,Math.PI*2);g.arc(24,0,5,0,Math.PI*2);g.fill();g.restore();}}
    g.restore();
  }

  function drawRoadwork(g,closedLane){
    if(closedLane==null)return;
    g.save();
    const cone=(x,y,rot=0)=>{g.save();g.translate(x,y);g.rotate(rot);g.fillStyle='#ff8a3d';g.beginPath();g.moveTo(0,-10);g.lineTo(8,8);g.lineTo(-8,8);g.closePath();g.fill();g.fillStyle='#fff3d6';g.fillRect(-5,0,10,3);g.fillStyle='#7b472c';g.fillRect(-10,8,20,4);g.restore();};
    const hY1=450+laneOffset('W',closedLane),hY2=450+laneOffset('E',closedLane),vX1=450+laneOffset('N',closedLane),vX2=450+laneOffset('S',closedLane);
    for(const x of [78,138,198,258,642,702,762,822]){cone(x,x<450?hY1:hY2,0);}
    for(const y of [78,138,198,258,642,702,762,822]){cone(y<450?vX2:vX1,y,Math.PI/2);}
    g.fillStyle='rgba(255,138,61,.16)';g.fillRect(0,hY1-20,310,40);g.fillRect(590,hY2-20,310,40);g.fillRect(vX2-20,0,40,310);g.fillRect(vX1-20,590,40,310);
    g.restore();
  }

  function drawBusStopMarkers(g,junctionType='cross'){
    const {edgeMin:a,edgeMax:b}=roadLayout(Game.config?.lanes||1);
    const marks=[
      ['N',b+38,216],['S',a-38,684],['W',216,b+38],['E',684,a-38]
    ];
    g.save();
    for(const [arm,x,y] of marks){
      if(!junctionArmOpen(junctionType,arm))continue;
      g.save();g.translate(x,y);
      // Yellow curb stripe + pole make BUS read as a stop/service marker rather than road text.
      g.fillStyle='rgba(255,209,102,.52)';roundRect(g,-34,24,68,5,3,true);
      g.strokeStyle='rgba(40,58,68,.78)';g.lineWidth=5;g.beginPath();g.moveTo(0,20);g.lineTo(0,-22);g.stroke();
      g.fillStyle='rgba(7,24,38,.94)';g.strokeStyle='rgba(255,209,102,.52)';g.lineWidth=2;roundRect(g,-20,-43,40,27,8,true);roundRect(g,-20,-43,40,27,8,false);
      g.fillStyle='#ffd166';g.font='900 10px system-ui';g.textAlign='center';g.textBaseline='middle';g.fillText('BUS',0,-29);
      g.restore();
    }
    g.restore();
  }

  function drawPedestrians(g,game){
    if(!game.pedestrians?.length)return;
    const shirts=['#ffd166','#f6fbff','#55d5ff','#ff7c8a','#8fd19e','#b28cff'];
    g.save();g.lineWidth=3.2;g.lineCap='round';
    for(const ped of game.pedestrians){
      const pose=pedestrianPose(ped,game.config?.lanes||1),x=pose.x,y=pose.y,bob=reducedMotion?0:Math.sin((game.elapsed||0)*7+ped.id)*.8;
      g.fillStyle='rgba(0,0,0,.15)';g.beginPath();g.ellipse(x+2,y+18,8,3.8,0,0,Math.PI*2);g.fill();
      g.fillStyle=shirts[ped.shirt%shirts.length];g.beginPath();g.arc(x,y-10+bob,8,0,Math.PI*2);g.fill();
      g.strokeStyle='rgba(20,40,52,.92)';g.lineWidth=4;g.beginPath();g.moveTo(x,y-1+bob);g.lineTo(x,y+13+bob);g.moveTo(x,y+3+bob);g.lineTo(x-6,y+9+bob);g.moveTo(x,y+3+bob);g.lineTo(x+6,y+9+bob);g.moveTo(x,y+13+bob);g.lineTo(x-5,y+22+bob);g.moveTo(x,y+13+bob);g.lineTo(x+5,y+22+bob);g.stroke();
    }
    g.restore();
  }

  function drawPedestrianSignal(g,x,y,state='stop',flip=false){
    const walk=state==='walk',hold=state==='hold',color=walk?'#56e39f':hold?'#ffd166':'#ff5964';
    g.save();g.translate(x,y);if(flip)g.rotate(Math.PI);g.scale(.88,.88);g.strokeStyle='rgba(43,66,77,.72)';g.lineWidth=5;g.beginPath();g.moveTo(0,18);g.lineTo(0,38);g.stroke();g.fillStyle='rgba(5,18,30,.90)';g.strokeStyle='rgba(200,235,255,.22)';g.lineWidth=2;roundRect(g,-12,-18,24,36,7,true);roundRect(g,-12,-18,24,36,7,false);
    g.strokeStyle=color;g.fillStyle=color;g.shadowColor=color;g.shadowBlur=RenderQuality.level>=1?9:0;g.lineCap='round';g.lineWidth=2.6;
    if(walk){const step=reducedMotion?0:Math.sin(performance.now()/150)*1.6;g.beginPath();g.arc(0,-9,3.5,0,Math.PI*2);g.fill();g.beginPath();g.moveTo(0,-4);g.lineTo(0,4);g.moveTo(0,-1);g.lineTo(-5+step,2.5);g.moveTo(0,-1);g.lineTo(5-step,1);g.moveTo(0,4);g.lineTo(-4.5-step,11.5);g.moveTo(0,4);g.lineTo(5+step,10.5);g.stroke();}
    else if(hold){g.beginPath();g.arc(0,0,5,0,Math.PI*2);g.fill();g.globalAlpha=.55;g.beginPath();g.arc(0,0,9.5,0,Math.PI*2);g.stroke();}
    else {g.beginPath();g.arc(0,-9,3.5,0,Math.PI*2);g.fill();g.beginPath();g.moveTo(0,-4);g.lineTo(0,6);g.moveTo(-5,0);g.lineTo(5,0);g.moveTo(0,6);g.lineTo(-4.5,12);g.moveTo(0,6);g.lineTo(4.5,12);g.stroke();}
    g.shadowBlur=0;g.restore();
  }
  function drawPedestrianSignals(g,game){
    const layout=roadLayout(game.config?.lanes||1),a=layout.edgeMin,b=layout.edgeMax,near=CROSSWALK_STOP_A+17,far=CROSSWALK_STOP_B-17;
    const v=pedestrianSignalState('V',game),h=pedestrianSignalState('H',game),off=72,along=22,type=game.config?.junctionType||'cross';
    const open=arm=>junctionArmOpen(type,arm);
    // Keep pedestrian hardware clearly separated from the larger vehicle signal cluster: each box
    // sits diagonally outward on the sidewalk, still adjacent to its zebra but outside car paths.
    if(open('N')){if(open('W'))drawPedestrianSignal(g,a-off,near+along,v,false);if(open('E'))drawPedestrianSignal(g,b+off,near+along,v,true);}
    if(open('S')){if(open('W'))drawPedestrianSignal(g,a-off,far-along,v,false);if(open('E'))drawPedestrianSignal(g,b+off,far-along,v,true);}
    if(open('W')){if(open('N'))drawPedestrianSignal(g,near+along,a-off,h,false);if(open('S'))drawPedestrianSignal(g,near+along,b+off,h,true);}
    if(open('E')){if(open('N'))drawPedestrianSignal(g,far-along,a-off,h,false);if(open('S'))drawPedestrianSignal(g,far-along,b+off,h,true);}
  }
  function drawLinkedPedestrianSignals(g,game){
    const layout=roadLayout(game.config?.lanes||1),half=(layout.edgeMax-layout.edgeMin)/2,off=68,along=30;
    for(const junctionId of ['J0','J1']){
      const {x,y}=linkedJunctionCenter(junctionId),v=pedestrianSignalState('V',game,junctionId),h=pedestrianSignalState('H',game,junctionId);
      for(const side of [-1,1]){
        drawPedestrianSignal(g,x-half-off,y+side*(half+along),v,false);
        drawPedestrianSignal(g,x+half+off,y+side*(half+along),v,true);
        drawPedestrianSignal(g,x+side*(half+along),y-half-off,h,false);
        drawPedestrianSignal(g,x+side*(half+along),y+half+off,h,true);
      }
    }
  }

  function drawSidewalkPedestrians(g,game){
    if(reducedMotion)return;
    const quality=RenderQuality.level,count=quality===2?10:quality===1?6:1,t=(game.elapsed||0),layout=roadLayout(game.config?.lanes||1),a=layout.edgeMin,b=layout.edgeMax,pad=16,type=game.config?.junctionType||'cross';
    const candidates=[
      ['W',48,a-pad,a-26,a-pad],['E',b+26,a-pad,852,a-pad],['W',48,b+pad,a-26,b+pad],['E',b+26,b+pad,852,b+pad],
      ['N',a-pad,48,a-pad,a-26],['N',b+pad,48,b+pad,a-26],['S',a-pad,b+26,a-pad,852],['S',b+pad,b+26,b+pad,852]
    ];
    const routes=candidates.filter(([arm])=>junctionArmOpen(type,arm));if(!routes.length)return;
    const shirts=['#ff7c8a','#55d5ff','#ffd166','#8fd19e','#b28cff','#ffffff'];g.save();g.lineWidth=2.8;g.lineCap='round';
    for(let i=0;i<count;i++){const [,x0,y0,x1,y1]=routes[i%routes.length],speed=7.5+(i%4)*1.7,len=Math.hypot(x1-x0,y1-y0);let u=((t*speed+i*41)%Math.max(1,len))/Math.max(1,len);if(i%2)u=1-u;const x=x0+(x1-x0)*u,y=y0+(y1-y0)*u,bob=Math.sin(t*4+i)*.8;
      g.fillStyle='rgba(0,0,0,.15)';g.beginPath();g.ellipse(x+2,y+15,7.5,3.4,0,0,Math.PI*2);g.fill();g.fillStyle=shirts[i%shirts.length];g.beginPath();g.arc(x,y-8+bob,7.2,0,Math.PI*2);g.fill();g.strokeStyle='rgba(29,45,55,.90)';g.lineWidth=3.5;g.beginPath();g.moveTo(x,y+bob);g.lineTo(x,y+12+bob);g.moveTo(x,y+3+bob);g.lineTo(x-5,y+8+bob);g.moveTo(x,y+3+bob);g.lineTo(x+5,y+8+bob);g.moveTo(x,y+12+bob);g.lineTo(x-4.5,y+20+bob);g.moveTo(x,y+12+bob);g.lineTo(x+4.5,y+20+bob);g.stroke();}
    g.restore();
  }

  // M169: decorative city life stays inside the outer blocks, away from signals and crossings.
  function drawLivingCityShops(g,id){
    if(!['park','oldtown','coast','harbor'].includes(id))return;
    const shops=id==='park'?[[72,659,'CAFÉ','#df8d68']]:id==='coast'?[[665,78,'CAFÉ','#e2a15c']]:id==='harbor'?[[658,78,'MARKET','#65b2aa']]:[[64,74,'MARKET','#d98b66'],[668,74,'CAFÉ','#79b9a8']];
    g.save();
    for(const [x,y,label,awning] of shops){
      drawBuildingDepth(g,x,y,142,80,8);
      g.fillStyle='rgba(12,37,45,.18)';roundRect(g,x+5,y+7,142,80,10,true);
      g.fillStyle='#e6ddd0';roundRect(g,x,y,142,80,10,true);
      g.fillStyle='#607e86';roundRect(g,x+9,y+27,124,45,5,true);
      g.fillStyle='#c4eced';roundRect(g,x+14,y+31,72,36,3,true);
      g.fillStyle='rgba(255,255,255,.42)';g.fillRect(x+22,y+33,7,32);g.fillRect(x+61,y+33,4,32);
      g.fillStyle='#38565f';roundRect(g,x+98,y+32,27,39,3,true);
      g.fillStyle=awning;roundRect(g,x+7,y+19,128,14,3,true);
      g.fillStyle='#243e48';g.font='bold 11px system-ui';g.textAlign='center';g.textBaseline='middle';g.fillText(label,x+71,y+12);
      g.fillStyle='#487f67';g.beginPath();g.arc(x+120,y+60,6,0,Math.PI*2);g.fill();
    }
    g.restore();
  }

  // Cropped fragments at the four outside edges imply adjacent blocks beyond the playable view.
  // Their geometry stays outside traffic corridors and is drawn only into the static world cache.
  function drawNeighborhoodEdge(g,id){
    const green=['park','coast'].includes(id),industrial=['harbor','airport'].includes(id),night=id==='night';
    const roof=night?'#394766':id==='winter'?'#d3e5e9':industrial?'#758f96':'#b4c8c6';
    const trim=night?'#647b94':id==='winter'?'#ecf6f5':'#dce8df';
    const xs=[26,88,151,214,640,703,766,829];
    g.save();
    for(let i=0;i<xs.length;i++)for(const bottom of [false,true]){
      const x=xs[i],y=bottom?876+(i%3)*4:-22+(i%3)*4;
      if(green){g.fillStyle=id==='coast'?'#6fb0a8':'#5caf7e';for(let j=0;j<2;j++){g.beginPath();g.arc(x+j*17,y+18,15+(i%2)*3,0,Math.PI*2);g.fill();}continue;}
      g.fillStyle='rgba(19,43,48,.14)';roundRect(g,x+5,y+6,48,42,5,true);
      g.fillStyle=roof;roundRect(g,x,y,48,42,5,true);
      g.fillStyle=trim;g.fillRect(x+6,y+7,35,4);g.fillRect(x+9,y+19,12,10);
      g.fillStyle='rgba(39,76,88,.25)';g.fillRect(x+26,y+19,12,10);
    }
    for(let i=0;i<6;i++)for(const right of [false,true]){
      const x=right?881:-22,y=[58,128,205,646,726,807][i];
      if(green){g.fillStyle=id==='coast'?'#74b7a9':'#65b884';g.beginPath();g.arc(x+15,y,17,0,Math.PI*2);g.fill();continue;}
      g.fillStyle='rgba(19,43,48,.14)';roundRect(g,x+4,y+5,41,47,5,true);
      g.fillStyle=roof;roundRect(g,x,y,41,47,5,true);
      g.fillStyle=trim;g.fillRect(x+7,y+8,25,4);
    }
    g.restore();
  }

  function drawLivingCityAmbient(g,game){
    if(reducedMotion||RenderQuality.level===0)return;
    if(isLinkedJunctionType(game.config?.junctionType))return;
    const id=districtInfo(game.level).id,t=Math.max(0,game.elapsed||0);
    // Walkers and dogs remain in park blocks; no collision or gameplay state is added.
    const routes=id==='park'?[[72,194,210,122],[660,738,793,785]]:
      ['oldtown','coast','tech','airport','winter'].includes(id)?[[665,735,788,786]]:[];
    const count=RenderQuality.level>=2?routes.length:Math.min(1,routes.length);
    g.save();g.lineCap='round';
    for(let i=0;i<count;i++){
      const [x0,y0,x1,y1]=routes[i],phase=((t*(i?0.018:0.023)+i*.43)%2),u=phase<=1?phase:2-phase;
      const x=x0+(x1-x0)*u,y=y0+(y1-y0)*u,bob=Math.sin(t*5+i)*1.2;
      g.fillStyle='rgba(13,44,39,.16)';g.beginPath();g.ellipse(x+4,y+12,11,4,0,0,Math.PI*2);g.fill();
      g.strokeStyle='#f2e1bd';g.lineWidth=1.7;g.beginPath();g.moveTo(x+7,y+4);g.lineTo(x+22,y+12);g.stroke();
      g.fillStyle=i?'#edcb89':'#f49e7c';g.beginPath();g.arc(x,y-8+bob,7,0,Math.PI*2);g.fill();
      g.strokeStyle='#354754';g.lineWidth=3.4;g.beginPath();g.moveTo(x,y+bob);g.lineTo(x,y+11+bob);g.moveTo(x,y+3+bob);g.lineTo(x+7,y+4);g.moveTo(x,y+11+bob);g.lineTo(x-5,y+19+bob);g.moveTo(x,y+11+bob);g.lineTo(x+5,y+19+bob);g.stroke();
      const dx=x+23,dy=y+13+Math.sin(t*9+i)*.5;
      g.fillStyle=i?'#513e37':'#a7653f';g.beginPath();g.ellipse(dx,dy,10,5,0,0,Math.PI*2);g.fill();
      g.beginPath();g.arc(dx+9,dy-3,4.5,0,Math.PI*2);g.fill();
      g.beginPath();g.moveTo(dx+9,dy-6);g.lineTo(dx+8,dy-12);g.lineTo(dx+13,dy-7);g.fill();
      g.strokeStyle='#513e37';g.lineWidth=2;g.beginPath();g.moveTo(dx-8,dy+2);g.lineTo(dx-9,dy+7);g.moveTo(dx+4,dy+3);g.lineTo(dx+5,dy+8);g.moveTo(dx-10,dy-2);g.lineTo(dx-17,dy-8);g.stroke();
    }
    // A short flyover on one in four levels, after the opening rush has settled.
    if(RenderQuality.level>=2&&game.level%4===1){
      const cycle=t-16;
      if(cycle>=0&&cycle<8){const x=50+cycle*25,y=92+Math.sin(cycle*.55)*4;
        g.save();g.translate(x,y);g.globalAlpha=.48;
        g.fillStyle='rgba(16,38,48,.16)';g.beginPath();g.ellipse(7,38,27,5,0,0,Math.PI*2);g.fill();
        g.fillStyle='#e1eaf0';roundRect(g,-24,-8,48,16,9,true);
        g.fillStyle='#65adc5';roundRect(g,3,-7,17,10,4,true);
        g.strokeStyle='#d9e7e9';g.lineWidth=3;g.beginPath();g.moveTo(-22,0);g.lineTo(-39,-3);g.moveTo(-32,-10);g.lineTo(-32,4);g.moveTo(-27,-12);g.lineTo(26,-12);g.stroke();
        g.strokeStyle='#c9d9dc';g.lineWidth=2;g.beginPath();g.moveTo(-30,-15);g.lineTo(30,-15);g.stroke();g.restore();
      }
    }
    g.restore();
  }

  // M174: district-specific visual motion. These actors never enter gameplay corridors,
  // consume simulation RNG, or change collision/signal state. Low quality and reduced-motion
  // modes skip the layer entirely so the living city remains performance-scalable.
  function drawDistrictMicroLife(g,game){
    if(reducedMotion||RenderQuality.level===0||isLinkedJunctionType(game.config?.junctionType))return;
    const id=districtInfo(game.level).id,t=Math.max(0,game.elapsed||0),high=RenderQuality.level>=2;
    g.save();g.lineCap='round';g.lineJoin='round';

    if(id==='park'||id==='oldtown'){
      const cx=id==='park'?738:174,cy=id==='park'?174:734;
      const pulse=.5+.5*Math.sin(t*2.4),jet=high?22:15;
      g.fillStyle='rgba(38,105,122,.20)';g.beginPath();g.ellipse(cx+5,cy+11,34,13,0,0,Math.PI*2);g.fill();
      g.fillStyle=id==='park'?'#9fdbd7':'#b8d7d4';g.beginPath();g.ellipse(cx,cy,32,12,0,0,Math.PI*2);g.fill();
      g.fillStyle='rgba(217,247,255,.72)';g.beginPath();g.ellipse(cx,cy-1,22,7,0,0,Math.PI*2);g.fill();
      g.strokeStyle='rgba(224,249,255,.78)';g.lineWidth=2.2;
      for(let i=-1;i<=1;i++){
        const dx=i*8;g.beginPath();g.moveTo(cx+dx,cy-2);g.quadraticCurveTo(cx+dx*1.2,cy-jet-pulse*5,cx+dx*1.45,cy-5);g.stroke();
      }
      if(high){g.fillStyle='rgba(233,252,255,.72)';for(let i=0;i<5;i++){const a=t*1.7+i*1.26;g.beginPath();g.arc(cx+Math.cos(a)*22,cy-8-Math.abs(Math.sin(a))*11,2.2,0,Math.PI*2);g.fill();}}
    }

    if(id==='coast'||id==='harbor'){
      const harbor=id==='harbor',span=harbor?174:198,baseX=harbor?58:52,baseY=harbor?226:178;
      const u=((t*(harbor?11:9))%(span+70))-35,x=baseX+u,y=baseY+Math.sin(t*.9)*3;
      if(x>34&&x<314){
        g.globalAlpha=.30;g.strokeStyle='#ffffff';g.lineWidth=2;g.beginPath();g.moveTo(x-34,y+9);g.lineTo(x-10,y+4);g.stroke();g.globalAlpha=1;
        g.fillStyle=harbor?'#e1b94d':'#f5f1e5';g.beginPath();g.moveTo(x-17,y-3);g.lineTo(x+20,y-3);g.lineTo(x+11,y+9);g.lineTo(x-12,y+9);g.closePath();g.fill();
        g.fillStyle=harbor?'#456d76':'#4f91aa';roundRect(g,x-4,y-13,16,10,3,true);
        g.strokeStyle='rgba(236,250,255,.75)';g.lineWidth=2;g.beginPath();g.moveTo(x+2,y-13);g.lineTo(x+2,y-22);g.stroke();
        if(high){g.fillStyle='#ffdf77';g.beginPath();g.arc(x+2,y-22,2.2,0,Math.PI*2);g.fill();}
      }
    }

    if(id==='airport'){
      const xs=[76,114,152,190,228,266],phase=(t*1.8)%xs.length;
      for(let i=0;i<xs.length;i++){
        const d=Math.min(Math.abs(i-phase),xs.length-Math.abs(i-phase)),a=Math.max(.08,.70-d*.22);
        g.globalAlpha=a;g.fillStyle=i%2?'#ffd166':'#55d5ff';g.beginPath();g.arc(xs[i],101,4+(a*3),0,Math.PI*2);g.fill();
        if(high&&a>.45){g.globalAlpha=a*.16;g.beginPath();g.arc(xs[i],101,13,0,Math.PI*2);g.fill();}
      }
      g.globalAlpha=1;
    }

    if(id==='downtown'||id==='night'||id==='tech'){
      const points=id==='tech'?[[76,98],[206,118],[665,96],[768,128]]:[[72,98],[188,118],[664,96],[772,128],[82,686],[204,672],[668,690],[770,670]];
      const count=high?points.length:Math.min(4,points.length);
      for(let i=0;i<count;i++){
        const [x,y]=points[i],on=Math.sin(t*(.62+(i%3)*.11)+i*1.7)>.05;
        if(!on)continue;
        g.globalAlpha=id==='night'?.68:.40;g.fillStyle=id==='tech'?(i%2?'#55d5ff':'#64f1d2'):(id==='night'?(i%2?'#ff8fd8':'#8feeff'):'#ffe7a8');
        roundRect(g,x,y,8,5,1.5,true);roundRect(g,x+14,y+8,7,5,1.5,true);
      }
      if(high){
        const ax=id==='tech'?274:284,ay=id==='night'?69:58,blink=Math.sin(t*4.2)>0;
        g.globalAlpha=blink?.85:.22;g.fillStyle=id==='night'?'#ff5fb2':'#ff695f';g.beginPath();g.arc(ax,ay,3.2,0,Math.PI*2);g.fill();
        g.globalAlpha=.55;g.strokeStyle='rgba(220,241,247,.72)';g.lineWidth=2;g.beginPath();g.moveTo(ax,ay+2);g.lineTo(ax,ay+18);g.stroke();
      }
      g.globalAlpha=1;
    }

    if(id==='winter'){
      const bx=260,by=63;
      for(let i=0;i<(high?4:2);i++){
        const life=((t*.22+i*.24)%1),r=5+life*9,x=bx+Math.sin(t*.8+i)*5,y=by-life*50;
        g.globalAlpha=(1-life)*.22;g.fillStyle='#eaf6fa';g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill();
      }
      g.globalAlpha=1;
    }
    g.restore();
  }

  // M175: sidewalk/street-life activity. This layer is presentation-only: it derives motion
  // from elapsed visual time and level metadata, never from simulation RNG or gameplay actors.
  // All activity stays inside sidewalks / outer city blocks and disappears on Low quality or
  // reduced-motion devices so traffic readability and frame budget remain the priority.
  function drawStreetLifeActivity(g,game){
    if(reducedMotion||RenderQuality.level===0||isLinkedJunctionType(game.config?.junctionType))return;
    const id=districtInfo(game.level).id,t=Math.max(0,game.elapsed||0),high=RenderQuality.level>=2;
    const layout=roadLayout(game.config?.lanes||1),a=layout.edgeMin,b=layout.edgeMax,type=game.config?.junctionType||'cross';
    const skin=['#f1c9a5','#d9aa86','#b97b60','#ead0b8'],shirts=['#ff7c8a','#55d5ff','#ffd166','#8fd19e','#b28cff','#f7f9fb'];
    const person=(x,y,i=0,scale=1,pose=0)=>{
      const bob=Math.sin(t*3.2+i*1.7)*.45*scale,head=6.2*scale,leg=11*scale;
      g.fillStyle='rgba(11,33,43,.14)';g.beginPath();g.ellipse(x+2*scale,y+14*scale,7*scale,2.8*scale,0,0,Math.PI*2);g.fill();
      g.fillStyle=skin[i%skin.length];g.beginPath();g.arc(x,y-9*scale+bob,head,0,Math.PI*2);g.fill();
      g.strokeStyle=shirts[i%shirts.length];g.lineWidth=4*scale;g.beginPath();g.moveTo(x,y-1*scale+bob);g.lineTo(x,y+9*scale+bob);g.stroke();
      g.strokeStyle='rgba(30,47,56,.9)';g.lineWidth=2.6*scale;g.beginPath();g.moveTo(x,y+8*scale+bob);g.lineTo(x-4*scale,y+8*scale+leg+bob);g.moveTo(x,y+8*scale+bob);g.lineTo(x+4*scale,y+8*scale+leg+bob);g.stroke();
      const wave=pose?Math.sin(t*2.2+i)*3.5*scale:0;g.beginPath();g.moveTo(x,y+1*scale+bob);g.lineTo(x-6*scale,y+6*scale+bob);g.moveTo(x,y+1*scale+bob);g.lineTo(x+6*scale,y+(pose?-2:6)*scale+bob+wave);g.stroke();
    };
    const table=(x,y,i=0)=>{
      g.fillStyle='rgba(20,47,52,.15)';g.beginPath();g.ellipse(x+3,y+12,20,5,0,0,Math.PI*2);g.fill();
      g.fillStyle=i%2?'#c99163':'#b87c58';g.beginPath();g.ellipse(x,y,16,7,0,0,Math.PI*2);g.fill();g.fillRect(x-2,y,4,14);
      g.fillStyle='#f4f0df';g.beginPath();g.arc(x-5,y-2,2.3,0,Math.PI*2);g.arc(x+5,y-1,2.1,0,Math.PI*2);g.fill();
    };
    g.save();g.lineCap='round';g.lineJoin='round';

    // Commuters wait near the same curb locations as the existing BUS signs. They are visual
    // passengers only; actual bus stop timing remains entirely in the traffic simulation.
    if((game.config?.busChance||0)>0){
      const stops=[
        ['N',b+67,204,0,1],['S',a-67,696,0,-1],['W',204,b+67,1,0],['E',696,a-67,-1,0]
      ].filter(([arm])=>junctionArmOpen(type,arm));
      const stopCount=high?Math.min(4,stops.length):Math.min(2,stops.length);
      for(let si=0;si<stopCount;si++){
        const [arm,x,y,dx,dy]=stops[(si+(game.level%stops.length))%stops.length];
        const people=high?2:1;
        for(let j=0;j<people;j++)person(x+dx*j*17+(dy?j*13:0),y+dy*j*17+(dx?j*10:0),si*3+j,.78,j===0&&((Math.floor(t/3)+si)%2===0));
        // Tiny timetable panel pulse: readable as city furniture, not a gameplay warning.
        const p=.55+.12*Math.sin(t*1.8+si);g.globalAlpha=p;g.fillStyle='#dff4f5';roundRect(g,x-5,y-34,10,15,2,true);g.globalAlpha=1;
      }
    }

    // Café / market frontage gets seated patrons and a short customer approach. This ties the
    // static M169 storefronts into the animated city without entering the road corridor.
    const terraces=id==='park'?[[225,742,1]]:id==='coast'?[[748,190,0]]:id==='harbor'?[[744,190,1]]:id==='oldtown'?[[222,186,0],[748,188,1]]:[];
    const terraceCount=high?terraces.length:Math.min(1,terraces.length);
    for(let i=0;i<terraceCount;i++){
      const [x,y,v]=terraces[i];table(x,y,i);person(x-22,y+4,i+1,.72,0);person(x+24,y+5,i+4,.72,1);
      g.fillStyle=v?'#75b99f':'#e69a6d';g.globalAlpha=.72;g.beginPath();g.arc(x,y-12,4+Math.sin(t*2+i)*.5,0,Math.PI*2);g.fill();g.globalAlpha=1;
    }
    if(terraceCount){
      const [tx,ty]=terraces[0],u=((t*.045+.31)%2),q=u<=1?u:2-u,px=tx-52+q*34,py=ty-38+q*8;person(px,py,7,.70,0);
    }

    // M195 Hotfix01: removed the static decorative bicycle racks from business/tech districts.
    // They read as frozen gameplay actors at mobile scale. Moving cyclists and traffic simulation are unchanged.

    // Port/airport service carts move only inside the upper-left non-road block. Their motion is
    // deterministic and cosmetic; no vehicle or collision object is added to Game.cars.
    if(id==='harbor'||id==='airport'){
      const u=((t*(id==='airport'?18:14))%210),x=48+u,y=id==='airport'?244:238;
      if(x<278){
        g.fillStyle='rgba(13,38,45,.13)';g.beginPath();g.ellipse(x+3,y+13,18,4,0,0,Math.PI*2);g.fill();
        g.fillStyle=id==='airport'?'#f0d574':'#72aeb2';roundRect(g,x-15,y-7,30,15,4,true);g.fillStyle='#314f59';roundRect(g,x+6,y-12,10,9,2,true);
        g.fillStyle='#263f48';for(const wx of [-9,10]){g.beginPath();g.arc(x+wx,y+10,3.3,0,Math.PI*2);g.fill();}
        if(high&&id==='airport'){g.fillStyle=(Math.floor(t*5)%2)?'#ff745f':'#ffd166';g.beginPath();g.arc(x-11,y-9,2.1,0,Math.PI*2);g.fill();}
      }
    }

    // Doorway activity: a warm entrance light opens/closes in districts with storefronts.
    if(['park','oldtown','coast','harbor','downtown','night'].includes(id)){
      const doors=id==='park'?[[170,722]]:id==='coast'?[[775,150]]:id==='harbor'?[[768,150]]:id==='oldtown'?[[166,146],[770,146]]:id==='night'?[[80,136],[744,136]]:[[82,136]];
      const n=high?doors.length:1;
      for(let i=0;i<n;i++){
        const [x,y]=doors[i],open=Math.sin(t*.75+i*2.1)>.12;if(!open)continue;
        const grad=g.createRadialGradient(x,y,2,x,y,30);grad.addColorStop(0,'rgba(255,222,143,.28)');grad.addColorStop(1,'rgba(255,222,143,0)');g.fillStyle=grad;g.fillRect(x-30,y-30,60,60);
        g.fillStyle='rgba(255,229,166,.74)';roundRect(g,x-4,y-8,8,16,2,true);
      }
    }
    g.restore();
  }

  // M176: district signature events. One lightweight, recognizable ambient vignette per
  // district gives neighborhoods their own behavior. These events are render-only, deterministic,
  // bounded to outer blocks and fully disabled for reduced-motion / Low quality / linked boards.
  function drawDistrictSignatureEvents(g,game){
    if(reducedMotion||RenderQuality.level===0||isLinkedJunctionType(game.config?.junctionType))return;
    const id=districtInfo(game.level).id,t=Math.max(0,game.elapsed||0),high=RenderQuality.level>=2;
    const cycle=t%28,fade=Math.min(1,cycle/1.5,(28-cycle)/1.8);
    if(fade<=0)return;
    g.save();g.globalAlpha=Math.max(0,fade);g.lineCap='round';g.lineJoin='round';

    if(id==='park'){
      // A cyclist loops along the park path without approaching a road crossing.
      const q=((cycle*0.065)%2),u=q<=1?q:2-q,x=58+u*184,y=112+Math.sin(u*Math.PI)*32;
      g.strokeStyle='#345764';g.lineWidth=2.3;g.beginPath();g.arc(x-8,y+7,7,0,Math.PI*2);g.arc(x+9,y+7,7,0,Math.PI*2);g.moveTo(x-8,y+7);g.lineTo(x,y-3);g.lineTo(x+9,y+7);g.lineTo(x+1,y+7);g.lineTo(x-8,y+7);g.moveTo(x,y-3);g.lineTo(x+10,y-5);g.stroke();
      g.fillStyle='#f3c7a5';g.beginPath();g.arc(x-1,y-14,4.5,0,Math.PI*2);g.fill();g.strokeStyle='#ef886b';g.lineWidth=4;g.beginPath();g.moveTo(x,y-8);g.lineTo(x,y+1);g.stroke();
    }else if(id==='coast'){
      // Seagulls circle above the waterfront block; their shadows stay on water/grass.
      const n=high?4:2;for(let i=0;i<n;i++){const a=t*.75+i*(Math.PI*2/n),x=150+Math.cos(a)*82,y=132+Math.sin(a*.83)*42;
        g.strokeStyle='rgba(247,252,255,.88)';g.lineWidth=2.4;g.beginPath();g.moveTo(x-10,y);g.quadraticCurveTo(x-5,y-7,x,y);g.quadraticCurveTo(x+5,y-7,x+10,y);g.stroke();
        g.fillStyle='rgba(24,72,82,.09)';g.beginPath();g.ellipse(x+7,y+32,9,2.5,0,0,Math.PI*2);g.fill();}
    }else if(id==='downtown'){
      // Rooftop media board swaps between two soft patterns instead of static facade light.
      const x=70,y=72,w=112,h=38,alt=Math.sin(t*.72)>0;
      g.fillStyle='rgba(18,32,49,.78)';roundRect(g,x,y,w,h,6,true);g.strokeStyle='rgba(160,214,230,.45)';g.lineWidth=2;roundRect(g,x,y,w,h,6,false);
      g.globalAlpha*=.72;g.fillStyle=alt?'#55d5ff':'#ffd166';if(alt){for(let i=0;i<5;i++)g.fillRect(x+12+i*18,y+10+(i%2)*8,9,13);}else{g.beginPath();g.arc(x+28,y+19,9,0,Math.PI*2);g.fill();g.fillRect(x+48,y+12,49,5);g.fillRect(x+48,y+22,34,4);}g.globalAlpha=fade;
    }else if(id==='airport'){
      // Terminal radar sweep: recognizable airport motion, confined to the terminal block.
      const cx=150,cy=118,r=45,a=t*1.25;g.strokeStyle='rgba(85,213,255,.35)';g.lineWidth=2;g.beginPath();g.arc(cx,cy,r,0,Math.PI*2);g.stroke();g.beginPath();g.arc(cx,cy,r*.58,0,Math.PI*2);g.stroke();
      g.strokeStyle='rgba(86,227,159,.75)';g.lineWidth=3;g.beginPath();g.moveTo(cx,cy);g.lineTo(cx+Math.cos(a)*r,cy+Math.sin(a)*r);g.stroke();g.fillStyle='#56e39f';g.beginPath();g.arc(cx,cy,4,0,Math.PI*2);g.fill();
      if(high){for(let i=0;i<3;i++){const da=a-i*.22;g.globalAlpha=fade*(.22-i*.05);g.strokeStyle='#56e39f';g.lineWidth=5-i;g.beginPath();g.moveTo(cx,cy);g.lineTo(cx+Math.cos(da)*r,cy+Math.sin(da)*r);g.stroke();}g.globalAlpha=fade;}
    }else if(id==='harbor'){
      // Container crane raises/lowers one box inside the port yard.
      const x=118,y=65,lift=.5+.5*Math.sin(t*.72),boxY=154-lift*58;
      g.strokeStyle='#516e76';g.lineWidth=6;g.beginPath();g.moveTo(x,y);g.lineTo(x,190);g.moveTo(x,y);g.lineTo(x+100,y);g.stroke();g.lineWidth=3;g.beginPath();g.moveTo(x+75,y);g.lineTo(x+75,boxY-2);g.stroke();
      g.fillStyle='#d88b58';roundRect(g,x+50,boxY,52,23,3,true);g.strokeStyle='rgba(70,75,72,.45)';g.lineWidth=1.5;for(let k=1;k<4;k++){g.beginPath();g.moveTo(x+50+k*13,boxY+2);g.lineTo(x+50+k*13,boxY+21);g.stroke();}
      if(high){g.fillStyle='#ffd166';g.globalAlpha=fade*(.35+.45*(Math.sin(t*4)>0));g.beginPath();g.arc(x+4,y+5,3,0,Math.PI*2);g.fill();g.globalAlpha=fade;}
    }else if(id==='night'){
      // Neon hotel sign with restrained flicker, not full-screen flashing.
      const x=74,y=72,on=Math.sin(t*3.6)+Math.sin(t*.83)*.45>-.2;g.font='900 20px system-ui';g.textAlign='center';g.textBaseline='middle';
      g.shadowColor='#ff69c9';g.shadowBlur=on&&high?15:5;g.fillStyle=on?'rgba(255,112,207,.88)':'rgba(255,112,207,.28)';g.fillText('CITY',x+48,y+13);g.shadowBlur=0;
      g.strokeStyle=on?'rgba(106,229,255,.78)':'rgba(106,229,255,.24)';g.lineWidth=2;roundRect(g,x,y,96,28,6,false);
    }else if(id==='oldtown'){
      // Market vendor opens/closes the awning and serves a nearby customer.
      const x=72,y=205,open=.55+.45*Math.sin(t*.55),w=92;
      g.fillStyle='#d98b66';g.beginPath();g.moveTo(x,y);g.lineTo(x+w,y);g.lineTo(x+w-8,y+18*open);g.lineTo(x+8,y+18*open);g.closePath();g.fill();
      g.strokeStyle='#f3dfc2';g.lineWidth=3;for(let k=1;k<5;k++){g.beginPath();g.moveTo(x+k*w/5,y+1);g.lineTo(x+k*w/5-2,y+16*open);g.stroke();}
      g.fillStyle='#6b8b6e';roundRect(g,x+10,y+24,72,25,4,true);g.fillStyle='#f3d47a';for(let k=0;k<5;k++){g.beginPath();g.arc(x+18+k*13,y+31+(k%2)*6,4,0,Math.PI*2);g.fill();}
    }else if(id==='tech'){
      // Small delivery drone travels only over the top-right campus block.
      const q=((cycle*0.075)%2),u=q<=1?q:2-q,x=650+u*158,y=120+Math.sin(u*Math.PI)*25;
      g.fillStyle='rgba(25,66,78,.12)';g.beginPath();g.ellipse(x+4,y+34,16,4,0,0,Math.PI*2);g.fill();g.fillStyle='#dbe9ec';roundRect(g,x-12,y-5,24,10,5,true);g.strokeStyle='#607f89';g.lineWidth=2.4;g.beginPath();g.moveTo(x-10,y);g.lineTo(x-24,y-7);g.moveTo(x+10,y);g.lineTo(x+24,y-7);g.stroke();
      g.fillStyle='#55d5ff';for(const dx of [-24,24]){g.beginPath();g.arc(x+dx,y-7,3.2,0,Math.PI*2);g.fill();}if(high){g.globalAlpha=fade*.45;g.fillStyle='#56e39f';g.fillRect(x-3,y+7,6,9);g.globalAlpha=fade;}
    }else if(id==='winter'){
      // Decorative holiday lights animate along a safe lower-right park edge.
      const pts=[[674,718],[698,704],[724,711],[750,698],[778,710],[806,700]],n=high?pts.length:4;
      for(let i=0;i<n;i++){const [x,y]=pts[i],on=Math.sin(t*2.1+i*1.2)>-.15;g.globalAlpha=fade*(on?.86:.22);g.fillStyle=i%3===0?'#ff7c8a':i%3===1?'#ffd166':'#55d5ff';g.beginPath();g.arc(x,y,4.2,0,Math.PI*2);g.fill();}
      g.globalAlpha=fade;g.strokeStyle='rgba(231,244,247,.45)';g.lineWidth=2;g.beginPath();for(let i=0;i<n;i++){const [x,y]=pts[i];if(i===0)g.moveTo(x,y);else g.lineTo(x,y);}g.stroke();
    }
    g.restore();
  }

  // M177: traffic-aware city reactions. This presentation state is derived from the
  // authoritative simulation but never writes back to it. It lets the city acknowledge congestion,
  // emergency priority, crashes and good flow without creating actors, collisions or RNG calls.
  function cityReactionState(game){
    const none={queuePressure:0,queueLevel:0,maxQueueNow:0,emergency:false,crash:false,flow:0,progress:0,weather:'clear'};
    if(!game||isLinkedJunctionType(game.config?.junctionType))return none;
    const queues={N:0,S:0,E:0,W:0};
    for(const c of game.cars||[]){if(c.stopped&&c.progress<365&&queues[c.dir]!=null)queues[c.dir]++;}
    const maxQueueNow=Math.max(queues.N,queues.S,queues.E,queues.W),limit=Math.max(1,Number(game.config?.maxQueue)||1),queuePressure=Math.min(1.35,maxQueueNow/limit);
    const emergency=Boolean(game.emergencyPriorityId||(game.cars||[]).some(c=>isEmergencyVehicle(c)&&(c.emergencyPriorityActive||c.priorityAnnounced)));
    const crash=Boolean(game.crashFx||(game.state==='failed'&&game.crashPair));
    const flow=Math.max(0,Number(game.flowStreak)||0),progress=Math.max(0,Math.min(1,(Number(game.exited)||0)/Math.max(1,Number(game.config?.total)||1)));
    return {queuePressure,queueLevel:queuePressure>=.72?2:queuePressure>=.42?1:0,maxQueueNow,emergency,crash,flow,progress,weather:weatherForLevel(game.level)};
  }

  function drawTrafficAwareCityReactions(g,game){
    if(reducedMotion||RenderQuality.level===0||isLinkedJunctionType(game.config?.junctionType))return;
    const s=cityReactionState(game),t=Math.max(0,game.elapsed||0),high=RenderQuality.level>=2,id=districtInfo(game.level).id;
    if(!s.queueLevel&&!s.emergency&&!s.crash&&s.flow<4&&s.progress<.72)return;
    g.save();g.lineCap='round';g.lineJoin='round';

    // Growing queues make nearby public spaces visibly busier, but the extra people stay well
    // inside the outer blocks so they can never be mistaken for gameplay pedestrians.
    if(s.queueLevel){
      const pulse=.58+.20*Math.sin(t*2.1),count=s.queueLevel===2?(high?7:5):(high?5:3),baseX=(id==='airport'||id==='tech'||id==='coast')?690:92,baseY=(id==='harbor'||id==='oldtown')?748:246;
      g.globalAlpha=.72+.18*pulse;
      g.fillStyle=s.queueLevel===2?'rgba(255,174,91,.20)':'rgba(255,209,102,.14)';roundRect(g,baseX-24,baseY-28,132,58,15,true);
      g.strokeStyle=s.queueLevel===2?'rgba(255,154,91,.68)':'rgba(255,209,102,.54)';g.lineWidth=2;roundRect(g,baseX-24,baseY-28,132,58,15,false);
      for(let i=0;i<count;i++){
        const x=baseX+i*16+(i%2)*2,y=baseY+(i%2)*3;
        g.fillStyle=['#f1c7a3','#d6a47e','#f0d8b8'][i%3];g.beginPath();g.arc(x,y-11,3.3,0,Math.PI*2);g.fill();
        g.strokeStyle=i%2?'#6e8fa0':'#8d6b79';g.lineWidth=4;g.beginPath();g.moveTo(x,y-6);g.lineTo(x,y+5);g.stroke();
      }
      if(s.queueLevel===2){g.fillStyle='rgba(255,209,102,.86)';g.font='900 12px system-ui';g.textAlign='center';g.textBaseline='middle';g.fillText('•••',baseX+86,baseY-1);}
      g.globalAlpha=1;
    }

    // Emergency vehicles cast restrained alternating reflections onto facades and cause two
    // decorative sidewalk figures to step back from the curb. No road geometry is touched.
    if(s.emergency){
      const alt=Math.floor(t*5)%2===0,spots=[[118,104],[782,756]];
      for(let i=0;i<spots.length;i++){
        const [x,y]=spots[i],c=(i===0)===alt?'rgba(85,190,255,.28)':'rgba(255,89,100,.25)';
        const grad=g.createRadialGradient(x,y,4,x,y,high?70:48);grad.addColorStop(0,c);grad.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=grad;g.fillRect(x-75,y-75,150,150);
      }
      const retreat=.5+.5*Math.sin(t*3.2);for(const [x,y,dir] of [[255,245,-1],[645,655,1]]){g.fillStyle='#f1c9a8';g.beginPath();g.arc(x+dir*retreat*7,y-10,3.5,0,Math.PI*2);g.fill();g.strokeStyle='#7c91a0';g.lineWidth=4;g.beginPath();g.moveTo(x+dir*retreat*7,y-5);g.lineTo(x+dir*(5+retreat*10),y+7);g.stroke();}
    }

    // A crash briefly draws attention from the surrounding blocks rather than adding another
    // screen-wide flash. These rings disappear with the existing crash FX lifetime.
    if(s.crash){
      const life=game.crashFx?Math.max(0,Math.min(1,game.crashFx.life/game.crashFx.max)):1,rad=10+(1-life)*14;
      g.globalAlpha=.3+.45*life;g.strokeStyle='rgba(255,209,102,.88)';g.lineWidth=2.4;
      for(const [x,y] of [[210,205],[690,205],[210,695],[690,695]]){g.beginPath();g.arc(x,y,rad,0,Math.PI*2);g.stroke();}
      g.globalAlpha=1;
    }

    // Sustained FLOW gives the city a positive response: outer-block lamps illuminate in a
    // travelling sequence. This is deliberately subtle and never changes the signal colors.
    if(s.flow>=4&&!s.emergency&&!s.crash){
      const lamps=[[128,264],[772,264],[128,636],[772,636]],boost=Math.min(1,(s.flow-3)/7);
      for(let i=0;i<lamps.length;i++){
        const [x,y]=lamps[i],on=Math.sin(t*3-i*.75)>.05;
        g.globalAlpha=(on?.48:.18)+boost*.20;g.fillStyle='#70f0b2';g.shadowColor='#56e39f';g.shadowBlur=high&&on?12:0;g.beginPath();g.arc(x,y,4.2+boost*1.5,0,Math.PI*2);g.fill();
      }
      g.shadowBlur=0;g.globalAlpha=1;
    }

    // Late in a clean run, storefronts warm up as a lightweight sense of elapsed city time.
    if(s.progress>=.72&&!s.emergency&&!s.crash&&s.queueLevel<2){
      const glow=.18+.10*Math.sin(t*1.4);g.fillStyle=`rgba(255,226,157,${glow.toFixed(3)})`;
      for(const [x,y] of [[84,172],[764,172],[84,724],[764,724]])roundRect(g,x-13,y-6,26,12,3,true);
    }
    g.restore();
  }

  // M178: weather-responsive street life. The base weather overlay describes the atmosphere;
  // this layer shows how safe outer-block city spaces adapt to it. It is presentation-only and
  // never changes movement speed, signals, spawning, collisions or gameplay pedestrians.
  function drawWeatherResponsiveCity(g,game){
    if(reducedMotion||RenderQuality.level===0||isLinkedJunctionType(game.config?.junctionType))return;
    const kind=weatherForLevel(game.level);if(kind==='clear')return;
    const t=Math.max(0,game.elapsed||0),high=RenderQuality.level>=2,id=districtInfo(game.level).id;
    g.save();g.lineCap='round';g.lineJoin='round';

    if(kind==='rain'){
      // Umbrellas and sheltered waiting figures remain deep inside the outer blocks.
      const pts=id==='coast'?[[88,210],[146,222],[760,706],[818,718]]:[[86,218],[146,230],[754,704],[812,716]];
      const n=high?pts.length:2;
      for(let i=0;i<n;i++){
        const [x,y]=pts[i],bob=Math.sin(t*2+i)*1.4;
        g.fillStyle=i%2?'#6fc5d2':'#f0a86e';g.beginPath();g.arc(x,y-14+bob,10,Math.PI,Math.PI*2);g.lineTo(x+10,y-14+bob);g.closePath();g.fill();
        g.strokeStyle='#57717b';g.lineWidth=2;g.beginPath();g.moveTo(x,y-14+bob);g.lineTo(x,y+1+bob);g.quadraticCurveTo(x,y+7+bob,x+5,y+7+bob);g.stroke();
        g.fillStyle='#edc8aa';g.beginPath();g.arc(x,y+2+bob,3,0,Math.PI*2);g.fill();
      }
      // Small puddle ripples next to plazas, never on the drivable surface.
      g.strokeStyle='rgba(158,222,239,.38)';g.lineWidth=1.8;const ripple=(t*22)%18;
      for(const [x,y] of [[226,250],[674,650]]){g.globalAlpha=.62;g.beginPath();g.ellipse(x,y,8+ripple*.55,2.8+ripple*.12,0,0,Math.PI*2);g.stroke();}
      g.globalAlpha=1;
    }else if(kind==='fog'){
      // Street lamps increase their visible halo in fog; no signal color is reused or altered.
      const lamps=[[120,250],[780,250],[120,650],[780,650]],n=high?4:2;
      for(let i=0;i<n;i++){
        const [x,y]=lamps[i],r=high?52:38,grad=g.createRadialGradient(x,y,4,x,y,r);grad.addColorStop(0,'rgba(255,229,166,.30)');grad.addColorStop(1,'rgba(255,229,166,0)');g.fillStyle=grad;g.fillRect(x-r,y-r,r*2,r*2);
        g.fillStyle='rgba(255,230,170,.82)';g.beginPath();g.arc(x,y,3.5,0,Math.PI*2);g.fill();g.strokeStyle='#566f78';g.lineWidth=2;g.beginPath();g.moveTo(x,y+4);g.lineTo(x,y+23);g.stroke();
      }
      if(high){g.globalAlpha=.34;g.fillStyle='#d9edf5';for(const [x,y] of [[184,122],[716,774]])roundRect(g,x-34,y-5,68,10,5,true);g.globalAlpha=1;}
    }else if(kind==='snow'){
      // A maintenance worker clears a short decorative sidewalk strip while warm windows glow.
      const x=118+Math.sin(t*.55)*22,y=720;
      g.fillStyle='rgba(219,244,252,.78)';roundRect(g,62,735,132,10,5,true);
      g.fillStyle='#f0c7a5';g.beginPath();g.arc(x,y-19,4,0,Math.PI*2);g.fill();g.strokeStyle='#6e91aa';g.lineWidth=5;g.beginPath();g.moveTo(x,y-13);g.lineTo(x,y+1);g.stroke();
      g.strokeStyle='#9bb6c4';g.lineWidth=3;g.beginPath();g.moveTo(x+2,y-4);g.lineTo(x+14,y+8);g.stroke();g.fillStyle='#c5dbe4';roundRect(g,x+10,y+6,22,5,2,true);
      const glow=.22+.10*Math.sin(t*1.3);g.fillStyle=`rgba(255,225,154,${glow.toFixed(3)})`;for(const [wx,wy] of [[742,126],[774,126],[742,158],[774,158]])roundRect(g,wx-8,wy-7,16,14,2,true);
      if(high){g.fillStyle='rgba(243,252,255,.75)';for(let i=0;i<5;i++){const fx=70+i*22,fy=696+(i%2)*4;g.beginPath();g.ellipse(fx,fy,4,2,0,0,Math.PI*2);g.fill();}}
    }else if(kind==='sunset'){
      // Terraces and windows pick up warm low-angle light; the gameplay road remains unchanged.
      const alpha=.16+.07*Math.sin(t*.9);g.fillStyle=`rgba(255,185,111,${alpha.toFixed(3)})`;
      for(const [x,y,w,h] of [[58,86,120,34],[720,90,120,34],[64,742,106,28],[730,742,106,28]])roundRect(g,x,y,w,h,7,true);
      const awnY=id==='downtown'||id==='night'?206:216;g.fillStyle='rgba(231,142,91,.72)';g.beginPath();g.moveTo(72,awnY);g.lineTo(166,awnY);g.lineTo(156,awnY+16);g.lineTo(82,awnY+16);g.closePath();g.fill();
      if(high){g.strokeStyle='rgba(255,220,160,.64)';g.lineWidth=2;for(let i=0;i<4;i++){g.beginPath();g.moveTo(82+i*23,awnY+2);g.lineTo(88+i*18,awnY+14);g.stroke();}}
    }
    g.restore();
  }



  // M179: dynamic daily city rhythm. The city now moves through a lightweight visual day cycle
  // during a run: morning service, daytime commerce, evening commute, and warm night windows.
  // The layer is deterministic, presentation-only, and reads traffic/weather state without
  // mutating gameplay actors, signal timing, spawning, collisions, save data, or simulation RNG.
  function cityRhythmState(game){
    const base={phase:'day',phaseIndex:1,cycle:.35,commute:.2,commerce:1,service:.25,evening:0,weather:'clear',district:'park',trafficLoad:0};
    if(!game||isLinkedJunctionType(game.config?.junctionType))return base;
    const elapsed=Math.max(0,Number(game.elapsed)||0),district=districtInfo(game.level).id,weather=weatherForLevel(game.level);
    const cycle=((Number(game.level||1)%5)*.073+elapsed/92)%1;
    let phase='day',phaseIndex=1;
    if(cycle<.20){phase='morning';phaseIndex=0;}else if(cycle<.56){phase='day';phaseIndex=1;}else if(cycle<.80){phase='evening';phaseIndex=2;}else{phase='night';phaseIndex=3;}
    const peak=(c,w)=>Math.max(0,1-Math.abs(cycle-c)/w),commute=Math.max(peak(.13,.13),peak(.68,.15));
    let commerce=phase==='day'?1:phase==='evening'?.82:phase==='morning'?.48:.24;
    if(weather==='rain')commerce*=.76;else if(weather==='snow')commerce*=.64;else if(weather==='fog')commerce*=.84;
    const service=phase==='morning'?.95:phase==='day'?.34:phase==='evening'?.16:.08;
    const evening=phase==='evening'?Math.min(1,(cycle-.56)/.24):phase==='night'?1:0;
    const trafficLoad=Math.min(1.2,Math.max(0,cityReactionState(game).queuePressure||0));
    return {phase,phaseIndex,cycle,commute:Math.min(1,commute*(1+trafficLoad*.12)),commerce:Math.min(1,commerce),service,evening,weather,district,trafficLoad};
  }

  function drawDailyCityRhythm(g,game){
    if(reducedMotion||RenderQuality.level===0||isLinkedJunctionType(game.config?.junctionType))return;
    const s=cityRhythmState(game),t=Math.max(0,game.elapsed||0),high=RenderQuality.level>=2,id=s.district;
    g.save();g.lineCap='round';g.lineJoin='round';

    // Morning municipal/service activity. The cart stays deep inside the upper-left city block.
    if(s.service>.18){
      const u=((t*18+game.level*7)%150)/150,x=72+u*120,y=146+Math.sin(t*.8)*2,a=.28+.62*s.service;
      g.globalAlpha=a;g.fillStyle='rgba(24,57,65,.16)';g.beginPath();g.ellipse(x+3,y+11,19,5,0,0,Math.PI*2);g.fill();
      g.fillStyle=id==='winter'?'#8fc6da':'#e6b45b';roundRect(g,x-13,y-7,27,14,4,true);g.fillStyle='#536d76';roundRect(g,x+8,y-4,10,9,3,true);
      g.fillStyle='#31464f';for(const wx of [x-7,x+10]){g.beginPath();g.arc(wx,y+8,4,0,Math.PI*2);g.fill();}
      if(high){g.fillStyle='rgba(255,229,150,.78)';g.beginPath();g.arc(x+16,y-4,2.5,0,Math.PI*2);g.fill();}
      g.globalAlpha=1;
    }

    // Commute peaks make bus shelters feel occupied. These are decorative figures only and are
    // placed away from pedestrian crossings / drivable lanes.
    if(s.commute>.18){
      const n=Math.max(1,Math.round((high?5:3)*s.commute)),base=id==='airport'||id==='tech'?684:92,yy=id==='harbor'||id==='oldtown'?742:224;
      g.globalAlpha=.34+.56*s.commute;
      for(let i=0;i<n;i++){
        const x=base+i*14,y=yy+(i%2)*3,bob=Math.sin(t*2.6+i)*.7;
        g.fillStyle=['#f0c6a2','#d8a47f','#e7c2a6'][i%3];g.beginPath();g.arc(x,y-10+bob,3.4,0,Math.PI*2);g.fill();
        g.strokeStyle=['#5d7f91','#8a6f83','#56736a'][i%3];g.lineWidth=4;g.beginPath();g.moveTo(x,y-5+bob);g.lineTo(x,y+6+bob);g.stroke();
      }
      // Transit information lamp pulses faster near the commute peak.
      const px=base-16,py=yy-17,pulse=.45+.55*Math.sin(t*(2.1+s.commute*2.2))**2;
      g.globalAlpha=.22+.52*s.commute*pulse;g.fillStyle='#55d5ff';g.beginPath();g.arc(px,py,4.2,0,Math.PI*2);g.fill();g.globalAlpha=1;
    }

    // Daytime/evening commerce: open signs and awning lights track city rhythm, while rain/snow
    // naturally reduce the intensity through cityRhythmState().
    if(s.commerce>.16&&['park','coast','downtown','oldtown','tech','night'].includes(id)){
      const shops=[[96,188],[760,188],[96,706],[760,706]],n=high?shops.length:2;
      for(let i=0;i<n;i++){
        const [x,y]=shops[i],f=.55+.45*Math.sin(t*1.2+i*.9)**2;
        g.globalAlpha=(.14+.42*s.commerce)*f;g.fillStyle=id==='night'?(i%2?'#ff79c9':'#8feeff'):'#ffd88e';roundRect(g,x-13,y-5,26,10,3,true);
        if(high&&s.commerce>.55){g.globalAlpha=.30*s.commerce;g.fillStyle='#f4efe1';roundRect(g,x-5,y+10,10,4,2,true);}
      }
      g.globalAlpha=1;
    }

    // Evening/night: more windows turn on in a travelling pattern, giving the skyline a daily
    // cadence without changing the district's existing art or any gameplay illumination.
    if(s.evening>.05){
      const windows=[[74,94],[104,108],[136,92],[746,94],[778,110],[808,92],[82,762],[116,744],[752,760],[790,744]],n=high?windows.length:6;
      for(let i=0;i<n;i++){
        const [x,y]=windows[i],on=(i/n)<=Math.min(1,s.evening*.78+.18*Math.sin(t*.7+i));if(!on)continue;
        g.globalAlpha=.20+.38*s.evening;g.fillStyle=id==='tech'?(i%2?'#7ff0d6':'#82dfff'):(id==='night'?(i%2?'#ff8fd8':'#9bdfff'):'#ffe0a1');roundRect(g,x,y,8,6,1.5,true);
      }
      g.globalAlpha=1;
    }

    // At night, non-night districts quiet down: a small cleanup figure replaces daytime crowding.
    if(s.phase==='night'&&high&&id!=='night'){
      const x=760+Math.sin(t*.35)*18,y=742;g.globalAlpha=.58;g.fillStyle='#e7c5a5';g.beginPath();g.arc(x,y-12,3.5,0,Math.PI*2);g.fill();g.strokeStyle='#667d88';g.lineWidth=4;g.beginPath();g.moveTo(x,y-7);g.lineTo(x,y+5);g.stroke();g.strokeStyle='#9eb0b8';g.lineWidth=2;g.beginPath();g.moveTo(x+2,y-1);g.lineTo(x+13,y+10);g.stroke();g.globalAlpha=1;
    }
    g.restore();
  }

  // M180: civic service pulse. Public-space services now follow the city's visual day rhythm:
  // morning sanitation, daytime transit service, evening deliveries and night maintenance. The
  // layer is deterministic and presentation-only; service vehicles never enter Game.cars or lanes.
  function civicServicePulseState(game){
    const r=cityRhythmState(game),id=r.district,weather=r.weather,phase=r.phase;
    let service='transit';
    if(phase==='morning')service=id==='park'||id==='oldtown'?'sanitation':'commute';
    else if(phase==='day')service=id==='harbor'||id==='airport'?'freight':id==='tech'?'delivery':'transit';
    else if(phase==='evening')service=id==='downtown'||id==='night'?'delivery':'cleanup';
    else service=id==='winter'?'snowplow':'maintenance';
    if(weather==='snow')service='snowplow';else if(weather==='rain'&&phase==='night')service='drainage';
    const activity=Math.max(.12,Math.min(1,r.service*.72+r.commute*.28+r.commerce*.18+(r.trafficLoad>.65?.12:0)));
    return {service,activity,phase,weather,district:id};
  }

  function drawCivicServicePulse(g,game){
    if(reducedMotion||RenderQuality.level===0||isLinkedJunctionType(game.config?.junctionType))return;
    const s=civicServicePulseState(game),t=Math.max(0,game.elapsed||0),high=RenderQuality.level>=2;
    g.save();g.lineCap='round';g.lineJoin='round';g.globalAlpha=.38+.42*s.activity;
    // A compact municipal/service vehicle loops only through deep outer-block service space.
    const u=((t*(10+7*s.activity)+game.level*11)%180)/180,x=66+u*118,y=s.district==='harbor'||s.district==='airport'?704:154;
    g.fillStyle='rgba(20,38,48,.18)';g.beginPath();g.ellipse(x+2,y+10,18,4.5,0,0,Math.PI*2);g.fill();
    const body=s.service==='snowplow'?'#8fc6da':s.service==='drainage'?'#65a9c7':s.service==='delivery'?'#7bd6b3':s.service==='freight'?'#d5a05c':'#e2b95f';
    g.fillStyle=body;roundRect(g,x-13,y-7,27,14,4,true);g.fillStyle='#536d76';roundRect(g,x+7,y-4,10,9,3,true);
    g.fillStyle='#31464f';for(const wx of [x-7,x+10]){g.beginPath();g.arc(wx,y+8,3.8,0,Math.PI*2);g.fill();}
    if(s.service==='sanitation'||s.service==='cleanup'){g.strokeStyle='rgba(219,235,232,.58)';g.lineWidth=2;for(let i=0;i<3;i++){g.beginPath();g.moveTo(x-19-i*5,y+8);g.lineTo(x-24-i*5,y+12);g.stroke();}}
    if(s.service==='snowplow'){g.fillStyle='#dceff6';g.beginPath();g.moveTo(x+18,y+3);g.lineTo(x+30,y+8);g.lineTo(x+18,y+11);g.closePath();g.fill();}
    if(s.service==='drainage'){g.strokeStyle='rgba(130,205,235,.60)';g.lineWidth=2;g.beginPath();g.arc(x-22,y+13,7,0,Math.PI);g.stroke();}
    if((s.service==='transit'||s.service==='commute')&&high){g.fillStyle='rgba(85,213,255,.72)';g.beginPath();g.arc(x+14,y-6,2.5,0,Math.PI*2);g.fill();}
    // Service points acknowledge the current duty without adding HUD text or gameplay markers.
    if(high){const pts=s.district==='harbor'?[[742,718],[790,718]]:[[92,188],[144,188]];g.globalAlpha=.18+.28*s.activity;g.fillStyle=body;for(const [px,py] of pts)roundRect(g,px-9,py-3,18,6,3,true);}
    g.restore();
  }


  // M181: transit stop lifecycle. Decorative shelters now cycle through approaching, boarding,
  // departing and quiet states based on the existing visual day rhythm and traffic pressure.
  // This is presentation-only: no decorative passenger or transit marker enters Game.cars,
  // consumes road capacity, changes signals, spawning, collisions, score, save data or RNG.
  function transitStopPulseState(game){
    const r=cityRhythmState(game),id=r.district,t=Math.max(0,Number(game?.elapsed)||0);
    const period=18+((Number(game?.level)||1)%4)*2,cycle=((t+(Number(game?.level)||1)*3.7)%period)/period;
    let stage='quiet';
    if(cycle<.22)stage='approaching';else if(cycle<.48)stage='boarding';else if(cycle<.68)stage='departing';
    const base=r.phase==='night'?.18:r.phase==='morning'?.78:r.phase==='evening'?.88:.58;
    const demand=Math.max(.08,Math.min(1,base*.72+r.commute*.46+r.trafficLoad*.10));
    const weatherPenalty=r.weather==='snow'?.20:r.weather==='rain'?.12:r.weather==='fog'?.06:0;
    const passengers=Math.max(0,Math.round((RenderQuality.level>=2?5:3)*Math.max(.10,demand-weatherPenalty)));
    return {stage,cycle,demand,passengers,phase:r.phase,weather:r.weather,district:id};
  }

  function drawTransitStopPulse(g,game){
    if(reducedMotion||RenderQuality.level===0||isLinkedJunctionType(game.config?.junctionType))return;
    const s=transitStopPulseState(game),t=Math.max(0,game.elapsed||0),high=RenderQuality.level>=2;
    // Two safe decorative shelter zones remain inside outer blocks and never overlap crossings.
    const stops=s.district==='airport'||s.district==='tech'?[[704,214,1],[112,704,-1]]:[[112,214,1],[704,704,-1]];
    g.save();g.lineCap='round';g.lineJoin='round';
    for(let k=0;k<(high?2:1);k++){
      const [sx,sy,dir]=stops[k],a=.30+.48*s.demand;
      // Shelter / arrival lamp.
      g.globalAlpha=a;g.strokeStyle='rgba(92,126,139,.78)';g.lineWidth=3;g.beginPath();g.moveTo(sx-20,sy+12);g.lineTo(sx-20,sy-20);g.lineTo(sx+18,sy-20);g.stroke();
      g.fillStyle='rgba(116,174,193,.18)';roundRect(g,sx-17,sy-17,32,24,3,true);
      const lamp=s.stage==='approaching'||s.stage==='boarding';g.globalAlpha=lamp?.88:.28;g.fillStyle=lamp?'#78e4ff':'#78909a';g.beginPath();g.arc(sx-25,sy-16,3.5,0,Math.PI*2);g.fill();
      // Waiting/boarding figures. During boarding they move toward the curb-side shelter edge,
      // but stay well outside the canonical road corridor.
      const n=s.stage==='quiet'?Math.max(1,Math.floor(s.passengers*.45)):s.passengers;
      for(let i=0;i<n;i++){
        const q=s.stage==='boarding'?Math.min(1,.25+s.cycle*1.6):0,x=sx-10+i*7+dir*q*5,y=sy+5+(i%2)*2,bob=Math.sin(t*2+i*.8)*.5;
        g.globalAlpha=.36+.46*s.demand;g.fillStyle=['#e6bd9d','#d9a985','#f0c9a7'][i%3];g.beginPath();g.arc(x,y-8+bob,2.7,0,Math.PI*2);g.fill();g.strokeStyle=['#587886','#7d697d','#587066'][i%3];g.lineWidth=3;g.beginPath();g.moveTo(x,y-4+bob);g.lineTo(x,y+5+bob);g.stroke();
      }
      // A tiny route panel communicates the lifecycle visually without adding HUD text.
      g.globalAlpha=.18+.42*s.demand;g.fillStyle=s.stage==='departing'?'#a9dcae':'#d6c77c';roundRect(g,sx+20,sy-17,11,7,2,true);
    }
    g.restore();
  }


  // M182: storefront delivery lifecycle. Small couriers and loading activity give commercial
  // blocks a working-day cadence without entering the road simulation. All actors remain inside
  // outer-block service space and are derived only from visual rhythm/time.
  function storefrontDeliveryState(game){
    const r=cityRhythmState(game),t=Math.max(0,Number(game?.elapsed)||0),level=Math.max(1,Number(game?.level)||1);
    const period=24+(level%3)*3,cycle=((t+level*2.9)%period)/period;
    let stage='closed';
    if(cycle<.20)stage='arriving';else if(cycle<.52)stage='unloading';else if(cycle<.72)stage='departing';
    const districtBoost=['downtown','oldtown','tech','harbor','night'].includes(r.district)?.18:0;
    const phaseBoost=r.phase==='day'?.28:r.phase==='evening'?.22:r.phase==='morning'?.12:-.18;
    const weatherPenalty=r.weather==='snow'?.16:r.weather==='rain'?.08:0;
    const activity=Math.max(.06,Math.min(1,r.commerce*.62+r.service*.22+districtBoost+phaseBoost-weatherPenalty));
    const parcels=Math.max(1,Math.round((RenderQuality.level>=2?4:2)*activity));
    return {stage,cycle,activity,parcels,phase:r.phase,weather:r.weather,district:r.district};
  }

  function drawStorefrontDeliveryLifecycle(g,game){
    if(reducedMotion||RenderQuality.level===0||isLinkedJunctionType(game.config?.junctionType))return;
    const s=storefrontDeliveryState(game),t=Math.max(0,game.elapsed||0),high=RenderQuality.level>=2;
    if(s.activity<.12)return;
    const zones=s.district==='harbor'?[[744,168,-1],[748,726,-1]]:s.district==='airport'?[[126,168,1],[742,726,-1]]:[[116,168,1],[748,726,-1]];
    g.save();g.lineCap='round';g.lineJoin='round';
    for(let k=0;k<(high?2:1);k++){
      const [sx,sy,dir]=zones[k],active=s.stage!=='closed';
      // Loading-bay stripe and storefront door stay deep in the block, never on the canonical road.
      g.globalAlpha=.14+.26*s.activity;g.strokeStyle='#d7c37c';g.lineWidth=2;for(let i=0;i<3;i++){g.beginPath();g.moveTo(sx-24+i*13,sy+17);g.lineTo(sx-14+i*13,sy+17);g.stroke();}
      g.fillStyle=s.district==='night'?'#8feeff':'#ffd88e';g.globalAlpha=.16+.30*s.activity;roundRect(g,sx-18,sy-21,36,8,2,true);
      if(active){
        const move=s.stage==='arriving'?Math.min(1,s.cycle/.20):s.stage==='departing'?Math.max(0,1-(s.cycle-.52)/.20):1;
        const vx=sx-dir*(36-18*move),vy=sy+5;
        g.globalAlpha=.38+.42*s.activity;g.fillStyle=s.district==='tech'?'#71d7c4':'#d8a75d';roundRect(g,vx-13,vy-7,27,14,4,true);g.fillStyle='#526c76';roundRect(g,vx+7,vy-4,9,8,2,true);
        g.fillStyle='#30454e';for(const wx of [vx-7,vx+10]){g.beginPath();g.arc(wx,vy+8,3.5,0,Math.PI*2);g.fill();}
      }
      if(s.stage==='unloading'){
        for(let i=0;i<s.parcels;i++){const px=sx-11+i*8,py=sy+8-(i%2)*7;g.globalAlpha=.42+.35*s.activity;g.fillStyle=i%2?'#b98a58':'#c99b64';roundRect(g,px,py,7,6,1,true);}
        const cx=sx+dir*(8+Math.sin(t*1.7+k)*3),cy=sy+2;g.globalAlpha=.55;g.fillStyle='#e6bd9d';g.beginPath();g.arc(cx,cy-9,2.8,0,Math.PI*2);g.fill();g.strokeStyle='#5d7882';g.lineWidth=3;g.beginPath();g.moveTo(cx,cy-5);g.lineTo(cx,cy+5);g.stroke();
      }
    }
    g.restore();
  }


  // M183: neighborhood parking turnover. Decorative curbside parking in deep outer blocks
  // now changes through arriving, parked, loading and departing states. These vehicles never
  // enter Game.cars, reserve lanes, affect collisions/signals/spawning, score, save data or RNG.
  function neighborhoodParkingState(game){
    const r=cityRhythmState(game),t=Math.max(0,Number(game?.elapsed)||0),level=Math.max(1,Number(game?.level)||1);
    const period=27+(level%4)*2,cycle=((t+level*4.1)%period)/period;
    let stage='parked';
    if(cycle<.16)stage='arriving';else if(cycle>.78)stage='departing';else if(cycle>.56&&cycle<.70)stage='loading';
    const districtBoost=['downtown','oldtown','night','tech'].includes(r.district)?.18:['park','coast'].includes(r.district)?.06:.11;
    const phaseBoost=r.phase==='night'?.24:r.phase==='evening'?.20:r.phase==='day'?.14:.08;
    const weatherPenalty=r.weather==='snow'?.16:r.weather==='rain'?.05:0;
    const occupancy=Math.max(.12,Math.min(1,.30+r.commerce*.22+r.commute*.20+districtBoost+phaseBoost-weatherPenalty));
    const spaces=Math.max(1,Math.round((RenderQuality.level>=2?4:2)*occupancy));
    return {stage,cycle,occupancy,spaces,phase:r.phase,weather:r.weather,district:r.district};
  }

  function drawNeighborhoodParkingTurnover(g,game){
    if(reducedMotion||RenderQuality.level===0||isLinkedJunctionType(game.config?.junctionType))return;
    const s=neighborhoodParkingState(game),t=Math.max(0,game.elapsed||0),high=RenderQuality.level>=2;
    const zones=s.district==='airport'?[[126,735,1],[742,142,-1]]:s.district==='harbor'?[[742,142,-1],[126,735,1]]:[[126,142,1],[742,735,-1]];
    g.save();g.lineCap='round';g.lineJoin='round';
    for(let k=0;k<(high?2:1);k++){
      const [sx,sy,dir]=zones[k];
      // Parking bays are deliberately deep inside decorative blocks, beyond sidewalks/crossings.
      g.globalAlpha=.13+.22*s.occupancy;g.strokeStyle='rgba(221,226,210,.72)';g.lineWidth=1.5;
      for(let i=0;i<4;i++){g.beginPath();g.moveTo(sx-28+i*18,sy+13);g.lineTo(sx-20+i*18,sy+13);g.stroke();}
      const n=Math.min(s.spaces,high?4:2);
      for(let i=0;i<n;i++){
        let x=sx-22+i*17,y=sy,alpha=.30+.42*s.occupancy;
        if(i===n-1&&s.stage==='arriving')x-=dir*(20-20*Math.min(1,s.cycle/.16));
        if(i===n-1&&s.stage==='departing')x+=dir*(26*Math.min(1,(s.cycle-.78)/.22));
        g.globalAlpha=alpha;g.fillStyle=['#6e9eb0','#c98567','#7fa17b','#b69a67'][(i+k+game.level)%4];roundRect(g,x-7,y-11,14,22,4,true);
        g.fillStyle='rgba(185,222,231,.62)';roundRect(g,x-5,y-6,10,7,2,true);g.fillStyle='#2f4148';g.fillRect(x-9,y-6,2,5);g.fillRect(x+7,y-6,2,5);g.fillRect(x-9,y+3,2,5);g.fillRect(x+7,y+3,2,5);
      }
      if(s.stage==='loading'&&n){
        const px=sx-22+(n-1)*17+dir*11,py=sy+4,bob=Math.sin(t*2+k)*.5;
        g.globalAlpha=.48;g.fillStyle='#e7bd9a';g.beginPath();g.arc(px,py-9+bob,2.7,0,Math.PI*2);g.fill();g.strokeStyle='#667c83';g.lineWidth=3;g.beginPath();g.moveTo(px,py-5+bob);g.lineTo(px,py+5+bob);g.stroke();
        g.fillStyle='#b88b58';roundRect(g,px+dir*6,py+1,7,6,1,true);
      }
    }
    g.restore();
  }


  // M184: building entrance lifecycle. Residents and workers now give safe outer-block entrances
  // a readable daily cadence: leaving, arriving, social pause and quiet. The layer is deterministic
  // and presentation-only; figures never enter crossings, Game.cars, routing, signals, score or save.
  function buildingEntranceActivityState(game){
    const r=cityRhythmState(game),t=Math.max(0,Number(game?.elapsed)||0),level=Math.max(1,Number(game?.level)||1);
    const period=21+(level%5)*2,cycle=((t+level*3.3)%period)/period;
    let stage='quiet';
    if(r.phase==='morning')stage=cycle<.68?'leaving':'quiet';
    else if(r.phase==='day')stage=cycle<.46?'arriving':cycle<.72?'social':'quiet';
    else if(r.phase==='evening')stage=cycle<.64?'arriving':'social';
    else stage=cycle<.22?'arriving':'quiet';
    const districtBoost=['downtown','oldtown','tech','night'].includes(r.district)?.18:['park','coast'].includes(r.district)?.10:.13;
    const weatherPenalty=r.weather==='snow'?.20:r.weather==='rain'?.12:r.weather==='fog'?.05:0;
    const activity=Math.max(.08,Math.min(1,.24+r.commerce*.24+r.commute*.28+districtBoost-weatherPenalty));
    const people=Math.max(1,Math.round((RenderQuality.level>=2?5:3)*activity));
    return {stage,cycle,activity,people,phase:r.phase,weather:r.weather,district:r.district};
  }

  function drawBuildingEntranceActivity(g,game){
    if(reducedMotion||RenderQuality.level===0||isLinkedJunctionType(game.config?.junctionType))return;
    const s=buildingEntranceActivityState(game),t=Math.max(0,game.elapsed||0),high=RenderQuality.level>=2;
    const entrances=s.district==='harbor'||s.district==='airport'?[[758,174,-1],[142,724,1]]:[[142,174,1],[758,724,-1]];
    g.save();g.lineCap='round';g.lineJoin='round';
    for(let k=0;k<(high?2:1);k++){
      const [ex,ey,dir]=entrances[k],open=s.stage!=='quiet';
      // Entrance light and threshold remain deep inside the decorative building block.
      g.globalAlpha=.16+.32*s.activity;g.fillStyle=open?'#ffd79a':'#78909a';roundRect(g,ex-10,ey-18,20,5,2,true);
      g.fillStyle='rgba(72,88,94,.28)';roundRect(g,ex-13,ey-11,26,20,3,true);
      const n=s.stage==='quiet'?1:s.people;
      for(let i=0;i<n;i++){
        const spread=(i-(n-1)/2)*7,progress=Math.min(1,(s.cycle%0.5)*2),motion=s.stage==='leaving'?progress:s.stage==='arriving'?1-progress:.45;
        const x=ex+spread+dir*motion*16,y=ey+13+(i%2)*2,bob=Math.sin(t*2.1+i*.8+k)*.45;
        g.globalAlpha=.30+.48*s.activity;g.fillStyle=['#edc6a6','#d8a985','#f0cdb1'][i%3];g.beginPath();g.arc(x,y-8+bob,2.7,0,Math.PI*2);g.fill();
        g.strokeStyle=['#5b7884','#7a687b','#607269'][i%3];g.lineWidth=3;g.beginPath();g.moveTo(x,y-4+bob);g.lineTo(x,y+5+bob);g.stroke();
      }
      if(s.stage==='social'&&high){g.globalAlpha=.26+.30*s.activity;g.fillStyle='#d6b77c';roundRect(g,ex+dir*20,ey+14,10,5,2,true);}
    }
    g.restore();
  }


  // M185: public-space leisure lifecycle. Parks, plazas and waterfront corners now gain a
  // deterministic daily cadence of strolling, resting, exercise and quiet periods. Everything
  // remains deep in decorative outer blocks and never participates in traffic simulation.
  function publicSpaceLeisureState(game){
    const r=cityRhythmState(game),t=Math.max(0,Number(game?.elapsed)||0),level=Math.max(1,Number(game?.level)||1);
    const period=26+(level%4)*3,cycle=((t+level*2.7)%period)/period;
    let stage='quiet';
    if(r.phase==='morning')stage=cycle<.46?'exercise':cycle<.78?'stroll':'rest';
    else if(r.phase==='day')stage=cycle<.38?'stroll':cycle<.76?'rest':'social';
    else if(r.phase==='evening')stage=cycle<.52?'social':cycle<.82?'stroll':'rest';
    else stage=cycle<.20&&['night','downtown','coast'].includes(r.district)?'stroll':'quiet';
    const districtBoost=r.district==='park'?.28:r.district==='coast'?.22:['oldtown','downtown'].includes(r.district)?.16:.08;
    const weatherPenalty=r.weather==='snow'?.26:r.weather==='rain'?.22:r.weather==='fog'?.08:0;
    const activity=Math.max(.04,Math.min(1,.20+r.commerce*.14+r.commute*.10+districtBoost-weatherPenalty));
    const people=stage==='quiet'?0:Math.max(1,Math.round((RenderQuality.level>=2?5:3)*activity));
    return {stage,cycle,activity,people,phase:r.phase,weather:r.weather,district:r.district};
  }

  function drawPublicSpaceLeisure(g,game){
    if(reducedMotion||RenderQuality.level===0||isLinkedJunctionType(game.config?.junctionType))return;
    const s=publicSpaceLeisureState(game);if(s.stage==='quiet'||s.people<=0)return;
    const t=Math.max(0,game.elapsed||0),high=RenderQuality.level>=2;
    const zones=s.district==='park'?[[118,692,1],[782,204,-1]]:s.district==='coast'?[[116,196,1],[784,704,-1]]:[[118,704,1],[782,196,-1]];
    g.save();g.lineCap='round';g.lineJoin='round';
    for(let k=0;k<(high?2:1);k++){
      const [cx,cy,dir]=zones[k],n=Math.min(s.people,high?5:3);
      // Bench/planter furniture anchors the leisure activity safely inside decorative blocks.
      g.globalAlpha=.18+.24*s.activity;g.fillStyle='#8d7658';roundRect(g,cx-24,cy+10,48,5,2,true);
      g.fillStyle='rgba(80,110,86,.46)';roundRect(g,cx-31,cy+15,10,7,3,true);roundRect(g,cx+21,cy+15,10,7,3,true);
      for(let i=0;i<n;i++){
        const lane=(i-(n-1)/2)*10,walk=(s.stage==='stroll'||s.stage==='exercise');
        const speed=s.stage==='exercise'?24:13,travel=walk?(((t*speed+i*23+k*17)%64)-32)*dir:lane;
        const x=cx+(walk?travel:lane),y=cy+(i%2)*3,bob=walk?Math.sin(t*(s.stage==='exercise'?6:3)+i)*.7:0;
        g.globalAlpha=.30+.46*s.activity;g.fillStyle=['#efc6a3','#d9aa88','#f0d0b3'][i%3];g.beginPath();g.arc(x,y-8+bob,2.6,0,Math.PI*2);g.fill();
        g.strokeStyle=['#527684','#7c6778','#5f7668','#8a704f'][i%4];g.lineWidth=3;g.beginPath();g.moveTo(x,y-4+bob);g.lineTo(x,y+5+bob);g.stroke();
        if(s.stage==='rest'&&i<2){g.strokeStyle='rgba(70,79,78,.55)';g.lineWidth=1.5;g.beginPath();g.moveTo(x-4,y+6);g.lineTo(x+4,y+6);g.stroke();}
      }
      if(s.stage==='social'&&high){g.globalAlpha=.24+.25*s.activity;g.fillStyle='#c8a96d';g.beginPath();g.arc(cx+dir*28,cy+14,5,0,Math.PI*2);g.fill();}
    }
    g.restore();
  }


  // M186: cafe terrace lifecycle. Outdoor tables in safe decorative plazas now follow a
  // deterministic opening, serving, dining, clearing and closed cadence. Weather and daily
  // rhythm affect occupancy only; this layer never touches traffic simulation, score or save.
  function cafeTerraceLifecycleState(game){
    const r=cityRhythmState(game),t=Math.max(0,Number(game?.elapsed)||0),level=Math.max(1,Number(game?.level)||1);
    const period=31+(level%5)*2,cycle=((t+level*2.35)%period)/period;
    let stage='closed';
    if(r.phase==='morning')stage=cycle<.18?'opening':cycle<.70?'serving':'clearing';
    else if(r.phase==='day')stage=cycle<.12?'opening':cycle<.76?'dining':'clearing';
    else if(r.phase==='evening')stage=cycle<.68?'dining':cycle<.88?'clearing':'closed';
    else stage=['night','downtown','oldtown'].includes(r.district)&&cycle<.34?'dining':'closed';
    const districtBoost=['oldtown','coast','downtown','night'].includes(r.district)?.24:r.district==='park'?.16:.08;
    const weatherPenalty=r.weather==='snow'?.52:r.weather==='rain'?.42:r.weather==='fog'?.10:0;
    const activity=Math.max(0,Math.min(1,.18+r.commerce*.34+districtBoost-weatherPenalty));
    if(activity<.12)stage='closed';
    const tables=stage==='closed'?0:Math.max(1,Math.round((RenderQuality.level>=2?3:2)*activity));
    const guests=stage==='dining'||stage==='serving'?Math.max(1,Math.round((RenderQuality.level>=2?6:3)*activity)):0;
    return {stage,cycle,activity,tables,guests,phase:r.phase,weather:r.weather,district:r.district};
  }

  function drawCafeTerraceLifecycle(g,game){
    if(reducedMotion||RenderQuality.level===0||isLinkedJunctionType(game.config?.junctionType))return;
    const s=cafeTerraceLifecycleState(game);if(s.stage==='closed'||s.tables<=0)return;
    const t=Math.max(0,game.elapsed||0),high=RenderQuality.level>=2;
    const zones=s.district==='coast'?[[116,236,1],[784,664,-1]]:s.district==='oldtown'?[[116,664,1],[784,236,-1]]:[[116,236,1],[784,664,-1]];
    g.save();g.lineCap='round';g.lineJoin='round';
    for(let k=0;k<(high?2:1);k++){
      const [cx,cy,dir]=zones[k],n=Math.min(s.tables,high?3:2);
      // Terrace awning and furniture stay deep inside decorative blocks, away from crossings.
      g.globalAlpha=.16+.30*s.activity;g.fillStyle=s.district==='night'?'#8edbe8':'#d6a45e';roundRect(g,cx-27,cy-22,54,6,2,true);
      for(let i=0;i<n;i++){
        const tx=cx+(i-(n-1)/2)*19,ty=cy+5;
        g.globalAlpha=.30+.42*s.activity;g.fillStyle='#a77c52';g.beginPath();g.arc(tx,ty,5,0,Math.PI*2);g.fill();
        g.strokeStyle='#6c5948';g.lineWidth=1.5;g.beginPath();g.moveTo(tx,ty+4);g.lineTo(tx,ty+11);g.stroke();
        if((s.stage==='dining'||s.stage==='serving')&&i<s.guests){
          for(let q=0;q<2;q++){const px=tx+(q?8:-8),py=ty+(q?3:-2),bob=Math.sin(t*1.7+i+q+k)*.35;g.globalAlpha=.36+.42*s.activity;g.fillStyle=q?'#edc7a8':'#d9ad8b';g.beginPath();g.arc(px,py-7+bob,2.5,0,Math.PI*2);g.fill();g.strokeStyle=q?'#647d87':'#806d78';g.lineWidth=2.6;g.beginPath();g.moveTo(px,py-3+bob);g.lineTo(px,py+4+bob);g.stroke();}
        }
        if(s.stage==='clearing'){g.globalAlpha=.38;g.fillStyle='#d9d1b4';roundRect(g,tx-3,ty-3,6,4,1,true);}
      }
      if(s.stage==='serving'){
        const wx=cx+dir*(29+Math.sin(t*1.8+k)*4),wy=cy+7;g.globalAlpha=.52;g.fillStyle='#e8c09f';g.beginPath();g.arc(wx,wy-8,2.6,0,Math.PI*2);g.fill();g.strokeStyle='#526f77';g.lineWidth=3;g.beginPath();g.moveTo(wx,wy-4);g.lineTo(wx,wy+5);g.stroke();g.fillStyle='#c9b48a';roundRect(g,wx+dir*4,wy-2,7,3,1,true);
      }
    }
    g.restore();
  }

  // M187: neighborhood street-market lifecycle. Small produce/craft stalls in safe outer plazas
  // now cycle through setup, trading, busy, packing and closed states. The layer reads daily rhythm,
  // district and weather only; it never enters traffic lanes or mutates simulation, score or save.
  function streetMarketLifecycleState(game){
    const r=cityRhythmState(game),t=Math.max(0,Number(game?.elapsed)||0),level=Math.max(1,Number(game?.level)||1);
    const period=37+(level%4)*3,cycle=((t+level*1.9)%period)/period;
    let stage='closed';
    if(r.phase==='morning')stage=cycle<.18?'setup':cycle<.72?'trading':'packing';
    else if(r.phase==='day')stage=cycle<.12?'setup':cycle<.70?'busy':cycle<.90?'trading':'packing';
    else if(r.phase==='evening')stage=cycle<.48?'trading':cycle<.78?'packing':'closed';
    const districtBoost=['oldtown','park','coast'].includes(r.district)?.28:['downtown','harbor'].includes(r.district)?.14:.06;
    const weatherPenalty=r.weather==='snow'?.48:r.weather==='rain'?.38:r.weather==='fog'?.08:0;
    const activity=Math.max(0,Math.min(1,.16+r.commerce*.28+districtBoost-weatherPenalty));
    if(activity<.12)stage='closed';
    const stalls=stage==='closed'?0:Math.max(1,Math.round((RenderQuality.level>=2?3:2)*activity));
    const shoppers=(stage==='trading'||stage==='busy')?Math.max(1,Math.round((RenderQuality.level>=2?7:4)*activity*(stage==='busy'?1.18:1))):0;
    return {stage,cycle,activity,stalls,shoppers,phase:r.phase,weather:r.weather,district:r.district};
  }

  function drawStreetMarketLifecycle(g,game){
    if(reducedMotion||RenderQuality.level===0||isLinkedJunctionType(game.config?.junctionType))return;
    const s=streetMarketLifecycleState(game);if(s.stage==='closed'||s.stalls<=0)return;
    const t=Math.max(0,game.elapsed||0),high=RenderQuality.level>=2;
    const zones=s.district==='oldtown'?[[126,628,1],[774,272,-1]]:s.district==='coast'?[[126,272,1],[774,628,-1]]:[[126,628,1],[774,272,-1]];
    g.save();g.lineCap='round';g.lineJoin='round';
    for(let k=0;k<(high?2:1);k++){
      const [cx,cy,dir]=zones[k],n=Math.min(s.stalls,high?3:2);
      for(let i=0;i<n;i++){
        const x=cx+(i-(n-1)/2)*23,y=cy;
        g.globalAlpha=.28+.42*s.activity;g.fillStyle=['#d56f58','#e1b75f','#6e9c79'][(i+k)%3];
        g.beginPath();g.moveTo(x-10,y-13);g.lineTo(x+10,y-13);g.lineTo(x+7,y-5);g.lineTo(x-7,y-5);g.closePath();g.fill();
        g.fillStyle='#9a7650';roundRect(g,x-9,y-4,18,9,2,true);g.fillStyle='#d6b36d';g.fillRect(x-6,y-1,4,3);g.fillStyle='#78995f';g.fillRect(x+2,y-1,4,3);
        if(s.stage==='setup'||s.stage==='packing'){g.globalAlpha=.34;g.fillStyle='#9b7650';roundRect(g,x+dir*11,y+4,7,6,1,true);}
      }
      if(s.shoppers){
        const count=Math.min(s.shoppers,high?7:4);
        for(let q=0;q<count;q++){
          const px=cx-25+(q%4)*16+Math.sin(t*.9+q+k)*2,py=cy+17+Math.floor(q/4)*8,bob=Math.sin(t*2+q)*.35;
          g.globalAlpha=.30+.42*s.activity;g.fillStyle=['#efc7a7','#d9ad8b','#f0d1b4'][q%3];g.beginPath();g.arc(px,py-7+bob,2.4,0,Math.PI*2);g.fill();
          g.strokeStyle=['#5d7882','#7b6879','#627568'][q%3];g.lineWidth=2.6;g.beginPath();g.moveTo(px,py-3+bob);g.lineTo(px,py+4+bob);g.stroke();
        }
      }
    }
    g.restore();
  }


  // M188: neighborhood construction-site lifecycle. Safe outer-block sites now progress through
  // surveying, active work, delivery, finishing and idle states. This is deterministic presentation
  // only: cranes, workers and materials never enter traffic lanes or mutate gameplay/save state.
  function constructionSiteLifecycleState(game){
    const r=cityRhythmState(game),t=Math.max(0,Number(game?.elapsed)||0),level=Math.max(1,Number(game?.level)||1);
    const period=43+(level%5)*3,cycle=((t+level*2.15)%period)/period;
    let stage='idle';
    if(r.phase==='morning')stage=cycle<.16?'surveying':cycle<.72?'active':'delivery';
    else if(r.phase==='day')stage=cycle<.62?'active':cycle<.82?'delivery':'finishing';
    else if(r.phase==='evening')stage=cycle<.34?'finishing':'idle';
    const districtBoost=['downtown','tech','harbor','airport'].includes(r.district)?.24:['oldtown','coast'].includes(r.district)?.12:.07;
    const weatherPenalty=r.weather==='snow'?.34:r.weather==='rain'?.24:r.weather==='fog'?.07:0;
    const activity=Math.max(0,Math.min(1,.18+r.commerce*.18+r.commute*.08+districtBoost-weatherPenalty));
    if(activity<.13)stage='idle';
    const workers=stage==='idle'?0:Math.max(1,Math.round((RenderQuality.level>=2?5:3)*activity));
    const materials=(stage==='active'||stage==='delivery')?Math.max(1,Math.round(3*activity)):0;
    return {stage,cycle,activity,workers,materials,phase:r.phase,weather:r.weather,district:r.district};
  }

  function drawConstructionSiteLifecycle(g,game){
    if(reducedMotion||RenderQuality.level===0||isLinkedJunctionType(game.config?.junctionType))return;
    const s=constructionSiteLifecycleState(game);if(s.stage==='idle'||s.workers<=0)return;
    const t=Math.max(0,game.elapsed||0),high=RenderQuality.level>=2;
    const zones=s.district==='downtown'?[[142,168,1],[758,732,-1]]:s.district==='harbor'?[[142,732,1],[758,168,-1]]:[[142,168,1],[758,732,-1]];
    g.save();g.lineCap='round';g.lineJoin='round';
    for(let k=0;k<(high?2:1);k++){
      const [cx,cy,dir]=zones[k];
      g.globalAlpha=.22+.36*s.activity;g.fillStyle='#d5b36b';roundRect(g,cx-34,cy-18,68,36,3,true);
      g.strokeStyle='#8b744b';g.lineWidth=2;g.strokeRect(cx-31,cy-15,62,30);
      // Compact crane silhouette remains deep in the decorative block.
      g.strokeStyle='#d29b45';g.lineWidth=3;g.beginPath();g.moveTo(cx-23,cy+12);g.lineTo(cx-23,cy-32);g.lineTo(cx+25,cy-32);g.stroke();
      g.lineWidth=1.5;g.beginPath();g.moveTo(cx-23,cy-25);g.lineTo(cx+13,cy-32);g.stroke();
      const hookX=cx+10+Math.sin(t*.55+k)*7;g.beginPath();g.moveTo(hookX,cy-32);g.lineTo(hookX,cy-12);g.stroke();
      if(s.materials){for(let i=0;i<Math.min(3,s.materials);i++){g.fillStyle=i%2?'#a97955':'#8b8f83';roundRect(g,cx-16+i*13,cy+3,10,7,1,true);}}
      for(let i=0;i<Math.min(s.workers,high?5:3);i++){const px=cx-24+i*12,py=cy+22+Math.sin(t*1.4+i)*.5;g.fillStyle='#f0c58f';g.beginPath();g.arc(px,py-7,2.3,0,Math.PI*2);g.fill();g.fillStyle='#e2a83f';g.fillRect(px-2.8,py-10,5.6,1.8);g.strokeStyle=i%2?'#5f7180':'#746a5f';g.lineWidth=2.5;g.beginPath();g.moveTo(px,py-3);g.lineTo(px,py+4);g.stroke();}
      if(s.stage==='delivery'){g.globalAlpha=.38+.30*s.activity;g.fillStyle='#b88955';roundRect(g,cx+dir*38,cy+5,20,11,2,true);}
      if(s.stage==='finishing'){g.globalAlpha=.32;g.fillStyle='#79a27a';g.fillRect(cx-28,cy+14,56,3);}
    }
    g.restore();
  }


  // M189: building occupancy rhythm. Window light, blinds and tiny balcony/office silhouettes
  // make the surrounding blocks visibly wake, work and settle through the day. Deterministic
  // presentation only: no gameplay actor, path, signal, spawn RNG, score or save state is touched.
  function buildingOccupancyRhythmState(game){
    const r=cityRhythmState(game),level=Math.max(1,Number(game?.level)||1),t=Math.max(0,Number(game?.elapsed)||0);
    const phaseBase=r.phase==='morning'?.48:r.phase==='day'?.58:r.phase==='evening'?.86:.68;
    const districtBias=['downtown','tech','airport'].includes(r.district)?.12:['oldtown','night'].includes(r.district)?.08:0;
    const weatherBoost=r.weather==='rain'?.08:r.weather==='snow'?.11:r.weather==='fog'?.05:0;
    const occupancy=Math.max(.18,Math.min(1,phaseBase+districtBias+weatherBoost));
    const officeShare=['downtown','tech','airport','harbor'].includes(r.district)?(r.phase==='day'?.82:r.phase==='morning'?.62:r.phase==='evening'?.34:.10):(r.phase==='day'?.44:.18);
    const homeShare=Math.max(.12,Math.min(1,r.phase==='evening'?.88:r.phase==='night'?.78:r.phase==='morning'?.52:.28));
    const pulse=((t*.035+level*.071)%1);
    return {phase:r.phase,district:r.district,weather:r.weather,occupancy,officeShare,homeShare,pulse};
  }

  function drawBuildingOccupancyRhythm(g,game){
    if(RenderQuality.level===0||isLinkedJunctionType(game.config?.junctionType))return;
    const s=buildingOccupancyRhythmState(game),high=RenderQuality.level>=2;
    const blocks=[[86,92,1],[814,92,-1],[86,748,1],[814,748,-1]];
    const cols=high?4:3,rows=high?3:2;
    g.save();g.lineCap='round';
    for(let b=0;b<(high?4:2);b++){
      const [cx,cy,dir]=blocks[b],office=(b<2&&['downtown','tech','airport','harbor'].includes(s.district));
      const share=office?s.officeShare:s.homeShare;
      for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
        const seed=((game.level*17+b*13+x*7+y*11)%23)/23,lit=seed<share*s.occupancy;
        const wx=cx+dir*(x*12),wy=cy+y*13;
        g.globalAlpha=lit?.30+.38*s.occupancy:.12;
        g.fillStyle=lit?(office?'#cfe8dd':'#ffd98a'):'#60717a';roundRect(g,wx-4,wy-4,8,7,1,true);
        if(lit&&high&&((x+y+b+game.level)%3===0)){g.globalAlpha=.22+.22*s.occupancy;g.strokeStyle='#4f5c62';g.lineWidth=1;g.beginPath();g.moveTo(wx,wy-4);g.lineTo(wx,wy+3);g.stroke();}
      }
      if(high&&!reducedMotion&&s.phase==='evening'&&((b+game.level)%2===0)){
        const px=cx+dir*8,py=cy+46;g.globalAlpha=.26+.28*s.homeShare;g.fillStyle='#efc5a2';g.beginPath();g.arc(px,py-5,2.2,0,Math.PI*2);g.fill();g.strokeStyle='#66737c';g.lineWidth=2.4;g.beginPath();g.moveTo(px,py-2);g.lineTo(px,py+5);g.stroke();
      }
    }
    g.restore();
  }


  // M190: rooftop evening life. A small deterministic presentation layer adds rooftop
  // gardens, residents and maintenance activity without creating gameplay actors or RNG.
  function rooftopLifeState(game){
    const r=cityRhythmState(game),level=Math.max(1,Number(game?.level)||1),t=Math.max(0,Number(game?.elapsed)||0);
    const phaseBase=r.phase==='morning'?.34:r.phase==='day'?.28:r.phase==='evening'?.78:.16;
    const districtBias=['downtown','tech','oldtown','coast'].includes(r.district)?.14:r.district==='night'?.20:0;
    const weatherPenalty=r.weather==='rain'?.30:r.weather==='snow'?.38:r.weather==='fog'?.10:0;
    const activity=Math.max(.04,Math.min(1,phaseBase+districtBias-weatherPenalty));
    const mode=r.weather==='rain'||r.weather==='snow'?'sheltered':r.phase==='morning'?'garden':r.phase==='day'?'maintenance':r.phase==='evening'?'social':'quiet';
    const people=Math.max(0,Math.min(5,Math.round(activity*(RenderQuality.level>=2?5:3))));
    return {phase:r.phase,district:r.district,weather:r.weather,activity,mode,people,pulse:(t*.028+level*.053)%1};
  }

  function drawRooftopLife(g,game){
    if(RenderQuality.level===0||reducedMotion||isLinkedJunctionType(game.config?.junctionType))return;
    const s=rooftopLifeState(game),high=RenderQuality.level>=2;
    const roofs=[[120,63],[748,68],[122,690],[748,692]];
    g.save();g.lineCap='round';
    for(let i=0;i<(high?4:2);i++){
      const [x,y]=roofs[i],active=((i+game.level)%4)<Math.max(1,Math.ceil(s.activity*4));
      g.globalAlpha=active?.30+.35*s.activity:.12;
      g.fillStyle='#5c7465';roundRect(g,x-25,y-9,50,18,4,true);
      g.fillStyle='#779b67';for(let k=0;k<3;k++){g.beginPath();g.arc(x-15+k*15,y-6-(k%2)*2,4,0,Math.PI*2);g.fill();}
      if(!active)continue;
      if(s.mode==='social'||s.mode==='garden'){
        for(let k=0;k<Math.min(s.people,3);k++){const px=x-14+k*14,py=y+2;g.fillStyle='#e9bf98';g.beginPath();g.arc(px,py-4,2.2,0,Math.PI*2);g.fill();g.strokeStyle='#65737a';g.lineWidth=2.2;g.beginPath();g.moveTo(px,py-1);g.lineTo(px,py+5);g.stroke();}
      } else if(s.mode==='maintenance'){
        g.strokeStyle='#d6b75f';g.lineWidth=2;g.beginPath();g.moveTo(x-12,y+3);g.lineTo(x+10,y-5);g.stroke();g.fillStyle='#c9d2d4';roundRect(g,x+7,y-7,8,6,1,true);
      } else if(s.mode==='sheltered'){
        g.fillStyle='#c8a86a';roundRect(g,x-10,y-7,20,9,2,true);g.strokeStyle='#8f7954';g.lineWidth=1.5;g.beginPath();g.moveTo(x-12,y-7);g.lineTo(x+12,y-7);g.stroke();
      }
      if(s.phase==='evening'){g.globalAlpha=.20+.28*s.activity;g.fillStyle='#ffd987';g.beginPath();g.arc(x+20,y-7,3.5,0,Math.PI*2);g.fill();}
    }
    g.restore();
  }


  // M192: neighborhood pet-walk life. Deterministic presentation-only walkers and pets
  // add morning/evening neighborhood rhythm without becoming simulation actors.
  function neighborhoodPetWalkState(game){
    const r=cityRhythmState(game),level=Math.max(1,Number(game?.level)||1),t=Math.max(0,Number(game?.elapsed)||0);
    const phaseBase=r.phase==='morning'?.72:r.phase==='day'?.30:r.phase==='evening'?.82:.12;
    const districtBias=['park','coast','oldtown'].includes(r.district)?.14:r.district==='downtown'?.05:0;
    const weatherPenalty=r.weather==='rain'?.34:r.weather==='snow'?.42:r.weather==='fog'?.08:0;
    const activity=Math.max(.03,Math.min(1,phaseBase+districtBias-weatherPenalty));
    const mode=(r.weather==='rain'||r.weather==='snow')?'quick':r.phase==='morning'?'walk':r.phase==='evening'?'social':r.phase==='day'?'stroll':'quiet';
    const pairs=Math.max(0,Math.min(4,Math.round(activity*(RenderQuality.level>=2?4:2))));
    return {phase:r.phase,district:r.district,weather:r.weather,activity,mode,pairs,pulse:(t*.036+level*.071)%1};
  }

  function drawNeighborhoodPetWalk(g,game){
    if(RenderQuality.level===0||reducedMotion||isLinkedJunctionType(game.config?.junctionType))return;
    const s=neighborhoodPetWalkState(game),high=RenderQuality.level>=2;
    const paths=[[135,244,1],[765,244,-1],[135,632,1],[765,632,-1]];
    g.save();g.lineCap='round';g.lineJoin='round';
    for(let i=0;i<Math.min(s.pairs,high?4:2);i++){
      const [bx,by,dir]=paths[i],travel=(s.pulse+i*.23)%1,px=bx+dir*(travel*44-22),py=by+((i%2)*8-4);
      g.globalAlpha=.34+.42*s.activity;
      // walker
      g.fillStyle='#e8bd98';g.beginPath();g.arc(px,py-8,2.5,0,Math.PI*2);g.fill();
      g.strokeStyle=i%2?'#657b87':'#786f68';g.lineWidth=2.6;g.beginPath();g.moveTo(px,py-5);g.lineTo(px,py+3);g.stroke();
      // leash and dog stay well inside decorative sidewalk blocks
      const dx=px+dir*9,dy=py+4;g.strokeStyle='#8b765e';g.lineWidth=1;g.beginPath();g.moveTo(px,py-2);g.lineTo(dx,dy-1);g.stroke();
      g.fillStyle=i%2?'#9b7655':'#705a49';roundRect(g,dx-3,dy-2,7,4,2,true);g.beginPath();g.arc(dx+dir*4,dy-3,2.2,0,Math.PI*2);g.fill();
      if(s.mode==='social'&&i===0&&high){g.globalAlpha=.22+.25*s.activity;g.fillStyle='#ffd987';g.beginPath();g.arc(px-dir*7,py-15,2.5,0,Math.PI*2);g.fill();}
      if(s.mode==='quick'){g.globalAlpha=.25;g.strokeStyle='#9ec4d8';g.lineWidth=1;g.beginPath();g.moveTo(px-5,py-14);g.lineTo(px+5,py-14);g.stroke();}
    }
    g.restore();
  }


  // M193: neighborhood playground life. Children and supervising adults add a compact
  // after-school/evening cadence to safe outer-block playgrounds. This is deterministic,
  // presentation-only scenery: no gameplay actors, routing, signal timing, RNG, score or save changes.
  function neighborhoodPlaygroundState(game){
    const r=cityRhythmState(game),level=Math.max(1,Number(game?.level)||1),t=Math.max(0,Number(game?.elapsed)||0);
    const phaseBase=r.phase==='morning'?.18:r.phase==='day'?.66:r.phase==='evening'?.78:.06;
    const districtBias=['park','coast','oldtown'].includes(r.district)?.16:['downtown','tech'].includes(r.district)?.06:0;
    const weatherPenalty=r.weather==='rain'?.48:r.weather==='snow'?.58:r.weather==='fog'?.10:0;
    const activity=Math.max(.02,Math.min(1,phaseBase+districtBias-weatherPenalty));
    const mode=(r.weather==='rain'||r.weather==='snow')?'weather_break':r.phase==='day'?'play':r.phase==='evening'?'family':r.phase==='morning'?'opening':'quiet';
    const children=Math.max(0,Math.min(5,Math.round(activity*(RenderQuality.level>=2?5:3))));
    const adults=children>0?Math.max(1,Math.min(2,Math.ceil(children/3))):0;
    return {phase:r.phase,district:r.district,weather:r.weather,activity,mode,children,adults,pulse:(t*.031+level*.067)%1};
  }

  function drawNeighborhoodPlayground(g,game){
    if(RenderQuality.level===0||reducedMotion||isLinkedJunctionType(game.config?.junctionType))return;
    const s=neighborhoodPlaygroundState(game),high=RenderQuality.level>=2;
    const zones=[[105,330,1],[795,570,-1]];
    g.save();g.lineCap='round';g.lineJoin='round';
    for(let i=0;i<(high?2:1);i++){
      const [cx,cy,dir]=zones[i],active=s.children>0&&s.mode!=='weather_break'&&s.mode!=='quiet';
      // Compact playground surface remains deep in decorative outer blocks, clear of crossings.
      g.globalAlpha=.16+.20*s.activity;g.fillStyle='#c8b47a';roundRect(g,cx-34,cy-20,68,40,8,true);
      g.strokeStyle='#6f806d';g.lineWidth=2;g.beginPath();g.moveTo(cx-28,cy+17);g.lineTo(cx-28,cy-14);g.lineTo(cx-5,cy-14);g.stroke();
      g.fillStyle='#d89058';roundRect(g,cx-7,cy-16,8,24,3,true);g.strokeStyle='#8a704f';g.beginPath();g.moveTo(cx-3,cy+7);g.lineTo(cx+14,cy+17);g.stroke();
      // Bench/supervision point.
      g.fillStyle='#806b55';roundRect(g,cx+15,cy-13,16,4,1,true);g.fillRect(cx+18,cy-9,2,6);g.fillRect(cx+27,cy-9,2,6);
      if(!active){
        if(s.mode==='weather_break'){g.globalAlpha=.28;g.strokeStyle='#9ec4d8';g.lineWidth=1;for(let k=0;k<3;k++){g.beginPath();g.moveTo(cx-22+k*15,cy-27);g.lineTo(cx-27+k*15,cy-19);g.stroke();}}
        continue;
      }
      const n=Math.min(s.children,high?5:3);
      for(let k=0;k<n;k++){
        const a=(s.pulse+k*.19)%1,px=cx-19+k*9+dir*Math.sin(a*Math.PI*2)*2,py=cy+4+Math.cos(a*Math.PI*2+k)*2;
        g.globalAlpha=.34+.42*s.activity;g.fillStyle='#e9bd98';g.beginPath();g.arc(px,py-6,2.1,0,Math.PI*2);g.fill();
        g.strokeStyle=['#6b86a0','#b66f68','#71916d'][k%3];g.lineWidth=2.2;g.beginPath();g.moveTo(px,py-3);g.lineTo(px,py+3);g.stroke();
      }
      for(let k=0;k<Math.min(s.adults,2);k++){
        const px=cx+20+k*8,py=cy-1;g.globalAlpha=.38+.30*s.activity;g.fillStyle='#e2b48e';g.beginPath();g.arc(px,py-8,2.4,0,Math.PI*2);g.fill();g.strokeStyle='#65777e';g.lineWidth=2.5;g.beginPath();g.moveTo(px,py-5);g.lineTo(px,py+4);g.stroke();
      }
      if(s.mode==='family'&&high){g.globalAlpha=.25+.24*s.activity;g.fillStyle='#ffd987';g.beginPath();g.arc(cx+31,cy-19,2.5,0,Math.PI*2);g.fill();}
    }
    g.restore();
  }


  // M194: pocket-park life. Tiny neighborhood green spaces gain deterministic
  // morning exercise, daytime reading and evening social cadence. Presentation only:
  // no gameplay actors, routing, traffic rules, RNG, score or persistence changes.
  function pocketParkLifeState(game){
    const r=cityRhythmState(game),level=Math.max(1,Number(game?.level)||1),t=Math.max(0,Number(game?.elapsed)||0);
    const phaseBase=r.phase==='morning'?.62:r.phase==='day'?.48:r.phase==='evening'?.72:.10;
    const districtBias=['park','coast','oldtown'].includes(r.district)?.15:['downtown','tech'].includes(r.district)?.05:0;
    const weatherPenalty=r.weather==='rain'?.40:r.weather==='snow'?.52:r.weather==='fog'?.09:0;
    const activity=Math.max(.02,Math.min(1,phaseBase+districtBias-weatherPenalty));
    const mode=(r.weather==='rain'||r.weather==='snow')?'weather_break':r.phase==='morning'?'exercise':r.phase==='day'?'reading':r.phase==='evening'?'social':'quiet';
    const visitors=Math.max(0,Math.min(5,Math.round(activity*(RenderQuality.level>=2?5:3))));
    return {phase:r.phase,district:r.district,weather:r.weather,activity,mode,visitors,pulse:(t*.024+level*.059)%1};
  }

  function drawPocketParkLife(g,game){
    if(RenderQuality.level===0||reducedMotion||isLinkedJunctionType(game.config?.junctionType))return;
    const s=pocketParkLifeState(game),high=RenderQuality.level>=2;
    const zones=[[118,174],[782,704]];
    g.save();g.lineCap='round';g.lineJoin='round';
    for(let i=0;i<(high?2:1);i++){
      const [cx,cy]=zones[i],active=s.visitors>0&&s.mode!=='weather_break'&&s.mode!=='quiet';
      // Small landscaped pocket remains deep inside decorative outer blocks.
      g.globalAlpha=.15+.18*s.activity;g.fillStyle='#78966e';roundRect(g,cx-31,cy-18,62,36,10,true);
      g.fillStyle='#52765a';for(const [ox,oy,r] of [[-22,-8,7],[20,-7,6],[-5,11,5]]){g.beginPath();g.arc(cx+ox,cy+oy,r,0,Math.PI*2);g.fill();}
      g.fillStyle='#806b55';roundRect(g,cx+5,cy+5,20,4,1,true);g.fillRect(cx+8,cy+9,2,5);g.fillRect(cx+21,cy+9,2,5);
      g.strokeStyle='#c8b58c';g.lineWidth=3;g.beginPath();g.moveTo(cx-27,cy+8);g.quadraticCurveTo(cx,cy-2,cx+28,cy-12);g.stroke();
      if(!active){
        if(s.mode==='weather_break'){g.globalAlpha=.25;g.strokeStyle='#9ec4d8';g.lineWidth=1;for(let k=0;k<3;k++){g.beginPath();g.moveTo(cx-18+k*14,cy-27);g.lineTo(cx-23+k*14,cy-19);g.stroke();}}
        continue;
      }
      const n=Math.min(s.visitors,high?5:3);
      for(let k=0;k<n;k++){
        const a=(s.pulse+k*.21)%1,px=cx-18+k*9+Math.sin(a*Math.PI*2)*2,py=cy+1+Math.cos(a*Math.PI*2+k)*2;
        g.globalAlpha=.34+.38*s.activity;g.fillStyle='#e5b994';g.beginPath();g.arc(px,py-6,2.2,0,Math.PI*2);g.fill();
        g.strokeStyle=['#66859a','#8c7167','#6f8d68'][k%3];g.lineWidth=2.3;g.beginPath();g.moveTo(px,py-3);g.lineTo(px,py+4);g.stroke();
        if(s.mode==='exercise'&&k<2){g.lineWidth=1.4;g.beginPath();g.moveTo(px,py);g.lineTo(px+(k?4:-4),py-2);g.stroke();}
      }
      if(s.mode==='reading'){g.globalAlpha=.40;g.fillStyle='#e9ddaa';roundRect(g,cx+10,cy-3,6,4,1,true);}
      if(s.mode==='social'&&high){g.globalAlpha=.22+.24*s.activity;g.fillStyle='#ffd987';g.beginPath();g.arc(cx+29,cy-18,2.5,0,Math.PI*2);g.fill();}
    }
    g.restore();
  }


  // M195: balcony life. Residential facades gain deterministic morning airing,
  // daytime plants/laundry, evening residents and night quiet. Presentation only:
  // no gameplay actors, routing, traffic rules, RNG, score or persistence changes.
  function balconyLifeState(game){
    const r=cityRhythmState(game),level=Math.max(1,Number(game?.level)||1),t=Math.max(0,Number(game?.elapsed)||0);
    const phaseBase=r.phase==='morning'?.46:r.phase==='day'?.34:r.phase==='evening'?.68:.12;
    const districtBias=['oldtown','coast','park'].includes(r.district)?.16:['downtown','night'].includes(r.district)?.07:0;
    const weatherPenalty=r.weather==='rain'?.26:r.weather==='snow'?.38:r.weather==='fog'?.05:0;
    const activity=Math.max(.02,Math.min(1,phaseBase+districtBias-weatherPenalty));
    const mode=(r.weather==='rain'||r.weather==='snow')?'sheltered':r.phase==='morning'?'airing':r.phase==='day'?'domestic':r.phase==='evening'?'social':'quiet';
    const balconies=Math.max(0,Math.min(6,Math.round(activity*(RenderQuality.level>=2?6:4))));
    return {phase:r.phase,district:r.district,weather:r.weather,activity,mode,balconies,pulse:(t*.021+level*.047)%1};
  }

  function drawBalconyLife(g,game){
    if(RenderQuality.level===0||reducedMotion||isLinkedJunctionType(game.config?.junctionType))return;
    const s=balconyLifeState(game),high=RenderQuality.level>=2,zones=[[226,126],[700,742]];
    g.save();g.lineCap='round';g.lineJoin='round';
    for(let i=0;i<(high?2:1);i++){
      const [cx,cy]=zones[i],n=Math.min(s.balconies,high?6:4);
      for(let k=0;k<n;k++){
        const col=k%3,row=Math.floor(k/3),x=cx+(col-1)*25,y=cy+row*22;
        g.globalAlpha=.24+.28*s.activity;g.fillStyle='#6d7880';roundRect(g,x-10,y-3,20,5,1,true);
        g.strokeStyle='#4d5b62';g.lineWidth=1.3;g.beginPath();g.moveTo(x-9,y-3);g.lineTo(x-9,y-10);g.moveTo(x+9,y-3);g.lineTo(x+9,y-10);g.moveTo(x-9,y-9);g.lineTo(x+9,y-9);g.stroke();
        if(s.mode==='domestic'){g.fillStyle=k%2?'#e7c46c':'#77a6bd';g.globalAlpha=.35+.28*s.activity;g.fillRect(x-7,y-8,5,3);g.fillRect(x+1,y-8,6,3);}
        if(s.mode==='airing'){g.fillStyle='#5c8f62';g.globalAlpha=.38;g.beginPath();g.arc(x+5,y-12,3,0,Math.PI*2);g.fill();}
        if(s.mode==='social'&&k<Math.max(1,n-1)){const sway=Math.sin((s.pulse+k*.17)*Math.PI*2)*1.2;g.globalAlpha=.40+.35*s.activity;g.fillStyle='#e3b48f';g.beginPath();g.arc(x+sway,y-15,2.1,0,Math.PI*2);g.fill();g.strokeStyle=k%2?'#7b6f91':'#66869a';g.lineWidth=2.2;g.beginPath();g.moveTo(x+sway,y-12);g.lineTo(x+sway,y-7);g.stroke();}
        if(s.mode==='sheltered'){g.globalAlpha=.20;g.fillStyle='#9ec4d8';g.fillRect(x-8,y-14,16,2);}
      }
    }
    g.restore();
  }

  function drawLivingCityFire(g,game){
    if(reducedMotion||RenderQuality.level<2||isLinkedJunctionType(game.config?.junctionType))return;
    if(districtInfo(game.level).id!=='oldtown'||game.level%5!==2)return;
    const t=(game.elapsed||0)-18;if(t<0||t>=29)return;
    const arrival=Math.min(1,Math.max(0,(t-2)/4)),spray=Math.min(1,Math.max(0,(t-8)/3));
    const fade=Math.min(1,Math.max(0,(t-17)/9)),flame=Math.max(0,1-fade);
    const truckX=805-110*arrival;
    g.save();g.globalAlpha=Math.min(1,t/2,(29-t)/2);
    // Everything fits the upper-right block even with three traffic lanes.
    g.fillStyle='rgba(27,32,45,.25)';roundRect(g,681,118,102,111,7,true);
    g.fillStyle='#d9b496';roundRect(g,675,111,102,111,7,true);
    g.fillStyle='#77545a';g.beginPath();g.moveTo(666,112);g.lineTo(726,68);g.lineTo(785,112);g.closePath();g.fill();
    g.fillStyle='#638799';for(const x of [689,740])roundRect(g,x,132,26,31,3,true);
    g.fillStyle='#63494d';roundRect(g,714,175,25,47,3,true);
    if(flame>0){
      g.globalAlpha*=flame;
      for(let i=0;i<5;i++){
        const x=690+i*17,y=111+(i%2)*4,h=15+Math.sin(t*7+i)*5;
        g.fillStyle=i%2?'#ffc05a':'#ff784e';g.beginPath();g.moveTo(x-8,y+8);g.quadraticCurveTo(x-5,y-h,x,y-h-5);g.quadraticCurveTo(x+10,y-h*.25,x+8,y+8);g.closePath();g.fill();
      }
      g.fillStyle='rgba(67,74,81,.34)';for(let i=0;i<3;i++){g.beginPath();g.arc(700+i*28+Math.sin(t+i)*4,53-(t%4)*5,9+i*3,0,Math.PI*2);g.fill();}
      g.globalAlpha/=flame;
    }
    g.fillStyle='#d94848';roundRect(g,truckX,235,102,38,6,true);
    g.fillStyle='#e8eeee';roundRect(g,truckX+66,238,31,26,3,true);
    g.fillStyle='#8dc3d9';roundRect(g,truckX+74,241,20,11,2,true);
    g.fillStyle='#1f3544';for(const x of [truckX+19,truckX+79]){g.beginPath();g.arc(x,274,8,0,Math.PI*2);g.fill();}
    g.fillStyle='#f4d76f';g.fillRect(truckX+13,245,44,5);
    if(t>6&&t<27){g.fillStyle=Math.floor(t*5)%2?'#65baff':'#ff6669';g.fillRect(truckX+39,229,12,5);}
    if(spray>0&&t<26){
      g.strokeStyle='rgba(54,78,81,.72)';g.lineWidth=3;g.beginPath();g.moveTo(truckX+25,241);g.quadraticCurveTo(truckX-11,250,687,220);g.stroke();
      g.strokeStyle=`rgba(170,229,250,${.55*spray})`;g.lineWidth=4;g.setLineDash([8,7]);
      g.beginPath();g.moveTo(truckX+27,239);g.quadraticCurveTo(709,180,724,105);g.stroke();g.setLineDash([]);
    }
    g.restore();
  }

  function createSignalController(startPhase='H'){return{phase:startPhase==='V'?'V':'H',pendingPhase:null,transitionTimer:0,phaseElapsed:0,pedestrianHold:false};}
  function independentSignals(game=Game){return Boolean(game?.signalMode==='independent'&&game.signalControllers);}
  function signalControllerState(game=Game,junctionId=null){if(independentSignals(game)&&junctionId&&game.signalControllers?.[junctionId])return game.signalControllers[junctionId];return game;}
  function signalTransitionTimer(game=Game,junctionId=null){return Math.max(0,Number(signalControllerState(game,junctionId)?.transitionTimer||0));}
  function anySignalTransitioning(game=Game){return independentSignals(game)?Object.values(game.signalControllers||{}).some(c=>(c.transitionTimer||0)>0):(game.transitionTimer||0)>0;}
  function signalStateForAxis(axis,game,junctionId=null){
    const controller=signalControllerState(game,junctionId),timer=Math.max(0,controller?.transitionTimer||0),phase=controller?.phase||game.phase;
    if(timer<=0)return phase===axis?'green':'red';
    const total=Math.max(.001,game.config?.clearance||.82),elapsed=Math.max(0,total-timer),yellow=Math.min(.55,total*.58);
    if(elapsed<yellow)return phase===axis?'yellow':'red';
    return 'red';
  }
  // M100 common signal-authority interface. Legacy modes expose one shared controller while
  // Green Wave exposes J0/J1 independently through the same API.
  const SignalController=Object.freeze({
    create:createSignalController,
    state:signalControllerState,
    transitionTimer:signalTransitionTimer,
    isTransitioning:anySignalTransitioning,
    signalState:signalStateForAxis,
    independent:independentSignals
  });

  function drawAnimatedDistrictDetails(g,game){
    if(reducedMotion||RenderQuality.level===0)return;
    const id=districtInfo(game.level).id,t=performance.now()/1000;
    g.save();
    if(id==='coast'){
      g.strokeStyle='rgba(255,255,255,.34)';g.lineWidth=3;
      for(let j=0;j<3;j++){g.beginPath();for(let x=32;x<285;x+=14){const y=72+j*38+Math.sin(x*.055+t*1.8+j)*5; if(x===32)g.moveTo(x,y);else g.lineTo(x,y);}g.stroke();}
      g.fillStyle='rgba(255,255,255,.62)';for(let i=0;i<3;i++){const bx=68+i*72+Math.sin(t*.7+i)*10,by=42+i*21;g.beginPath();g.arc(bx-5,by,5,Math.PI,Math.PI*2);g.arc(bx+5,by,5,Math.PI,Math.PI*2);g.fill();}
    } else if(id==='airport'){
      const x=40+((t*46)%820),y=95+Math.sin(t*.8)*10;
      g.translate(x,y);g.fillStyle='rgba(235,246,255,.56)';g.beginPath();g.moveTo(-34,0);g.lineTo(12,-5);g.lineTo(30,0);g.lineTo(12,5);g.closePath();g.fill();g.fillRect(-6,-18,8,36);g.fillStyle='rgba(85,213,255,.7)';g.beginPath();g.arc(-30,0,3,0,Math.PI*2);g.fill();
    } else if(id==='harbor'){
      const bx=70+((t*28)%190),by=255+Math.sin(t*1.2)*3;g.translate(bx,by);g.fillStyle='rgba(25,48,64,.75)';roundRect(g,-28,-7,56,14,5,true);g.fillStyle='#f2c65e';roundRect(g,-8,-18,24,10,3,true);g.strokeStyle='rgba(255,255,255,.28)';g.lineWidth=2;g.beginPath();g.moveTo(-40,10);g.quadraticCurveTo(0,18,42,10);g.stroke();
    } else if(id==='downtown'||id==='night'){
      const neon=id==='night'?['#55d5ff','#b56cff','#ff5fb2']:['#55d5ff','#ff7c8a','#ffd166'];
      g.globalAlpha=.18+.10*Math.sin(t*2.2);for(let i=0;i<3;i++){g.fillStyle=neon[i];g.shadowColor=neon[i];g.shadowBlur=18;roundRect(g,76+i*72,250+(i%2)*16,46,8,4,true);}g.shadowBlur=0;g.globalAlpha=1;
      if(id==='night'){g.fillStyle='rgba(255,237,164,.55)';for(let i=0;i<10;i++){if((Math.floor(t*2)+i)%3===0)g.fillRect(65+(i%5)*43,78+Math.floor(i/5)*52,7,7);}}
    } else if(id==='park'){
      g.fillStyle='rgba(255,242,159,.52)';for(let i=0;i<7;i++){const x=62+(i*41)%240+Math.sin(t*1.3+i)*7,y=70+((i*61)%210)+Math.cos(t*1.1+i)*5;g.beginPath();g.arc(x,y,2.2,0,Math.PI*2);g.fill();}
    }
    g.restore();
  }

  function drawLinkedWorld(g,game){
    const theme=districtInfo(game.level),lanes=game.config?.lanes||1,layout=roadLayout(lanes),w=layout.edgeMax-layout.edgeMin,half=w/2,yA=450-half,yB=450+half,centers=[230,670];
    g.drawImage(getWorldCache(theme,lanes,'double-horizontal'),0,0);drawDynamicAmbient(g,theme);drawLivingCityAmbient(g,game);
    const sharedActive=game.activeAxis(),sharedTransition=game.transitionTimer>0;
    if(!independentSignals(game)&&!sharedTransition&&sharedActive){const flowColor=sharedActive==='H'?'#55d5ff':'#56e39f';g.save();g.globalAlpha=.13;g.fillStyle=flowColor;if(sharedActive==='H')g.fillRect(0,yA,900,w);else for(const cx of centers)g.fillRect(cx-half,0,w,900);g.globalAlpha=.55;g.strokeStyle=flowColor;g.lineWidth=6;g.setLineDash([18,18]);g.beginPath();if(sharedActive==='H'){g.moveTo(14,450);g.lineTo(886,450);}else for(const cx of centers){g.moveTo(cx,14);g.lineTo(cx,886);}g.stroke();g.setLineDash([]);g.restore();}
    for(let ji=0;ji<centers.length;ji++){
      const junctionId=`J${ji}`,active=game.activeAxis(junctionId),transition=signalTransitionTimer(game,junctionId)>0,hSignal=signalStateForAxis('H',game,junctionId),vSignal=signalStateForAxis('V',game,junctionId),cx=centers[ji],left=cx-half,right=cx+half,top=yA,bottom=yB;
      if(independentSignals(game)&&!transition&&active){const flowColor=active==='H'?'#55d5ff':'#56e39f';g.save();g.globalAlpha=.12;g.fillStyle=flowColor;if(active==='H')g.fillRect(left,top,w,w);else g.fillRect(left,top,w,w);g.restore();}
      drawSignal(g,left-48,top-48,vSignal,{facing:'S',axis:'V'});drawSignal(g,right+48,bottom+48,vSignal,{facing:'N',axis:'V'});
      drawSignal(g,right+48,top-48,hSignal,{facing:'W',axis:'H'});drawSignal(g,left-48,bottom+48,hSignal,{facing:'E',axis:'H'});
      const occupied=game.cars.some(c=>c.linkedJunctionId===junctionId),color=occupied?'rgba(255,145,98,.78)':transition?'rgba(255,209,102,.68)':active==='H'?'rgba(85,213,255,.60)':'rgba(86,227,159,.60)';
      g.save();g.translate(cx,450);g.strokeStyle=color;g.lineWidth=7;const pulse=(reducedMotion||RenderQuality.level===0)?0:Math.sin(performance.now()/260+ji)*5;g.beginPath();g.arc(0,0,48+pulse,0,Math.PI*2);g.stroke();g.globalAlpha=.16;g.fillStyle=color;g.beginPath();g.arc(0,0,36,0,Math.PI*2);g.fill();g.restore();
      g.save();g.fillStyle='rgba(4,18,30,.78)';g.strokeStyle=ji?'#56e39f':'#55d5ff';g.lineWidth=2;roundRect(g,cx-16,44,32,24,9,true);roundRect(g,cx-16,44,32,24,9,false);g.fillStyle='#fff';g.font='900 12px system-ui';g.textAlign='center';g.textBaseline='middle';g.fillText(String(ji+1),cx,56);g.restore();
    }
    if(game.cars.some(c=>c.connectorBlocked)){g.save();g.fillStyle='rgba(255,145,98,.13)';roundRect(g,330,yA+8,240,w-16,16,true);g.strokeStyle='rgba(255,145,98,.82)';g.lineWidth=3;roundRect(g,330,yA+8,240,w-16,16,false);g.fillStyle='#ffe0cf';g.font='900 16px system-ui';g.textAlign='center';g.textBaseline='middle';g.fillText(T.greenWaveBlocked,450,450);g.restore();}
    drawLinkedPedestrianSignals(g,game);drawPedestrians(g,game);
    {const focus=emergencyFocusVehicle(game);game.renderEmergencyFocusId=focus?.car?.id||null;}game.cars.forEach(c=>drawCar(g,c));drawRain(g,game);drawWeatherOverlay(g,game);
    for(const p of game.particles){const alpha=Math.max(0,p.life/p.max);g.globalAlpha=alpha;g.fillStyle=p.color;if(p.kind==='confetti'||p.kind==='debris'){g.save();g.translate(p.x,p.y);g.rotate(p.rot||0);roundRect(g,-(p.size||6),-2,(p.size||6)*2,4,2,true);g.restore();}else if(p.kind==='smoke'){g.globalAlpha=alpha*.34;g.beginPath();g.arc(p.x,p.y,p.size||8,0,Math.PI*2);g.fill();}else if(p.kind==='flame'){g.shadowColor=p.color;g.shadowBlur=12;g.beginPath();g.arc(p.x,p.y,p.size||5,0,Math.PI*2);g.fill();g.shadowBlur=0;}else{g.beginPath();g.arc(p.x,p.y,p.size||4,0,Math.PI*2);g.fill();}g.globalAlpha=1;}
    if(game.crashFx){const f=game.crashFx,t=Math.max(0,f.life/f.max),e=1-t;g.save();g.globalAlpha=Math.min(.34,t*.44);g.fillStyle='#fff3c4';g.fillRect(0,0,900,900);g.globalAlpha=Math.min(1,t*1.5);g.fillStyle='#ffd166';g.shadowColor='#ff6a3d';g.shadowBlur=RenderQuality.level>=1?38:18;g.beginPath();g.arc(f.x,f.y,20+e*46,0,Math.PI*2);g.fill();g.shadowBlur=0;g.strokeStyle='rgba(255,255,255,.82)';g.lineWidth=6;g.beginPath();g.arc(f.x,f.y,28+e*72,0,Math.PI*2);g.stroke();g.restore();}
    if(game.state==='failed'&&game.crashPair){const a=carXY(game.crashPair[0]),b=carXY(game.crashPair[1]);g.font='bold 72px system-ui';g.textAlign='center';g.fillText('💥',(a.x+b.x)/2,(a.y+b.y)/2);}
  }

  function drawScenarioDecor(g,game){
    if(game.mode!=='scenario'||!game.scenarioId)return;
    const layout=roadLayout(game.config?.lanes||1),a=layout.edgeMin,b=layout.edgeMax,id=game.scenarioId;g.save();
    if(id==='after_school'){
      g.globalAlpha=.88;g.fillStyle='rgba(255,209,102,.20)';g.fillRect(0,a+18,a,44);g.fillRect(b,a+18,900-b,44);g.fillStyle='#ffd166';g.font='900 18px system-ui';g.textAlign='center';g.textBaseline='middle';g.fillText('SCHOOL',150,a+40);g.fillText('SCHOOL',750,a+40);g.strokeStyle='rgba(255,209,102,.72)';g.lineWidth=4;g.setLineDash([14,10]);g.beginPath();g.moveTo(48,a+68);g.lineTo(a-20,a+68);g.moveTo(b+20,a+68);g.lineTo(852,a+68);g.stroke();g.setLineDash([]);
    }else if(id==='green_corridor'){
      g.strokeStyle='rgba(86,227,159,.62)';g.lineWidth=7;g.setLineDash([18,15]);g.beginPath();g.moveTo(450,34);g.lineTo(450,a-26);g.moveTo(450,b+26);g.lineTo(450,866);g.moveTo(34,450);g.lineTo(a-26,450);g.moveTo(b+26,450);g.lineTo(866,450);g.stroke();g.setLineDash([]);g.fillStyle='rgba(5,28,24,.90)';g.strokeStyle='#56e39f';g.lineWidth=2;for(const [x,y] of [[108,a-46],[792,b+46]]){roundRect(g,x-40,y-15,80,30,10,true);roundRect(g,x-40,y-15,80,30,10,false);g.fillStyle='#8ff4bd';g.font='900 14px system-ui';g.textAlign='center';g.textBaseline='middle';g.fillText('EMS',x,y);g.fillStyle='rgba(5,28,24,.90)';}
    }else if(id==='stadium_exit'){
      g.fillStyle='rgba(178,140,255,.16)';roundRect(g,34,34,a-64,a-64,26,true);roundRect(g,b+30,34,900-b-64,a-64,26,true);g.strokeStyle='rgba(178,140,255,.65)';g.lineWidth=4;g.setLineDash([12,10]);g.beginPath();g.moveTo(52,a-18);g.lineTo(a-28,a-18);g.moveTo(b+28,a-18);g.lineTo(848,a-18);g.stroke();g.setLineDash([]);g.fillStyle='#e5d7ff';g.font='900 17px system-ui';g.textAlign='center';g.fillText('STADIUM EXIT',150,88);g.fillText('CROWD',750,88);
    }else if(id==='airport_priority'){
      g.strokeStyle='rgba(85,213,255,.48)';g.lineWidth=5;g.setLineDash([24,18]);g.beginPath();g.moveTo(450,30);g.lineTo(450,a-22);g.moveTo(450,b+22);g.lineTo(450,870);g.stroke();g.setLineDash([]);for(const [x,y,label] of [[120,a-44,'A1'],[780,a-44,'SERVICE']]){g.fillStyle='rgba(4,22,38,.92)';g.strokeStyle='#55d5ff';g.lineWidth=2;roundRect(g,x-44,y-15,88,30,9,true);roundRect(g,x-44,y-15,88,30,9,false);g.fillStyle='#9eeaff';g.font='900 13px system-ui';g.textAlign='center';g.textBaseline='middle';g.fillText(label,x,y);}
    }else if(id==='roadworks_detour'){
      g.fillStyle='rgba(255,138,61,.13)';g.fillRect(0,a,900,b-a);g.fillRect(a,0,b-a,900);g.fillStyle='rgba(5,18,30,.90)';g.strokeStyle='#ff9f68';g.lineWidth=2;for(const [x,y] of [[110,a-42],[790,b+42]]){roundRect(g,x-48,y-15,96,30,9,true);roundRect(g,x-48,y-15,96,30,9,false);g.fillStyle='#ffd1ad';g.font='900 13px system-ui';g.textAlign='center';g.textBaseline='middle';g.fillText('DETOUR',x,y);g.fillStyle='rgba(5,18,30,.90)';}
    }else if(id==='freight_port'){
      g.fillStyle='rgba(255,209,102,.12)';g.fillRect(0,a+8,a-18,34);g.fillRect(b+18,b-42,900-b-18,34);g.fillStyle='#ffd166';g.font='900 16px system-ui';g.textAlign='center';g.textBaseline='middle';g.fillText('FREIGHT',150,a+25);g.fillText('PORT',750,b-25);
    }
    g.restore();
  }

  function drawWorld(g,game){
    if(isLinkedJunctionType(game.config?.junctionType))return drawLinkedWorld(g,game);
    const theme=districtInfo(game.level),layout=roadLayout(game.config?.lanes||1),roadA=layout.edgeMin,roadB=layout.edgeMax;
    g.drawImage(getWorldCache(theme,game.config?.lanes||1,game.config?.junctionType||'cross'),0,0);
    drawDynamicAmbient(g,theme);drawLivingCityAmbient(g,game);drawDistrictMicroLife(g,game);drawStreetLifeActivity(g,game);drawDistrictSignatureEvents(g,game);drawDailyCityRhythm(g,game);drawCivicServicePulse(g,game);drawTransitStopPulse(g,game);drawStorefrontDeliveryLifecycle(g,game);drawNeighborhoodParkingTurnover(g,game);drawBuildingEntranceActivity(g,game);drawPublicSpaceLeisure(g,game);drawCafeTerraceLifecycle(g,game);drawStreetMarketLifecycle(g,game);drawConstructionSiteLifecycle(g,game);drawBuildingOccupancyRhythm(g,game);drawRooftopLife(g,game);drawNeighborhoodPetWalk(g,game);drawNeighborhoodPlayground(g,game);drawPocketParkLife(g,game);drawBalconyLife(g,game);drawWeatherResponsiveCity(g,game);drawTrafficAwareCityReactions(g,game);drawLivingCityFire(g,game);drawScenarioDecor(g,game);drawCityGrowthEdge(g,game);drawDistrictIdentityMarker(g,game);
    const active=game.activeAxis(); const transition=game.transitionTimer>0;
    const occupied=game.cars.some(c=>c.inside);
    g.save();
    // brighter lane wash + edge glows for premium readability. Clip out a closed T-junction arm.
    const closedArm=junctionClosedArm(game.config?.junctionType||'cross');
    if(closedArm){const a=layout.edgeMin,b=layout.edgeMax,w=b-a;g.beginPath();if(closedArm==='W')g.rect(a,a,900-a,w);else if(closedArm==='E')g.rect(0,a,b,w);else g.rect(0,a,900,w);if(closedArm==='N')g.rect(a,a,w,900-a);else if(closedArm==='S')g.rect(a,0,w,b);else g.rect(a,0,w,900);g.clip();}
    if(!transition&&active){
      const flowColor=active==='H'?'#55d5ff':'#56e39f';
      g.globalAlpha=.15; g.fillStyle=flowColor;
      if(active==='H') g.fillRect(0,roadA,900,roadB-roadA); else g.fillRect(roadA,0,roadB-roadA,900);
      g.globalAlpha=.58; g.strokeStyle=flowColor; g.lineWidth=7; g.setLineDash([18,18]);
      g.beginPath();
      if(active==='H'){
        g.moveTo(18,450);g.lineTo(316,450);g.moveTo(584,450);g.lineTo(882,450);
        g.stroke();g.setLineDash([]);g.globalAlpha=.16;g.fillStyle=flowColor;g.fillRect(0,roadA+8,900,5);g.fillRect(0,roadB-13,900,5);
        drawPhaseChevrons(g,'H',flowColor);
      }else{
        g.moveTo(450,18);g.lineTo(450,316);g.moveTo(450,584);g.lineTo(450,882);
        g.stroke();g.setLineDash([]);g.globalAlpha=.16;g.fillStyle=flowColor;g.fillRect(roadA+8,0,5,900);g.fillRect(roadB-13,0,5,900);
        drawPhaseChevrons(g,'V',flowColor);
      }
    }
    g.restore();
    if(game.config?.busChance>0)drawBusStopMarkers(g,game.config?.junctionType||'cross');
    drawDynamicRoadIncident(g,game);
    if(game.config?.variant==='roadwork')drawRoadwork(g,game.config.closedLane);
    const hSignal=signalStateForAxis('H',game),vSignal=signalStateForAxis('V',game),sigA=roadA-48,sigB=roadB+48;
    // Each near-side signal controls the lane that reaches it on the driver's right:
    // top-left = southbound, bottom-right = northbound, top-right = westbound, bottom-left = eastbound.
    if(closedArm!=='N')drawSignal(g,sigA,sigA,vSignal,{facing:'S',axis:'V'});
    if(closedArm!=='S')drawSignal(g,sigB,sigB,vSignal,{facing:'N',axis:'V'});
    if(closedArm!=='E')drawSignal(g,sigB,sigA,hSignal,{facing:'W',axis:'H'});
    if(closedArm!=='W')drawSignal(g,sigA,sigB,hSignal,{facing:'E',axis:'H'});
    drawPedestrianSignals(g,game);
    drawSidewalkPedestrians(g,game);
    drawPedestrians(g,game);

    g.save();g.translate(450,450);
    g.strokeStyle=occupied?'rgba(255,145,98,.78)':transition?'rgba(255,209,102,.68)':active==='H'?'rgba(85,213,255,.60)':'rgba(86,227,159,.60)';g.lineWidth=8;
    const pulse=(reducedMotion||RenderQuality.level===0)?0:Math.sin(performance.now()/250)*7;
    g.beginPath();g.arc(0,0,66+pulse,0,Math.PI*2);g.stroke();
    g.globalAlpha=.2;g.beginPath();g.arc(0,0,48+pulse*.3,0,Math.PI*2);g.stroke();
    g.globalAlpha=occupied?.34:.26;g.fillStyle=g.strokeStyle;g.beginPath();g.arc(0,0,46,0,Math.PI*2);g.fill();
    g.globalAlpha=.18;g.fillStyle='#ffffff';g.beginPath();g.arc(-12,-12,17,0,Math.PI*2);g.fill();g.globalAlpha=.05;g.beginPath();g.arc(12,14,24,0,Math.PI*2);g.fill();
    g.restore();

    {const focus=emergencyFocusVehicle(game);game.renderEmergencyFocusId=focus?.car?.id||null;}game.cars.forEach(c=>drawCar(g,c));
    drawQueueBadges(g,game);
    drawRain(g,game);
    drawWeatherOverlay(g,game);
    for(const p of game.particles){
      const alpha=Math.max(0,p.life/p.max);g.globalAlpha=alpha;g.fillStyle=p.color;
      if(p.kind==='confetti'||p.kind==='debris'){g.save();g.translate(p.x,p.y);g.rotate(p.rot||0);roundRect(g,-(p.size||6),-2,(p.size||6)*2,4,2,true);g.restore();}
      else if(p.kind==='smoke'){g.globalAlpha=alpha*.34;g.beginPath();g.arc(p.x,p.y,p.size||8,0,Math.PI*2);g.fill();}
      else if(p.kind==='flame'){g.shadowColor=p.color;g.shadowBlur=12;g.beginPath();g.arc(p.x,p.y,p.size||5,0,Math.PI*2);g.fill();g.shadowBlur=0;}
      else{g.beginPath();g.arc(p.x,p.y,p.size||4,0,Math.PI*2);g.fill();}
      g.globalAlpha=1;
    }
    if(game.crashFx){const f=game.crashFx,t=Math.max(0,f.life/f.max),e=1-t;g.save();
      g.globalAlpha=Math.min(.34,t*.44);g.fillStyle='#fff3c4';g.fillRect(0,0,900,900);
      g.globalAlpha=Math.min(1,t*1.5);g.fillStyle='#ffd166';g.shadowColor='#ff6a3d';g.shadowBlur=RenderQuality.level>=1?38:18;g.beginPath();g.arc(f.x,f.y,20+e*46,0,Math.PI*2);g.fill();
      g.shadowBlur=0;g.strokeStyle='rgba(255,255,255,.82)';g.lineWidth=6;g.beginPath();g.arc(f.x,f.y,28+e*72,0,Math.PI*2);g.stroke();
      g.globalAlpha=t*.52;g.strokeStyle='rgba(255,112,63,.72)';g.lineWidth=4;g.beginPath();g.arc(f.x,f.y,44+e*112,0,Math.PI*2);g.stroke();g.restore();}
    if(game.state==='failed'&&game.crashPair){const a=carXY(game.crashPair[0]);const b=carXY(game.crashPair[1]);g.font='bold 72px system-ui';g.textAlign='center';g.fillText('💥',(a.x+b.x)/2,(a.y+b.y)/2);}
  }

  function drawFailureReplayOverlay(g,game){
    const playback=game.replayPlayback;if(!playback?.frames?.length)return;
    const elapsed=Math.max(0,performance.now()-playback.startedAt),idx=Math.min(playback.frames.length-1,Math.floor(elapsed/Math.max(60,playback.frameMs||120))),frame=playback.frames[idx];
    g.save();g.fillStyle='rgba(2,10,18,.34)';g.fillRect(0,0,900,900);
    g.fillStyle='rgba(5,18,30,.94)';g.strokeStyle='rgba(255,209,102,.55)';g.lineWidth=2;roundRect(g,315,22,270,44,14,true);roundRect(g,315,22,270,44,14,false);g.fillStyle='#ffe39a';g.font='900 17px system-ui';g.textAlign='center';g.textBaseline='middle';const remain=((playback.frames.length-1-idx)*(playback.frameMs||120)/1000).toFixed(1);g.fillText(`🎬 ${T.failureReplayPlaying} · -${remain}s`,450,44);
    const scale=renderedTrafficScale(game.config?.lanes||1);
    for(const c of frame.cars||[]){const m=vehicleBodyMetrics(c),w=m.length*scale,h=m.width*scale;g.save();g.translate(c.x,c.y);g.rotate(c.rot||0);g.globalAlpha=.96;g.fillStyle='rgba(0,0,0,.28)';roundRect(g,-w/2+5,-h/2+7,w,h,Math.min(14,h*.28),true);g.fillStyle=c.color||'#55d5ff';roundRect(g,-w/2,-h/2,w,h,Math.min(14,h*.28),true);g.strokeStyle=c.violation&&c.violation!=='none'?'#ffd166':'rgba(255,255,255,.34)';g.lineWidth=2;roundRect(g,-w/2+2,-h/2+2,w-4,h-4,Math.min(12,h*.25),false);if(['ambulance','police','fire'].includes(c.kind)){g.fillStyle='#f6fbff';roundRect(g,-8,-h*.38,16,h*.76,4,true);g.fillStyle='#ff5964';g.fillRect(-w*.12,-3,w*.24,6);}g.restore();}
    g.fillStyle='#f6fbff';for(const ped of frame.pedestrians||[]){g.beginPath();g.arc(ped.x,ped.y-5,4,0,Math.PI*2);g.fill();g.strokeStyle='#d7e6ef';g.lineWidth=2;g.beginPath();g.moveTo(ped.x,ped.y);g.lineTo(ped.x,ped.y+10);g.stroke();}
    if(idx>=playback.frames.length-1){g.fillStyle='rgba(255,89,100,.14)';g.fillRect(0,0,900,900);}g.restore();
  }

  function themeColor(id,idx){
    const themes={park:['#b1f0b0','#79d4a4'],coast:['#f3e3ac','#7dd5d0'],downtown:['#bacdfb','#7e9fd8'],airport:['#c0e2bc','#8ec9b0'],harbor:['#7fcbef','#57a1d8'],night:['#5c67a8','#202552'],oldtown:['#dcb78b','#9d6b59'],tech:['#7bd7cf','#3d8291'],winter:['#d9f1fa','#8db9d6']};
    return(themes[id]||themes.park)[idx];
  }
  function drawCrosswalk(g,x,y,dir){
    g.save();g.globalAlpha=.18;g.fillStyle='#000';for(let i=0;i<5;i++){if(dir==='h')g.fillRect(x+i*18+2,y+3,10,46);else g.fillRect(x+3,y+i*18+2,46,10);}g.globalAlpha=.62;g.fillStyle='#fff';for(let i=0;i<5;i++){if(dir==='h')g.fillRect(x+i*18,y,10,46);else g.fillRect(x,y+i*18,46,10);}g.restore();
  }
  function drawLamp(g,x,y,s=1,glow='#ffd166'){
    g.save();g.translate(x,y);g.scale(s,s);g.fillStyle='rgba(13,31,39,.18)';g.beginPath();g.ellipse(12,29,17,5,-.2,0,Math.PI*2);g.fill();g.strokeStyle='rgba(28,48,57,.72)';g.lineWidth=5;g.beginPath();g.moveTo(0,22);g.lineTo(0,-18);g.stroke();g.fillStyle='#314856';roundRect(g,-7,17,14,8,3,true);g.fillStyle=glow;g.shadowColor=glow;g.shadowBlur=10;g.beginPath();g.arc(0,-22,7,0,Math.PI*2);g.fill();g.restore();
  }
  function drawBench(g,x,y,s=1){g.save();g.translate(x,y);g.scale(s,s);g.fillStyle='rgba(16,39,43,.17)';roundRect(g,-17,19,52,12,5,true);g.fillStyle='#91603d';roundRect(g,-25,-7,50,10,4,true);roundRect(g,-23,7,46,7,3,true);g.fillStyle='#4a5960';g.fillRect(-18,14,5,12);g.fillRect(13,14,5,12);g.restore();}
  function drawFlowerBed(g,x,y,s=1){g.save();g.translate(x,y);g.scale(s,s);g.fillStyle='rgba(16,39,43,.16)';g.beginPath();g.ellipse(9,8,36,20,0,0,Math.PI*2);g.fill();g.fillStyle='#5b9c69';g.beginPath();g.ellipse(0,0,35,18,0,0,Math.PI*2);g.fill();const cs=['#ff7c8a','#ffd166','#ffffff','#a78bfa'];for(let i=0;i<8;i++){const a=i/8*Math.PI*2;g.fillStyle=cs[i%cs.length];g.beginPath();g.arc(Math.cos(a)*22,Math.sin(a)*9,4,0,Math.PI*2);g.fill();}g.restore();}
  function drawPalm(g,x,y,s=1){g.save();g.translate(x,y);g.scale(s,s);g.fillStyle='rgba(13,48,44,.17)';g.beginPath();g.ellipse(14,31,31,9,-.2,0,Math.PI*2);g.fill();g.strokeStyle='#986a42';g.lineWidth=7;g.beginPath();g.moveTo(0,24);g.quadraticCurveTo(-4,0,2,-18);g.stroke();g.strokeStyle='#3aa978';g.lineWidth=6;for(let i=0;i<5;i++){const a=-1.1+i*.55;g.beginPath();g.moveTo(2,-18);g.quadraticCurveTo(Math.cos(a)*22,-28+Math.sin(a)*14,Math.cos(a)*35,-25+Math.sin(a)*20);g.stroke();}g.restore();}
  function drawBillboard(g,x,y,w=86,h=38,color='#55d5ff'){g.save();g.fillStyle='rgba(12,28,42,.88)';roundRect(g,x,y,w,h,8,true);g.strokeStyle=color;g.lineWidth=3;roundRect(g,x+2,y+2,w-4,h-4,7,false);g.fillStyle=color;g.globalAlpha=.65;g.fillRect(x+12,y+10,w-24,5);g.fillRect(x+20,y+22,w-40,4);g.globalAlpha=1;g.fillStyle='#465763';g.fillRect(x+w*.46,y+h,5,16);g.restore();}
  function drawCrane(g,x,y,s=1){g.save();g.translate(x,y);g.scale(s,s);g.strokeStyle='#f0bf53';g.lineWidth=7;g.beginPath();g.moveTo(-18,24);g.lineTo(0,-38);g.lineTo(48,-38);g.stroke();g.lineWidth=3;g.beginPath();g.moveTo(0,-38);g.lineTo(24,20);g.moveTo(48,-38);g.lineTo(48,2);g.stroke();g.fillStyle='#f0bf53';roundRect(g,41,0,14,12,3,true);g.restore();}
  function drawRunwayBeacon(g,x,y,color='#55d5ff'){g.save();g.fillStyle=color;g.shadowColor=color;g.shadowBlur=12;g.beginPath();g.arc(x,y,5,0,Math.PI*2);g.fill();g.restore();}


  function textureRand(i,seed=1){
    const x=Math.sin((i+1)*12.9898+seed*78.233)*43758.5453; return x-Math.floor(x);
  }
  function drawMicroTexture(g,x,y,w,h,kind='grass',seed=1){
    g.save();
    const count=kind==='road'?58:kind==='roof'?24:36;
    for(let i=0;i<count;i++){
      const rx=x+textureRand(i,seed)*w, ry=y+textureRand(i+97,seed)*h;
      if(kind==='road'){
        g.fillStyle=i%3===0?'rgba(255,255,255,.025)':'rgba(0,0,0,.035)';
        const len=5+textureRand(i+31,seed)*15; g.fillRect(rx,ry,len,1.2);
      }else if(kind==='roof'){
        g.fillStyle=i%2?'rgba(255,255,255,.08)':'rgba(50,75,83,.06)';
        g.fillRect(rx,ry,2.5,2.5);
      }else{
        g.fillStyle=i%3===0?'rgba(255,255,255,.08)':'rgba(35,120,73,.08)';
        g.beginPath();g.arc(rx,ry,1.2+textureRand(i+51,seed)*1.6,0,Math.PI*2);g.fill();
      }
    }
    g.restore();
  }
  function drawRoadReflectors(g,lanes=1){
    const layout=roadLayout(lanes),a=layout.edgeMin,b=layout.edgeMax;
    g.save();g.fillStyle='rgba(221,243,255,.48)';g.shadowColor='rgba(85,213,255,.34)';g.shadowBlur=5;
    for(let i=0;i<6;i++){
      const d=60+i*42;roundRect(g,d,447,11,5,3,true);roundRect(g,900-d,447,11,5,3,true);roundRect(g,447,d,5,11,3,true);roundRect(g,447,900-d,5,11,3,true);
    }
    g.shadowBlur=0;g.fillStyle='rgba(255,255,255,.30)';roundRect(g,12,a+5,42,4,2,true);roundRect(g,846,b-9,42,4,2,true);roundRect(g,a+5,12,4,42,2,true);roundRect(g,b-9,846,4,42,2,true);g.restore();
  }
  function drawJunctionClosure(g,junctionType='cross',theme=districtInfo(Game.level),lanes=1){
    const closed=junctionClosedArm(junctionType);if(!closed)return;
    const {edgeMin:a,edgeMax:b}=roadLayout(lanes),w=b-a;
    g.save();
    const night=theme.id==='night',winter=theme.id==='winter';
    const c0=night?'#314052':winter?'#d8e8ed':'#b9cbca',c1=night?'#263543':winter?'#b9d0d8':'#98adae';
    const fill=g.createLinearGradient(0,0,900,900);fill.addColorStop(0,c0);fill.addColorStop(1,c1);g.fillStyle=fill;
    const rect=closed==='N'?[a,0,w,a]:closed==='S'?[a,b,w,900-b]:closed==='W'?[0,a,a,w]:[b,a,900-b,w];
    g.fillRect(...rect);
    // Subtle paving makes a closed arm read as pedestrian space instead of water or missing geometry.
    g.save();g.beginPath();g.rect(...rect);g.clip();g.strokeStyle=night?'rgba(190,220,232,.10)':'rgba(60,88,94,.13)';g.lineWidth=2;
    for(let q=-40;q<940;q+=28){g.beginPath();g.moveTo(q,0);g.lineTo(q,900);g.stroke();g.beginPath();g.moveTo(0,q);g.lineTo(900,q);g.stroke();}g.restore();
    // Strong curb cap where asphalt ends, plus bollards so the missing arm reads as intentional.
    g.strokeStyle='rgba(235,247,250,.72)';g.lineWidth=10;g.beginPath();
    if(closed==='N'){g.moveTo(a,a);g.lineTo(b,a);} 
    else if(closed==='S'){g.moveTo(a,b);g.lineTo(b,b);} 
    else if(closed==='W'){g.moveTo(a,a);g.lineTo(a,b);} 
    else {g.moveTo(b,a);g.lineTo(b,b);}g.stroke();
    const pts=closed==='N'?[[390,a-20],[450,a-20],[510,a-20]]:closed==='S'?[[390,b+20],[450,b+20],[510,b+20]]:closed==='W'?[[a-20,390],[a-20,450],[a-20,510]]:[[b+20,390],[b+20,450],[b+20,510]];
    for(const [x,y] of pts){g.fillStyle='rgba(22,47,57,.88)';g.beginPath();g.arc(x,y,7,0,Math.PI*2);g.fill();g.fillStyle='rgba(255,209,102,.9)';g.beginPath();g.arc(x,y-2,3,0,Math.PI*2);g.fill();}
    g.restore();
  }


  function drawRoundaboutOverlay(g,lanes=1,theme=districtInfo(Game.level)){
    const cx=450,cy=450,r=lanes>1?104:92,outer=r+37,inner=r-35;g.save();
    // Cover the legacy crossing core with a circular carriageway, then add a landscaped island.
    const road=g.createRadialGradient(cx,cy,inner,cx,cy,outer);road.addColorStop(0,'#344650');road.addColorStop(.72,'#2a3944');road.addColorStop(1,'#1e2b34');g.fillStyle=road;g.beginPath();g.arc(cx,cy,outer,0,Math.PI*2);g.fill();
    g.strokeStyle='rgba(255,255,255,.30)';g.lineWidth=2.2;g.setLineDash([13,15]);g.beginPath();g.arc(cx,cy,r,0,Math.PI*2);g.stroke();g.setLineDash([]);
    g.strokeStyle='rgba(255,209,102,.72)';g.lineWidth=3;g.beginPath();g.arc(cx,cy,inner+4,0,Math.PI*2);g.stroke();
    const island=g.createRadialGradient(cx-18,cy-22,8,cx,cy,inner-3);island.addColorStop(0,theme.id==='winter'?'#e8f2f5':'#6ea66f');island.addColorStop(1,theme.id==='night'?'#294c43':'#497c52');g.fillStyle=island;g.beginPath();g.arc(cx,cy,inner-3,0,Math.PI*2);g.fill();
    g.strokeStyle='rgba(234,246,238,.55)';g.lineWidth=5;g.beginPath();g.arc(cx,cy,inner-3,0,Math.PI*2);g.stroke();
    // Direction arrows show right-hand / counter-clockwise circulation without adding new controls.
    g.fillStyle='rgba(225,243,250,.72)';for(const a of [-.35,Math.PI/2-.35,Math.PI-.35,Math.PI*1.5-.35]){const x=cx+Math.cos(a)*r,y=cy+Math.sin(a)*r,tan=a-Math.PI/2;g.save();g.translate(x,y);g.rotate(tan);g.beginPath();g.moveTo(10,0);g.lineTo(-7,-6);g.lineTo(-3,0);g.lineTo(-7,6);g.closePath();g.fill();g.restore();}
    // Small central landmark keeps the roundabout visually distinct but cheap to render.
    g.fillStyle=theme.id==='night'?'rgba(85,213,255,.52)':'rgba(225,244,230,.55)';g.beginPath();g.arc(cx,cy,20,0,Math.PI*2);g.fill();g.fillStyle='rgba(15,48,50,.42)';g.beginPath();g.arc(cx,cy,11,0,Math.PI*2);g.fill();
    g.restore();
  }

  function drawRoadSurface(g,lanes=1){
    const layout=roadLayout(lanes),a=layout.edgeMin,b=layout.edgeMax,w=b-a;
    const roadGrad=g.createLinearGradient(0,0,900,900);roadGrad.addColorStop(0,'#3c4e5b');roadGrad.addColorStop(.42,'#2d3c47');roadGrad.addColorStop(1,'#1e2932');
    g.fillStyle=roadGrad;g.fillRect(0,a,900,w);g.fillRect(a,0,w,900);
    drawMicroTexture(g,0,a,900,w,'road',17+lanes);drawMicroTexture(g,a,0,w,900,'road',29+lanes);
    g.save();g.globalAlpha=.12;g.fillStyle='#111a21';
    for(let i=0;i<layout.lanes;i++){const d=layout.laneBase+i*layout.laneStep;g.fillRect(0,450+d-5,900,10);g.fillRect(0,450-d-5,900,10);g.fillRect(450+d-5,0,10,900);g.fillRect(450-d-5,0,10,900);}g.restore();
    // Same-direction lane separators are generated from actual lane centers so cars can never be wider than the painted lane.
    if(layout.lanes>1){g.strokeStyle='rgba(255,255,255,.52)';g.lineWidth=2.4;g.setLineDash([15,17]);
      for(let i=0;i<layout.lanes-1;i++){const d1=layout.laneBase+i*layout.laneStep,d2=layout.laneBase+(i+1)*layout.laneStep,sep=(d1+d2)/2;
        for(const sign of [-1,1]){const q=450+sign*sep;g.beginPath();g.moveTo(0,q);g.lineTo(a,q);g.moveTo(b,q);g.lineTo(900,q);g.stroke();g.beginPath();g.moveTo(q,0);g.lineTo(q,a);g.moveTo(q,b);g.lineTo(q,900);g.stroke();}}
      g.setLineDash([]);
    }
    g.strokeStyle='rgba(255,204,92,.82)';g.lineWidth=3;g.beginPath();g.moveTo(0,446);g.lineTo(a,446);g.moveTo(b,446);g.lineTo(900,446);g.moveTo(0,454);g.lineTo(a,454);g.moveTo(b,454);g.lineTo(900,454);g.moveTo(446,0);g.lineTo(446,a);g.moveTo(446,b);g.lineTo(446,900);g.moveTo(454,0);g.lineTo(454,a);g.moveTo(454,b);g.lineTo(454,900);g.stroke();
    g.fillStyle='rgba(255,255,255,.10)';g.fillRect(0,a,900,7);g.fillRect(0,b-7,900,7);g.fillRect(a,0,7,900);g.fillRect(b-7,0,7,900);
    g.fillStyle='rgba(0,0,0,.14)';g.fillRect(0,a+7,900,5);g.fillRect(0,b-12,900,5);g.fillRect(a+7,0,5,900);g.fillRect(b-12,0,5,900);
  }
  function drawSidewalkFrame(g,lanes=1){
    const {edgeMin:a,edgeMax:b}=roadLayout(lanes),sw=26,light='rgba(222,230,228,.34)',dark='rgba(70,88,94,.18)';
    g.fillStyle=light;g.fillRect(0,a-sw,a,sw);g.fillRect(b,a-sw,900-b,sw);g.fillRect(0,b,a,sw);g.fillRect(b,b,900-b,sw);g.fillRect(a-sw,0,sw,a);g.fillRect(b,0,sw,a);g.fillRect(a-sw,b,sw,900-b);g.fillRect(b,b,sw,900-b);
    g.strokeStyle=dark;g.lineWidth=1;
    for(let x=12;x<a;x+=28){g.beginPath();g.moveTo(x,a-sw);g.lineTo(x,a);g.moveTo(x,b);g.lineTo(x,b+sw);g.stroke();}
    for(let x=b+12;x<900;x+=28){g.beginPath();g.moveTo(x,a-sw);g.lineTo(x,a);g.moveTo(x,b);g.lineTo(x,b+sw);g.stroke();}
    for(let y=12;y<a;y+=28){g.beginPath();g.moveTo(a-sw,y);g.lineTo(a,y);g.moveTo(b,y);g.lineTo(b+sw,y);g.stroke();}
    for(let y=b+12;y<900;y+=28){g.beginPath();g.moveTo(a-sw,y);g.lineTo(a,y);g.moveTo(b,y);g.lineTo(b+sw,y);g.stroke();}
    g.fillStyle='rgba(0,0,0,.12)';g.fillRect(0,a-4,a,4);g.fillRect(b,a-4,900-b,4);g.fillRect(0,b,a,4);g.fillRect(b,b,900-b,4);g.fillRect(a-4,0,4,a);g.fillRect(b,0,4,a);g.fillRect(a-4,b,4,900-b);g.fillRect(b,b,4,900-b);
    g.fillStyle='rgba(245,247,235,.45)';g.fillRect(0,a-sw,a,3);g.fillRect(b,a-sw,900-b,3);g.fillRect(0,b,a,3);g.fillRect(b,b,900-b,3);
    g.fillStyle='rgba(20,39,46,.34)';g.fillRect(0,a-5,a,5);g.fillRect(b,a-5,900-b,5);g.fillRect(0,b,a,5);g.fillRect(b,b,900-b,5);
    g.fillRect(a-5,0,5,a);g.fillRect(b,0,5,a);g.fillRect(a-5,b,5,900-b);g.fillRect(b,b,5,900-b);
  }
  function drawAsphaltSheen(g,lanes=1){
    const {edgeMin:a,edgeMax:b}=roadLayout(lanes),w=b-a;g.save();const lg=g.createLinearGradient(0,a,0,b);lg.addColorStop(0,'rgba(255,255,255,.03)');lg.addColorStop(.5,'rgba(255,255,255,.008)');lg.addColorStop(1,'rgba(0,0,0,.03)');g.fillStyle=lg;g.fillRect(0,a,900,w);g.fillRect(a,0,w,900);g.restore();
  }
  function drawApproachMarkings(g,lanes=1){
    const layout=roadLayout(lanes),a=layout.edgeMin,b=layout.edgeMax,stopA=CROSSWALK_STOP_A,stopB=CROSSWALK_STOP_B;
    g.save();
    // Dark under-stroke + bright cap separates the stop line from the zebra at a glance.
    g.strokeStyle='rgba(7,18,28,.62)';g.lineWidth=12;g.beginPath();g.moveTo(stopA,454);g.lineTo(stopA,b-8);g.moveTo(stopB,a+8);g.lineTo(stopB,446);g.moveTo(a+8,stopA);g.lineTo(446,stopA);g.moveTo(454,stopB);g.lineTo(b-8,stopB);g.stroke();
    g.strokeStyle='rgba(255,255,255,.97)';g.lineWidth=6;g.beginPath();g.moveTo(stopA,454);g.lineTo(stopA,b-8);g.moveTo(stopB,a+8);g.lineTo(stopB,446);g.moveTo(a+8,stopA);g.lineTo(446,stopA);g.moveTo(454,stopB);g.lineTo(b-8,stopB);g.stroke();
    // Four zebra crossings start after a visible safety gap beyond the stop line.
    g.fillStyle='rgba(255,255,255,.70)';const stripe=10,gap=8,zebraGap=16,zebraDepth=14;
    for(let q=a+12;q<b-12;q+=stripe+gap){g.fillRect(stopA+zebraGap,q,zebraDepth,stripe);g.fillRect(stopB-zebraGap-zebraDepth,q,zebraDepth,stripe);g.fillRect(q,stopA+zebraGap,stripe,zebraDepth);g.fillRect(q,stopB-zebraGap-zebraDepth,stripe,zebraDepth);}
    g.restore();
  }
  function drawParkingBay(g,x,y,vertical=false){
    g.save();g.fillStyle='rgba(38,55,66,.34)';roundRect(g,x,y,82,54,10,true);g.strokeStyle='rgba(255,255,255,.34)';g.lineWidth=3;
    for(let i=0;i<3;i++){g.beginPath();if(vertical){g.moveTo(x+12+i*24,y+8);g.lineTo(x+12+i*24,y+46);}else{g.moveTo(x+8,y+12+i*15);g.lineTo(x+74,y+12+i*15);}g.stroke();}
    g.fillStyle='rgba(85,213,255,.18)';roundRect(g,x+8,y+8,18,10,4,true);g.restore();
  }
  function drawTree(g,x,y,s=1,night=false){
    g.save();g.translate(x,y);g.scale(s,s);g.fillStyle='rgba(15,32,31,.18)';g.beginPath();g.ellipse(13,18,25,12,-.25,0,Math.PI*2);g.fill();
    g.fillStyle='#6f5536';roundRect(g,-4,5,8,24,4,true);
    const leaf=night?'#23635d':'#45a86f',light=night?'#348978':'#65c98a';g.fillStyle=leaf;g.beginPath();g.arc(-10,0,19,0,Math.PI*2);g.arc(9,-7,21,0,Math.PI*2);g.arc(13,9,17,0,Math.PI*2);g.fill();
    g.fillStyle=light;g.globalAlpha=.55;g.beginPath();g.arc(1,-10,10,0,Math.PI*2);g.fill();g.restore();
  }
  function drawBuildingDepth(g,x,y,w,h,height=10,night=false){
    const dx=height*.68,dy=height;
    g.save();
    g.fillStyle='rgba(12,30,39,.16)';roundRect(g,x+dx+height*.7,y+dy+height*.6,w,h,12,true);
    g.fillStyle=night?'#2b385b':'#76949d';g.beginPath();g.moveTo(x+w,y);g.lineTo(x+w+dx,y+dy);g.lineTo(x+w+dx,y+h+dy);g.lineTo(x+w,y+h);g.closePath();g.fill();
    g.fillStyle=night?'#1b2948':'#506c76';g.beginPath();g.moveTo(x,y+h);g.lineTo(x+w,y+h);g.lineTo(x+w+dx,y+h+dy);g.lineTo(x+dx,y+h+dy);g.closePath();g.fill();
    // Floor bands and windows follow the two visible facades, making height legible.
    g.strokeStyle=night?'rgba(156,193,225,.25)':'rgba(24,57,68,.25)';g.lineWidth=1;
    const floors=Math.max(2,Math.floor(height/5));
    for(let i=1;i<floors;i++){
      const u=i/floors;
      g.beginPath();g.moveTo(x+w+dx*u,y+dy*u);g.lineTo(x+w+dx*u,y+h+dy*u);g.stroke();
      g.beginPath();g.moveTo(x+dx*u,y+h+dy*u);g.lineTo(x+w+dx*u,y+h+dy*u);g.stroke();
    }
    g.fillStyle=night?'rgba(255,210,125,.64)':'rgba(199,235,238,.65)';
    for(let i=0;i<Math.min(5,Math.floor(w/20));i++){
      const wx=x+8+i*(w-16)/Math.max(1,Math.min(5,Math.floor(w/20)));
      g.fillRect(wx+dx*.60,y+h+dy*.58,6,Math.max(2,dy*.15));
    }
    g.strokeStyle=night?'rgba(177,215,255,.20)':'rgba(255,255,255,.28)';g.lineWidth=1.5;
    g.beginPath();g.moveTo(x,y+h);g.lineTo(x+w,y+h);g.lineTo(x+w+dx,y+h+dy);g.stroke();
    g.restore();
  }
  function drawHighRise(g,x,y,w,h,accent='#55d5ff',night=false){
    g.save();drawBuildingDepth(g,x,y,w,h,night?28:25,night);
    const bg=g.createLinearGradient(x,y,x+w,y+h);bg.addColorStop(0,night?'#273453':'#dde8ef');bg.addColorStop(1,night?'#17243d':'#9fb7c6');g.fillStyle=bg;roundRect(g,x,y,w,h,14,true);
    g.fillStyle='rgba(255,255,255,.12)';roundRect(g,x+7,y+7,w-14,8,4,true);
    const cols=Math.max(2,Math.floor(w/22)),rows=Math.max(3,Math.floor(h/24));
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){const lit=((r*cols+c)%3)!==0;g.fillStyle=night?(lit?'#ffd77a':'#26395a'):(lit?'#c9f0fb':'#7899a9');roundRect(g,x+10+c*((w-20)/cols),y+22+r*((h-32)/rows),8,10,2,true);}
    g.strokeStyle=night?'rgba(167,210,245,.42)':'rgba(255,255,255,.53)';g.lineWidth=3;roundRect(g,x+5,y+5,w-10,h-10,10,false);
    g.fillStyle=night?'#1a2946':'#668997';roundRect(g,x+w*.36,y+h*.37,w*.28,h*.20,6,true);
    g.fillStyle=night?'#76a4bc':'#d2e8e7';for(let i=0;i<3;i++)g.fillRect(x+w*.4+i*w*.07,y+h*.40,3,h*.14);
    g.fillStyle=accent;g.globalAlpha=.65;g.fillRect(x+w-5,y+14,3,h-28);g.globalAlpha=1;g.restore();
  }
  function drawPlaza(g,x,y,w,h){
    g.save();const bg=g.createLinearGradient(x,y,x+w,y+h);bg.addColorStop(0,'#dce6dd');bg.addColorStop(1,'#bbcfc4');g.fillStyle=bg;roundRect(g,x,y,w,h,24,true);
    g.strokeStyle='rgba(60,90,92,.16)';g.lineWidth=2;for(let i=16;i<w;i+=26){g.beginPath();g.moveTo(x+i,y+8);g.lineTo(x+i,y+h-8);g.stroke();}for(let i=16;i<h;i+=26){g.beginPath();g.moveTo(x+8,y+i);g.lineTo(x+w-8,y+i);g.stroke();}
    g.fillStyle='#7bc8d7';g.beginPath();g.arc(x+w*.5,y+h*.48,28,0,Math.PI*2);g.fill();g.fillStyle='rgba(255,255,255,.55)';g.beginPath();g.arc(x+w*.44,y+h*.42,8,0,Math.PI*2);g.fill();g.restore();
  }
  function drawContainerStack(g,x,y,scale=1){
    const cs=['#db6958','#e9b44c','#4ba3c7','#5f8e5e'];g.save();g.translate(x,y);g.scale(scale,scale);
    for(let r=0;r<3;r++)for(let c=0;c<3;c++){g.fillStyle='rgba(0,0,0,.18)';g.fillRect(c*42+4,r*27+5,36,20);g.fillStyle=cs[(r*3+c)%cs.length];roundRect(g,c*42,r*27,36,20,3,true);g.strokeStyle='rgba(255,255,255,.25)';g.lineWidth=1;for(let k=1;k<4;k++){g.beginPath();g.moveTo(c*42+k*8,r*27+3);g.lineTo(c*42+k*8,r*27+17);g.stroke();}}
    g.restore();
  }
  function drawTerminal(g,x,y,w,h){
    g.save();drawBuildingDepth(g,x,y,w,h,17);const gr=g.createLinearGradient(x,y,x,y+h);gr.addColorStop(0,'#e7f2f0');gr.addColorStop(1,'#a7c9ca');g.fillStyle=gr;roundRect(g,x,y,w,h,20,true);
    g.fillStyle='#548da5';roundRect(g,x+10,y+16,w-20,32,10,true);g.fillStyle='rgba(174,234,255,.8)';for(let i=0;i<5;i++)roundRect(g,x+18+i*((w-36)/5),y+22,16,18,4,true);
    g.fillStyle='#f1c75b';g.fillRect(x+18,y+h-26,w-36,7);g.restore();
  }
  function drawBoardwalk(g,x,y,w,h){
    g.save();g.fillStyle='#d7b27a';roundRect(g,x,y,w,h,16,true);g.strokeStyle='rgba(95,63,36,.25)';g.lineWidth=2;for(let i=10;i<w;i+=14){g.beginPath();g.moveTo(x+i,y+4);g.lineTo(x+i,y+h-4);g.stroke();}g.restore();
  }
  function drawNeonStrip(g,x,y,w,color){g.save();g.strokeStyle=color;g.shadowColor=color;g.shadowBlur=14;g.lineWidth=4;g.beginPath();g.moveTo(x,y);g.lineTo(x+w,y);g.stroke();g.restore();}
  function drawDistrictDecor(g,id){
    if(id==='park'){
      drawPark(g,30,30,295,295);drawPlaza(g,615,35,245,280);drawBuildings(g,38,620,280,235);drawPark(g,635,642,230,220);
      drawTree(g,86,92,1.15);drawTree(g,154,154,.9);drawTree(g,255,82,.8);drawTree(g,697,710,1.05);drawTree(g,805,760,.8);
      drawBench(g,120,270,.9);drawFlowerBed(g,235,116,.85);drawLamp(g,302,292,.85);drawLamp(g,600,292,.85);drawParkingBay(g,228,246);drawParkingBay(g,590,602);return;
    }
    if(id==='coast'){
      const sea=g.createLinearGradient(0,0,300,300);sea.addColorStop(0,'#68d7e7');sea.addColorStop(1,'#2687bd');g.fillStyle=sea;roundRect(g,24,24,295,295,26,true);
      g.fillStyle='rgba(255,255,255,.35)';for(let i=0;i<7;i++){g.beginPath();g.arc(45+i*36,66+(i%2)*33,12,0,Math.PI*2);g.fill();}
      drawBoardwalk(g,34,250,278,54);drawPalm(g,258,236,1);drawPalm(g,186,254,.78);drawTerminal(g,620,42,236,272);drawBuildings(g,36,622,282,232);drawPark(g,636,642,224,212);drawLamp(g,602,298,.9,'#fff1b8');return;
    }
    if(id==='downtown'){
      g.fillStyle='#aebbc5';roundRect(g,24,24,300,300,24,true);roundRect(g,612,24,250,300,24,true);roundRect(g,24,612,300,250,24,true);roundRect(g,612,612,250,250,24,true);
      drawHighRise(g,46,50,94,220,'#ff7c8a');drawHighRise(g,154,78,126,196,'#55d5ff');drawHighRise(g,638,58,94,218,'#ffd166');drawHighRise(g,746,86,90,188,'#56e39f');
      drawHighRise(g,54,646,110,174,'#a78bfa');drawHighRise(g,180,630,112,194,'#55d5ff');drawHighRise(g,640,642,86,184,'#ff7c8a');drawHighRise(g,742,625,94,205,'#ffd166');
      drawBillboard(g,110,264,112,44,'#ff7c8a');drawBillboard(g,662,265,105,42,'#55d5ff');drawLamp(g,312,300,.8);drawLamp(g,588,300,.8);drawParkingBay(g,220,258);return;
    }
    if(id==='airport'){
      g.fillStyle='#82998e';roundRect(g,28,28,295,295,26,true);g.fillStyle='#414d55';roundRect(g,52,78,240,112,18,true);g.strokeStyle='rgba(255,255,255,.88)';g.lineWidth=7;g.setLineDash([26,18]);g.beginPath();g.moveTo(70,134);g.lineTo(275,134);g.stroke();g.setLineDash([]);for(let i=0;i<6;i++)drawRunwayBeacon(g,76+i*38,101,i%2?'#ffd166':'#55d5ff');
      drawTerminal(g,620,38,240,282);drawPark(g,38,624,280,232);drawTerminal(g,636,642,220,208);drawBillboard(g,650,257,115,42,'#56e39f');drawLamp(g,604,298,.82);return;
    }
    if(id==='oldtown'){
      g.fillStyle='#c7a47d';roundRect(g,24,24,300,300,24,true);roundRect(g,612,24,250,300,24,true);roundRect(g,24,612,300,250,24,true);roundRect(g,612,612,250,250,24,true);
      drawBuildings(g,40,44,268,250);drawBuildings(g,626,46,220,246);drawPlaza(g,42,628,266,218);drawPark(g,632,632,218,218);
      g.strokeStyle='rgba(98,61,47,.22)';g.lineWidth=3;for(let y of [78,116,154,192,230,268]){g.beginPath();g.moveTo(36,y);g.lineTo(312,y);g.stroke();}
      drawBench(g,110,286,.85);drawFlowerBed(g,242,660,.9);drawLamp(g,302,298,.8,'#ffd79a');drawLamp(g,600,598,.8,'#ffd79a');drawBillboard(g,652,258,112,42,'#f0b96a');return;
    }
    if(id==='tech'){
      g.fillStyle='#96c8c5';roundRect(g,24,24,300,300,26,true);roundRect(g,612,24,250,300,26,true);roundRect(g,24,612,300,250,26,true);roundRect(g,612,612,250,250,26,true);
      drawHighRise(g,50,56,112,214,'#64f1d2');drawHighRise(g,178,82,116,188,'#55d5ff');drawTerminal(g,626,46,224,260);drawBuildings(g,42,630,268,216);drawPark(g,636,636,216,216);
      drawNeonStrip(g,74,286,190,'#64f1d2');drawNeonStrip(g,650,292,166,'#55d5ff');drawBillboard(g,92,250,120,44,'#64f1d2');drawLamp(g,302,300,.8,'#64f1d2');drawLamp(g,600,600,.8,'#55d5ff');return;
    }
    if(id==='winter'){
      g.fillStyle='#dcecf2';roundRect(g,24,24,300,300,26,true);roundRect(g,612,24,250,300,26,true);roundRect(g,24,612,300,250,26,true);roundRect(g,612,612,250,250,26,true);
      drawBuildings(g,42,48,268,246);drawBuildings(g,628,50,218,242);drawPark(g,42,628,266,218);drawBuildings(g,632,634,216,214);
      g.fillStyle='rgba(255,255,255,.72)';for(const [x,y,r] of [[84,94,24],[146,142,18],[264,86,20],[690,110,24],[802,188,19],[104,724,22],[728,710,26]]){g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill();}
      drawLamp(g,302,298,.8,'#dff8ff');drawLamp(g,600,598,.8,'#dff8ff');drawBillboard(g,654,258,112,42,'#9ee7ff');return;
    }
    if(id==='night'){
      g.fillStyle='#111a37';roundRect(g,24,24,300,300,26,true);roundRect(g,612,24,250,300,26,true);roundRect(g,24,612,300,250,26,true);roundRect(g,612,612,250,250,26,true);
      drawHighRise(g,46,52,105,220,'#b56cff',true);drawHighRise(g,170,78,122,194,'#55d5ff',true);drawHighRise(g,638,56,94,220,'#ff5fb2',true);drawHighRise(g,748,90,88,184,'#55d5ff',true);
      drawHighRise(g,50,642,104,184,'#55d5ff',true);drawHighRise(g,175,625,112,205,'#b56cff',true);drawHighRise(g,640,642,92,185,'#ff5fb2',true);drawHighRise(g,748,626,88,202,'#55d5ff',true);
      drawNeonStrip(g,70,286,175,'#b56cff');drawNeonStrip(g,650,290,160,'#55d5ff');drawBillboard(g,88,250,120,44,'#b56cff');drawBillboard(g,658,245,112,44,'#55d5ff');drawLamp(g,300,300,.8,'#b56cff');drawLamp(g,600,600,.8,'#55d5ff');return;
    }
    // Harbor: industrial waterfront with containers and cranes.
    const water=g.createLinearGradient(24,24,300,300);water.addColorStop(0,'#4fa4c1');water.addColorStop(1,'#356d8e');g.fillStyle=water;roundRect(g,24,24,300,300,26,true);roundRect(g,612,612,250,250,26,true);
    drawContainerStack(g,54,72,.9);drawContainerStack(g,655,668,.72);drawTerminal(g,620,38,238,282);drawBuildings(g,36,622,282,232);drawCrane(g,262,270,.9);drawCrane(g,684,700,.75);drawLamp(g,602,298,.8);return;
  }
  function drawPark(g,x,y,w,h){
    const pg=g.createLinearGradient(x,y,x+w,y+h);pg.addColorStop(0,'#b6e8b4');pg.addColorStop(.55,'#83d39a');pg.addColorStop(1,'#69b986');g.fillStyle=pg;roundRect(g,x,y,w,h,26,true);
    g.fillStyle='rgba(255,255,255,.09)';roundRect(g,x+8,y+8,w-16,h-16,20,true);
    // winding path
    g.strokeStyle='#d7ccb0';g.lineWidth=14;g.lineCap='round';g.beginPath();g.moveTo(x+w*.08,y+h*.76);g.bezierCurveTo(x+w*.28,y+h*.58,x+w*.22,y+h*.28,x+w*.58,y+h*.18);g.stroke();
    g.strokeStyle='rgba(255,255,255,.35)';g.lineWidth=3;g.stroke();
    drawMicroTexture(g,x+8,y+8,w-16,h-16,'grass',Math.round(x+y)+57);
    for(let i=0;i<7;i++){const px=x+32+(i*67)%Math.max(80,w-60),py=y+34+((i*89)%Math.max(90,h-66));drawTree(g,px,py,.72+(i%3)*.13);}
  }
  function drawBuildings(g,x,y,w,h){
    const bg=g.createLinearGradient(x,y,x+w,y+h);bg.addColorStop(0,'#dce8e7');bg.addColorStop(1,'#aebfc1');g.fillStyle=bg;roundRect(g,x,y,w,h,24,true);
    g.fillStyle='rgba(255,255,255,.14)';roundRect(g,x+8,y+8,w-16,h-16,18,true);
    for(let i=0;i<4;i++){const bx=x+16+(i%2)*(w/2),by=y+16+Math.floor(i/2)*(h/2),bw=w/2-27,bh=h/2-27;const warm=i%2===1;const cg=g.createLinearGradient(bx,by,bx+bw,by+bh);cg.addColorStop(0,warm?'#f5d47d':'#eff7f7');cg.addColorStop(1,warm?'#d8aa55':'#b8cfd1');drawBuildingDepth(g,bx,by,bw,bh,13+i%2*5);g.fillStyle=cg;roundRect(g,bx,by,bw,bh,12,true);
      g.fillStyle='rgba(255,255,255,.22)';g.fillRect(bx+8,by+7,bw-16,4);g.fillStyle='rgba(45,79,91,.34)';for(let r=0;r<2;r++)for(let c=0;c<2;c++)roundRect(g,bx+12+c*(bw*.48),by+18+r*(bh*.38),12,10,2,true);
      g.fillStyle='rgba(55,70,75,.22)';roundRect(g,bx+bw*.38,by+bh*.42,bw*.24,bh*.18,4,true);drawMicroTexture(g,bx+6,by+6,bw-12,bh-12,'roof',i+Math.round(x)+83);
    }
  }
  function drawRoadsideSignalPad(g,x,y,axis='V'){
    g.save();g.translate(x,y);
    g.fillStyle='rgba(211,225,226,.46)';g.strokeStyle='rgba(60,82,91,.22)';g.lineWidth=2;
    if(axis==='H')roundRect(g,-46,-34,92,68,14,true);else roundRect(g,-34,-46,68,92,14,true);
    if(axis==='H')roundRect(g,-46,-34,92,68,14,false);else roundRect(g,-34,-46,68,92,14,false);
    g.fillStyle='rgba(15,26,34,.13)';
    if(axis==='H')roundRect(g,-34,-6,68,12,6,true);else roundRect(g,-6,-34,12,68,6,true);
    g.restore();
  }

  function drawSignal(g,x,y,state='red',meta=null){
    const info=(meta&&typeof meta==='object')?meta:{facing:(typeof meta==='string'&&meta)||'S',axis:null};
    const facing=info.facing||'S',axis=info.axis||((facing==='E'||facing==='W')?'H':'V');
    const arrow=facing==='N'?'↑':facing==='S'?'↓':facing==='E'?'→':'←';
    const plateColor=axis==='H'?'#55d5ff':'#56e39f';
    const parallelToRoad = axis==='H';
    drawRoadsideSignalPad(g,x,y,axis);
    g.save();g.translate(x,y);g.scale(.88,.88);
    // M78: restore a more natural mounting for the horizontal arterial heads. Signals that control
    // the left/right stream are rotated to lie parallel to the road, while vertical-road heads stay
    // upright. Direction plaques remain so phase ownership stays unambiguous.
    if(parallelToRoad)g.rotate(Math.PI/2);
    g.fillStyle='rgba(0,0,0,.22)';roundRect(g,-20,50,54,12,6,true);
    g.strokeStyle='#263a49';g.lineWidth=8;g.beginPath();g.moveTo(0,48);g.lineTo(0,78);g.stroke();
    g.fillStyle='#102132';roundRect(g,-25,-56,50,112,15,true);
    g.fillStyle='rgba(255,255,255,.08)';roundRect(g,-19,-50,38,100,11,true);
    const redOn=state==='red',yellowOn=state==='yellow',greenOn=state==='green';
    g.fillStyle='rgba(0,0,0,.24)';roundRect(g,-28,48,56,8,4,true);
    for(const [yy,c,on] of [[-28,'#ff5964',redOn],[0,'#ffd166',yellowOn],[28,'#56e39f',greenOn]]){
      g.fillStyle='rgba(3,12,20,.48)';g.beginPath();g.arc(0,yy-6,16,Math.PI,Math.PI*2);g.fill();
      g.fillStyle=on?c:'rgba(255,255,255,.14)';
      g.shadowColor=on?c:'transparent';g.shadowBlur=on?(RenderQuality.level>=2?22:RenderQuality.level===1?11:0):0;
      g.beginPath();g.arc(0,yy,12,0,Math.PI*2);g.fill();
      if(on){const pulse=(reducedMotion?0:.04*Math.sin(performance.now()/180+yy));g.globalAlpha=.34+pulse;g.beginPath();g.arc(0,yy,19,0,Math.PI*2);g.fill();g.globalAlpha=.10+pulse*.5;g.beginPath();g.arc(0,yy,30,0,Math.PI*2);g.fill();g.globalAlpha=1;}
    }
    // Small directional plaque: shows which stream this head controls (↑ ↓ ← →).
    g.fillStyle='rgba(4,18,30,.94)';g.strokeStyle=plateColor;g.lineWidth=2;roundRect(g,-16,-79,32,18,7,true);roundRect(g,-16,-79,32,18,7,false);
    g.fillStyle=plateColor;g.font='900 12px system-ui';g.textAlign='center';g.textBaseline='middle';g.fillText(arrow,0,-70);
    g.restore();
  }
  function drawMotionTrail(g,c,pose){
    if(reducedMotion||RenderQuality.level===0||c.stopped)return;
    const speed=c.currentSpeed||c.topSpeed||0;if(speed<155)return;
    const strength=Math.min(.24,(speed-145)/260);
    g.save();g.translate(pose.x,pose.y);g.rotate(pose.rot);g.globalAlpha=strength;
    const grad=g.createLinearGradient(-88,0,-20,0);grad.addColorStop(0,'rgba(85,213,255,0)');grad.addColorStop(1,c.kind==='ambulance'||c.kind==='police'?'rgba(85,213,255,.48)':'rgba(255,255,255,.28)');
    g.fillStyle=grad;roundRect(g,-88,-13,62,5,3,true);roundRect(g,-88,8,62,5,3,true);g.restore();
  }
  function drawEmergencyCorridorCue(g,c,state){
    if(!state?.needsPriority||Game.renderEmergencyFocusId!==c.id)return;
    const urgency=Math.max(.15,Math.min(1,state.urgency||0)),shift=(reducedMotion||RenderQuality.level===0)?0:(performance.now()/22)%18;
    const color=c.kind==='fire'?'#ffd166':c.kind==='police'?'#55d5ff':'#ff7c8a';
    g.save();g.globalAlpha=.20+.34*urgency;g.strokeStyle=color;g.fillStyle=color;g.lineWidth=3;g.shadowColor=color;g.shadowBlur=RenderQuality.level>=1?10:0;
    for(let i=0;i<3;i++){const x=58+i*25+shift;g.beginPath();g.moveTo(x-12,-11);g.lineTo(x+4,0);g.lineTo(x-12,11);g.stroke();}
    g.globalAlpha=.10+.12*urgency;g.beginPath();g.moveTo(46,0);g.lineTo(142,0);g.stroke();g.restore();
  }
  function drawEmergencyLightbar(g,c,bodyH){
    if(!isEmergencyVehicle(c))return;const phase=reducedMotion?0:(Math.floor(performance.now()/(c.kind==='police'?120:c.kind==='ambulance'?145:175))%2);
    const a=c.kind==='fire'?'#ff5964':'#55d5ff',b=c.kind==='fire'?'#ffd166':'#ff5964';
    g.save();g.shadowBlur=RenderQuality.level>=1?16:7;g.shadowColor=phase?a:b;g.fillStyle='rgba(4,18,30,.88)';roundRect(g,-17,-bodyH/2-7,34,9,4,true);
    g.fillStyle=phase?a:b;roundRect(g,-14,-bodyH/2-5,12,5,2,true);g.shadowColor=phase?b:a;g.fillStyle=phase?b:a;roundRect(g,2,-bodyH/2-5,12,5,2,true);g.shadowBlur=0;
    if(Game.renderEmergencyFocusId===c.id){g.strokeStyle='rgba(255,255,255,.72)';g.lineWidth=1.5;roundRect(g,-18,-bodyH/2-8,36,11,5,false);}
    g.restore();
  }
  function drawCar(g,c){
    const pose=renderCarPose(c),{x,y,rot}=pose;drawMotionTrail(g,c,pose);
    const laneCount=Game.config?.lanes||1,trafficScale=renderedTrafficScale(laneCount);
    // One world-facing light source keeps the moving shadow aligned with the city blocks.
    g.save();g.translate(x+7*trafficScale,y+10*trafficScale);g.rotate(rot);g.scale(trafficScale,trafficScale);
    g.fillStyle='rgba(5,20,27,.22)';g.beginPath();g.ellipse(0,0,52,29,0,0,Math.PI*2);g.fill();g.restore();
    g.save();g.translate(x,y);g.rotate(rot);g.scale(trafficScale,trafficScale);
    const emergencyVisual=isEmergencyVehicle(c)?emergencyReadabilityState(c,Game):null;drawEmergencyCorridorCue(g,c,emergencyVisual);
    if(['ambulance','police','fire'].includes(c.kind)){const pulse=reducedMotion?0:Math.sin(performance.now()/150)*4,glow=c.kind==='fire'?'#ff7a59':'#55d5ff';g.strokeStyle=c.kind==='fire'?'rgba(255,122,89,.55)':'rgba(85,213,255,.55)';g.lineWidth=3;g.shadowColor=glow;g.shadowBlur=12;g.beginPath();g.ellipse(0,0,(c.kind==='fire'?64:56)+pulse,(c.kind==='fire'?40:38)+pulse*.5,0,0,Math.PI*2);g.stroke();g.shadowBlur=0;if(c.emergencyPriorityActive){g.save();g.rotate(-rot);g.fillStyle='rgba(4,18,30,.90)';g.strokeStyle='#ffd166';g.lineWidth=2;roundRect(g,-43,-55,86,22,9,true);roundRect(g,-43,-55,86,22,9,false);g.fillStyle='#ffd166';g.font='900 11px system-ui';g.textAlign='center';g.textBaseline='middle';g.fillText('PRIORITY',0,-44);g.restore();}}
    const supporterSkin=Boolean(c.supporterSkin||(c.kind==='car'&&supporterSkinEnabled(c.style||0)));
    const truck=c.kind==='truck', bus=c.kind==='bus', ambulance=c.kind==='ambulance',police=c.kind==='police',fire=c.kind==='fire';
    const van=c.style===2||truck||fire, sport=c.archetype==='sport'||c.style===3, compact=c.archetype==='compact';
    const bodyW=bus?126:fire?118:truck?108:van?98:sport?92:compact?82:92,bodyH=bus?62:fire?60:truck?58:van?56:sport?52:compact?48:53;
    const radius=bus?18:fire?15:truck?14:sport?13:17,brakeVisual=vehicleBrakeIntensity(c),chassisShift=vehicleChassisShift(c);
    // M121: bounded brake streaks are render-only and disabled on Low/reduced-motion.
    if(brakeVisual>.42&&!c.stopped&&!reducedMotion&&RenderQuality.level>=1){const streak=12+brakeVisual*24;g.save();g.globalAlpha=(RenderQuality.level>=2?.20:.11)*brakeVisual;g.strokeStyle='rgba(22,31,38,.86)';g.lineWidth=2.2;for(const yy of [-bodyH*.28,bodyH*.28]){g.beginPath();g.moveTo(-bodyW/2-4,yy);g.lineTo(-bodyW/2-streak,yy);g.stroke();}g.restore();}
    // Stronger toy-like shadow and volume.
    const movingLift=c.stopped?0:2;if(c.stopped&&!reducedMotion){g.save();g.globalAlpha=.15;g.fillStyle='#ff5964';g.shadowColor='#ff5964';g.shadowBlur=18;g.beginPath();g.ellipse(-bodyW*.48,0,18,bodyH*.42,0,0,Math.PI*2);g.fill();g.restore();}
    g.save();g.translate(chassisShift,0);
    g.fillStyle='rgba(0,0,0,.12)';roundRect(g,-bodyW/2+4,-bodyH/2+7+movingLift,bodyW,bodyH,16,true);
    g.fillStyle=c.color;roundRect(g,-bodyW/2,-bodyH/2,bodyW,bodyH,radius,true);
    if(RenderQuality.level>=1){const bodyGrad=g.createLinearGradient(-bodyW/2,-bodyH/2,bodyW/2,bodyH/2);bodyGrad.addColorStop(0,supporterSkin?'rgba(255,248,218,.56)':'rgba(255,255,255,.34)');bodyGrad.addColorStop(.08,c.color);bodyGrad.addColorStop(.72,'rgba(255,255,255,.04)');bodyGrad.addColorStop(1,'rgba(0,0,0,.14)');g.fillStyle=bodyGrad;roundRect(g,-bodyW/2,-bodyH/2,bodyW,bodyH,radius,true);}
    if(supporterSkin){g.save();g.strokeStyle='rgba(255,224,122,.95)';g.shadowColor='rgba(255,205,90,.8)';g.shadowBlur=14;g.lineWidth=2.5;roundRect(g,-bodyW/2+3,-bodyH/2+3,bodyW-6,bodyH-6,Math.max(10,radius-1),false);g.restore();}
    // Narrow shaded side panels add height while keeping the silhouette inside the lane.
    g.fillStyle='rgba(7,25,34,.26)';roundRect(g,-bodyW/2+7,bodyH/2-8,bodyW-14,6,3,true);
    g.fillStyle='rgba(255,255,255,.19)';roundRect(g,-bodyW/2+9,-bodyH/2+5,bodyW-20,3,2,true);
    // M57 pseudo-3D sculpted body: bumper, hood and roof deck.
    g.fillStyle='rgba(0,0,0,.18)';roundRect(g,-bodyW/2+5,bodyH/2-9,bodyW-10,7,5,true);
    g.fillStyle='rgba(255,255,255,.16)';roundRect(g,bodyW*.10,-bodyH/2+5,bodyW*.30,bodyH-10,8,true);
    const roofX=compact?-8:(sport?-5:-9),roofW=bus?54:truck?46:compact?31:sport?34:40;
    g.fillStyle='rgba(0,0,0,.16)';roundRect(g,roofX+2,-bodyH*.33+3,roofW,bodyH*.66,9,true);
    g.fillStyle='rgba(7,25,36,.34)';roundRect(g,roofX+3,-bodyH*.33+4,roofW,bodyH*.66,9,true);
    if(RenderQuality.level>=1){const roofGrad=g.createLinearGradient(roofX,-bodyH*.34,roofX+roofW,bodyH*.34);roofGrad.addColorStop(0,'rgba(195,240,255,.58)');roofGrad.addColorStop(.48,'rgba(32,74,94,.88)');roofGrad.addColorStop(1,'rgba(8,32,48,.92)');g.fillStyle=roofGrad;}else g.fillStyle='rgba(32,74,94,.88)';roundRect(g,roofX,-bodyH*.33,roofW,bodyH*.66,9,true);
    g.strokeStyle='rgba(255,255,255,.22)';g.lineWidth=1.5;roundRect(g,roofX+2,-bodyH*.33+2,roofW-4,bodyH*.66-4,7,false);
    drawEmergencyLightbar(g,c,bodyH);
    g.fillStyle='rgba(0,0,0,.13)';roundRect(g,-bodyW/2+4,bodyH/2-11,bodyW-8,9,6,true);g.fillStyle='rgba(10,20,28,.28)';roundRect(g,-bodyW/2+6,-bodyH/2+3,6,bodyH-6,3,true);
    g.fillStyle='rgba(255,255,255,.28)';roundRect(g,-bodyW/2+9,-bodyH/2+6,bodyW-24,6,4,true);g.fillStyle='rgba(255,255,255,.10)';roundRect(g,-bodyW/2+15,-bodyH/2+14,bodyW*.34,4,2,true);
    g.fillStyle='rgba(255,255,255,.12)';roundRect(g,-bodyW/2+14,-bodyH/2+14,bodyW*0.22,bodyH*0.18,4,true);

    // M39: turn indicators flash before and during the manoeuvre.
    if(c.turn&&c.turn!=='straight'&&c.progress<turnCurveBounds(Game.config?.lanes||1).end+35){
      const blink=reducedMotion?1:(Math.floor(performance.now()/260)%2);
      if(blink){
        const sy=c.turn==='right'?(bodyH/2-5):(-bodyH/2+5);
        g.fillStyle='#ffbf47';g.shadowColor='#ffbf47';g.shadowBlur=10;
        g.beginPath();g.arc(bodyW/2-9,sy,4.5,0,Math.PI*2);g.fill();
        g.beginPath();g.arc(-bodyW/2+9,sy,4.5,0,Math.PI*2);g.fill();g.shadowBlur=0;
      }
    }

    // Cabin / windows.
    const cabW=bus?48:fire?44:truck?42:compact?34:38, cabH=bus?42:fire?40:truck?38:compact?36:40;
    g.fillStyle='rgba(12,37,55,.34)';roundRect(g,-7,-cabH/2,cabW,cabH,10,true);
    g.fillStyle='rgba(153,230,255,.34)';roundRect(g,-3,-cabH/2+5,cabW-10,14,6,true);
    g.fillStyle='rgba(104,189,222,.24)';roundRect(g,-3,4,cabW-10,12,6,true);
    g.fillStyle='rgba(255,255,255,.34)';g.fillRect(cabW-11,-cabH/2+7,2,10);

    // Front/rear lights with a little glow.
    const night=districtInfo(Game.level).id==='night';
    if(night){g.save();const beam=g.createLinearGradient(bodyW/2-4,0,bodyW/2+58,0);beam.addColorStop(0,'rgba(255,247,190,.22)');beam.addColorStop(1,'rgba(255,247,190,0)');g.fillStyle=beam;g.beginPath();g.moveTo(bodyW/2-2,-18);g.lineTo(bodyW/2+62,-28);g.lineTo(bodyW/2+62,28);g.lineTo(bodyW/2-2,18);g.closePath();g.fill();g.restore();}
    g.fillStyle='#fff3b0';g.shadowColor='#fff3b0';g.shadowBlur=night?12:5;roundRect(g,bodyW/2-11,-17,7,12,2,true);roundRect(g,bodyW/2-11,5,7,12,2,true);g.shadowBlur=0;
    g.globalAlpha=.18; g.fillRect(bodyW/2-4,-18,8,34); g.globalAlpha=1;
    const brakeGlow=.18+.82*brakeVisual;g.fillStyle=brakeVisual>.18?'#ff4757':'#8f3140';g.shadowColor='#ff5964';g.shadowBlur=brakeVisual>0?3+10*brakeVisual:0;g.globalAlpha=.55+.45*brakeGlow;roundRect(g,-bodyW/2+4,-17,7,12,2,true);roundRect(g,-bodyW/2+4,5,7,12,2,true);g.globalAlpha=1;g.shadowBlur=0;
    if(brakeVisual>.35){g.shadowColor='#ff5964';g.shadowBlur=6+9*brakeVisual;g.globalAlpha=.18+.38*brakeVisual;g.fillStyle='#ff5964';g.fillRect(-bodyW/2-4,-16,5,32);g.globalAlpha=1;g.shadowBlur=0;}

    // Identity accents.
    if(bus){g.fillStyle='rgba(255,255,255,.78)';for(let i=0;i<5;i++)roundRect(g,-33+i*14,-19,9,11,2,true);g.fillStyle='rgba(40,55,70,.78)';g.fillRect(-36,16,63,4);}
    else if(truck){g.fillStyle='rgba(255,255,255,.78)';roundRect(g,-34,-16,34,32,6,true);g.fillStyle='rgba(41,58,84,.48)';roundRect(g,-30,-12,26,24,4,true);g.fillStyle='rgba(255,255,255,.18)';g.fillRect(-bodyW/2+16,-bodyH/2+10,bodyW-36,4);}
    else if(ambulance){g.fillStyle='#ff5964';g.fillRect(-7,-24,14,48);g.fillRect(-23,-8,46,16);const flash=reducedMotion?0:Math.floor(performance.now()/180)%2;g.shadowBlur=14;g.shadowColor=flash?'#55d5ff':'#ff5964';g.fillStyle=flash?'#55d5ff':'#ff5964';g.fillRect(-8,-31,7,5);g.fillStyle=flash?'#ff5964':'#55d5ff';g.fillRect(1,-31,7,5);g.shadowBlur=0;}
    else if(police){const flash=reducedMotion?0:Math.floor(performance.now()/170)%2;g.fillStyle='#244f91';g.fillRect(-bodyW/2+9,-7,bodyW-18,14);g.fillStyle='rgba(255,255,255,.75)';g.fillRect(-8,-24,16,48);g.shadowBlur=14;g.shadowColor=flash?'#55d5ff':'#ff5964';g.fillStyle=flash?'#55d5ff':'#ff5964';g.fillRect(-8,-30,8,5);g.fillStyle=flash?'#ff5964':'#55d5ff';g.fillRect(0,-30,8,5);g.shadowBlur=0;}
    else if(fire){const flash=reducedMotion?0:Math.floor(performance.now()/210)%2;g.fillStyle='rgba(255,255,255,.86)';g.fillRect(-bodyW/2+12,-5,bodyW-24,10);g.fillStyle='#ffd166';roundRect(g,-30,-18,42,8,3,true);g.fillStyle='rgba(80,34,34,.45)';for(let i=0;i<3;i++)roundRect(g,-34+i*20,10,14,10,3,true);g.shadowBlur=14;g.shadowColor=flash?'#ffd166':'#ff5964';g.fillStyle=flash?'#ffd166':'#ff5964';g.fillRect(-8,-32,8,5);g.fillStyle=flash?'#ff5964':'#ffd166';g.fillRect(0,-32,8,5);g.shadowBlur=0;}
    else if(c.style===1){g.fillStyle='#1f2937';g.fillRect(-21,-26,42,5);for(let i=0;i<6;i++){g.fillStyle=i%2?'#fff':'#1f2937';g.fillRect(-18+i*6,-4,6,6);}}
    else if(c.style===4){g.fillStyle='#fff';g.fillRect(-7,-25,14,50);const flash=reducedMotion?0:Math.floor(performance.now()/180)%2;g.shadowBlur=12;g.shadowColor=flash?'#55d5ff':'#ff5964';g.fillStyle=flash?'#55d5ff':'#ff5964';g.fillRect(-7,-29,7,5);g.fillStyle=flash?'#ff5964':'#55d5ff';g.fillRect(0,-29,7,5);g.shadowBlur=0;}
    else if(c.style===2){g.fillStyle='rgba(255,255,255,.64)';roundRect(g,-31,-5,23,10,3,true);g.fillStyle='rgba(12,37,55,.40)';roundRect(g,-29,-3,19,6,2,true);}
    else if(c.style===3){g.fillStyle='rgba(255,255,255,.72)';g.fillRect(-bodyW/2+10,-3,bodyW-20,6);g.fillStyle='rgba(255,255,255,.28)';g.fillRect(-bodyW/2+18,-11,bodyW-36,3);}
    else if(c.style===5){g.strokeStyle='#8affdf';g.lineWidth=2;g.beginPath();g.arc(-24,0,6,0,Math.PI*2);g.stroke();g.beginPath();g.moveTo(-18,0);g.lineTo(-10,0);g.stroke();}
    else if(c.style===6){g.strokeStyle='#e8ca7a';g.lineWidth=2;roundRect(g,-bodyW/2+2,-bodyH/2+2,bodyW-4,bodyH-4,14,false);g.fillStyle='rgba(232,202,122,.28)';g.fillRect(-bodyW/2+14,-bodyH/2+9,bodyW-28,3);}
    else if(c.style===7){g.save();g.strokeStyle='#d88cff';g.shadowColor='#bd5cff';g.shadowBlur=13;g.lineWidth=2.5;roundRect(g,-bodyW/2+3,-bodyH/2+3,bodyW-6,bodyH-6,13,false);g.shadowBlur=0;g.fillStyle='#5df0ff';g.fillRect(-bodyW/2+18,bodyH/2-7,bodyW-36,3);g.restore();}
    else if(c.style===8){g.fillStyle='#5a3b2a';g.fillRect(-bodyW/2+10,-3,bodyW-20,6);g.fillStyle='rgba(255,255,255,.55)';g.fillRect(-bodyW/2+18,-bodyH/2+9,bodyW-36,4);g.strokeStyle='#f9edcf';g.lineWidth=2;roundRect(g,-bodyW/2+3,-bodyH/2+3,bodyW-6,bodyH-6,15,false);}
    else if(c.style===9){g.strokeStyle='#55e7ff';g.lineWidth=2;g.shadowColor='#55e7ff';g.shadowBlur=9;g.beginPath();g.moveTo(-bodyW/2+12,-bodyH/2+8);g.lineTo(bodyW/2-14,-bodyH/2+8);g.stroke();g.shadowBlur=0;g.fillStyle='rgba(85,231,255,.38)';g.fillRect(-bodyW/2+14,bodyH/2-8,bodyW-28,3);g.fillStyle='rgba(255,255,255,.10)';for(let i=0;i<4;i++)g.fillRect(-24+i*14,-6,8,2);}
    else if(supporterSkin){g.fillStyle='rgba(84,45,0,.34)';g.fillRect(-bodyW/2+10,-4,bodyW-20,8);g.fillStyle='rgba(255,248,219,.88)';g.beginPath();g.moveTo(0,-11);g.lineTo(3,-3);g.lineTo(11,-3);g.lineTo(5,2);g.lineTo(8,10);g.lineTo(0,5);g.lineTo(-8,10);g.lineTo(-5,2);g.lineTo(-11,-3);g.lineTo(-3,-3);g.closePath();g.fill();g.strokeStyle='rgba(124,78,0,.55)';g.lineWidth=1.5;g.stroke();g.fillStyle='rgba(255,255,255,.22)';roundRect(g,-26,-4,20,8,3,true);}
    else {g.fillStyle='rgba(255,255,255,.22)';roundRect(g,-26,-4,20,8,3,true);}

    g.restore();
    // Wheels / mirrors stay planted while the chassis has a subtle presentation-only motion.
    g.fillStyle='#0a1119';roundRect(g,-32,-34,21,9,4,true);roundRect(g,11,-34,21,9,4,true);roundRect(g,-32,25,21,9,4,true);roundRect(g,11,25,21,9,4,true);
    g.fillStyle='#728695';roundRect(g,-25,-32,8,4,2,true);roundRect(g,18,-32,8,4,2,true);roundRect(g,-25,27,8,4,2,true);roundRect(g,18,27,8,4,2,true);
    g.fillStyle='#2a4050';roundRect(g,20,-33,11,4,2,true);roundRect(g,20,29,11,4,2,true);
    if(c.violation&&c.violation!=='none'){
      const blink=reducedMotion?1:(.55+.45*Math.sin(performance.now()/115+c.id)),warn=c.violation==='red'?'#ff4757':'#ffd166';
      g.globalAlpha=.28+.22*blink;g.strokeStyle=warn;g.lineWidth=3;g.shadowColor=warn;g.shadowBlur=14;g.beginPath();g.ellipse(0,0,bodyW*.58,bodyH*.70,0,0,Math.PI*2);g.stroke();
      g.globalAlpha=.88+.12*blink;g.fillStyle=warn;g.beginPath();g.moveTo(-8,-bodyH/2-15);g.lineTo(8,-bodyH/2-15);g.lineTo(0,-bodyH/2-32);g.closePath();g.fill();
      g.shadowBlur=0;g.fillStyle='#07101e';g.font='900 13px system-ui';g.textAlign='center';g.textBaseline='middle';g.fillText('!',0,-bodyH/2-21);g.globalAlpha=1;
    }
    g.restore();
  }
  function roundRect(g,x,y,w,h,r,fill=true){g.beginPath();if(g.roundRect)g.roundRect(x,y,w,h,r);else{g.rect(x,y,w,h);}if(fill)g.fill();else g.stroke();}

  function applyDistrictTheme(){
    const d=districtInfo(Game.level),root=document.documentElement;root.style.setProperty('--district-accent',d.accent);root.style.setProperty('--district-bg',d.bg);
  }
  function eventLabel(variant){
    return variant==='rush'?T.eventRush:variant==='heavy'?T.eventHeavy:variant==='service'?T.eventService:variant==='express'?T.eventExpress:variant==='freight'?T.eventFreight:variant==='pulse'?T.eventPulse:variant==='alternating'?T.eventAlternating:variant==='roadwork'?T.eventRoadwork:'';
  }
  function levelGoal(){
    let base='';
    if(Game.assistActive)base=T.assistGoal;
    else if(Game.mode==='greenwave'){const def=greenWaveDefinition(Game.greenWaveId);base=Game.greenWaveDirector?.hudText?.(Game)||(def?T[def.goalKey]:T.greenWaveDesc);}
    else if(Game.mode==='scenario'){const def=Game.scenarioDirector?.def||scenarioDefinition(Game.scenarioId);base=Game.scenarioDirector?.hudText?.(Game)||(def?T[def.goalKey]:T.scenarioAfterSchoolGoal);}
    else if(Game.mode==='daily')base=T.dailyDesc;
    else if(Game.mode==='weekly')base=T.weeklyDesc;
    else if(Game.mode==='endless')base=`${T.endlessScore}: ${Game.endlessScore} · ${T.endlessBest}: ${save.endlessBestScore||0}`;
    else if(Game.level===1)base=T.tutorialGoal1;else if(Game.level===2)base=T.tutorialGoal2;else if(Game.level===3)base=T.tutorialGoal3;else if(Game.level===4)base=T.tutorialGoal4;else if(Game.level===5)base=T.tutorialGoal5;else if(Game.level===6)base=T.tutorialPedestrians;else if(Game.level===8)base=T.tutorialTurns;else if(Game.level===14)base=T.tutorialYellow;else if(Game.level===18)base=T.tutorialLeftTurns;else if(Game.level===46)base=T.tutorialLanes;else if(Game.level===90)base=T.tutorialLanes3;
    else if(Game.config?.variant==='rush')base=T.rushGoal;else if(Game.config?.variant==='heavy')base=T.heavyGoal;else if(Game.config?.variant==='service')base=T.serviceGoal;else if(Game.config?.variant==='express')base=T.expressGoal;else if(Game.config?.variant==='freight')base=T.freightGoal;else if(Game.config?.variant==='pulse')base=T.pulseGoal;else if(Game.config?.variant==='alternating')base=T.alternatingGoal;else if(Game.config?.variant==='roadwork')base=T.roadworkGoal;else base=T.goal;
    const incident=Game.incidentDirector;if(incident&&!incident.completed&&(incident.warned||incident.active)){const detail=incident.def.type==='broken'?T.incidentBrokenGoal:incident.def.type==='roadworks'?T.incidentRoadworksGoal:T.incidentSlowGoal;return `${base} · ${detail}`;}
    return base;
  }
  function nextCarGoal(){
    for(let i=1;i<CAR_REQUIREMENTS.length;i++){
      if(save.level<CAR_REQUIREMENTS[i]&&!ownedStyleIds().includes(i))return {name:T[CAR_NAMES[i]],level:CAR_REQUIREMENTS[i]};
    }
    return null;
  }
  const HUD_CACHE=Object.create(null);
  function setHudText(key,id,value){if(HUD_CACHE[key]===value)return;HUD_CACHE[key]=value;$(id).textContent=value;}
  function phaseLabelText(axis){return axis==='H'?`↔ ${T.phaseH}`:`↕ ${T.phaseV}`;}

  function updateHud(){
    if(!$('coins'))return;
    setHudText('coins','coins',String(save.coins));setHudText('stars','total-stars',String(save.totalStars));const scenarioDef=Game.mode==='scenario'?(Game.scenarioDirector?.def||scenarioDefinition(Game.scenarioId)):null,greenWaveDef=Game.mode==='greenwave'?greenWaveDefinition(Game.greenWaveId):null;setHudText('level','level-label',Game.mode==='greenwave'?(greenWaveDef?T[greenWaveDef.nameKey]:T.greenWaveMode):Game.mode==='scenario'?(scenarioDef?T[scenarioDef.nameKey]:T.scenarioMode):Game.mode==='daily'?T.dailyChallenge:Game.mode==='weekly'?T.weeklyChallenge:Game.mode==='endless'?`${T.endlessWave} ${Game.endlessWave}`:`${T.level} ${Game.level}`);
    const d=districtInfo(Game.level);setHudText('district','district',Game.mode==='greenwave'?T.greenWaveDistrict:Game.mode==='scenario'?T.scenarioDistrict:Game.mode==='daily'?T.dailyDistrict:Game.mode==='weekly'?T.weeklyDistrict:Game.mode==='endless'?T.endlessDistrict:T[d.key]);setHudText('goal','goal-text',levelGoal());document.documentElement.dataset.weather=weatherForLevel(Game.level);document.documentElement.classList.toggle('first-session-focus',Boolean(Game.mode==='campaign'&&Game.level<=3&&save.level<=3));updateFirstSessionCoach();
    $('daily-btn').classList.toggle('ui-hidden',save.level<4);$('daily-btn').classList.toggle('ready',save.level>=4&&(!save.dailyRewards[todayDailyKey()]||save.level>=21));
    const carGoal=nextCarGoal(),starsToBonus=15-(save.totalStars%15||0); 
    setHudText('insightCar','insight-car',carGoal?`${T.insightCar}: ${carGoal.name} · ${T.level} ${carGoal.level}`:T.allCars);
    setHudText('insightStars','insight-stars',`${T.insightStars}: ${starsToBonus===15?15:starsToBonus}★`);
    setHudText('insightFlow','insight-flow',`${T.insightFlow}: ×${Math.max(0,save.bestFlow||0,Game.maxFlowStreak||0)}`);
    const missionCount=Object.keys(save.missionCompleted||{}).length;setHudText('insightMission','insight-mission',`${T.missionMastery}: ${missionCount} · ${missionCount%5}/5`);
    const progressTotal=Game.mode==='scenario'?(Game.scenarioDirector?.totalTraffic||Game.config?.scenarioTotalTraffic||1):(Game.config?.total||1),p=Game.config?Math.min(100,Math.round((Game.exited/progressTotal)*100)):0;if(HUD_CACHE.progress!==p){HUD_CACHE.progress=p;$('progress-bar').style.width=`${p}%`;const progressEl=document.querySelector('.progress');if(progressEl)progressEl.setAttribute('aria-valuenow',String(p));}
    const q=countQueues(),mq=Math.max(q.N,q.S,q.E,q.W);setHudText('queue','queue-label',`${T.jam}: ${mq}/${Game.config?.maxQueue||4}`);setHudText('switches','switch-label',`${T.switches}: ${Game.switches}`);
    const warnQueue=Boolean(Game.config&&mq>=Math.max(1,Game.config.maxQueue-1));
    if(HUD_CACHE.warnQueue!==warnQueue){HUD_CACHE.warnQueue=warnQueue;document.querySelector('.game-card')?.classList.toggle('queue-warning',warnQueue);}
    const occupied=Game.cars.some(c=>c.inside);
    if(HUD_CACHE.occupied!==occupied){HUD_CACHE.occupied=occupied;$('signal-btn').classList.toggle('occupied',occupied);}
    const violatorNear=Game.cars.some(c=>c.violation&&c.violation!=='none'&&c.progress>135&&c.progress<560);
    if(HUD_CACHE.violatorNear!==violatorNear){HUD_CACHE.violatorNear=violatorNear;document.querySelector('.game-card')?.classList.toggle('violator-warning',violatorNear);}
    const jt=Game.config?.junctionType||'cross',incidentHud=Game.incidentDirector&&!Game.incidentDirector.completed&&(Game.incidentDirector.warned||Game.incidentDirector.active)?Game.incidentDirector.hudText():'',eventText=Game.mode==='greenwave'?`${greenWaveDefinition(Game.greenWaveId)?.order||1}/${GREEN_WAVE_ORDER.length} · ${T.greenWaveMode}`:Game.mode==='scenario'?(Game.scenarioDirector?.stageLabel()||T.scenarioMode):(incidentHud||(eventLabel(Game.config?.variant||'standard')||(jt==='double-horizontal'?T.junctionDouble:jt!=='cross'?T.junctionT:''))),eventEl=$('event-badge');
    const eventVariant=incidentHud?'incident':(Game.config?.variant||'standard');if(HUD_CACHE.eventText!==eventText||HUD_CACHE.eventVariant!==eventVariant){HUD_CACHE.eventText=eventText;HUD_CACHE.eventVariant=eventVariant;eventEl.textContent=eventText;eventEl.classList.toggle('ui-hidden',!eventText);eventEl.dataset.variant=eventVariant;}
    const incidentActive=Boolean(Game.incidentDirector?.active);if(HUD_CACHE.incidentActive!==incidentActive){HUD_CACHE.incidentActive=incidentActive;document.querySelector('.game-card')?.classList.toggle('incident-active',incidentActive);}
    const weather=weatherForLevel(Game.level),weatherEl=$('weather-badge'),weatherText=weatherLabel(weather);
    if(weatherEl&&HUD_CACHE.weather!==weatherText){HUD_CACHE.weather=weatherText;weatherEl.textContent=weatherText;weatherEl.dataset.weather=weather;weatherEl.classList.toggle('ui-hidden',!weatherText);}
    const missionEl=$('mission-badge'),mission=Game.mission,missionDone=Boolean(mission&&save.missionCompleted?.[String(Game.level)]);
    const missionText=mission?`🎯 ${missionDone?'✓ ':''}${mission.label}`:'';
    if(HUD_CACHE.missionText!==missionText){HUD_CACHE.missionText=missionText;missionEl.textContent=missionText;missionEl.classList.toggle('ui-hidden',!mission);missionEl.classList.toggle('completed',missionDone);}
    const priorityFocus=emergencyFocusVehicle(Game),priorityEmergency=priorityFocus?.car||null,priorityState=priorityFocus?.state||null,priorityEl=$('priority-badge');
    const priorityKey=priorityEmergency?`${priorityEmergency.kind}:${priorityState?.active?'clear':'incoming'}:${priorityEmergency.dir}:${priorityState?.junctionId||'-'}`:'';
    if(HUD_CACHE.priorityWait!==priorityKey){HUD_CACHE.priorityWait=priorityKey;const kind=priorityEmergency?.kind||'',icon=kind==='fire'?'🚒':kind==='police'?'🚓':'🚑',stateLabel=priorityState?.active?T.priorityClear:T.priorityIncoming,arrow=priorityState?.arrow||'';priorityEl.textContent=priorityEmergency?`${icon} ${arrow} ${stateLabel}`:'';priorityEl.dataset.kind=kind;priorityEl.dataset.state=priorityState?.active?'clear':'incoming';priorityEl.classList.toggle('ui-hidden',!priorityEmergency);priorityEl.setAttribute('aria-label',priorityEmergency?`${T.priorityAlert}: ${stateLabel}`:'');}
    const flowShown=Game.flowStreak>=3,hotFlow=Game.flowStreak>=5,flowText=flowShown?`${hotFlow?T.hotFlow:T.flow} ×${Game.flowStreak}`:T.flow;
    if(HUD_CACHE.flowText!==flowText){HUD_CACHE.flowText=flowText;$('flow-badge').textContent=flowText;}
    if(HUD_CACHE.flowShown!==flowShown){HUD_CACHE.flowShown=flowShown;$('flow-badge').classList.toggle('show',flowShown);}if(HUD_CACHE.hotFlow!==hotFlow){HUD_CACHE.hotFlow=hotFlow;$('flow-badge').classList.toggle('hot',hotFlow);document.querySelector('.game-card')?.classList.toggle('hot-flow',hotFlow);}
    const flowHot=Game.flowStreak>=6;if(HUD_CACHE.flowHot!==flowHot){HUD_CACHE.flowHot=flowHot;document.querySelector('.game-card')?.classList.toggle('flow-hot',flowHot);}
    const signalKey=independentSignals(Game)?`ind:${Object.entries(Game.signalControllers).map(([k,c])=>`${k}:${c.phase}:${c.transitionTimer>0?'t':'s'}`).join('|')}:${lang}`:`${Game.phase}:${Game.transitionTimer>0?'t':'s'}:${lang}`;if(HUD_CACHE.signalKey!==signalKey){HUD_CACHE.signalKey=signalKey;updateSignalIcon();}
    if(typeof PersonalBestService!=='undefined')PersonalBestService.renderBadge(Game);
    // Coalescing bookkeeping. Explicit calls are also treated as a completed refresh, so the rAF
    // loop will not immediately duplicate the same DOM work on the next frame.
    Game.hudDirty=false;Game.lastHudTs=performance.now();Game.hudRefreshCount=(Game.hudRefreshCount||0)+1;
  }
  function updateSignalIcon(){
    const indicator=$('phase-indicator'),label=$('phase-label'),button=$('signal-btn'),dual=$('greenwave-controls'),panel=$('controls-panel');if(!button)return;const independent=independentSignals(Game);button.classList.toggle('ui-hidden',independent);dual?.classList.toggle('ui-hidden',!independent);panel?.classList.toggle('greenwave-active',independent);
    if(independent){let anyTransition=false;for(const [id,name] of [['J0',T.greenWaveLeft],['J1',T.greenWaveRight]]){const c=Game.signalControllers[id],b=$(id==='J0'?'signal-j0-btn':'signal-j1-btn'),icon=b?.querySelector('.signal-icon'),txt=$(id==='J0'?'signal-j0-label':'signal-j1-label');if(!b||!icon)continue;const tr=(c.transitionTimer||0)>0;anyTransition=anyTransition||tr;icon.classList.toggle('transition',tr);icon.style.transform=c.phase==='H'?'rotate(0deg)':'rotate(90deg)';b.disabled=tr;b.classList.toggle('ready',!tr);b.setAttribute('aria-busy',tr?'true':'false');const state=tr?T.phaseChanging:phaseLabelText(c.phase);if(txt)txt.textContent=`${name} · ${state}`;b.setAttribute('aria-label',`${name}: ${state}`);}indicator.classList.toggle('transition',anyTransition);label.textContent=`${T.greenWaveLeft}: ${phaseLabelText(Game.signalControllers.J0.phase)} · ${T.greenWaveRight}: ${phaseLabelText(Game.signalControllers.J1.phase)}`;return;}
    const icon=button.querySelector('.signal-icon'),tr=Game.transitionTimer>0;icon?.classList.toggle('transition',tr);indicator.classList.toggle('transition',tr);button.disabled=tr;button.classList.toggle('ready',!tr);button.setAttribute('aria-busy',tr?'true':'false');if(tr){const transitionText=Game.pedestrianHold?T.phasePedestrianClearing:T.phaseChanging;label.textContent=transitionText;button.setAttribute('aria-label',transitionText);return;}if(icon)icon.style.transform=Game.phase==='H'?'rotate(0deg)':'rotate(90deg)';label.textContent=phaseLabelText(Game.phase);button.setAttribute('aria-label',`${T.switchLight}: ${phaseLabelText(Game.phase)}`);
  }
  function toast(msg){const el=$('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>el.classList.remove('show'),1900);}
  function pulseCanvas(){ if(reducedMotion||!canvas.animate)return; canvas.animate([{filter:'brightness(1)'},{filter:'brightness(1.16)'},{filter:'brightness(1)'}],{duration:420}); }

  function showPause(){
    $('modal-kicker').textContent='TRAFFIC PULSE';$('modal-title').textContent=T.paused;$('modal-text').textContent=T.pausedText;$('modal-stars').textContent='';$('modal-reward').classList.add('hidden');$('modal-extra').classList.add('hidden');
    const pauseActions=[{text:T.continue,cls:'primary',fn:()=>Game.resume()},{text:`🎮 ${T.modesHub}`,fn:()=>showModeHub('pause')},{text:`🗺️ ${T.campaignMap}`,fn:()=>showCampaignMap('pause',save.level)},{text:`🚗 ${T.garage}`,fn:()=>showGarage('pause')},{text:`📊 ${T.stats}`,fn:()=>showStats('pause')},{text:`ℹ️ ${T.developer}`,fn:()=>showDeveloperInfo('pause')},{text:`${T.musicLevel}: ${AudioFx.musicLabel()}`,cls:'sound-toggle',fn:(b)=>{AudioFx.cycleMusic();b.textContent=`${T.musicLevel}: ${AudioFx.musicLabel()}`;}},{text:save.sfx?T.effectsOn:T.effectsOff,cls:'sound-toggle',fn:(b)=>{AudioFx.setSfxEnabled(!save.sfx);b.textContent=save.sfx?T.effectsOn:T.effectsOff;}},{text:`${T.language}: ${languageModeLabel()}`,cls:'sound-toggle',fn:()=>{cycleLanguageMode();showPause();}},{text:T.restart,fn:()=>Game.restart()}];actions(pauseActions);openOverlay();
  }
  // M195 Hotfix03: player-facing About panel contains only studio, support email and public game version.
  function showDeveloperInfo(origin='pause'){
    $('modal-kicker').textContent='TRAFFIC PULSE';$('modal-title').textContent=`ℹ️ ${T.developerTitle}`;$('modal-text').textContent=T.developerDesc;$('modal-stars').textContent='';$('modal-reward').classList.add('hidden');
    const extra=$('modal-extra');extra.classList.remove('hidden');extra.textContent='';
    const grid=document.createElement('div');grid.className='stats-grid about-grid';
    const entries=[['🏢',T.developerBuild,'SV Games Studio'],['✉️',T.developerPlatform,'anhelos1987@yandex.ru'],['🎮',T.developerSave,'1.0.0']];
    for(const [icon,label,value] of entries){const row=document.createElement('div');row.className='stats-cell';const a=document.createElement('span');a.textContent=icon;const c=document.createElement('div');const l=document.createElement('small');l.textContent=label;const v=document.createElement('b');v.textContent=String(value);c.append(l,v);row.append(a,c);grid.appendChild(row);}extra.appendChild(grid);
    actions([{text:T.close,cls:'primary',fn:()=>origin==='pause'?showPause():closeOverlay()}]);openOverlay();
  }

  function showStats(origin='pause'){
    const day=todayDailyKey(),dailyStreak=save.dailyRewards?.[day]?dailyStreakEnding(day,save.dailyRewards):dailyStreakEnding(dayOffsetKey(day,-1),save.dailyRewards||{});
    const missionCount=Object.keys(save.missionCompleted||{}).length,achievementCount=Object.keys(save.achievements||{}).filter(k=>save.achievements[k]).length,weeklyCount=Object.values(save.weeklyRewards||{}).filter(Boolean).length;
    $('modal-kicker').textContent='TRAFFIC PULSE';$('modal-title').textContent=`📊 ${T.stats}`;$('modal-text').textContent='';$('modal-stars').textContent='';$('modal-reward').classList.add('hidden');
    const extra=$('modal-extra');extra.classList.remove('hidden');extra.textContent='';
    const grid=document.createElement('div');grid.className='stats-grid';
    const entries=[['🏁',T.statsLevel,save.level],['⭐',T.statsStars,save.totalStars],['🎯',T.statsMissions,missionCount],['🏅',T.statsAchievements,`${achievementCount}/${ACHIEVEMENT_KEYS.length}`],['🚗',T.statsCars,`${ownedStyleIds().length}/${CAR_NAMES.length}`],['⚡',T.statsFlow,`×${save.bestFlow||0}`],['📅',T.statsDaily,dailyStreak],['🗓',T.statsWeekly,weeklyCount],['♾',T.endlessBest,`${save.endlessBestScore||0} · ${T.endlessWave} ${save.endlessBestWave||0}`],['🎒',T.scenarioMode,`${Object.values(SCENARIO_DEFINITIONS).reduce((n,d)=>n+(save.scenarioProgress?.[scenarioSaveKey(d)]?.stars||0),0)}/${Object.keys(SCENARIO_DEFINITIONS).length*3}★`],['🟢',T.greenWaveMode,`${greenWaveCatalog().reduce((n,d)=>n+(save.greenWaveProgress?.[greenWaveSaveKey(d)]?.stars||0),0)}/${greenWaveCatalog().length*3}★`]];
    for(const [icon,label,value] of entries){const row=document.createElement('div');row.className='stats-cell';const a=document.createElement('span');a.textContent=icon;const c=document.createElement('div');const l=document.createElement('small');l.textContent=label;const v=document.createElement('b');v.textContent=String(value);c.append(l,v);row.append(a,c);grid.appendChild(row);}extra.appendChild(grid);
    actions([{text:T.close,cls:'primary',fn:()=>origin==='pause'?showPause():closeOverlay()}]);openOverlay();
  }

  function leaderboardErrorIsMissing(error){return /404|not.?found|leaderboard.*missing/i.test(String(error||''));}
  function leaderboardPublicName(entry){const raw=String(entry?.player?.publicName||'').trim();return raw||T.leaderboardAnonymous;}
  function leaderboardRankLabel(entry,index=0){const rank=Number(entry?.rank);return Number.isFinite(rank)&&rank>0?`#${rank}`:`#${index+1}`;}
  function renderLeaderboardRows(extra,result){
    const list=document.createElement('div');list.className='leaderboard-list';const rows=Array.isArray(result?.entries)?result.entries:[];
    if(!rows.length){const empty=document.createElement('div');empty.className='leaderboard-empty';empty.textContent=result?.error?(leaderboardErrorIsMissing(result.error)?T.leaderboardSetup:T.adUnavailable):T.leaderboardNoEntries;list.appendChild(empty);extra.appendChild(list);return;}
    const seen=new Set();let visualIndex=0;
    for(const entry of rows){const key=String(entry?.player?.uniqueID||`rank:${entry?.rank}:${entry?.score}`);if(seen.has(key))continue;seen.add(key);const row=document.createElement('div');row.className='leaderboard-row';const rank=document.createElement('b');rank.className='leaderboard-rank';rank.textContent=leaderboardRankLabel(entry,visualIndex++);const name=document.createElement('span');name.className='leaderboard-name';name.textContent=leaderboardPublicName(entry);const score=document.createElement('strong');score.className='leaderboard-score';if(result.mode==='stars'){score.textContent=`⭐ ${safeInt(entry?.score,0,999999,0)}`;}else{const breakdown=decodeLeaderboardScore(entry?.score);score.textContent=leaderboardBreakdownText(breakdown);if(breakdown.legacy)score.title='Legacy stars-only score';}if(result.authorized&&platform.player?.getUniqueID&&entry?.player?.uniqueID===platform.player.getUniqueID()){row.classList.add('you');name.textContent=`${T.leaderboardYou} · ${name.textContent}`;}row.append(rank,name,score);list.appendChild(row);}
    extra.appendChild(list);
  }
  async function showLeaderboard(origin='pause'){
    const returnToPause=origin==='pause';$('modal-kicker').textContent='TRAFFIC PULSE';$('modal-title').textContent=`🏆 ${T.leaderboardTitle}`;$('modal-text').textContent=T.leaderboardDesc;$('modal-stars').textContent='';$('modal-reward').classList.add('hidden');const extra=$('modal-extra');extra.classList.remove('hidden');extra.textContent='';
    const summary=document.createElement('div');summary.className='leaderboard-summary';summary.textContent=`${T.leaderboardScore}: ${leaderboardBreakdownText(leaderboardBreakdown(save))}`;extra.appendChild(summary);
    if(platform.target!=='yandex'){const note=document.createElement('div');note.className='leaderboard-note';note.textContent=T.leaderboardUnavailable;extra.appendChild(note);actions([{text:T.close,cls:'primary',fn:()=>returnToPause?showPause():closeOverlay()}]);openOverlay();return;}
    const status=document.createElement('div');status.className='leaderboard-note';status.textContent=T.leaderboardLoading;extra.appendChild(status);actions([{text:T.close,fn:()=>returnToPause?showPause():closeOverlay()}]);openOverlay();
    const result=await platform.getLeaderboardEntries();if(!overlayVisible()||$('modal-title').textContent!==`🏆 ${T.leaderboardTitle}`)return;status.remove();renderLeaderboardRows(extra,result);
    if(result.authorized){const me=document.createElement('div');me.className='leaderboard-note';me.textContent=result.userRank>0?`${T.leaderboardYourRank}: #${result.userRank}`:`${T.leaderboardYourRank}: —`;extra.prepend(me);actions([{text:T.leaderboardRetry,cls:'primary',fn:()=>showLeaderboard(origin)},{text:T.close,fn:()=>returnToPause?showPause():closeOverlay()}]);}
    else{const auth=document.createElement('div');auth.className='leaderboard-auth';auth.textContent=T.leaderboardSignInDesc;extra.prepend(auth);actions([{text:T.leaderboardSignIn,cls:'primary',fn:async(b)=>{if(b.disabled)return;b.disabled=true;const ok=await platform.authorizeForLeaderboard();if(ok)showLeaderboard(origin);else{b.disabled=false;toast(T.adUnavailable);}}},{text:T.leaderboardRetry,fn:()=>showLeaderboard(origin)},{text:T.close,fn:()=>returnToPause?showPause():closeOverlay()}]);}
  }

  function nextGaragePurchase(){
    for(let i=1;i<CAR_NAMES.length;i++){
      if(ownedStyleIds().includes(i))continue;
      const unlocked=save.level>CAR_REQUIREMENTS[i];
      const missing=Math.max(0,(CAR_COSTS[i]||0)-save.coins);
      return {id:i,name:T[CAR_NAMES[i]],cost:CAR_COSTS[i]||0,level:CAR_REQUIREMENTS[i]||0,unlocked,missing};
    }
    return null;
  }

  let garagePreviewId=null;
  function supporterSkinEnabled(styleId){return PLATFORM_TARGET==='vkplay'&&safeInt(styleId,0,CAR_NAMES.length-1,0)===0&&typeof VKBilling!=='undefined'&&VKBilling.supporterOwned();}
  function supporterSkinColor(styleId){return supporterSkinEnabled(styleId)?'#f2c14e':CAR_SWATCHES[safeInt(styleId,0,CAR_NAMES.length-1,0)];}
  function supporterBadgeTitle(){return lang==='ru'?'Supporter · Gold Pulse':'Supporter · Gold Pulse';}
  function supporterBadgeDesc(){return lang==='ru'?'Эксклюзивная золотая машина · рамка гаража · значок Supporter':'Exclusive gold car · garage frame · Supporter badge';}
  function garagePreviewMeta(id){
    const i=safeInt(id,0,CAR_NAMES.length-1,0),owned=ownedStyleIds().includes(i),selected=owned&&save.favoriteCar===i,available=i===0||save.level>CAR_REQUIREMENTS[i],cost=CAR_COSTS[i]||0,shortfall=Math.max(0,cost-save.coins),levels=Math.max(0,(CAR_REQUIREMENTS[i]||0)-save.level);
    let status='';
    if(selected)status=T.selected;else if(owned)status=T.garageCanSelect;else if(!available)status=`${T.locked} ${CAR_REQUIREMENTS[i]} · ${levels} ${T.garageUnlockIn}`;else if(shortfall>0)status=`${cost} 🪙 · ${shortfall} 🪙 ${T.garageCoinsShort}`;else status=`${cost} 🪙 · ${T.readyToBuy}`;
    const supporterSkin=supporterSkinEnabled(i);
    return {id:i,name:T[CAR_NAMES[i]],owned,selected,available,cost,shortfall,levels,status,rare:i>=7,color:supporterSkinColor(i),supporterSkin};
  }
  function garageSetPreview(id,fromPause=false){garagePreviewId=safeInt(id,0,CAR_NAMES.length-1,0);showGarage(fromPause?'pause':'rerender');}

  async function purchaseGarageCar(i,fromPause=false){
    const cost=CAR_COSTS[i]||0;if(save.coins<cost){toast(T.notEnough);return false;}
    if(PLATFORM_TARGET==='vkplay'&&safeInt(save.vkPaidCoinsCredited,0,1_000_000_000_000,0)>0){
      const result=await VKBilling.spendForGarageCar(i,cost);if(!result)return false;
      if(result.localOnly){save.coins=Math.max(0,save.coins-cost);save.ownedCars=[...new Set([...ownedStyleIds(),i])].sort((a,b)=>a-b);save.purchasedCars=[...new Set([...(save.purchasedCars||[]),i])].sort((a,b)=>a-b);save.favoriteCar=i;garagePreviewId=i;persist();updateHud();showGarage(fromPause?'pause':'rerender');}
      return true;
    }
    save.coins=Math.max(0,save.coins-cost);save.ownedCars=[...new Set([...ownedStyleIds(),i])].sort((a,b)=>a-b);save.purchasedCars=[...new Set([...(save.purchasedCars||[]),i])].sort((a,b)=>a-b);save.favoriteCar=i;garagePreviewId=i;persist();updateHud();showGarage(fromPause?'pause':'rerender');return true;
  }

  function showGarage(origin='game'){
    if(origin==='game'){ $('overlay').dataset.garageOrigin=(Game.state==='playing'&&!Game.userPaused)?'game':'pause'; garagePreviewId=ownedStyleIds().includes(save.favoriteCar)?save.favoriteCar:0; }
    if(garagePreviewId==null||garagePreviewId<0||garagePreviewId>=CAR_NAMES.length)garagePreviewId=ownedStyleIds().includes(save.favoriteCar)?save.favoriteCar:0;
    const fromPause=$('overlay').dataset.garageOrigin==='pause'||origin==='pause';
    const resumeAfter=!fromPause;
    if(origin==='game'&&resumeAfter){Game.userPaused=true;platform.gameplayStop();}
    $('modal-kicker').textContent='TRAFFIC PULSE';$('modal-title').textContent=`🚗 ${T.garage}`;$('modal-text').textContent=T.garageDesc;$('modal-stars').textContent='';$('modal-stars').style.display='none';$('modal-reward').classList.add('hidden');
    const extra=$('modal-extra');extra.classList.remove('hidden');extra.textContent='';
    const summary=document.createElement('div');summary.className='garage-summary';
    const ownedCount=ownedStyleIds().length,nextPurchase=nextGaragePurchase(),nextText=nextPurchase?(!nextPurchase.unlocked?`${T.nextPurchase}: ${nextPurchase.name} · ${T.level} ${nextPurchase.level}`:nextPurchase.missing>0?`${T.nextPurchase}: ${nextPurchase.name} · ${T.needCoins} ${nextPurchase.missing} 🪙`:`${T.nextPurchase}: ${nextPurchase.name} · ${T.readyToBuy}`):T.allCars;
    summary.textContent=`${T.collection}: ${ownedCount}/${CAR_NAMES.length} · ${T.favoriteCar}: ${T[CAR_NAMES[save.favoriteCar||0]]} · ${nextText}`;extra.appendChild(summary);
    if(PLATFORM_TARGET==='vkplay'&&VKBilling.supporterOwned()){const supporter=document.createElement('div');supporter.className='supporter-badge-panel';const head=document.createElement('strong');head.textContent=`✦ ${supporterBadgeTitle()}`;const desc=document.createElement('small');desc.textContent=supporterBadgeDesc();supporter.append(head,desc);extra.appendChild(supporter);}
    if(PLATFORM_TARGET==='vkplay'){
      const store=document.createElement('section');store.className='vk-store';store.setAttribute('aria-label',T.vkBillingStore);
      const storeHead=document.createElement('div');storeHead.className='vk-store-head';const storeTitle=document.createElement('strong');storeTitle.textContent=`💳 ${T.vkBillingStore}`;const storeMeta=document.createElement('small');storeMeta.textContent=VKBilling.canOffer()?`${T.vkBillingPaidWallet}: ${safeInt(save.vkPaidCoinsCredited,0,1_000_000_000_000,0)} 🪙 · ${T.vkBillingSecure}`:VKBilling.statusText();storeHead.append(storeTitle,storeMeta);store.appendChild(storeHead);
      if(!VKBilling.canOffer()){
        const auth=document.createElement('button');auth.type='button';auth.className='vk-store-auth';auth.textContent=VKBilling.actionLabel();auth.disabled=VKBilling.busy||VKBilling.connecting;auth.onclick=()=>void VKBilling.handleAuthAction();store.appendChild(auth);
      }else{
        const grid=document.createElement('div');grid.className='vk-store-grid';
        for(const product of Object.values(VKPLAY_PRODUCTS)){
          const card=document.createElement('div');card.className=`vk-store-card${product.supporter?' supporter':''}`;card.dataset.product=product.id;
          const name=document.createElement('strong');name.textContent=VKBilling.productTitle(product);const desc=document.createElement('small');desc.textContent=product.supporter?(VKBilling.supporterOwned()?T.vkBillingSupporterOwned:T.vkBillingSupporterDesc):`${product.coins.toLocaleString(lang==='ru'?'ru-RU':'en-US')} 🪙`;
          const buy=document.createElement('button');buy.type='button';buy.textContent=VKBilling.busy&&VKBilling.lastProductId===product.id?T.vkBillingOpening:`${product.price} ₽ · ${T.vkBillingBuy}`;buy.disabled=VKBilling.busy;buy.onclick=()=>void VKBilling.buyProduct(product.id);card.append(name,desc,buy);grid.appendChild(card);
        }
        store.appendChild(grid);
      }
      const tx=VKBilling.serverState.transactions||[];if(tx.length){const details=document.createElement('details');details.className='vk-purchase-history';const sum=document.createElement('summary');sum.textContent=`${T.vkBillingHistory} (${tx.length})`;details.appendChild(sum);for(const item of tx.slice(0,6)){const row=document.createElement('div');row.className='vk-history-row';const product=VKPLAY_PRODUCTS[item.product_id];const when=new Date(Number(item.created_at||0));const date=Number.isFinite(when.getTime())?when.toLocaleDateString(lang==='ru'?'ru-RU':'en-US'):'';row.textContent=`${product?VKBilling.productTitle(product):item.product_id} · ${item.sum_value} ₽${date?` · ${date}`:''}`;details.appendChild(row);}store.appendChild(details);}
      extra.appendChild(store);
    }
    const collectionTrack=document.createElement('div');collectionTrack.className='garage-collection-track';collectionTrack.setAttribute('role','progressbar');collectionTrack.setAttribute('aria-label',T.garageCollectionProgress);collectionTrack.setAttribute('aria-valuemin','0');collectionTrack.setAttribute('aria-valuemax',String(CAR_NAMES.length));collectionTrack.setAttribute('aria-valuenow',String(ownedCount));const collectionFill=document.createElement('span');collectionFill.style.width=`${Math.round(ownedCount/CAR_NAMES.length*100)}%`;collectionTrack.appendChild(collectionFill);extra.appendChild(collectionTrack);
    const previewMeta=garagePreviewMeta(garagePreviewId),showcase=document.createElement('section');showcase.className=`garage-showcase${previewMeta.rare?' rare':''}${previewMeta.supporterSkin?' supporter-skin':''}`;showcase.setAttribute('aria-label',`${T.garagePreview}: ${previewMeta.name}`);const car=document.createElement('div');car.className=`garage-showcase-car${previewMeta.supporterSkin?' supporter-skin':''}`;car.style.setProperty('--car-color',previewMeta.color);car.dataset.style=String(previewMeta.id);const cabin=document.createElement('span');cabin.className='garage-showcase-cabin';const wheelA=document.createElement('i');wheelA.className='wheel-a';const wheelB=document.createElement('i');wheelB.className='wheel-b';car.append(cabin,wheelA,wheelB);const showcaseCopy=document.createElement('div');const label=document.createElement('small');label.textContent=T.garagePreview;const title=document.createElement('strong');title.textContent=previewMeta.name;const state=document.createElement('span');state.textContent=previewMeta.status;showcaseCopy.append(label,title,state);if(previewMeta.supporterSkin){const badge=document.createElement('span');badge.className='supporter-inline-badge';badge.textContent='✦ Gold Pulse';showcaseCopy.appendChild(badge);}showcase.append(car,showcaseCopy);extra.appendChild(showcase);
    const previewHint=document.createElement('div');previewHint.className='garage-preview-hint';previewHint.textContent=T.garageTapPreview;extra.appendChild(previewHint);
    const list=document.createElement('div');list.className='garage-list';
    CAR_NAMES.forEach((key,i)=>{
      const row=document.createElement('div');row.className='garage-row';
      const owned=ownedStyleIds().includes(i),supporterSkin=supporterSkinEnabled(i);if(owned)row.classList.add('owned');if(i>=7)row.classList.add('rare');if(supporterSkin)row.classList.add('supporter-skin');
      const preview=document.createElement('span');preview.className=`garage-preview${garagePreviewId===i?' previewing':''}${supporterSkin?' supporter-skin':''}`;preview.style.setProperty('--car-color',supporterSkinColor(i));preview.setAttribute('role','button');preview.setAttribute('tabindex','0');preview.setAttribute('aria-label',`${T.garagePreview}: ${T[key]}`);preview.onclick=(e)=>{e.stopPropagation();garageSetPreview(i,fromPause);};preview.onkeydown=(e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();garageSetPreview(i,fromPause);}};
      const copy=document.createElement('div');const name=document.createElement('strong');name.textContent=supporterSkin?`${T[key]} · Gold Pulse`:T[key];const meta=document.createElement('small');
      const available=i===0||save.level>CAR_REQUIREMENTS[i],selected=owned&&save.favoriteCar===i;
      const shortfall=Math.max(0,(CAR_COSTS[i]||0)-save.coins);
      meta.textContent=(selected?T.selected:owned?T.owned:available?(shortfall>0?`${CAR_COSTS[i]} 🪙 · ${T.needCoins} ${shortfall}`:`${CAR_COSTS[i]} 🪙 · ${T.readyToBuy}`):`${T.locked} ${CAR_REQUIREMENTS[i]}`)+(supporterSkin?' · ✦ Gold Pulse':'')+(i>=7?` · ✦ ${T.rare}`:'');copy.append(name,meta);
      const b=document.createElement('button');b.type='button';
      if(owned){
        b.textContent=selected?`★ ${T.selected}`:T.select;b.disabled=selected;
        b.onclick=()=>{if(selected)return;save.favoriteCar=i;garagePreviewId=i;persist();updateHud();showGarage(fromPause?'pause':'rerender');};
      }else if(!available){b.textContent='🔒';b.disabled=true;}else{
        b.textContent=`${T.buy} ${CAR_COSTS[i]}`;b.disabled=save.coins<CAR_COSTS[i];b.title=b.disabled?T.notEnough:'';
        b.onclick=()=>void purchaseGarageCar(i,fromPause);
      }
      row.append(preview,copy,b);list.appendChild(row);
    });
    extra.appendChild(list);
    actions([{text:T.close,cls:'primary',fn:()=>{if(fromPause){showPause();return;}closeOverlay();if(resumeAfter){resumePausedGameplay();}}}]);openOverlay();
  }

  function appendDailySummary(container,best){
    if(!best)return; const sum=document.createElement('div'); sum.className='daily-summary';
    const items=[[T.dailyBest,'⭐'.repeat(safeInt(best.stars,1,3,1))],[T.switchesShort,String(safeInt(best.switches,0,9999,9999))],[T.queueShort,String(safeInt(best.maxQueue,0,999,999))]];
    for(const [label,value] of items){const span=document.createElement('span'),b=document.createElement('b');span.append(document.createTextNode(label));b.textContent=value;span.appendChild(b);sum.appendChild(span);}
    container.appendChild(sum);
  }

  function appendPersonalBestComparison(container,comparison){
    if(!comparison?.previous||!comparison?.current)return;const wrap=document.createElement('div');wrap.className='pb-comparison';const title=document.createElement('strong');title.className='pb-comparison-title';title.textContent=comparison.newBest?`🏆 ${pbText('newBest')}`:`🏁 ${pbText('compare')}`;wrap.appendChild(title);
    const rows=[['⭐',pbText('stars'),comparison.previous.stars,comparison.current.stars,comparison.delta.stars,1],['↔',pbText('switches'),comparison.previous.switches,comparison.current.switches,comparison.delta.switches,-1],['🚦',pbText('queue'),comparison.previous.maxQueue,comparison.current.maxQueue,comparison.delta.maxQueue,-1]];
    for(const [icon,label,before,now,delta,betterDirection] of rows){const row=document.createElement('div');row.className='pb-comparison-row';const left=document.createElement('span');left.textContent=`${icon} ${label}`;const value=document.createElement('b');const sign=delta>0?`+${delta}`:String(delta);value.textContent=`${before} → ${now}${delta?` (${sign})`:''}`;if(delta)value.classList.add(delta*betterDirection>0?'better':'worse');row.append(left,value);wrap.appendChild(row);}if(!comparison.hadLiveTrace){const note=document.createElement('small');note.textContent=pbText('noTrace');wrap.appendChild(note);}container.appendChild(wrap);
  }

  function beginEndless(seed=0){
    Game.endlessWave=1;Game.endlessScore=0;Game.endlessSessionSeed=seed||hashText(`endless:${platform.now()}:${save.sessions}:${Math.random()}`);Game.userPaused=false;Game.startLevel(28,false,'endless');
  }
  function showEndlessIntro(origin='game'){
    if(save.level<20){toast(T.endlessLocked);return;}
    const resumeAfter=origin==='game'&&Game.state==='playing'&&!Game.userPaused;if(resumeAfter){Game.userPaused=true;platform.gameplayStop();}
    $('modal-kicker').textContent=T.endlessDistrict;$('modal-title').textContent=`♾ ${T.endlessMode}`;$('modal-text').textContent=T.endlessDesc;$('modal-stars').textContent='';$('modal-reward').classList.add('hidden');
    const extra=$('modal-extra');extra.classList.remove('hidden');extra.textContent='';const best=document.createElement('div');best.className='daily-streak';best.textContent=`🏆 ${T.endlessBest}: ${save.endlessBestScore||0} · ${T.endlessWave} ${save.endlessBestWave||0}`;extra.appendChild(best);
    actions([{text:T.endlessStart,cls:'primary',fn:()=>beginEndless()},{text:T.close,fn:()=>{closeOverlay();if(resumeAfter){resumePausedGameplay();}else if(origin==='pause')showPause();}}]);openOverlay();
  }
  function showEndlessFail(type,improved=false){
    $('modal-kicker').textContent=T.endlessDistrict;$('modal-title').textContent=improved?`🏆 ${T.endlessNewBest}`:(type==='crash'?T.crash:T.trafficJam);$('modal-text').textContent=`${T.endlessWave}: ${Game.endlessWave} · ${T.endlessScore}: ${Game.endlessScore}`;$('modal-stars').textContent='';$('modal-reward').classList.add('hidden');
    const extra=$('modal-extra');extra.classList.remove('hidden');extra.textContent=`${T.endlessBest}: ${save.endlessBestScore||0} · ${T.endlessWave} ${save.endlessBestWave||0}`;
    actions([{text:T.endlessReplay,cls:'primary',fn:()=>beginEndless()},{text:T.endlessReturn,fn:()=>Game.startLevel(save.level,false,'campaign')}]);openOverlay('fail');
  }

  let campaignMapContext={origin:'game',resumeAfter:false,chapter:null};
  function startCampaignLevelFromMap(level){
    const n=safeInt(level,1,1_000_000,1);if(!campaignLevelUnlocked(n)){toast(T.campaignLocked);return false;}Game.userPaused=false;Game.startLevel(n,false,'campaign');return true;
  }
  function showCampaignMap(origin='game',targetLevel=save.level){
    if(origin!=='page'){
      const resumeAfter=origin==='game'&&Game.state==='playing'&&!Game.userPaused;campaignMapContext={origin,resumeAfter,chapter:campaignChapterForLevel(targetLevel)};if(resumeAfter){Game.userPaused=true;platform.gameplayStop();}
    }else campaignMapContext.chapter=campaignChapterForLevel(targetLevel);
    const catalog=campaignCatalog(campaignMapContext.chapter||campaignChapterForLevel(save.level)),ch=catalog.chapter,modal=document.querySelector('.modal');modal?.classList.add('campaign-map-modal');
    $('modal-kicker').textContent=T.campaignChapter;$('modal-title').textContent=`🗺️ ${ch.title}`;$('modal-text').textContent=T.campaignMapDesc;$('modal-stars').textContent=`⭐ ${save.totalStars}`;$('modal-reward').classList.add('hidden');
    const extra=$('modal-extra');extra.classList.remove('hidden');extra.textContent='';extra.className='modal-extra campaign-map-extra';
    const progress=campaignProgressSummary(ch);
    const summary=document.createElement('div');summary.className='campaign-map-summary';summary.textContent=`${T.level} ${ch.start}–${ch.end} · ${T.campaignCompleted}: ${progress.completed}/${progress.total}`;extra.appendChild(summary);
    appendCityGrowthPanel(extra,ch.start);
    const progressPanel=document.createElement('section');progressPanel.className='campaign-progress-panel';progressPanel.setAttribute('aria-label',T.campaignProgress);
    const progressHead=document.createElement('div');progressHead.className='campaign-progress-head';const progressTitle=document.createElement('strong');progressTitle.textContent=T.campaignProgress;const progressStars=document.createElement('span');progressStars.textContent=`${T.campaignStars}: ${progress.chapterStars}/${progress.chapterStarsMax}★ · ${T.campaignMedals}: ${progress.chapterMedals}/${progress.chapterMedalsMax}🏅`;progressHead.append(progressTitle,progressStars);
    const progressTrack=document.createElement('div');progressTrack.className='campaign-progress-track';progressTrack.setAttribute('role','progressbar');progressTrack.setAttribute('aria-valuemin','0');progressTrack.setAttribute('aria-valuemax',String(progress.total));progressTrack.setAttribute('aria-valuenow',String(progress.completed));const progressFill=document.createElement('span');progressFill.style.width=`${Math.round(progress.levelProgress*100)}%`;progressTrack.appendChild(progressFill);progressPanel.append(progressHead,progressTrack);
    const rewards=document.createElement('div');rewards.className='campaign-reward-grid';
    const rewardCard=(icon,label,value,accent='')=>{const card=document.createElement('div');card.className=`campaign-reward-card${accent?' '+accent:''}`;const i=document.createElement('span');i.className='campaign-reward-icon';i.textContent=icon;const copy=document.createElement('div');const l=document.createElement('small');l.textContent=label;const v=document.createElement('strong');v.textContent=value;copy.append(l,v);card.append(i,copy);rewards.appendChild(card);};
    if(progress.nextCar){const carValue=progress.nextCar.ready?`${progress.nextCar.name} · ${T.campaignReady}`:progress.nextCar.remaining>0?`${progress.nextCar.name} · ${progress.nextCar.remaining} ${T.campaignLevelsToGo}`:`${progress.nextCar.name} · ${progress.nextCar.status}`;rewardCard('🚗',T.campaignNextCar,carValue,progress.nextCar.ready?'ready':'');}else rewardCard('🚗',T.campaignNextCar,T.allCars,'complete');
    rewardCard('⭐',T.campaignMasteryBonus,`${progress.starsToBonus} ${T.campaignStarsToGo}`);
    rewardCard('🎯',T.campaignMissionBonus,`${progress.missionsToBonus} ${T.campaignMissionsToGo}`);
    rewardCard('🌆',T.campaignNextDistrictGoal,progress.nextDistrict.remaining>0?`${progress.nextDistrict.title} · ${progress.nextDistrict.remaining} ${T.campaignLevelsToGo}`:`${progress.nextDistrict.title} · ${T.campaignReady}`,progress.nextDistrict.remaining===0?'ready':'');
    progressPanel.appendChild(rewards);extra.appendChild(progressPanel);
    const grid=document.createElement('div');grid.className='campaign-level-grid';
    for(const item of catalog.levels){const b=document.createElement('button');b.type='button';b.className=`campaign-level${item.completed?' completed':''}${item.current?' current':''}${item.unlocked?'':' locked'}`;b.disabled=!item.unlocked;b.dataset.level=String(item.level);const top=document.createElement('span');top.className='campaign-level-top';top.textContent=`${item.level}`;const stars=document.createElement('span');stars.className='campaign-level-stars';stars.textContent=item.stars?'⭐'.repeat(item.stars)+'☆'.repeat(3-item.stars):(item.completed?'☆☆☆':'');const meta=document.createElement('small');meta.textContent=`${item.current?T.campaignCurrent:item.missionDone?`🎯 ${T.campaignMissionDone}`:item.mission?`🎯 ${T.campaignMissionOpen}`:item.completed?T.campaignCompleted:T.campaignLocked}${item.unlocked?` · 🏅${item.medals}/3`:''}`;const status=item.current?T.campaignCurrent:item.completed?T.campaignCompleted:T.campaignLocked;b.setAttribute('aria-label',`${T.level} ${item.level}. ${status}. ${item.stars}/3 ⭐. ${T.medals}: ${item.medals}/3${item.missionDone?`. ${T.campaignMissionDone}`:item.mission?`. ${T.campaignMissionOpen}`:''}`);b.append(top,stars,meta);if(item.unlocked)b.onclick=()=>startCampaignLevelFromMap(item.level);grid.appendChild(b);}extra.appendChild(grid);
    const next=catalog.next,peek=document.createElement('div');peek.className='campaign-next-peek';peek.textContent=`${T.campaignNextChapter}: ${campaignChapterTitle(next)} · ${T.level} ${next.start}`;peek.classList.toggle('locked',next.start>save.level);extra.appendChild(peek);
    const mapActions=[];if(catalog.prev)mapActions.push({text:`← ${T.campaignPrevChapter}`,fn:()=>showCampaignMap('page',catalog.prev.start)});mapActions.push({text:`▶ ${T.campaignContinue}`,cls:'primary',fn:()=>startCampaignLevelFromMap(save.level)});if(next.start<=save.level)mapActions.push({text:`${T.campaignNextChapter} →`,fn:()=>showCampaignMap('page',next.start)});mapActions.push({text:`🎮 ${T.campaignModes}`,fn:()=>{modal?.classList.remove('campaign-map-modal');extra.className='modal-extra';modeHubContext={origin:campaignMapContext.origin==='pause'?'pause':'game',resumeAfter:Boolean(campaignMapContext.resumeAfter)};showModeHub('return');}});mapActions.push({text:T.close,fn:()=>{modal?.classList.remove('campaign-map-modal');extra.className='modal-extra';if(campaignMapContext.origin==='hub'){showModeHub('return');return;}if(campaignMapContext.origin==='pause'){showPause();return;}if(campaignMapContext.origin==='result'){Game.startLevel(save.level,false,'campaign');return;}closeOverlay();if(campaignMapContext.resumeAfter&&Game.state==='playing'){resumePausedGameplay();}}});actions(mapActions);openOverlay();
  }
  let modeHubContext={origin:'game',resumeAfter:false};
  function showModeHub(origin='game'){
    if(origin!=='return'){
      const resumeAfter=origin==='game'&&Game.state==='playing'&&!Game.userPaused;modeHubContext={origin,resumeAfter};if(resumeAfter){Game.userPaused=true;platform.gameplayStop();}
    }
    $('modal-kicker').textContent='TRAFFIC PULSE';$('modal-title').textContent=`🎮 ${T.modesHub}`;$('modal-text').textContent=T.modesHubDesc;$('modal-stars').textContent='';$('modal-reward').classList.add('hidden');
    const extra=$('modal-extra');extra.classList.remove('hidden');extra.textContent='';appendRetentionLadder(extra);const grid=document.createElement('div');grid.className='mode-grid';extra.appendChild(grid);
    const card=(icon,title,desc,locked,fn,stars='',scenario=false)=>{const b=document.createElement('button');b.type='button';b.className=`mode-card${locked?' locked':''}${scenario?' scenario':''}`;const strong=document.createElement('strong');strong.textContent=`${icon} ${title}`;const small=document.createElement('small');small.textContent=locked?`${T.modeLocked} · ${desc}`:desc;b.append(strong,small);if(stars){const st=document.createElement('span');st.className='mode-stars';st.textContent=stars;b.appendChild(st);}b.disabled=locked;if(!locked)b.onclick=fn;grid.appendChild(b);return b;};
    card('🏁',T.modeCampaign,T.modeCampaignDesc,false,()=>showCampaignMap('hub',save.level));
    {const r=challengeRetentionSummary();card('📅',T.dailyChallenge,T.dailyDesc,save.level<4,()=>{Game.userPaused=false;Game.startLevel(28,false,'daily');},save.level>=4?`🔥 ${r.dailyCurrent}→${r.dailyProspective}/7 · +${r.dailyBonus}`:'');}
    {const r=challengeRetentionSummary();card('📆',T.weeklyChallenge,T.weeklyDesc,save.level<12,()=>{Game.userPaused=false;Game.startLevel(55,false,'weekly');},save.level>=12?`🔥 ${r.weeklyCurrent}→${r.weeklyProspective} · +${r.weeklyBonus}`:'');}
    card('♾',T.endlessMode,T.endlessDesc,save.level<20,()=>beginEndless());
    {const first=greenWaveDefinition(),locked=!greenWaveUnlocked(first),earned=greenWaveCatalog().reduce((n,d)=>n+(save.greenWaveProgress?.[greenWaveSaveKey(d)]?.stars||0),0),stars=earned?`${earned}/${greenWaveCatalog().length*3}★`:'';card('🟢',T.greenWaveMode,locked?T.greenWaveLocked:T.greenWaveDesc,locked,()=>showGreenWaveHub('hub'),stars,false);}
    for(const def of Object.values(SCENARIO_DEFINITIONS)){
      const locked=!scenarioUnlocked(def),best=save.scenarioProgress?.[scenarioSaveKey(def)]||null,stars=best?.stars?`${'⭐'.repeat(best.stars)}${'☆'.repeat(3-best.stars)}`:'';
      card(def.icon||'🎒',T[def.nameKey],T[def.goalKey],locked,()=>showScenarioIntro('hub',def.id),stars,true);
    }
    actions([{text:T.close,cls:'primary',fn:()=>{if(modeHubContext.origin==='pause'){showPause();return;}closeOverlay();if(modeHubContext.resumeAfter&&Game.state==='playing'){resumePausedGameplay();}}}]);openOverlay();
  }

  function showGreenWaveHub(origin='hub'){
    const fromGame=origin==='game',resumeAfter=fromGame&&Game.state==='playing'&&!Game.userPaused;if(resumeAfter){Game.userPaused=true;platform.gameplayStop();}
    $('modal-kicker').textContent=T.greenWaveDistrict;$('modal-title').textContent=`🟢 ${T.greenWaveChallenges}`;$('modal-text').textContent=T.greenWaveChallengesDesc;$('modal-stars').textContent='';$('modal-reward').classList.add('hidden');
    const extra=$('modal-extra');extra.classList.remove('hidden');extra.textContent='';const grid=document.createElement('div');grid.className='mode-grid greenwave-grid';extra.appendChild(grid);
    for(const def of greenWaveCatalog()){
      const unlocked=greenWaveUnlocked(def),best=save.greenWaveProgress?.[greenWaveSaveKey(def)]||null,b=document.createElement('button');b.type='button';b.className=`mode-card greenwave-card${unlocked?'':' locked'}`;b.disabled=!unlocked;
      const strong=document.createElement('strong');strong.textContent=`${def.icon||'🟢'} ${def.order}. ${T[def.nameKey]}`;const small=document.createElement('small');small.textContent=unlocked?T[def.goalKey]:T.greenWaveChallengeLocked;b.append(strong,small);
      const st=document.createElement('span');st.className='mode-stars';st.textContent=best?.stars?`${'⭐'.repeat(best.stars)}${'☆'.repeat(3-best.stars)}`:(unlocked?'☆☆☆':'🔒');b.appendChild(st);if(unlocked)b.onclick=()=>showGreenWaveIntro('catalog',def.id);grid.appendChild(b);
    }
    actions([{text:T.greenWaveReturn,fn:()=>{if(origin==='hub'){showModeHub('return');return;}closeOverlay();if(resumeAfter){resumePausedGameplay();}}}]);openOverlay();
  }

  function showGreenWaveIntro(origin='game',id='catch_wave'){
    const def=greenWaveDefinition(id);if(!def)return;if(!greenWaveUnlocked(def)){toast(T.greenWaveLocked);return;}const resumeAfter=origin==='game'&&Game.state==='playing'&&!Game.userPaused;if(resumeAfter){Game.userPaused=true;platform.gameplayStop();}const best=save.greenWaveProgress?.[greenWaveSaveKey(def)]||null;
    $('modal-kicker').textContent=T.greenWaveDistrict;$('modal-title').textContent=`🟢 ${T[def.nameKey]}`;$('modal-text').textContent=T[def.descriptionKey];$('modal-stars').textContent=best&&best.stars?'⭐'.repeat(best.stars)+'☆'.repeat(3-best.stars):'';$('modal-reward').classList.add('hidden');const extra=$('modal-extra');extra.classList.remove('hidden');extra.textContent='';const goal=document.createElement('div');goal.className='daily-streak';goal.textContent=`🎯 ${T[def.goalKey]}`;extra.appendChild(goal);const note=document.createElement('div');note.textContent=`${def.order} / ${GREEN_WAVE_ORDER.length} · ${T.greenWaveLeft} / ${T.greenWaveRight} · ${T.greenWaveNoCoins}`;extra.appendChild(note);if(best){const line=document.createElement('div');line.textContent=`🏆 ${best.stars}/3★ · ${T.greenWaveThrough}: ${best.throughNoStop}/${best.throughTotal} · ${T.greenWaveSideQueue}: ${best.bestSideQueue}`;extra.appendChild(line);}actions([{text:T.greenWaveStart,cls:'primary',fn:()=>{Game.userPaused=false;Game.startGreenWave(def.id);}},{text:T.close,fn:()=>{if(origin==='catalog'){showGreenWaveHub('hub');return;}if(origin==='hub'){showModeHub('return');return;}closeOverlay();if(resumeAfter){resumePausedGameplay();}}}]);openOverlay();
  }
  function showGreenWaveWin(def,stars,previous,result,best){
    const improved=!previous||best===result||best.stars>(previous.stars||0)||best.throughNoStop>(previous.throughNoStop||0);
    $('modal-kicker').textContent=T.greenWaveDistrict;$('modal-title').textContent=`🟢 ${stars===3?T.perfect:stars===2?T.good:T.survived}`;$('modal-text').textContent=T[def.nameKey];$('modal-stars').textContent='⭐'.repeat(stars)+'☆'.repeat(3-stars);$('modal-reward').classList.add('hidden');
    const extra=$('modal-extra');extra.classList.remove('hidden');extra.textContent=`${improved?'🏆 ':''}${T.greenWaveThrough}: ${result.throughNoStop}/${result.throughTotal} · ${T.greenWaveSideQueue}: ${result.bestSideQueue}${(def.objectives?.priorityRequired||0)?` · ${T.greenWavePriority}: ${result.bestPriority||0}`:''} · ${T.switchesShort}: ${result.bestSwitches} · ${T.greenWaveNoCoins}`;
    const next=greenWaveNext(def),items=[{text:T.greenWaveReplay,cls:'primary',fn:()=>Game.startGreenWave(def.id)}];if(next&&greenWaveUnlocked(next))items.push({text:T.greenWaveNext,fn:()=>showGreenWaveIntro('catalog',next.id)});items.push({text:`🟢 ${T.greenWaveChallenges}`,fn:()=>showGreenWaveHub('hub')},{text:T.greenWaveReturn,fn:()=>Game.startLevel(save.level,false,'campaign')});actions(items);openOverlay('win');
  }

  function showScenarioIntro(origin='game',id='after_school'){
    const def=scenarioDefinition(id);if(!def)return;if(!scenarioUnlocked(def)){toast(T.scenarioLocked);return;}
    const resumeAfter=origin==='game'&&Game.state==='playing'&&!Game.userPaused;if(resumeAfter){Game.userPaused=true;platform.gameplayStop();}
    const best=save.scenarioProgress?.[scenarioSaveKey(def)]||null;
    $('modal-kicker').textContent=T.scenarioDistrict;$('modal-title').textContent=`🎒 ${T[def.nameKey]}`;$('modal-text').textContent=T[def.descriptionKey];$('modal-stars').textContent=best&&best.stars?'⭐'.repeat(best.stars)+'☆'.repeat(3-best.stars):'';$('modal-reward').classList.add('hidden');
    const extra=$('modal-extra');extra.classList.remove('hidden');extra.textContent='';if(def.experimental){const exp=document.createElement('div');exp.className='roundabout-experimental';exp.textContent=`🧪 ${T.roundaboutExperimental} · ${T.roundaboutMetering}`;extra.appendChild(exp);}const goal=document.createElement('div');goal.className='daily-streak';goal.textContent=`🎯 ${T[def.goalKey]}`;extra.appendChild(goal);const rule=document.createElement('div');rule.className='scenario-rule';rule.textContent=`⚙️ ${T.scenarioRule}: ${T[def.ruleKey]||''}`;extra.appendChild(rule);const note=document.createElement('div');note.textContent=T.scenarioNoCoins;extra.appendChild(note);if(best){const line=document.createElement('div');line.textContent=`🏆 ${T.scenarioBest}: ${best.stars}/3★ · ${T.queueShort} ${best.bestQueue} · ${T.switchesShort} ${best.bestSwitches}${best.bestPriority?` · 🚨 ${best.bestPriority}`:''}`;extra.appendChild(line);}
    actions([{text:T.scenarioStart,cls:'primary',fn:()=>{Game.userPaused=false;Game.startScenario(def.id);}},{text:T.close,fn:()=>{if(origin==='hub'){showModeHub('return');return;}closeOverlay();if(resumeAfter){resumePausedGameplay();}else if(origin==='pause')showPause();}}]);openOverlay();
  }
  function showScenarioWin(def,stars,previous,best){
    const improved=!previous||best.stars>(previous.stars||0)||(best.stars===(previous.stars||0)&&best.bestSwitches<(previous.bestSwitches??9999))||(best.stars===(previous.stars||0)&&best.bestSwitches===(previous.bestSwitches??9999)&&best.bestQueue<(previous.bestQueue??999));
    $('modal-kicker').textContent=T.scenarioDistrict;$('modal-title').textContent=`🎒 ${T.scenarioComplete}`;$('modal-text').textContent=T[def.nameKey];$('modal-stars').textContent='⭐'.repeat(stars)+'☆'.repeat(3-stars);$('modal-reward').classList.add('hidden');
    const extra=$('modal-extra');extra.classList.remove('hidden');extra.textContent=`${improved?'🏆 ':''}${T.scenarioBest}: ${best.stars}/3★ · ${T.queueShort} ${best.bestQueue} · ${T.switchesShort} ${best.bestSwitches}${best.bestPriority?` · 🚨 ${best.bestPriority}`:''} · ${T.scenarioNoCoins}`;
    actions([{text:T.scenarioReplay,cls:'primary',fn:()=>Game.startScenario(def.id)},{text:T.scenarioReturn,fn:()=>Game.startLevel(save.level,false,'campaign')}]);openOverlay('win');
  }

  function showDailyIntro(origin='game'){
    if(save.level<4){toast(T.dailyLocked);return;}
    const resumeAfter=origin==='game'&&Game.state==='playing'&&!Game.userPaused;
    if(resumeAfter){Game.userPaused=true;platform.gameplayStop();}
    const key=todayDailyKey(),best=save.dailyBest[key],claimed=Boolean(save.dailyRewards[key]);
    $('modal-kicker').textContent='TRAFFIC PULSE';$('modal-title').textContent=`📅 ${T.dailyChallenge}`;$('modal-text').textContent=T.dailyDesc;$('modal-stars').textContent=best?'⭐'.repeat(best.stars)+'☆'.repeat(3-best.stars):'';$('modal-reward').classList.add('hidden');
    const extra=$('modal-extra');extra.classList.remove('hidden');extra.textContent='';
    const status=document.createElement('div');status.textContent=claimed?T.dailyDone:T.dailyFirstReward;extra.appendChild(status);
    const retention=challengeRetentionSummary(key,weekStartKey());const streak=document.createElement('div');streak.className='daily-streak';streak.textContent=`🔥 ${T.dailyStreak}: ${dailyStreakIfCleared(key)} · ${T.challengeNextBonus}: +${retention.dailyBonus} ${T.coins}`;extra.appendChild(streak);appendRetentionLadder(extra,retention);
    appendDailySummary(extra,best);
    const dailyActions=[{text:T.dailyStart,cls:'primary',fn:()=>{Game.userPaused=false;Game.startLevel(28,false,'daily');}}];
    if(save.level>=12)dailyActions.push({text:`📆 ${T.weeklyStart}`,fn:()=>showWeeklyIntro('daily')});
    dailyActions.push({text:T.close,fn:()=>{closeOverlay();if(resumeAfter){resumePausedGameplay();}else if(origin==='pause')showPause();}});actions(dailyActions);openOverlay();
  }
  function showWeeklyIntro(origin='game'){
    if(save.level<12){toast(T.weeklyLocked);return;}
    const key=weekStartKey(),best=save.weeklyBest[key],claimed=Boolean(save.weeklyRewards[key]);
    $('modal-kicker').textContent=T.weeklyDistrict;$('modal-title').textContent=`📆 ${T.weeklyChallenge}`;$('modal-text').textContent=T.weeklyDesc;$('modal-stars').textContent=best?'⭐'.repeat(best.stars)+'☆'.repeat(3-best.stars):'';$('modal-reward').classList.add('hidden');
    const extra=$('modal-extra');extra.classList.remove('hidden');extra.textContent='';const status=document.createElement('div');status.textContent=claimed?T.weeklyDone:T.weeklyFirstReward;extra.appendChild(status);const retention=challengeRetentionSummary(todayDailyKey(),key);const streak=document.createElement('div');streak.className='daily-streak';streak.textContent=`🔥 ${T.weeklyStreak}: ${retention.weeklyProspective} · ${T.weeklyNextBonus}: +${retention.weeklyBonus} ${T.coins}`;extra.appendChild(streak);appendRetentionLadder(extra,retention);appendDailySummary(extra,best);
    actions([{text:T.weeklyStart,cls:'primary',fn:()=>{Game.userPaused=false;Game.startLevel(55,false,'weekly');}},{text:T.dailyChallenge,fn:()=>showDailyIntro('weekly')},{text:T.close,fn:()=>{closeOverlay();if(Game.state==='playing'&&!Game.externalPaused&&!Game.userPaused)platform.gameplayStart();}}]);openOverlay();
  }
  function showWeeklyWin(stars,reward,improved,comparison=null,streak=1,streakBonus=0){
    $('modal-kicker').textContent=T.weeklyDistrict;$('modal-title').textContent=stars===3?T.perfect:stars===2?T.good:T.survived;$('modal-text').textContent=improved?pbText('newBest'):T.completeText;$('modal-stars').textContent='⭐'.repeat(stars)+'☆'.repeat(3-stars);const rw=$('modal-reward');if(reward>0){rw.textContent=`+${reward} ${T.coins}`;rw.classList.remove('hidden');}else rw.classList.add('hidden');const extra=$('modal-extra');extra.classList.remove('hidden');extra.textContent='';const streakLine=document.createElement('div');streakLine.className='daily-streak';streakLine.textContent=`🔥 ${T.weeklyStreak}: ${streak}${streakBonus?` · ${T.weeklyStreakBonus}: +${streakBonus}`:''}`;extra.appendChild(streakLine);appendRetentionLadder(extra,challengeRetentionSummary(todayDailyKey(),Game.weeklyKey));appendDailySummary(extra,save.weeklyBest[Game.weeklyKey]);appendPersonalBestComparison(extra,comparison);actions([{text:T.weeklyReplay,cls:'primary',fn:()=>Game.startLevel(55,false,'weekly')},{text:T.weeklyReturn,fn:()=>Game.startLevel(save.level,false,'campaign')}]);openOverlay('win');
  }
  function showDailyWin(stars,reward,improved,streak=1,streakBonus=0,comparison=null){
    $('modal-kicker').textContent=T.dailyDistrict;$('modal-title').textContent=stars===3?T.perfect:stars===2?T.good:T.survived;$('modal-text').textContent=improved?pbText('newBest'):T.completeText;$('modal-stars').textContent='⭐'.repeat(stars)+'☆'.repeat(3-stars);
    const rw=$('modal-reward');if(reward>0){rw.textContent=`+${reward} ${T.coins}`;rw.classList.remove('hidden');}else rw.classList.add('hidden');
    const best=save.dailyBest[Game.dailyKey];const extra=$('modal-extra');extra.classList.remove('hidden');extra.textContent='';const streakLine=document.createElement('div');streakLine.className='daily-streak';streakLine.textContent=`🔥 ${T.dailyStreak}: ${streak}${streakBonus?` · ${T.dailyStreakBonus}: +${streakBonus}`:''}`;extra.appendChild(streakLine);appendDailySummary(extra,best);appendPersonalBestComparison(extra,comparison);
    actions([{text:T.dailyReplay,cls:'primary',fn:()=>Game.startLevel(28,false,'daily')},{text:T.dailyReturn,fn:()=>Game.startLevel(save.level,false,'campaign')}]);openOverlay('win');
  }

  function showFail(type){
    $('modal-kicker').textContent='TRAFFIC PULSE';$('modal-title').textContent=type==='crash'?T.crash:T.trafficJam;const baseText=type==='crash'?T.crashText:T.jamText;const willAssist=Game.mode==='campaign'&&(sessionFailCounts.get(Game.level)||0)>=2;$('modal-text').textContent=willAssist?`${baseText} ${T.assistNext}`:baseText;$('modal-stars').textContent='';$('modal-reward').classList.add('hidden');const failExtra=$('modal-extra');failExtra.classList.remove('hidden');failExtra.textContent=type==='crash'?`🎬 ${T.failureReplayCrash}`:`🎬 ${T.failureReplayJam}`;
    const failActions=[{text:T.tryAgain,cls:'primary',fn:()=>Game.restart()}];if(Game.mode!=='greenwave'&&(Game.failureReplayFrames?.length||0)>=2)failActions.push({text:`🎬 ${T.failureReplay}`,fn:()=>Game.playFailureReplay()});actions(failActions);openOverlay('fail');
  }
  function showWin(stars,reward,unlocked,district,starBonus=0,flowBonus=0,priorityBonus=0,newFlowRecord=false,missionSuccess=false,missionBonus=0,missionMilestoneBonus=0,unlockedAchievements=[],achievementBonus=0,syncBonus=0,firstClear=true,starImprovement=0,rewardedBonus=0){
    $('modal-kicker').textContent='TRAFFIC PULSE';$('modal-title').textContent=stars===3?T.perfect:stars===2?T.good:T.survived;$('modal-text').textContent=T.completeText;$('modal-stars').textContent='⭐'.repeat(stars)+'☆'.repeat(3-stars);
    const rw=$('modal-reward');if(reward>0){rw.textContent=`+${reward} ${T.coins}`;rw.classList.remove('hidden');}else{rw.textContent='';rw.classList.add('hidden');}
    const extra=$('modal-extra');const extras=[`🚦 ${T.queueShort}: ${Game.maxObservedQueue} · ${T.switchesShort}: ${Game.switches}`];if(firstClear)extras.push(`🪙 ${T.campaignFirstClear}`);else extras.push(`↻ ${T.campaignBaseAlreadyPaid}`);if(!firstClear&&starImprovement)extras.push(`⭐ ${T.campaignStarImprove}: +${starImprovement*15} ${T.coins}`);if(starBonus)extras.push(`⭐ ${T.starBonus}: +${starBonus} ${T.coins}`);if(flowBonus)extras.push(`⚡ ${T.flowBonus}: +${flowBonus} ${T.coins}`);if(priorityBonus)extras.push(`🚑 ${T.priorityBonus}: +${priorityBonus} ${T.coins}`);if(syncBonus)extras.push(`⚡ ${T.syncBonus}: +${syncBonus} ${T.coins}`);if(newFlowRecord)extras.push(`⚡ ${T.newFlowRecord}: ×${save.bestFlow}`);if(missionSuccess)extras.push(`🎯 ${T.missionDone}${missionBonus?`: +${missionBonus} ${T.coins}`:''}`);if(missionMilestoneBonus)extras.push(`🏆 ${T.missionMilestone}: +${missionMilestoneBonus} ${T.coins}`);if(Game.lastMedalResult){extras.push(`🏅 ${T.medals}: ${Game.lastMedalResult.count}/3`);if(Game.lastMedalResult.newCount)extras.push(`✨ ${T.medalNew}: ${Game.lastMedalResult.newLabels.join(', ')}`);}if(unlockedAchievements.length)extras.push(`🏅 ${T.achievement}: ${unlockedAchievements.map(a=>a.label).join(', ')}${achievementBonus?` · +${achievementBonus} ${T.coins}`:''}`);if(unlocked)extras.push(`🚗 ${T.newCar} ${unlocked}`);if(district)extras.push(`🌆 ${T.newDistrict} ${district}`);if(Game.mode==='campaign'){const cityNow=districtGrowthSummaryForLevel(Game.level),cityBefore=firstClear?districtGrowthSummaryForLevel(Game.level,-1):cityNow;if(firstClear&&cityNow.stage>cityBefore.stage)extras.push(`🏙️ ${T.cityGrowthWin}: ${T[cityNow.labelKey]}`);else extras.push(`🏙️ ${T.cityGrowth}: ${cityNow.completed}/${cityNow.total} · ${T[cityNow.labelKey]}`);extras.push(`🗺️ ${T.campaignNextReward}: ${campaignNextGoalText()}`);}extra.textContent=extras.join('  •  ');extra.classList.toggle('hidden',extras.length===0);
    const winActions=[{text:T.next,cls:'primary',fn:()=>Game.next()},{text:`🗺️ ${T.campaignMap}`,fn:()=>showCampaignMap('result',save.level)}];actions(winActions);openOverlay('win');
  }
  function actions(items){const box=$('modal-actions');box.innerHTML='';items.forEach(it=>{const b=document.createElement('button');b.type='button';b.textContent=it.text;b.className=it.cls||'';b.onclick=()=>it.fn?.(b);box.appendChild(b);});}
  let overlayReturnFocus=null;
  function overlayVisible(){return !$('overlay').classList.contains('hidden');}
  function overlayFocusable(){return [...$('overlay').querySelectorAll('button:not([disabled]),[href],[tabindex]:not([tabindex="-1"])')].filter(el=>el.getClientRects().length>0);}
  function focusOverlay(){const list=overlayFocusable();(list.find(el=>el.classList.contains('primary'))||list[0]||document.querySelector('.modal'))?.focus?.({preventScroll:true});}
  let overlayOpenSerial=0;
  function openOverlay(tone='neutral'){
    const o=$('overlay'),app=$('app'),wasHidden=o.classList.contains('hidden'),toneClass=tone==='win'?'win-glow':tone==='fail'?'fail-glow':'';
    if(wasHidden&&document.activeElement instanceof HTMLElement)overlayReturnFocus=document.activeElement;
    // M97 HF01: do not churn the tone class while an overlay is already visible. Re-applying
    // win-glow used to restart its compositor animation and looked like the result window blinked.
    if((toneClass&&!o.classList.contains(toneClass))||(!toneClass&&(o.classList.contains('win-glow')||o.classList.contains('fail-glow')))){
      o.classList.remove('win-glow','fail-glow');if(toneClass)o.classList.add(toneClass);
    }
    o.classList.remove('hidden');o.setAttribute('aria-hidden','false');if(app)app.inert=true;
    if(wasHidden){
      const serial=++overlayOpenSerial;o.classList.add('overlay-opening');
      setTimeout(()=>{if(serial===overlayOpenSerial)o.classList.remove('overlay-opening');},320);
    }
    requestAnimationFrame(focusOverlay);
  }
  function closeOverlay(){const o=$('overlay'),app=$('app'),wasOpen=!o.classList.contains('hidden');overlayOpenSerial++;o.classList.add('hidden');o.setAttribute('aria-hidden','true');o.classList.remove('win-glow','fail-glow','overlay-opening');document.querySelector('.modal')?.classList.remove('campaign-map-modal');if(app)app.inert=false;$('modal-stars').style.display='';$('modal-extra').className='modal-extra';$('modal-extra').replaceChildren();$('modal-actions').replaceChildren();if(wasOpen){const target=overlayReturnFocus;overlayReturnFocus=null;requestAnimationFrame(()=>{const fallback=$('signal-btn');if(target?.isConnected&&!target.closest?.('[inert]'))target.focus?.({preventScroll:true});else fallback?.focus?.({preventScroll:true});});}}
  function resumePausedGameplay(){Game.userPaused=false;if(!Game.externalPaused){platform.gameplayStart();AudioFx.recoverAfterExternalResume();}}
  function trapOverlayFocus(e){if(e.key!=='Tab'||!overlayVisible())return false;const list=overlayFocusable();if(!list.length){e.preventDefault();document.querySelector('.modal')?.focus?.({preventScroll:true});return true;}const first=list[0],last=list[list.length-1],active=document.activeElement;if(e.shiftKey&&(active===first||!$('overlay').contains(active))){e.preventDefault();last.focus();return true;}if(!e.shiftKey&&(active===last||!$('overlay').contains(active))){e.preventDefault();first.focus();return true;}return false;}

  function syncExternalPauseState(){
    const paused=Boolean(platform.pausedByPlatform||platform.browserPaused||platform.adPaused),wasPaused=Boolean(Game.externalPaused);
    if(paused!==wasPaused)YandexAudit.mark(paused?'external:pause':'external:resume',`platform=${Number(platform.pausedByPlatform)} browser=${Number(platform.browserPaused)} ad=${Number(platform.adPaused)}`);
    Game.setExternalPause(paused);
    // M107: every authoritative external-pause release (browser, Yandex platform or ad) must
    // resume from a clean fixed-step boundary. Ad/platform callbacks can restore gameplay without
    // a focus/pageshow event, so browser-only rebasing is insufficient on mobile WebKit shells.
    if(wasPaused&&!paused){Game.lastTs=performance.now();Game.accumulator=0;Game.renderAlpha=1;}
    if(paused){AudioFx.suspend();platform.gameplayStop();}
    else if(Game.state==='playing'&&!Game.userPaused&&!platform.booting){
      platform.gameplayStart();
      if(wasPaused)AudioFx.recoverAfterExternalResume();
    }
    return paused;
  }
  function startApp(){save.sessions=(save.sessions||0)+1;persist();Game.startLevel(save.level,false,'campaign');syncExternalPauseState();Game.draw();if(!Game.frameId)Game.frameId=requestAnimationFrame(t=>Game.loop(t));}

  $('coin-btn').addEventListener('click',()=>{void VKBilling.sync('garage');showGarage('game');});$('map-btn').addEventListener('click',()=>showCampaignMap('game',save.level));
  $('daily-btn').addEventListener('click',()=>showModeHub('game'));$('record-badge')?.addEventListener('click',()=>PersonalBestService.toggle());
  // M112 Hotfix03: keep a cheap gesture fallback alive for iOS/WebKit. After an ad or app
  // switch the AudioContext may remain `interrupted`/`suspended` even though gameplay resumed.
  document.addEventListener('pointerdown',()=>{
    const state=String(AudioFx.ctx?.state||'');
    if(!AudioFx.ctx||AudioFx.needsGestureResume||state==='suspended'||state==='interrupted'||state==='closed'){YandexAudit.state.audio.gestureFallbacks++;YandexAudit.mark('audio:gesture-fallback',state||'none');AudioFx.ensure();}
  },{capture:true,passive:true});
  $('signal-btn').addEventListener('click',()=>{AudioFx.ensure();Game.toggle();});
  canvas.addEventListener('pointerup',(e)=>{if(e.isPrimary===false||e.button!==0)return;e.preventDefault();AudioFx.ensure();if(independentSignals(Game)){toast(T.greenWaveChoose);return;}Game.toggle();});
  $('signal-j0-btn')?.addEventListener('click',()=>{AudioFx.ensure();Game.toggle('J0');});$('signal-j1-btn')?.addEventListener('click',()=>{AudioFx.ensure();Game.toggle('J1');});
  $('restart-btn').addEventListener('click',()=>Game.restart());$('hint-btn').addEventListener('click',()=>Game.hint());$('pause-btn').addEventListener('click',()=>Game.pause());
  document.addEventListener('keydown',(e)=>{if(trapOverlayFocus(e))return;if(e.key==='Escape'){if(Game.userPaused)Game.resume();else if(!overlayVisible())Game.pause();return;}if(overlayVisible())return;if(independentSignals(Game)&&(e.key==='1'||e.code==='Digit1')){e.preventDefault();AudioFx.ensure();Game.toggle('J0');}else if(independentSignals(Game)&&(e.key==='2'||e.code==='Digit2')){e.preventDefault();AudioFx.ensure();Game.toggle('J1');}else if(e.code==='Space'){e.preventDefault();AudioFx.ensure();if(independentSignals(Game))toast(T.greenWaveChoose);else Game.toggle();}else if(e.key.toLowerCase()==='r')Game.restart();});
  function pauseForFocusLoss(commitManual=true){
    const manualPause=commitManual&&Game.state==='playing'&&!Game.userPaused&&!platform.adBusy&&!platform.adPaused;
    platform.browserPaused=true;
    if(manualPause){Game.userPaused=true;platform.gameplayStop();showPause();}
    syncExternalPauseState();
  }
  let blurPauseTimer=0;
  function cancelBlurPause(){if(blurPauseTimer){clearTimeout(blurPauseTimer);blurPauseTimer=0;}}
  function scheduleBlurPause(){
    // M104: mobile Safari/browser chrome can emit a transient blur while the page remains visible.
    // Suspend immediately, but only convert it into an explicit player pause if focus is still lost
    // after a short bounded grace period. visibility/pagehide remain immediate authoritative signals.
    cancelBlurPause();pauseForFocusLoss(false);
    blurPauseTimer=setTimeout(()=>{blurPauseTimer=0;if(!document.hasFocus()&&!document.hidden)pauseForFocusLoss(true);},180);
  }
  function restoreBrowserFocus(){
    cancelBlurPause();
    // M105: iOS/WebKit can report visibility=visible/pageshow before window focus is restored.
    // Keep the external pause latched until both signals agree, preventing a brief hidden resume
    // (simulation/audio/GameplayAPI) while Safari or the Yandex shell is still transitioning.
    platform.browserPaused=Boolean(document.hidden||!document.hasFocus());
    // M107 centralizes resume-clock isolation in syncExternalPauseState so browser, ad and
    // platform-owned pauses all obey the same no-background-catch-up invariant.
    syncExternalPauseState();
  }
  document.addEventListener('visibilitychange',()=>{YandexAudit.state.lifecycle.visibilityChanges++;YandexAudit.mark('lifecycle:visibility',document.visibilityState||'unknown');if(document.hidden){cancelBlurPause();pauseForFocusLoss(true);AudioFx.stopTransientAudio();snapshotLocalBeforeExternalTransition();void platform.flushCloud(true);}else restoreBrowserFocus();});
  // Genuine app/tab departure requires an explicit manual resume after return. Ads are excluded:
  // Yandex ad callbacks own their lifecycle and should not strand the player on an extra pause screen.
  window.addEventListener('blur',()=>{YandexAudit.state.lifecycle.blurs++;YandexAudit.mark('lifecycle:blur');scheduleBlurPause();});
  window.addEventListener('focus',()=>{YandexAudit.state.lifecycle.focuses++;YandexAudit.mark('lifecycle:focus');restoreBrowserFocus();if(!platform.cloudReady&&navigator.onLine!==false)void platform.recoverCloudAfterReconnect();void VKBilling.sync('focus');});
  window.addEventListener('pagehide',()=>{YandexAudit.state.lifecycle.pagehides++;YandexAudit.mark('lifecycle:pagehide');cancelBlurPause();pauseForFocusLoss(true);AudioFx.stopTransientAudio();clearWorldCache();snapshotLocalBeforeExternalTransition();void platform.flushCloud(true);});
  // M136: network-aware cloud recovery also heals an offline boot where initial getPlayer/getData timed out.
  window.addEventListener('offline',()=>{clearTimeout(platform.cloudTimer);platform.cloudTimer=0;platform.cloudDirty=platform.cloudDirty||Boolean(platform.cloudFlushRequested);});
  window.addEventListener('online',()=>{if(platform.cloudReady){if(platform.cloudDirty||platform.cloudFlushRequested)platform.queueCloudSave(true);}else{void platform.recoverCloudAfterReconnect();}});
  canvas.addEventListener('contextmenu',e=>e.preventDefault());

  let layoutRefreshRaf=0;function scheduleLayoutRefresh(){canvasMetricsDirty=true;if(layoutRefreshRaf)return;layoutRefreshRaf=requestAnimationFrame(()=>{layoutRefreshRaf=0;updateViewportMetrics();Game.draw();});}
  // M103 mobile lifecycle hardening: iOS Safari can publish the final layout-viewport dimensions
  // a few frames after orientation/pageshow. Re-sample only the stable layout viewport at bounded
  // settling points; never bind board geometry to visualViewport chrome animations.
  let layoutSettleTimers=[];function scheduleSettledLayoutRefresh(){for(const id of layoutSettleTimers)clearTimeout(id);layoutSettleTimers=[];scheduleLayoutRefresh();for(const delay of [120,360])layoutSettleTimers.push(setTimeout(scheduleLayoutRefresh,delay));}
  window.addEventListener('pageshow',()=>{YandexAudit.state.lifecycle.pageshows++;YandexAudit.mark('lifecycle:pageshow');Game.lastTs=performance.now();restoreBrowserFocus();if(!platform.cloudReady&&navigator.onLine!==false)void platform.recoverCloudAfterReconnect();void VKBilling.sync('pageshow');scheduleSettledLayoutRefresh();});
  window.addEventListener('resize',scheduleLayoutRefresh,{passive:true});window.addEventListener('orientationchange',scheduleSettledLayoutRefresh,{passive:true});
  // visualViewport scroll/resize is deliberately not a layout trigger: the layout viewport is the
  // stable authority for the game board. Real window/orientation changes still refresh immediately.
  if(typeof window.ResizeObserver==='function'){const ro=new window.ResizeObserver(scheduleLayoutRefresh);ro.observe(document.querySelector('.game-card'));}

  // M88 Draft audit: explicit opt-in with ?tpdebug=1. No player identifiers or private SDK data are recorded.
  if(YANDEX_AUDIT_ENABLED||IS_DEVELOPMENT){window.__trafficPulseYandexAudit=()=>YandexAudit.snapshot();window.__trafficPulseCopyAudit=()=>YandexAudit.copyReport();window.__trafficPulseYandexValidate=()=>YandexAudit.validateSession();}

  // M195 Hotfix04 VK Play browser release: production diagnostics stripped.

  applyLanguage(); void VKBilling.init(); platform.init();
})();
