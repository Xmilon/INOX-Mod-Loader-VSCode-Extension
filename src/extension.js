// Horizon Mod Tools: makes, checks, builds, installs and runs Horizon mods of every kind:
//  - content mods (horizon-mod.toml, .hmod): data and assets, no code;
//  - native mods (horizon-mixin.toml, .hnmod): mixin mods;
//  - Inox mods (inox.toml, .imod) of the Inox fork.
// Run is like a dev build in IntelliJ (the "inox" debug type: F5, the Run view, the editor's play
// button). The TOML manifests are checked by Even Better TOML against the bundled schemas
// (`linkSchemas`); the JSON files by VS Code itself (package.json's jsonValidation).
const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const { parse } = require('smol-toml');
const lib = require('./lib');
const { expand, findResources, launchArgs, modId, MANIFESTS, modKind, topLevelId } = lib;

const TYPE = 'inox';
const config = () => vscode.workspace.getConfiguration('inox');
const KIND_NAMES = { inox: 'Inox mod (.imod)', content: 'content mod (.hmod)', native: 'native mod (.hnmod)' };
const NO_MOD =
  'Open a Horizon mod first: a folder holding horizon-mod.toml (content), horizon-mixin.toml (native) or inox.toml (Inox).';

/** The folder of the mod to work on: the open manifest's, else a workspace folder holding one. */
function modFolder() {
  const doc = vscode.window.activeTextEditor?.document;
  if (doc && Object.values(MANIFESTS).includes(path.basename(doc.fileName))) return path.dirname(doc.fileName);
  const folder = (vscode.workspace.workspaceFolders || []).find((f) => modKind(f.uri.fsPath));
  return folder?.uri.fsPath;
}

/** The mod's id, from its manifest. */
function idOf(mod, kind) {
  const text = fs.readFileSync(path.join(mod, MANIFESTS[kind]), 'utf8');
  return kind === 'content' ? topLevelId(text) : modId(text);
}

/** The default run configuration, as launch.json would hold it. */
function defaultConfig() {
  return {
    type: TYPE,
    request: 'launch',
    name: 'Run in Horizon',
    mod: '${workspaceFolder}',
    world: 'Mod Test',
    creative: true,
  };
}

/** The prepared resources: the setting, else one the player picks (and keeps). */
async function resources(workspaceFolder) {
  const set = expand(config().get('resources'), workspaceFolder);
  if (set) return set;
  const launcher = expand(config().get('launcherDir'), workspaceFolder);
  const found = findResources(launcher);
  if (!found.length) {
    vscode.window.showErrorMessage(
      `No prepared Horizon resources in ${launcher}. Prepare a version in the Horizon launcher, or set inox.resources.`,
    );
    return undefined;
  }
  const pick =
    found.length === 1
      ? found[0]
      : await vscode.window.showQuickPick(
          found.map((f) => ({ label: f.version, description: f.dir, dir: f.dir })),
          { placeHolder: 'The game resources to run with (kept in the setting inox.resources)' },
        );
  if (!pick) return undefined;
  await config().update('resources', pick.dir, vscode.ConfigurationTarget.Global);
  return pick.dir;
}

/** F5 with no launch.json: the default configuration for the open mod. */
function fillConfig(_folder, cfg) {
  if (cfg.type || cfg.request || cfg.name) return cfg;
  const mod = modFolder();
  return mod ? { ...defaultConfig(), mod } : undefined;
}

/** The client a kind of mod runs in: content mods in Horizon's, Inox mods in the fork's. */
function clientFor(kind, workspaceFolder) {
  const key = kind === 'inox' ? 'client' : 'horizonClient';
  return { key, program: expand(config().get(key), workspaceFolder) };
}

/** Resolves a run configuration into the game's program and arguments, or undefined with a message. */
async function resolve(folder, cfg) {
  const workspaceFolder = folder?.uri.fsPath || cfg.mod;
  const kind = modKind(cfg.mod);
  if (!kind) {
    vscode.window.showErrorMessage(`No mod in ${cfg.mod}. ${NO_MOD}`);
    return undefined;
  }
  if (kind === 'native') {
    const pick = await vscode.window.showInformationMessage(
      'A native mod is compiled into the game by the Horizon launcher: build it here (.hnmod), install it, then build the game in the launcher (Mods page, or horizon-launcher native-build).',
      'Build and Install',
    );
    if (pick) install();
    return undefined;
  }
  const { key, program } = clientFor(kind, workspaceFolder);
  if (!fs.existsSync(program)) {
    const open = await vscode.window.showErrorMessage(
      `The Horizon client ${program} doesn't exist. Set inox.${key} to the horizon-client to run ${KIND_NAMES[kind]}s in.`,
      'Open Settings',
    );
    if (open) vscode.commands.executeCommand('workbench.action.openSettings', `inox.${key}`);
    return undefined;
  }
  const res = await resources(workspaceFolder);
  if (!res) return undefined;
  const gameDir = expand(config().get('gameDir'), cfg.mod);
  fs.mkdirSync(gameDir, { recursive: true });
  return { ...cfg, program, cwd: gameDir, gameArgs: launchArgs(cfg, { gameDir, resources: res }) };
}

/** A debug adapter that only runs the game: its output in the Debug Console, Stop kills it. */
class GameSession {
  constructor() {
    this.emitter = new vscode.EventEmitter();
    this.onDidSendMessage = this.emitter.event;
    this.seq = 1;
  }
  send(msg) {
    this.emitter.fire({ seq: this.seq++, ...msg });
  }
  respond(req, body = {}) {
    this.send({ type: 'response', request_seq: req.seq, success: true, command: req.command, body });
  }
  event(event, body) {
    this.send({ type: 'event', event, body });
  }
  output(text, category = 'stdout') {
    this.event('output', { category, output: text });
  }
  handleMessage(m) {
    if (m.type !== 'request') return;
    switch (m.command) {
      case 'initialize':
        this.respond(m, { supportsConfigurationDoneRequest: true, supportsTerminateRequest: true });
        this.event('initialized');
        break;
      case 'launch':
        this.launch(m);
        break;
      case 'threads':
        this.respond(m, { threads: [] });
        break;
      case 'terminate':
      case 'disconnect':
        this.kill();
        this.respond(m);
        break;
      default:
        this.respond(m);
    }
  }
  launch(req) {
    const a = req.arguments;
    this.output(`> ${a.program} ${a.gameArgs.map((x) => (x.includes(' ') ? `"${x}"` : x)).join(' ')}\n`, 'console');
    this.proc = cp.spawn(a.program, a.gameArgs, { cwd: a.cwd, env: { ...process.env, ...(a.env || {}) } });
    this.proc.stdout.on('data', (d) => this.output(d.toString()));
    this.proc.stderr.on('data', (d) => this.output(d.toString(), 'stderr'));
    this.proc.on('error', (e) => {
      this.output(`${e.message}\n`, 'stderr');
      this.event('terminated');
    });
    this.proc.on('exit', (code) => {
      this.output(`\nHorizon exited (${code ?? 'killed'})\n`, 'console');
      this.event('exited', { exitCode: code ?? 0 });
      this.event('terminated');
    });
    this.respond(req);
  }
  kill() {
    if (this.proc && this.proc.exitCode === null) this.proc.kill();
  }
  dispose() {
    this.kill();
  }
}

/** Runs `command` in `cwd` as a task in the terminal; resolves to its exit code. */
async function runTask(name, command, cwd) {
  const task = new vscode.Task(
    { type: TYPE, name },
    vscode.TaskScope.Workspace,
    name,
    'horizon',
    new vscode.ShellExecution(command, { cwd }),
  );
  const execution = await vscode.tasks.executeTask(task);
  return new Promise((done) => {
    const sub = vscode.tasks.onDidEndTaskProcess((e) => {
      if (e.execution === execution) {
        sub.dispose();
        done(e.exitCode);
      }
    });
  });
}

/** Packs a native mod's .hnmod into target/horizon-mod/, as the launcher and the registry pack it. */
function buildNative(mod) {
  let mixin;
  try {
    mixin = parse(fs.readFileSync(path.join(mod, MANIFESTS.native), 'utf8'));
  } catch (e) {
    vscode.window.showErrorMessage(`horizon-mixin.toml: ${e.message}`);
    return undefined;
  }
  let packed;
  try {
    packed = lib.packNative(mod, mixin, { mixins: config().get('mixinsRevision') || lib.MIXINS_REV });
  } catch (e) {
    packed = { error: e.message };
  }
  if (packed.error) {
    vscode.window.showErrorMessage(`Can't build the .hnmod: ${packed.error}`);
    return undefined;
  }
  const out = path.join(mod, 'target', 'horizon-mod');
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, `${packed.id}.hnmod`);
  fs.writeFileSync(file, packed.bytes);
  vscode.window.setStatusBarMessage(`Built ${path.basename(file)}`, 5000);
  return file;
}

/** Builds the open mod; the built file, or undefined. */
async function build() {
  const mod = modFolder();
  if (!mod) return vscode.window.showErrorMessage(NO_MOD);
  const kind = modKind(mod);
  if (kind === 'native') return buildNative(mod);
  const ext = kind === 'inox' ? 'imod' : 'hmod';
  const code = await runTask(`Build .${ext}`, `${config().get('cargoHorizonMod')} build`, mod);
  if (code !== 0) return undefined;
  return path.join(mod, 'target', 'horizon-mod', `${idOf(mod, kind)}.${ext}`);
}

/** Builds, then copies into the game folder: horizon-mods/ (content, Inox), horizon-native-mods/ (native). */
async function install() {
  const mod = modFolder();
  const file = await build();
  if (typeof file !== 'string' || !fs.existsSync(file)) return;
  const kind = modKind(mod);
  const dir = expand(config().get(kind === 'native' ? 'nativeInstallDir' : 'installDir'), mod);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(file, path.join(dir, path.basename(file)));
  const next = {
    native: 'Build the game with it in the Horizon launcher (Mods page), then play.',
    content: 'Turn it on in Options > Mods (mods start off), then restart Horizon.',
    inox: 'Restart Horizon to load it.',
  }[kind];
  vscode.window.showInformationMessage(`Installed ${path.basename(file)} in ${dir}. ${next}`);
}

/** Checks the built file as the mod registry does (`cargo horizon-mod check`). */
async function check() {
  const file = await build();
  if (typeof file !== 'string' || !fs.existsSync(file)) return;
  await runTask('Check mod', `${config().get('cargoHorizonMod')} check "${file}"`, path.dirname(file));
}

/** Writes the template `kind` (templates/<kind>/) into `dir`, filling its placeholders. */
function writeTemplate(context, kind, dir, values) {
  const copy = (src, dst) => {
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, e.name);
      const d = path.join(dst, e.name);
      if (e.isDirectory()) copy(s, d);
      else {
        fs.mkdirSync(dst, { recursive: true });
        fs.writeFileSync(d, lib.fill(fs.readFileSync(s, 'utf8'), values));
      }
    }
  };
  copy(context.asAbsolutePath(path.join('templates', kind)), dir);
}

async function newMod(context) {
  const kind = await vscode.window.showQuickPick(
    [
      { label: 'Content mod', description: '.hmod: blocks, items, mob effects, recipes. No code.', kind: 'content' },
      { label: 'Mixin mod', description: '.hnmod: code injected at the hook points. Recompiles the game.', kind: 'mixin' },
      { label: 'Inox mod', description: '.imod of the Inox fork: inox.toml shorthands.', kind: 'inox' },
    ],
    { placeHolder: 'What kind of mod?' },
  );
  if (!kind) return;
  const name = await vscode.window.showInputBox({
    prompt: 'The new mod folder name (its id is made from it: lowercase, _)',
    validateInput: (v) => (/^[A-Za-z0-9_-]+$/.test(v) ? undefined : 'Letters, digits, - and _'),
  });
  if (!name) return;
  const parent = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    openLabel: 'Create the mod here',
  });
  if (!parent) return;
  const dir = path.join(parent[0].fsPath, name);
  if (fs.existsSync(dir)) return vscode.window.showErrorMessage(`${dir} already exists.`);
  if (kind.kind === 'content' || kind.kind === 'inox') {
    const template = kind.kind === 'inox' ? ' --template inox' : '';
    const code = await runTask(
      `New ${kind.label}`,
      `${config().get('cargoHorizonMod')} new "${dir}"${template}`,
      parent[0].fsPath,
    );
    if (code !== 0) return;
  } else {
    writeTemplate(context, kind.kind, dir, {
      id: lib.idFromName(name),
      name,
      revision: config().get('horizonRevision') || '0'.repeat(40),
    });
    if (!config().get('horizonRevision')) {
      vscode.window.showWarningMessage(
        'Set [compatibility] horizon_revision in horizon-mixin.toml to the Horizon commit the mod is for (or the setting inox.horizonRevision for new mods): building the .hnmod needs it.',
      );
    }
  }
  // The game folder runs make stays out of git.
  const ignore = path.join(dir, '.gitignore');
  if (!fs.existsSync(ignore) || !fs.readFileSync(ignore, 'utf8').includes('run/')) fs.appendFileSync(ignore, 'run/\n');
  vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(dir));
}

/**
 * Points Even Better TOML at the bundled schemas of the TOML manifests. Its `tomlValidation`
 * contributions need an absolute URI, which a packaged extension can't name, so the associations
 * are kept in the user's settings and updated when the extension's folder changes (an update).
 */
function linkSchemas(context) {
  const wanted = {
    [String.raw`.*/inox\.toml$`]: 'inox.schema.json',
    [String.raw`.*/horizon-mod\.toml$`]: 'horizon-mod.schema.json',
    [String.raw`.*/horizon-mixin\.toml$`]: 'horizon-mixin.schema.json',
  };
  const toml = vscode.workspace.getConfiguration('evenBetterToml');
  const set = toml.inspect('schema.associations')?.globalValue || {};
  const next = { ...set };
  for (const [key, file] of Object.entries(wanted)) {
    next[key] = vscode.Uri.file(context.asAbsolutePath(path.join('schemas', file))).toString(true);
  }
  if (JSON.stringify(next) !== JSON.stringify(set)) {
    toml.update('schema.associations', next, vscode.ConfigurationTarget.Global);
  }
}

function activate(context) {
  linkSchemas(context);
  const provider = {
    provideDebugConfigurations: () => [defaultConfig()],
    resolveDebugConfiguration: fillConfig,
    resolveDebugConfigurationWithSubstitutedVariables: resolve,
  };
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider(TYPE, provider),
    // In the Run view's list without a launch.json, as a run configuration.
    vscode.debug.registerDebugConfigurationProvider(
      TYPE,
      { provideDebugConfigurations: () => [defaultConfig()] },
      vscode.DebugConfigurationProviderTriggerKind.Dynamic,
    ),
    vscode.debug.registerDebugAdapterDescriptorFactory(TYPE, {
      createDebugAdapterDescriptor: () => new vscode.DebugAdapterInlineImplementation(new GameSession()),
    }),
    vscode.commands.registerCommand('inox.run', () => {
      const mod = modFolder();
      if (!mod) return vscode.window.showErrorMessage(NO_MOD);
      const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(mod));
      return vscode.debug.startDebugging(folder, { ...defaultConfig(), mod });
    }),
    vscode.commands.registerCommand('inox.build', build),
    vscode.commands.registerCommand('inox.install', install),
    vscode.commands.registerCommand('inox.check', check),
    vscode.commands.registerCommand('inox.newMod', () => newMod(context)),
    vscode.commands.registerCommand('inox.pickResources', async () => {
      await config().update('resources', '', vscode.ConfigurationTarget.Global);
      return resources(modFolder());
    }),
  );
}

module.exports = { activate, deactivate() {} };
