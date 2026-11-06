import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../vk-games.js', import.meta.url), 'utf8');
const OK_APP_ID = 512005046523;

function browserDevice(server, { userId = 8877, failInitialCloudRead = false } = {}) {
  let failNextRead = failInitialCloudRead;
  const local = new Map();
  let progress = { level: 1, coins: 0, revision: 0 };
  const bridge = {
    isEmbedded: () => true,
    supportsAsync: async method => method !== 'VKWebAppGetLaunchParams',
    async send(method, params = {}) {
      switch (method) {
        case 'VKWebAppInit': return { result: true };
        case 'VKWebAppGetUserInfo': return { id: userId };
        case 'VKWebAppStorageGet': {
          if (failNextRead) {
            failNextRead = false;
            throw new Error('temporary OK Storage startup failure');
          }
          return { keys: params.keys.map(key => ({
            key, value: server.get(userId + ':' + OK_APP_ID + ':' + key) || ''
          })) };
        }
        case 'VKWebAppStorageSet':
          server.set(userId + ':' + OK_APP_ID + ':' + params.key, params.value);
          return { result: true };
        case 'VKWebAppStorageGetKeys':
          return { keys: [...server.keys()]
            .filter(key => key.startsWith(userId + ':' + OK_APP_ID + ':'))
            .map(key => key.slice((userId + ':' + OK_APP_ID + ':').length))
            .slice(params.offset, params.offset + params.count) };
        default: throw new Error('Unexpected method: ' + method);
      }
    }
  };
  const browser = {
    vkBridge: bridge,
    crypto: webcrypto,
    TextEncoder, TextDecoder,
    btoa, atob,
    location: { search: '?vk_app_id=' + OK_APP_ID + '&vk_user_id=' + userId + '&vk_client=ok&vk_platform=desktop_web' },
    navigator: { onLine: true },
    setTimeout, clearTimeout,
    localStorage: {
      getItem: key => local.get(key) ?? null,
      setItem: (key, value) => { local.set(key, value); }
    }
  };
  runInNewContext(source, { globalThis: browser, TextEncoder, TextDecoder, URLSearchParams, setTimeout, clearTimeout, Uint8Array, Uint32Array, Date, JSON, Promise });
  const normalize = raw => ({ level: 1, coins: 0, revision: 0, ...(raw || {}) });
  const account = browser.TrafficPulseVKGames.create({
    normalize,
    merge: (localValue, remoteValue) => {
      const a = normalize(localValue), b = normalize(remoteValue);
      return { ...a, ...b, level: Math.max(a.level, b.level), coins: Math.max(a.coins, b.coins), revision: Math.max(a.revision, b.revision) };
    },
    getSave: () => progress,
    onLoad: data => { progress = normalize(data); }
  });
  return {
    account,
    get progress() { return progress; },
    update(changes) { progress = { ...progress, ...changes }; }
  };
}

test('OK desktop save is restored on OK Android for the same account', async () => {
  const server = new Map();
  const desktop = browserDevice(server);
  assert.equal(await desktop.account.init(), true);
  assert.equal(desktop.account.cloud, true);
  desktop.update({ level: 13, coins: 420, revision: 1 });
  desktop.account.changed();
  assert.equal(await desktop.account.sync(), true);
  assert.equal(desktop.account.status(), 'saved');
  const android = browserDevice(server);
  assert.equal(await android.account.init(), true);
  assert.equal(android.account.cloud, true);
  assert.equal(android.progress.level, 13);
  assert.equal(android.progress.coins, 420);
});

test('temporary OK Bridge storage failure can retry without wiping offline progress', async () => {
  const server = new Map();
  const device = browserDevice(server, { failInitialCloudRead: true });
  assert.equal(await device.account.init(), false);
  device.update({ level: 7, coins: 150, revision: 2 });
  assert.equal(await device.account.init(), true);
  assert.equal(device.progress.level, 7);
  assert.equal(device.progress.coins, 150);
  device.account.changed();
  assert.equal(await device.account.sync(), true);
  const android = browserDevice(server);
  assert.equal(await android.account.init(), true);
  assert.equal(android.progress.level, 7);
});

test('OK account A progress does not leak to account B', async () => {
  const server = new Map();
  const a = browserDevice(server, { userId: 811 });
  await a.account.init();
  a.update({ level: 24, coins: 900, revision: 2 });
  a.account.changed();
  await a.account.sync();
  const b = browserDevice(server, { userId: 812 });
  await b.account.init();
  assert.equal(b.progress.level, 1);
  assert.equal(b.progress.coins, 0);
});

test('OK ViewHide/Restore handlers route through game and audio pause authorities', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /VKWebAppViewHide/);
  assert.match(app, /VKWebAppViewRestore/);
  assert.match(app, /platform\.pausedByPlatform=true;\s*cancelBlurPause\(\);pauseForFocusLoss\(true\)/);
  assert.match(app, /AudioFx\.stopTransientAudio\(\);\s*snapshotLocalBeforeExternalTransition\(\)/);
});
