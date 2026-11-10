// Build the minimal VK/OK static test package from the reviewed HEAD.
// This is intentionally separate from the Node/Python/server source tree:
// do not put backend code, secrets, test fixtures or development logs in the ZIP.
import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const dest=join(root,'artifacts');
const zipName='TrafficPulse_M222_VKOK_TestBuild.zip';
const archive=join(dest,zipName);
const files=[
  'index.html','style.css','app.js',
  'vkbridge.min.js','progress-core.js','campaign-access.js',
  'player-guidance-core.js','vk-games.js','vk-purchases.js',
  'payments-config.js','all-maps.png',
  'AUDIO_CREDITS.txt','THIRD_PARTY_NOTICES-VKGAMES.md'
];
assert.equal(new Set(files).size,files.length,'duplicate ZIP entry');
for(const name of files){
  assert.match(name,/^[A-Za-z0-9_.-]+$/,'flat ASCII archive filenames only');
  assert.ok(existsSync(join(root,name)),`required shipping asset missing: ${name}`);
}
const html=readFileSync(join(root,'index.html'),'utf8');
const scripts=[...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m=>m[1]);
const styles=[...html.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"/g)].map(m=>m[1]);
assert.ok(scripts.length>=7,'all platform/game scripts must be loaded by the entrypoint');
assert.equal(styles.length,1,'one shipping stylesheet expected');
for(const reference of [...scripts,...styles]){
  assert.ok(!reference.startsWith('/')&&!/^https?:/.test(reference),'unexpected external script/style: '+reference);
  const name=reference.split('?')[0].split('#')[0];
  assert.ok(files.includes(name),`HTML references an unshipped asset: ${name}`);
}
assert.ok(scripts.some(x=>x.startsWith('player-guidance-core.js?v=M211')),'M211 guidance must be included');
assert.ok(scripts.some(x=>x.startsWith('vk-games.js?v=M209-VKGAMES-CLOUD-RC')),'M209 cloud adapter must be included');
assert.ok(scripts.some(x=>x.startsWith('app.js?v=M222-VKGAMES-ROAD-EVENT-CUES-RC')),'M222 gameplay entrypoint must be included');

// Keep packaging independent of local file timestamps and reject hidden extras.
// The package is built as root-level entries, matching platform upload expectations.
mkdirSync(dest,{recursive:true});
rmSync(archive,{force:true}); // reruns must never retain files from an older ZIP
execFileSync('zip',['-q','-9','-X','-j',archive,...files],{cwd:root,stdio:'pipe'});
execFileSync('unzip',['-tq',archive],{cwd:root,stdio:'pipe'});
const entries=execFileSync('unzip',['-Z1',archive],{encoding:'utf8',cwd:root}).trim().split('\n').sort();
assert.deepEqual(entries,[...files].sort(),'ZIP entries must exactly match the shipping allowlist');

const sha256=data=>createHash('sha256').update(data).digest('hex');
const manifest={
  name:'Traffic Pulse',purpose:'VK/OK manual test only — not published',
  milestone:'M222',branch:process.env.GITHUB_HEAD_REF||process.env.GITHUB_REF_NAME||'feature/m222-vkgames-road-event-cues',
  revision:process.env.GITHUB_SHA||'unrecorded',
  zip:zipName,zipSha256:sha256(readFileSync(archive)),
  assets:files.map(name=>({name,bytes:readFileSync(join(root,name)).length,sha256:sha256(readFileSync(join(root,name)))})),
  caveat:'Local browsing does not validate real VK/OK authentication, cloud saves, ads or purchases.'
};
writeFileSync(join(dest,'TrafficPulse_M222_VKOK_TestBuild_manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('PASS draft VK/OK package:',archive,'files:',files.length,'sha256:',manifest.zipSha256);
