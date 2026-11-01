import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const adapter=readFileSync(new URL('../vk-games.js',import.meta.url),'utf8');

test('campaign interstitial is attempted after every two newly cleared levels',()=>{
  assert.match(app,/shouldRequestFullscreen\(level\)\{return this\.lastCampaignFirstClear&&level>=2&&level%2===0;\}/);
  assert.match(app,/this\.lastCampaignFirstClear&&platform\.shouldRequestFullscreen\(completed\)/);
  assert.doesNotMatch(app,/level%4===0/);
});

test('campaign win offers rewarded extra coins and grants only after rewarded success',()=>{
  assert.match(app,/async function claimWinRewardedCoins/);
  assert.match(app,/const rewarded=await platform\.showRewarded\(\);if\(!rewarded\)\{toast\(T\.adUnavailable\);return false;\}/);
  assert.match(app,/save\.coins\+=amount;persist\(\);updateHud\(\)/);
  assert.match(app,/T\.adDoubleCoins/);
});

test('garage offers rewarded car unlock without charging coins',()=>{
  assert.match(app,/async function unlockGarageCarByAd/);
  assert.match(app,/save\.ownedCars=\[\.\.\.new Set\(\[\.\.\.ownedStyleIds\(\),id\]\)\]/);
  assert.match(app,/T\.adUnlockCar/);
});

test('VK adapter implements native banner check show hide and adaptive layouts',()=>{
  assert.match(adapter,/VKWebAppCheckBannerAd/);
  assert.match(adapter,/VKWebAppShowBannerAd/);
  assert.match(adapter,/VKWebAppHideBannerAd/);
  assert.match(adapter,/mode:'desktop-side'/);
  assert.match(adapter,/orientation:'vertical'/);
  assert.match(adapter,/mode:'mobile-bottom'/);
  assert.match(adapter,/orientation:'horizontal'/);
});
