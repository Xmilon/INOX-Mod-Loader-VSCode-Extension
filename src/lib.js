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

module.exports = { expand, findResources, launchArgs, modId };
