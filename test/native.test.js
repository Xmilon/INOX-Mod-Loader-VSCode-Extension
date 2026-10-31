// Mod kinds, and .hnmod packing as the launcher packs: a manifest plus the sources under mixins/<id>/.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { parse } = require('smol-toml');
const lib = require('../src/lib');

const REV = 'a'.repeat(40);

/** The entries of a zip `buf` as {name: Buffer}, read through its central directory. */
function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = {};
  for (let i = 0; i < count; i++) {
    assert.strictEqual(buf.readUInt32LE(at), 0x02014b50);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = zlib.inflateRawSync(buf.subarray(dataAt, dataAt + size));
    assert.strictEqual(lib.crc32(data), buf.readUInt32LE(at + 16), name);
    out[name] = data;
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return out;
}

function apiMod() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hnmod-'));
  const files = {
    'horizon-mixin.toml': `[mod]\nid = "wand"\nversion = "0.1.0"\n[compatibility]\nhorizon_revision = "${REV}"\n[api]\ncrate = "engine"\nentry = "create"\n[[crate]]\nid = "engine"\npath = "engine"\n`,
    'engine/Cargo.toml': '[package]\nname = "wand-engine"\n',
    'engine/src/lib.rs': 'pub fn create() {}\n',
    'engine/target/debug/out.rs': 'build output',
    'data/table.bin': 'data',
    'run/options.txt': 'a game folder',
    'notes.md': 'not packed',
  };
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

test('the kind of a mod folder comes from its manifest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kind-'));
  assert.strictEqual(lib.modKind(dir), undefined);
  fs.writeFileSync(path.join(dir, 'horizon-mod.toml'), 'id = "gems"\nname = "Gems"\n[x]\nid = "no"\n');
  assert.strictEqual(lib.modKind(dir), 'content');
  assert.strictEqual(lib.topLevelId(fs.readFileSync(path.join(dir, 'horizon-mod.toml'), 'utf8')), 'gems');
  fs.rmSync(dir, { recursive: true });
});

test('an API mod packs as the launcher packs it, the same bytes each time', () => {
  const dir = apiMod();
  const mixin = parse(fs.readFileSync(path.join(dir, 'horizon-mixin.toml'), 'utf8'));
  const packed = lib.packNative(dir, mixin);
  assert.strictEqual(packed.id, 'wand');
  const files = unzip(packed.bytes);
  assert.deepStrictEqual(Object.keys(files), [
    'horizon-native.json',
    'mixins/wand/data/table.bin',
    'mixins/wand/engine/Cargo.toml',
    'mixins/wand/engine/src/lib.rs',
    'mixins/wand/horizon-mixin.toml',
  ]);
  assert.deepStrictEqual(JSON.parse(files['horizon-native.json']), {
    schema: 1,
    id: 'wand',
    version: '0.1.0',
    game: '26.3',
    horizon: REV,
    mixins: lib.MIXINS_REV,
    api: { crate: 'engine', entry: 'create' },
  });
  assert.ok(lib.packNative(dir, mixin).bytes.equals(packed.bytes));
  fs.rmSync(dir, { recursive: true });
});

test('a native mod the launcher would refuse is not packed', () => {
  const base = { mod: { id: 'wand', version: '1' }, compatibility: { horizon_revision: REV } };
  assert.match(lib.nativeManifest({ ...base, compatibility: {} }).error, /horizon_revision/);
  assert.match(lib.nativeManifest({ ...base, mod: { id: 'Wand', version: '1' } }).error, /id/);
  const api = { ...base, api: { crate: 'engine', entry: 'create' } };
  assert.match(lib.nativeManifest(api).error, /not a \[\[crate\]\]/);
  const injected = { ...api, crate: [{ id: 'engine', path: 'engine' }], injection: [{ id: 'f' }] };
  assert.match(lib.nativeManifest(injected).error, /no \[\[injection\]\]/);
  assert.deepStrictEqual(lib.nativeManifest(base).manifest.api, undefined);
});

test('templates fill only their own placeholders', () => {
  assert.strictEqual(lib.fill('{id}: use a::{B, C}; {missing}', { id: 'wand' }), 'wand: use a::{B, C}; {missing}');
  assert.strictEqual(lib.idFromName('My-Cool Mod'), 'my_cool_mod');
});
