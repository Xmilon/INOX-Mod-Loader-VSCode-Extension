// Inox Mod Tools: runs an Inox mod in Horizon like a dev build in IntelliJ
// (the "inox" debug type: F5, the Run view, the editor's play button),
// builds and installs the .imod, and makes new mods. inox.toml is checked
// against schemas/inox.schema.json by Even Better TOML (`linkSchema`).
const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const { expand, findResources, launchArgs, modId } = require('./lib');

const TYPE = 'inox';
const config = () => vscode.workspace.getConfiguration('inox');

/** The folder of the mod to work on: the open inox.toml's, else a workspace folder holding one. */
function modFolder() {
  const doc = vscode.window.activeTextEditor?.document;
  if (doc && path.basename(doc.fileName) === 'inox.toml') return path.dirname(doc.fileName);
  const folder = (vscode.workspace.workspaceFolders || []).find((f) =>
    fs.existsSync(path.join(f.uri.fsPath, 'inox.toml')),
  );
  return folder?.uri.fsPath;
}

/** The default run configuration, as launch.json would hold it. */
function defaultConfig() {
  return {
    type: TYPE,
    request: 'launch',
    name: 'Run in Horizon',
    mod: '${workspaceFolder}',
    world: 'Inox Test',
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
function fill(_folder, cfg) {
  if (cfg.type || cfg.request || cfg.name) return cfg;
  const mod = modFolder();
  return mod ? { ...defaultConfig(), mod } : undefined;
}

/** Resolves a run configuration into the game's program and arguments, or undefined with a message. */
async function resolve(folder, cfg) {
  const workspaceFolder = folder?.uri.fsPath || cfg.mod;
  if (!fs.existsSync(path.join(cfg.mod, 'inox.toml'))) {
    vscode.window.showErrorMessage(`No inox.toml in ${cfg.mod}: "mod" is the folder of an Inox mod.`);
    return undefined;
  }
  const program = expand(config().get('client'), workspaceFolder);
  if (!fs.existsSync(program)) {
    const open = await vscode.window.showErrorMessage(
      `The Horizon client ${program} doesn't exist. Set inox.client to your Inox build of horizon-client.`,
      'Open Settings',
    );
    if (open) vscode.commands.executeCommand('workbench.action.openSettings', 'inox.client');
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

/** Runs `command` in the mod folder as a task in the terminal; resolves to its exit code. */
async function runTask(name, command, cwd) {
  const task = new vscode.Task(
    { type: TYPE, name },
    vscode.TaskScope.Workspace,
    name,
    'inox',
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

async function build() {
  const mod = modFolder();
  if (!mod) return vscode.window.showErrorMessage('Open an Inox mod (a folder holding inox.toml) first.');
  const code = await runTask('Build .imod', `${config().get('cargoHorizonMod')} build`, mod);
  if (code !== 0) return undefined;
  const id = modId(fs.readFileSync(path.join(mod, 'inox.toml'), 'utf8'));
  return path.join(mod, 'target', 'horizon-mod', `${id}.imod`);
}

async function install() {
  const imod = await build();
  if (!imod || !fs.existsSync(imod)) return;
  const dir = expand(config().get('installDir'), modFolder());
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(imod, path.join(dir, path.basename(imod)));
  vscode.window.showInformationMessage(`Installed ${path.basename(imod)} in ${dir}. Restart Horizon to load it.`);
}

async function newMod() {
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
  const code = await runTask('New Inox mod', `${config().get('cargoHorizonMod')} new "${dir}" --template inox`, parent[0].fsPath);
  if (code !== 0) return;
  // The game folder runs make stays out of git.
  fs.appendFileSync(path.join(dir, '.gitignore'), 'run/\n');
  vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(dir));
}

/**
 * Points Even Better TOML at the bundled schema for every inox.toml. Its
 * `tomlValidation` contributions need an absolute URI, which a packaged
 * extension can't name, so the association is kept in the user's settings
 * and updated when the extension's folder changes (an update).
 */
function linkSchema(context) {
  const key = String.raw`.*/inox\.toml$`;
  const schema = vscode.Uri.file(context.asAbsolutePath('schemas/inox.schema.json')).toString(true);
  const toml = vscode.workspace.getConfiguration('evenBetterToml');
  const set = toml.inspect('schema.associations')?.globalValue || {};
  if (set[key] !== schema) {
    toml.update('schema.associations', { ...set, [key]: schema }, vscode.ConfigurationTarget.Global);
  }
}

function activate(context) {
  linkSchema(context);
  const provider = {
    provideDebugConfigurations: () => [defaultConfig()],
    resolveDebugConfiguration: fill,
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
      if (!mod) return vscode.window.showErrorMessage('Open an Inox mod (a folder holding inox.toml) first.');
      const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(mod));
      return vscode.debug.startDebugging(folder, { ...defaultConfig(), mod });
    }),
    vscode.commands.registerCommand('inox.build', build),
    vscode.commands.registerCommand('inox.install', install),
    vscode.commands.registerCommand('inox.newMod', newMod),
    vscode.commands.registerCommand('inox.pickResources', async () => {
      await config().update('resources', '', vscode.ConfigurationTarget.Global);
      return resources(modFolder());
    }),
  );
}

module.exports = { activate, deactivate() {} };
