// The official Horizon formats: the manifests and data files the game and launcher accept pass,
// what they refuse is marked.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const { parse } = require('smol-toml');

const ajv = new Ajv({ allErrors: true, strict: false });
const schema = (name) => ajv.compile(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schemas', name), 'utf8')));
const errors = (validate, value) => (validate(value) ? [] : validate.errors.map((e) => `${e.instancePath} ${e.message}`));

const REV = 'a'.repeat(40);

test('horizon-mixin.toml: templates, hook names and retired API rejection', () => {
  const mixin = schema('horizon-mixin.schema.json');
  const check = (toml) => errors(mixin, parse(toml));
  for (const kind of ['mixin']) {
    const text = fs
      .readFileSync(path.join(__dirname, '..', 'templates', kind, 'horizon-mixin.toml'), 'utf8')
      .replace(/\{id\}/g, 'demo')
      .replace('{revision}', REV);
    assert.deepStrictEqual(check(text), [], kind);
  }
  const fixture = '[mod]\nid = "x"\nversion = "1"\n';
  assert.deepStrictEqual(check(`${fixture}[[injection]]\nid = "t"\nhook = "use_item"\nkind = "HEAD"\nhelper = "t.rs"\n`), []);
  // An unknown hook name, a retired API mod, a bad revision.
  assert.notDeepStrictEqual(check(`${fixture}[[injection]]\nid = "t"\nhook = "use_itme"\nkind = "HEAD"\nhelper = "t.rs"\n`), []);
  assert.notDeepStrictEqual(
    check(`${fixture}[api]\ncrate = "e"\nentry = "create"\n[[injection]]\nid = "t"\nhook = "tick"\nkind = "HEAD"\nhelper = "t.rs"\n`),
    [],
  );
  assert.notDeepStrictEqual(check(`${fixture}[api]\ncrate = \"e\"\nentry = \"create\"\n`), []);
  assert.notDeepStrictEqual(check(`${fixture}[compatibility]\nhorizon_revision = "main"\n`), []);
});

test('horizon-mod.toml: the template manifest passes, typos fail', () => {
  const manifest = schema('horizon-mod.schema.json');
  const good = 'id = "gems"\nname = "Gems"\nversion = "0.1.0"\napi = "0.2"\nside = "both"\ncapabilities = ["registries"]\n';
  assert.deepStrictEqual(errors(manifest, parse(good)), []);
  assert.notDeepStrictEqual(errors(manifest, parse(`${good}capabilites = []\n`)), []);
  assert.notDeepStrictEqual(errors(manifest, parse(good.replace('"registries"', '"blocks"'))), []);
});

test('data files: blocks, items, mob effects and creative tabs', () => {
  const block = schema('hmod-block.schema.json');
  assert.deepStrictEqual(
    errors(block, {
      template: 'minecraft:stone',
      properties: { hardness: 4, light: 3, sounds: 'minecraft:amethyst_block' },
      state_properties: { lit: { type: 'boolean' }, facing: { type: 'enum', values: ['north', 'south'] } },
      default_state: { lit: 'true', facing: 'north' },
      components: { 'minecraft:max_stack_size': 16, '!minecraft:repairable': {} },
    }),
    [],
  );
  assert.notDeepStrictEqual(errors(block, { template: 'minecraft:stone', properties: { light: 16 } }), []);
  assert.notDeepStrictEqual(errors(block, { template: 'stone' }), []);
  assert.notDeepStrictEqual(errors(block, { template: 'minecraft:stone', state_properties: { f: { type: 'enum' } } }), []);
  const item = schema('hmod-item.schema.json');
  assert.deepStrictEqual(errors(item, { template: 'minecraft:iron_sword', rarity: 'rare', components: { 'minecraft:max_damage': 900 } }), []);
  assert.notDeepStrictEqual(errors(item, { template: 'minecraft:iron_sword', max_stack_size: 100 }), []);
  const effect = schema('hmod-mob-effect.schema.json');
  assert.deepStrictEqual(errors(effect, { category: 'harmful', color: 9154528 }), []);
  assert.notDeepStrictEqual(errors(effect, { category: 'bad', color: 16777216 }), []);
  const tab = schema('hmod-creative-tab.schema.json');
  assert.deepStrictEqual(errors(tab, { title: 'Ruby', icon: 'ruby:ruby', items: ['ruby:ruby'] }), []);
});

test('horizon-native.json: as the launcher writes it, unknown keys refused', () => {
  const native = schema('horizon-native.schema.json');
  const good = { schema: 1, id: 'wand', version: '1', game: '26.3', horizon: REV, mixins: REV };
  assert.deepStrictEqual(errors(native, good), []);
  assert.notDeepStrictEqual(errors(native, { ...good, schema: 2 }), []);
  assert.notDeepStrictEqual(errors(native, { ...good, extra: true }), []);
  assert.notDeepStrictEqual(errors(native, { ...good, api: { crate: 'engine', entry: 'create' } }), []);
});
