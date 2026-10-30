// The schema accepts the real Ruby mod and refuses what the game refuses.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const { parse } = require('smol-toml');

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schemas', 'inox.schema.json'), 'utf8'));
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
const check = (toml) => (validate(parse(toml)) ? [] : validate.errors.map((e) => `${e.instancePath} ${e.message}`));
const MOD = '[mod]\nid = "m"\nname = "M"\nversion = "1"\n';

test('a full mod is accepted', () => {
  const ruby = path.join(__dirname, 'fixtures', 'ruby.inox.toml');
  assert.deepStrictEqual(check(fs.readFileSync(ruby, 'utf8')), []);
});

test('tools, tags and tabs are accepted', () => {
  const toml = `${MOD}
[tools.gem]
tier = "iron"
durability = 800
speed = 7.0
damage = 2.5
repair = "gem"
[tag.item.gems]
values = ["gem", "minecraft:diamond", "#c:gems"]
[tag."worldgen/biome".lands]
values = ["minecraft:plains"]
replace = true
[tab.gear]
name = "Gear"
icon = "gem"
items = ["gem"]
`;
  assert.deepStrictEqual(check(toml), []);
});

test('mistakes the game refuses are marked', () => {
  const bad = [
    `${MOD}[block.a]\ntemplate = "minecraft:stone"\ncolour = 1\n`,
    `${MOD}[block.A]\ntemplate = "minecraft:stone"\n`,
    `${MOD}[block.a]\ntemplate = "minecraft:stone"\ntool = "sword"\n`,
    `${MOD}[block.a]\ntemplate = "minecraft:stone"\nlight = 16\n`,
    `${MOD}[item.s]\ntemplate = "minecraft:iron_sword"\nattack_damage = 7\n`,
    `${MOD}[ore.o]\nblock = "x"\nsize = 99\ncount = 2\nmin_y = 0\nmax_y = 10\n`,
    `${MOD}[armor.a]\ndurability = 5\ndefense = [1, 2, 3]\n`,
    `${MOD}[tools.t]\ntier = "copper"\ndurability = 9\nspeed = 2.0\ndamage = 1.0\n`,
    `[mod]\nid = "Bad"\nname = "x"\nversion = "1"\n`,
    `[mod]\nid = "m"\nname = "x"\n`,
  ];
  for (const toml of bad) assert.notDeepStrictEqual(check(toml), [], toml);
});
