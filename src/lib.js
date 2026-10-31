// What the extension decides without VS Code: paths, the game's command line,
// the prepared resources it can find. Tested in test/lib.test.js.
const fs = require('fs');
const path = require('path');

/** `${workspaceFolder}`, `${env:NAME}` and a leading `~` in a setting's path. */
function expand(p, workspaceFolder, env = process.env, home = require('os').homedir()) {
  if (!p) return p;
  let out = p
    .replace(/\$\{workspaceFolder\}/g, workspaceFolder || '')
    .replace(/\$\{env:([^}]+)\}/g, (_, name) => env[name] || '');
  if (out === '~' || out.startsWith('~/') || out.startsWith('~\\')) out = home + out.slice(1);
  return path.normalize(out);
}

/** The prepared game resources the Horizon launcher keeps, newest version name first. */
function findResources(launcherDir) {
  const versions = path.join(launcherDir, 'versions');
  let names = [];
  try {
    names = fs.readdirSync(versions);
  } catch {
    return [];
  }
  const found = [];
  for (const v of names) {
    const local = path.join(versions, v, '.local', 'horizon-client');
    let games = [];
    try {
      games = fs.readdirSync(local);
    } catch {
      continue;
    }
    for (const g of games) {
      const dir = path.join(local, g);
      if (fs.existsSync(path.join(dir, 'horizon-resources.json'))) found.push({ version: v, dir });
    }
  }
  return found.sort((a, b) => b.version.localeCompare(a.version));
}

/**
 * The game's command line for a launch configuration: the mod loaded from its
 * folder with `--dev-mod`, in a game folder of its own, logs there too.
 */
function launchArgs(config, s) {
  const args = ['--game-dir', s.gameDir, '--home', s.gameDir, '--resources', s.resources];
  args.push('--dev-mod', config.mod);
  if (config.world) args.push('--world', String(config.world));
  if (config.creative) args.push('--creative');
  return args.concat(config.args || []);
}

/** The mod id of an `inox.toml`'s `[mod]` table, or undefined. */
function modId(toml) {
  const table = /^\s*\[mod\]\s*$([\s\S]*?)(^\s*\[|$(?![\s\S]))/m.exec(toml);
  const id = table && /^\s*id\s*=\s*"([a-z0-9_]+)"/m.exec(table[1]);
  return id ? id[1] : undefined;
}

/** The manifest each kind of mod has in its folder. */
const MANIFESTS = {
  inox: 'inox.toml',
  content: 'horizon-mod.toml',
  native: 'horizon-mixin.toml',
};

/** What kind of mod `dir` holds: inox (.imod, the fork), content (.hmod), native (.hnmod), or undefined. */
function modKind(dir) {
  return Object.keys(MANIFESTS).find((k) => fs.existsSync(path.join(dir, MANIFESTS[k])));
}

/** horizon-mod.toml's top-level `id`, before any table. */
function topLevelId(toml) {
  const head = toml.split(/^\s*\[/m)[0];
  const id = /^\s*id\s*=\s*"([a-z0-9_]+)"/m.exec(head);
  return id ? id[1] : undefined;
}

/** The horizon-mixins commit the launcher uses when a mod names none (native_mods::MIXINS_REV). */
const MIXINS_REV = '4342a0bfbe71d4d14185528d64e496d6022f16a1';
const revision = (v) => typeof v === 'string' && /^[0-9a-f]{40}$/.test(v);

/**
 * The files of a native mod folder an .hnmod carries, as the launcher's `pack` keeps them: Rust,
 * TOML and data/ files, by their path in the folder, sorted. Build output and the run folder stay out.
 */
function nativeFiles(dir) {
  const out = [];
  const walk = (at, rel) => {
    for (const e of fs.readdirSync(at, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const name = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) throw new Error(`${name} is a link: not allowed in a mod.`);
      if (e.isDirectory()) {
        if (['target', '.git', 'node_modules'].includes(e.name) || (!rel && e.name === 'run')) continue;
        walk(path.join(at, e.name), name);
      } else if (name.endsWith('.rs') || name.endsWith('.toml') || name.startsWith('data/')) {
        out.push(name);
      }
    }
  };
  walk(dir, '');
  return out;
}

/**
 * The horizon-native.json of the native mod whose horizon-mixin.toml is `mixin` (parsed), as the
 * launcher writes it, or `{ error }`.
 */
function nativeManifest(mixin, { game = '26.3', mixins = MIXINS_REV } = {}) {
  const mod = mixin.mod || {};
  if (!/^[a-z0-9_]{1,64}$/.test(mod.id || '')) return { error: '[mod] id is missing or not [a-z0-9_].' };
  if (!mod.version) return { error: '[mod] version is missing.' };
  const horizon = mixin.compatibility?.horizon_revision;
  if (!revision(horizon)) {
    return {
      error:
        '[compatibility] horizon_revision must be the Horizon commit the mod was made for (40 hex digits): add it to horizon-mixin.toml.',
    };
  }
  const manifest = { schema: 1, id: mod.id, version: String(mod.version), game, horizon, mixins };
  if (Object.hasOwn(mixin, 'api')) {
    return { error: 'The experimental [api] format was retired. Use a native mixin mod with catalog hooks.' };
  }
  return { manifest };
}

// A zip archive (deflate), with fixed times so the same files give the same bytes.
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
/** A zip of `entries`, [name, Buffer] in order. */
function zip(entries) {
  const zlib = require('zlib');
  const parts = [];
  const central = [];
  let offset = 0;
  // 1980-01-01 00:00, zip's earliest date (the launcher's zip::DateTime::default()).
  const TIME = 0;
  const DATE = 0x21;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const packed = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // UTF-8 names
    head.writeUInt16LE(8, 8); // deflate
    head.writeUInt16LE(TIME, 10);
    head.writeUInt16LE(DATE, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    parts.push(head, nameBuf, packed);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(0x031e, 4); // made by Unix, so the mode below is read
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(TIME, 12);
    dir.writeUInt16LE(DATE, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE((0o100644 << 16) >>> 0, 38); // a plain file, rw-r--r--
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);
    offset += head.length + nameBuf.length + packed.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuf, end]);
}

/**
 * An .hnmod of the native mod folder `dir` whose horizon-mixin.toml is `mixin` (parsed): its
 * manifest, then its files under mixins/<id>/. `{ error }` when it can't be packed.
 */
function packNative(dir, mixin, options) {
  const { manifest, error } = nativeManifest(mixin, options);
  if (error) return { error };
  const entries = [['horizon-native.json', Buffer.from(JSON.stringify(manifest, null, 2))]];
  for (const name of nativeFiles(dir)) {
    entries.push([`mixins/${manifest.id}/${name}`, fs.readFileSync(path.join(dir, name))]);
  }
  return { id: manifest.id, bytes: zip(entries) };
}

/** Fills the `{key}` placeholders of a template. */
function fill(template, values) {
  return template.replace(/\{([a-z_]+)\}/g, (all, key) => (key in values ? values[key] : all));
}

/** A mod id made from a folder name: lower case, [a-z0-9_]. */
function idFromName(name) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64) || 'my_mod'
  );
}

module.exports = {
  expand,
  findResources,
  launchArgs,
  modId,
  MANIFESTS,
  modKind,
  topLevelId,
  MIXINS_REV,
  nativeFiles,
  nativeManifest,
  crc32,
  zip,
  packNative,
  fill,
  idFromName,
};
