// Writes schemas/horizon-mixin.schema.json from Horizon's hook catalog, so `hook = "..."` in
// horizon-mixin.toml completes and checks against the hook points Horizon has.
//
//   node scripts/sync-hooks.js                       # from schemas/native-hooks.json (the bundled copy)
//   node scripts/sync-hooks.js <Horizon checkout>    # copy its native-hooks.json first, then write
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const catalogPath = path.join(root, 'schemas', 'native-hooks.json');
if (process.argv[2]) fs.copyFileSync(path.join(process.argv[2], 'native-hooks.json'), catalogPath);
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

/** A hook's hover text: what NeoForge calls it, where it runs, whether it can cancel. */
function describe(h) {
  const parts = [`Hook point \`${h.name}\` v${h.version}: \`${h.target.split('::').pop()}\`.`];
  if (h.neoforge) parts.push(`NeoForge: ${h.neoforge}.`);
  if (h.side) parts.push(`Runs on the ${h.side}.`);
  if (h.cancellable) parts.push('Cancellable.');
  return parts.join(' ');
}

const id = { type: 'string', pattern: '^[a-z0-9_]{1,64}$' };
const hooks = [...new Map(catalog.hooks.map((h) => [h.name, h])).values()].sort((a, b) => a.name.localeCompare(b.name));
const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'horizon-mixin.toml',
  description:
    'A Horizon native mod (.hnmod): a horizon-mixins bundle, or an API mod ([api], no [[injection]]). Reference: docs/native-mods.md in Horizon.',
  type: 'object',
  required: ['mod'],
  properties: {
    mod: {
      type: 'object',
      description: "The mod's identity: the same id and version as its .hnmod's horizon-native.json.",
      required: ['id', 'version'],
      properties: {
        id: { ...id, description: 'The mod id: [a-z0-9_], 1 to 64 characters.' },
        version: { type: 'string', minLength: 1, description: 'Its version (0.1.0).' },
      },
    },
    compatibility: {
      type: 'object',
      description: 'What it was made for.',
      properties: {
        horizon_revision: {
          type: 'string',
          pattern: '^[0-9a-f]{40}$',
          description:
            'The Horizon commit it was made and tested on (40 hex digits). Needed to pack an .hnmod and for the registry.',
        },
      },
    },
    api: {
      type: 'object',
      description:
        'An API mod: no mixin. Its crate implements horizon_mod_api::Mod and the game calls it after its hook points, so building it never recompiles horizon-client. It may have no [[injection]].',
      required: ['crate', 'entry'],
      additionalProperties: false,
      properties: {
        crate: { ...id, description: 'The [[crate]] (its id) holding the mod.' },
        entry: {
          type: 'string',
          pattern: '^[A-Za-z_][A-Za-z0-9_]*(::[A-Za-z_][A-Za-z0-9_]*)*$',
          description: 'A public fn() -> Box<dyn horizon_mod_api::Mod> in that crate (create).',
        },
      },
    },
    injection: {
      type: 'array',
      description: 'Where the mod injects code: a named hook point (hook + hook_version), or a raw target.',
      items: {
        type: 'object',
        required: ['id', 'kind', 'helper'],
        properties: {
          id: { type: 'string', minLength: 1, description: 'A name for this injection.' },
          hook: {
            description: 'A hook point of native-hooks.json, by name: it moves with the source.',
            oneOf: hooks.map((h) => ({ const: h.name, description: describe(h) })),
          },
          hook_version: { type: 'integer', minimum: 1, description: 'The hook contract version (1 for most).' },
          target: {
            type: 'string',
            description: 'A raw path in the source (horizon_client::game::...). Prefer hook.',
          },
          kind: {
            type: 'string',
            examples: ['HEAD', 'RETURN', 'MODIFY_ARG', 'OVERWRITE'],
            description: "Where and how the helper runs (HEAD for hook points; horizon-mixins' README lists every kind).",
          },
          helper: { type: 'string', pattern: '\\.rs$', description: 'The .rs file (in the bundle) with the code.' },
          bindings: {
            type: 'array',
            description: 'What the helper receives: a name, its type and the expression for it.',
            items: {
              type: 'object',
              required: ['name', 'ty', 'value'],
              properties: { name: { type: 'string' }, ty: { type: 'string' }, value: { type: 'string' } },
            },
          },
        },
      },
    },
    crate: {
      type: 'array',
      description:
        "The mod's own Cargo packages, staged as native-crates/<mod>/<crate>/. Dependencies only from Horizon's Cargo.lock.",
      items: {
        type: 'object',
        required: ['id', 'path'],
        additionalProperties: false,
        properties: {
          id: { ...id, description: 'The crate id ([api] crate names it).' },
          path: { type: 'string', minLength: 1, description: 'Its folder in the bundle, holding Cargo.toml.' },
          dependent: { type: 'string', description: 'The package that depends on it (horizon-client by default).' },
        },
      },
    },
    post_build: {
      type: 'array',
      description: 'Programs of the crates run after the game compiles, in the new build folder.',
      items: {
        type: 'object',
        required: ['crate', 'bin'],
        additionalProperties: false,
        properties: {
          crate: { type: 'string' },
          bin: { type: 'string' },
          args: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
  // An API mod has no injection (the launcher refuses one).
  if: { required: ['api'] },
  then: { not: { required: ['injection'] } },
};

fs.writeFileSync(path.join(root, 'schemas', 'horizon-mixin.schema.json'), `${JSON.stringify(schema, null, 2)}\n`);
console.log(`horizon-mixin.schema.json: ${hooks.length} hook points`);
