const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { expand, findResources, launchArgs, modId } = require('../src/lib');

test('settings paths expand the workspace, env and home', () => {
  const env = { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' };
  assert.strictEqual(
    expand('${env:APPDATA}/horizon/x.exe', '', env, 'H'),
    path.normalize('C:\\Users\\me\\AppData\\Roaming/horizon/x.exe'),
  );
  assert.strictEqual(expand('${workspaceFolder}/run', '/mods/ruby', env, 'H'), path.normalize('/mods/ruby/run'));
  assert.strictEqual(expand('~/x', '', env, '/home/me'), path.normalize('/home/me/x'));
  assert.strictEqual(expand('', '', env), '');
});

test('the game runs the mod from its folder, in the run folder', () => {
  const s = { gameDir: '/m/run', resources: '/r/26.3' };
  assert.deepStrictEqual(launchArgs({ mod: '/m', world: 'Inox Test', creative: true, args: ['--seed', '1'] }, s), [
    '--game-dir', '/m/run', '--home', '/m/run', '--resources', '/r/26.3',
    '--dev-mod', '/m', '--world', 'Inox Test', '--creative', '--seed', '1',
  ]);
  assert.deepStrictEqual(launchArgs({ mod: '/m' }, s).slice(-2), ['--dev-mod', '/m']);
});

test('the mod id is read from [mod] only', () => {
  const toml = '[block.x]\nid = "nope"\n\n[mod]\nname = "Ruby"\nid = "ruby"\nversion = "1"\n\n[item.y]\nid = "no"\n';
  assert.strictEqual(modId(toml), 'ruby');
  assert.strictEqual(modId('[mod]\nid = "last"'), 'last');
  assert.strictEqual(modId('[item.a]\nid = "a"'), undefined);
});

test('prepared resources are found in the launcher folder, newest first', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inox-launcher-'));
  for (const v of ['v0.2.97', 'nightly-2026-10-30-1da354b', 'broken']) {
    const dir = path.join(root, 'versions', v, '.local', 'horizon-client', '26.3');
    fs.mkdirSync(dir, { recursive: true });
    if (v !== 'broken') fs.writeFileSync(path.join(dir, 'horizon-resources.json'), '{}');
  }
  assert.deepStrictEqual(
    findResources(root).map((f) => f.version),
    ['v0.2.97', 'nightly-2026-10-30-1da354b'],
  );
  assert.deepStrictEqual(findResources(path.join(root, 'missing')), []);
  fs.rmSync(root, { recursive: true });
});
