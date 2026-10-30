// The run adapter speaks enough of the Debug Adapter Protocol for VS Code:
// driven here with a stand-in for the `vscode` module and a real process.
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

class EventEmitter {
  constructor() {
    this.listeners = [];
    this.event = (f) => this.listeners.push(f);
  }
  fire(e) {
    this.listeners.forEach((f) => f(e));
  }
}
const registered = {};
const vscode = {
  EventEmitter,
  DebugAdapterInlineImplementation: class {
    constructor(adapter) {
      this.adapter = adapter;
    }
  },
  DebugConfigurationProviderTriggerKind: { Dynamic: 2 },
  ConfigurationTarget: { Global: 1 },
  Uri: { file: (p) => ({ fsPath: p, toString: () => `file:///${p}` }) },
  workspace: {
    getConfiguration: () => ({ get: () => undefined, inspect: () => ({}), update: async () => {} }),
  },
  debug: {
    registerDebugConfigurationProvider: () => ({}),
    registerDebugAdapterDescriptorFactory: (type, f) => (registered[type] = f),
  },
  commands: { registerCommand: () => ({}) },
};
const load = Module._load;
Module._load = (request, ...rest) => (request === 'vscode' ? vscode : load(request, ...rest));
const { activate } = require('../src/extension');

test('runs the game, shows its output and ends the session when it exits', async () => {
  activate({ subscriptions: [], asAbsolutePath: (p) => p });
  const session = registered.inox.createDebugAdapterDescriptor().adapter;
  const sent = [];
  const ended = new Promise((done) =>
    session.onDidSendMessage((m) => {
      sent.push(m);
      if (m.event === 'terminated') done();
    }),
  );
  session.handleMessage({ seq: 1, type: 'request', command: 'initialize', arguments: {} });
  session.handleMessage({
    seq: 2,
    type: 'request',
    command: 'launch',
    arguments: { program: process.execPath, gameArgs: ['-e', 'console.log("game up"); process.exit(3)'], cwd: '.' },
  });
  session.handleMessage({ seq: 3, type: 'request', command: 'configurationDone' });
  await ended;
  const responses = sent.filter((m) => m.type === 'response');
  assert.deepStrictEqual(
    responses.map((r) => [r.command, r.success]),
    [['initialize', true], ['launch', true], ['configurationDone', true]],
  );
  assert.ok(sent.some((m) => m.event === 'initialized'));
  assert.ok(sent.some((m) => m.event === 'output' && m.body.output.includes('game up')));
  assert.deepStrictEqual(sent.find((m) => m.event === 'exited').body, { exitCode: 3 });
});

test('stop kills the game', async () => {
  const session = registered.inox.createDebugAdapterDescriptor().adapter;
  const ended = new Promise((done) => session.onDidSendMessage((m) => m.event === 'terminated' && done()));
  session.handleMessage({
    seq: 1,
    type: 'request',
    command: 'launch',
    arguments: { program: process.execPath, gameArgs: ['-e', 'setInterval(() => {}, 1000)'], cwd: '.' },
  });
  session.handleMessage({ seq: 2, type: 'request', command: 'terminate' });
  await ended;
  assert.ok(session.proc.exitCode !== null || session.proc.signalCode !== null, 'the game still runs');
});
