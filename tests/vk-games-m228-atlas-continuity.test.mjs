import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

function section(a,b){
  const i=app.indexOf(a),j=app.indexOf(b,i+a.length);
  assert.ok(i>=0&&j>i,'missing app section '+a);return app.slice(i,j);
}
function focusWorld(){
  const ctx={};
  runInNewContext(section('  function dispatchFocusWorld(game){','  const DISPATCH_ATLAS_PALETTES=')+
    '\nglobalThis.focus=dispatchFocusWorld;',ctx);
  return ctx.focus;
}
test('M228: Atlas stays through first three campaign chapters, and other modes stay untouched',()=>{
  const focus=focusWorld();
  for(const n of [1,2,10,11,20,21,30])assert.equal(focus({mode:'campaign',level:n}),true,'campaign L'+n);
  for(const n of [31,45,100])assert.equal(focus({mode:'campaign',level:n}),false,'campaign L'+n);
  for(const mode of ['daily','weekly','scenario','greenwave','endless']){
    assert.equal(focus({mode,level:15}),false,mode);
  }
  assert.equal(focus({mode:'training',level:1}),true);
  assert.equal(focus(null),false);
});
test('M228: three distinct restrained palettes are authored and cached by existing district key',()=>{
  const source=section('  const DISPATCH_ATLAS_PALETTES=','  function drawDispatchAtlasQuarter(');
  const ctx={Object};
  runInNewContext(source+'\nglobalThis.palettes=DISPATCH_ATLAS_PALETTES;',ctx);
  const p=ctx.palettes;
  assert.deepEqual(Object.keys(p),['park','coast','downtown']);
  assert.equal(new Set(Object.values(p).map(x=>x.ground)).size,3);
  for(const [name,palette] of Object.entries(p)){
    assert.equal(palette.blocks.length,4,name+' blocks');
    assert.equal(palette.roofs.length,4,name+' roofs');
    assert.ok(palette.blocks.every(x=>/^#[0-9a-f]{6}$/i.test(x)),name+' solid blocks');
  }
  assert.match(app,/const cacheKey=\x60\$\{theme\.id\}:\$\{lanes\}:\$\{junctionType\}:\$\{dispatchFocus\?'focus':'city'\}\x60/);
  assert.match(app,/if\(dispatchFocus\)\{drawDispatchAtlasBase\(g,theme\.id\);\}else\{/);
});
test('M228: coast and downtown have different static vector marks without new image assets',()=>{
  const quarter=section('  function drawDispatchAtlasQuarter(', '  function drawDispatchAtlasBase(');
  assert.match(quarter,/themeId==='coast'/);
  assert.match(quarter,/themeId==='downtown'/);
  assert.match(quarter,/g\.quadraticCurveTo\(70,156\+k\*12,116,167\+k\*12\)/);
  assert.match(quarter,/for\(let i=0;i<5;i\+\+\)/);
  assert.match(html,/app\.js\?v=M228-VKGAMES-FIRST-TEN-AUDIT-ATLAS-CONTINUITY/);
  assert.match(app,/const BUILD_VERSION = 'M228-VKGAMES-FIRST-TEN-AUDIT-ATLAS-CONTINUITY';/);
});
