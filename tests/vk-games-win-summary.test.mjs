import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const begin=app.indexOf('  function showWin(');
const end=app.indexOf('  function actions(items){',begin);
assert.ok(begin>0&&end>begin,'extract the actual player-facing campaign victory dialog');
const shipping=app.slice(begin,end);
class Element{
  constructor(tag='div'){this.tagName=tag;this.children=[];this.className='';this._text='';this.open=false;
    const names=new Set();
    this.classList={add:k=>names.add(k),remove:k=>names.delete(k),
      contains:k=>names.has(k),toggle:(k,force)=>{const on=force===undefined?!names.has(k):Boolean(force);if(on)names.add(k);else names.delete(k);return on;}};
  }
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(x=>x.textContent).join('');}
  append(...nodes){this.children.push(...nodes);}
  appendChild(node){this.children.push(node);return node;}
  replaceChildren(...nodes){this._text='';this.children=[...nodes];}
}
const find=(node,cls)=>{
  if(node.className.split(' ').includes(cls))return node;
  for(const child of node.children){const found=find(child,cls);if(found)return found;}
  return null;
};
function harness(lang='ru'){
  const elements=new Map(),$=id=>{
    if(!elements.has(id))elements.set(id,new Element(id));
    return elements.get(id);
  };
  const T=new Proxy({perfect:'Идеально!',good:'Хорошо!',survived:'Готово!',
    completeText:'Пройдено!',next:'Следующий уровень',coins:'монет',queueShort:'Пик пробки',
    switchesShort:'Переключения',medals:'Медали',missionDone:'Миссия выполнена',newCar:'Новая машина',
    newDistrict:'Новый район',cityGrowth:'Город',campaignNextReward:'Дальше',label:'Зелёный город'},
    {get:(obj,key)=>Object.hasOwn(obj,key)?obj[key]:String(key)});
  const game={level:3,mode:'campaign',maxObservedQueue:2,switches:1,
    lastMedalResult:{count:3,newCount:1,newLabels:['Поток']},
    rewardedWinClaimed:false,config:{}};
  let capturedActions=null,overlay=null;
  const ctx={document:{createElement:tag=>new Element(tag)},$,T,Game:game,lang,
    save:{bestFlow:6,level:4},firstSessionNextLesson:()=>null,
    campaignStarFeedbackText:()=>'',districtGrowthSummaryForLevel:()=>({stage:1,completed:3,total:10,labelKey:'label'}),
    campaignNextGoalText:()=> 'Такси готово',actions:list=>{capturedActions=list;},
    openOverlay:tone=>{overlay=tone;}};
  runInNewContext(shipping+'\nglobalThis.render=showWin;',ctx,{filename:'shipping-win-ui.js'});
  return {render:ctx.render,$,game,actions:()=>capturedActions,overlay:()=>overlay};
}
test('M216: player win shows two readable stats and keeps full report collapsed',()=>{
  const h=harness();
  h.render(3,259,'Такси','Центр',120,16,0,true,true,90,0,[{label:'Идеальный диспетчер'}],125,8,true,0,134);
  const extra=h.$('modal-extra'),stats=find(extra,'win-summary-stats'),
    details=find(extra,'win-breakdown'),list=find(extra,'win-breakdown-list');
  assert.equal(extra.className,'modal-extra win-summary-extra');
  assert.equal(stats.children.length,2);
  assert.match(stats.children[0].textContent,/Пик пробки2/);
  assert.match(stats.children[1].textContent,/Переключения1/);
  assert.equal(details.open,false,'full reward report must start collapsed');
  assert.equal(details.children[0].tagName,'summary','native accessible disclosure');
  assert.match(details.children[0].textContent,/Все награды и достижения/);
  assert.ok(list.children.length>=8,'existing reward/mission/progression lines are preserved');
  const all=list.textContent;
  for(const word of ['Медали','Такси','Идеальный диспетчер','125','120','Город'])
    assert.ok(all.includes(word),'detail report lost '+word);
  assert.equal(h.$('modal-reward').textContent,'+259 монет','actual reward math untouched');
  assert.equal(h.actions().length,3,'Next, rewarded ad and map must remain functional');
  assert.equal(h.overlay(),'win');
});
test('M216: a two-star clear exposes actionable next-star tip and English disclosure',()=>{
  const h=harness('en');
  h.game.maxObservedQueue=4;h.game.switches=7;
  // Format function is part of actual shipping app; verify that the
  // summary keeps a dedicated slot for feedback without needing a new action.
  const source=app.slice(app.indexOf('  function showWin('),app.indexOf('  function actions(items){'));
  assert.match(source,/if\(starTip\)\{const hint=document\.createElement\('div'\)/);
  h.render(2,120,'','',0,0,0,false,false,0,0,[],0,0,false,0,0);
  const details=find(h.$('modal-extra'),'win-breakdown');
  assert.equal(details.children[0].textContent,'All rewards and achievements');
  assert.equal(h.$('modal-reward').textContent,'+120 монет');
  assert.equal(h.actions().length,2,'no rewarded button if no bonus');
});
test('M216: win summary uses safe text nodes rather than innerHTML',()=>{
  assert.doesNotMatch(shipping,/\.innerHTML\s*=/);
  assert.match(shipping,/details\.append\(summary,lines\)/);
  assert.match(shipping,/extra\.replaceChildren\(\)/);
});
