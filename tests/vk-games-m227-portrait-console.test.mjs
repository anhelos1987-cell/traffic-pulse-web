import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../style.css',import.meta.url),'utf8');

test('M227: mobile deck derives entirely from current campaign mode and level',()=>{
  assert.match(app,/classList\.toggle\('dispatch-portrait-deck',Game\.mode==='campaign'&&Game\.level>=1&&Game\.level<=10\)/);
  assert.match(css,/@media \(max-width:520px\) and \(min-width:350px\) and \(min-height:740px\) and \(orientation:portrait\)/);
  assert.match(css,/html\.dispatch-portrait-deck \.game-card\{/);
  assert.match(css,/padding-top:65px;padding-bottom:55px/);
  assert.match(css,/html\.dispatch-portrait-deck \.game-card canvas\{/);
  assert.match(css,/width:100%;height:auto;aspect-ratio:1\/1/);
});
test('M227: quarter landmarks are four unique authored vector silhouettes',()=>{
  const start=app.indexOf('  function drawDispatchAtlasQuarter('),end=app.indexOf('  function drawDispatchAtlasBase(',start);
  assert.ok(start>=0&&end>start);
  const quarter=app.slice(start,end);
  for(const key of ["index===0","index===1","index===2","else{ // PLAZA"])
    assert.ok(quarter.includes(key),'Missing landmark '+key);
  assert.match(quarter,/g\.arc\(tx,ty,r,0,Math\.PI\*2\)/);
  assert.match(quarter,/g\.fillRect\(228,23,8,23\)/);
  assert.match(quarter,/g\.arc\(199,66,27,0,Math\.PI\*2\)/);
  assert.match(app,/drawRoadSurface\(g,lanes\);drawSidewalkFrame\(g,lanes\)/,'roads still drawn from original simulator');
});
test('M227: atlas deck has a unique decorative mark with no new interaction',()=>{
  assert.match(html,/<div class="dispatch-console-stamp" aria-hidden="true">/);
  assert.equal((html.match(/class="dispatch-console-stamp"/g)||[]).length,1);
  assert.match(css,/\.dispatch-console-stamp\{display:none\}/);
  assert.match(css,/pointer-events:none/);
  assert.match(html,/src="app\.js\?v=M228-VKGAMES-FIRST-TEN-AUDIT-ATLAS-CONTINUITY"/);
});
