# Horizon Mod Tools (Inox)

VS Code support for every kind of [Horizon](https://github.com/horizon-rust/horizon) mod:

| Kind | Manifest | File | What it is |
|---|---|---|---|
| **Content mod** | `horizon-mod.toml` | `.hmod` | Blocks, items, mob effects, recipes, assets. No code. |
| **API mod** | `horizon-mixin.toml` with `[api]` | `.hnmod` | Rust events (`horizon_mod_api::Mod`), no mixin: rebuilds in seconds ([horizon#5446](https://github.com/horizon-rust/horizon/pull/5446)). |
| **Mixin mod** | `horizon-mixin.toml` with `[[injection]]` | `.hnmod` | Code injected into the game at its hook points. |
| **Inox mod** | `inox.toml` | `.imod` | The Inox fork's shorthands ([docs](https://github.com/Xmilon/horizon/blob/inox-loader/docs/inox-mods.md)). |

## What it does

- **Checks and autocomplete as you type**, with the documentation on hover:
  - `horizon-mod.toml`, `horizon-mixin.toml` and `inox.toml` (through Even Better TOML, installed with this
    extension);
  - `horizon-native.json`, and a content mod's `data/<id>/horizon/block/`, `item/`, `mob_effect/` and
    `creative_tab/` JSON files (VS Code's own JSON checks);
  - **hook point names**: `hook = "..."` in an `[[injection]]` completes from Horizon's hook catalog, each with
    its NeoForge event, side and whether it can cancel. An API mod with an `[[injection]]` is marked, as the
    launcher refuses it.
- **Horizon: New Mod**: a content, API, mixin or Inox mod from a template, opened in VS Code.
- **Run in Horizon, like a dev build in IntelliJ** (content and Inox mods): **F5**, the ▶ button on the
  manifest, or **Run in Horizon** in the Run and Debug view. The game starts with your mod loaded straight from its
  folder (`--dev-mod`, nothing to build), in a test game folder `run/` beside it. Its log is in the Debug Console;
  **Stop** closes the game, **Restart** starts it again with your latest changes. A native mod is compiled into the
  game by the launcher: Run offers to build and install it instead.
- **Build** (📦 on the manifest, or **Ctrl+F9**): `.hmod` and `.imod` through `cargo horizon-mod build`; `.hnmod`
  packed here exactly as the launcher and the mod registry pack it (same bytes for the same files).
- **Build and Install into Horizon**: `.hmod` and `.imod` into `horizon-mods/`, `.hnmod` into
  `horizon-native-mods/`, with what to do next (turn it on, or build the game in the launcher).
- **Check Mod**: the mod registry's checks on the built file (`cargo horizon-mod check`).

## Install

1. Build the package (once, and after changing the extension):

   ```sh
   npm install
   npm run package          # writes inox-tools-0.2.0.vsix
   ```

2. Install it: in VS Code, **Extensions** view → `...` menu → **Install from VSIX...** → pick the `.vsix`.
   Or from a terminal:

   ```sh
   code --install-extension inox-tools-0.2.0.vsix
   ```

   VS Code installs Even Better TOML with it.

3. For content and Inox mods (new, build, check), install `cargo horizon-mod`:

   ```sh
   cargo install --git https://github.com/horizon-rust/horizon cargo-horizon-mod
   ```

On first activation the extension adds entries to your user settings, `evenBetterToml.schema.associations` for
`inox.toml`, `horizon-mod.toml` and `horizon-mixin.toml`, pointing at its bundled schemas (Even Better TOML needs
an absolute path, which a packaged extension can't give it any other way).

## Native mods

- `[compatibility] horizon_revision` is the Horizon commit the mod is made for (40 hex digits): building the
  `.hnmod` needs it. Set **`inox.horizonRevision`** and new mods get it written in.
- An API mod's crate depends on `horizon-mod-api`. Set **`inox.horizonSource`** to a Horizon checkout that has it, and
  new API mods point there, so rust-analyzer completes the API; the launcher replaces the path when it builds.
- When Horizon adds hook points, refresh the list: `npm run sync-hooks -- <Horizon checkout>`.

## Run configurations

Without a `launch.json`, F5 on a mod runs the default configuration. To keep your own (another world,
survival, a seed), **Run and Debug** → **create a launch.json file** → **Horizon (mod)**:

```json
{
  "type": "inox",
  "request": "launch",
  "name": "Run in Horizon",
  "mod": "${workspaceFolder}",
  "world": "Mod Test",
  "creative": true,
  "args": ["--seed", "12345"]
}
```

| Key | Default | Meaning |
|---|---|---|
| `mod` | `${workspaceFolder}` | The mod's folder (holding `horizon-mod.toml` or `inox.toml`). |
| `world` | `Mod Test` | The world to open or create in `run/saves`; leave it out for the title screen. |
| `creative` | `true` | A new world in creative mode. |
| `args` | `[]` | More `horizon-client` arguments (`--seed`, `--width`, `--fullscreen`...). |
| `env` | `{}` | Environment variables for the game. |

The first run with a mod builds its content cache (about a minute and a half), later runs take seconds.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `inox.horizonClient` | (set it) | The official `horizon-client` content mods run in. |
| `inox.client` | `${env:APPDATA}/horizon/inox-indev/horizon-client.exe` | The Inox fork's client, for Inox mods. |
| `inox.resources` | picked on the first run | The prepared game resources (`.../.local/horizon-client/26.3`). **Horizon: Choose the Game Resources** picks again. |
| `inox.launcherDir` | `${env:APPDATA}/horizon-launcher` | Where the prepared versions are looked for. |
| `inox.gameDir` | `${workspaceFolder}/run` | The game folder of runs: its worlds, options, logs and content cache. |
| `inox.installDir` | `${env:APPDATA}/horizon/horizon-mods` | Where **Build and Install** puts `.hmod` and `.imod` files. |
| `inox.nativeInstallDir` | `${env:APPDATA}/horizon/horizon-native-mods` | Where it puts `.hnmod` files. |
| `inox.horizonRevision` | empty | The Horizon commit new native mods are made for. |
| `inox.horizonSource` | empty | A Horizon checkout with `crates/horizon-mod-api`, for new API mods. |
| `inox.mixinsRevision` | the launcher's | The horizon-mixins commit written in built `.hnmod`s. |
| `inox.cargoHorizonMod` | `cargo horizon-mod` | The command that makes, builds and checks content and Inox mods. |

## Develop the extension

`npm test` checks the launch logic, `.hnmod` packing and every schema (against the Ruby mod in `test/fixtures` and
the templates). To try a change without packaging: open this folder in VS Code and press F5 (**Run Extension**),
which opens a second VS Code window with it loaded. The schemas follow Horizon's readers
(`crates/horizon-mods/src/manifest.rs`, `content.rs`, `index/native.rs`): change them together.

License: MIT.
