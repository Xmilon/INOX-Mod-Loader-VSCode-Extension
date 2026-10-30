# Inox Mod Tools (Horizon)

VS Code support for [Inox mods](https://github.com/Xmilon/horizon/blob/inox-loader/docs/inox-mods.md), the
`.imod` mods of the Horizon fork's built-in loader.

- **`inox.toml` checks and autocomplete**: every key, its allowed values and its documentation on hover;
  typos and out-of-range numbers are underlined as you type (through Even Better TOML, installed with
  this extension).
- **Run in Horizon, like a dev build in IntelliJ**: press **F5**, or the ▶ button on `inox.toml`, or pick
  **Run in Horizon** in the Run and Debug view. The game starts with your mod loaded straight from its
  folder (`--dev-mod`, nothing to build), in a test game folder `run/` beside it. Its log is in the Debug
  Console; **Stop** closes the game, **Restart** starts it again with your latest changes.
- **Build .imod** (the 📦 button on `inox.toml`, or **Ctrl+F9**) and **Build and Install into Horizon**
  (copies it into your real game's `horizon-mods`).
- **Inox: New Mod**: a new mod from the Inox template, opened in VS Code.

## Install

1. Build the package (once, and after changing the extension):

   ```sh
   npm install
   npm run package          # writes inox-tools-0.1.0.vsix
   ```

2. Install it: in VS Code, **Extensions** view → `...` menu → **Install from VSIX...** → pick the `.vsix`.
   Or from a terminal:

   ```sh
   code --install-extension inox-tools-0.1.0.vsix
   ```

   VS Code installs Even Better TOML with it.

3. For **Build** and **New Mod**, install `cargo horizon-mod` from the fork:

   ```sh
   cargo install --locked --path "<fork>/crates/cargo-horizon-mod"
   ```

On first activation the extension adds one entry to your user settings,
`evenBetterToml.schema.associations` → `.*/inox\.toml$`, pointing at its bundled schema (Even Better
TOML needs an absolute path, which a packaged extension can't give it any other way).

## Run configurations

Without a `launch.json`, F5 on a mod runs the default configuration. To keep your own (another world,
survival, a seed), **Run and Debug** → **create a launch.json file** → **Horizon (Inox mod)**:

```json
{
  "type": "inox",
  "request": "launch",
  "name": "Run in Horizon",
  "mod": "${workspaceFolder}",
  "world": "Inox Test",
  "creative": true,
  "args": ["--seed", "12345"]
}
```

| Key | Default | Meaning |
|---|---|---|
| `mod` | `${workspaceFolder}` | The mod's folder (holding `inox.toml`). |
| `world` | `Inox Test` | The world to open or create in `run/saves`; leave it out for the title screen. |
| `creative` | `true` | A new world in creative mode. |
| `args` | `[]` | More `horizon-client` arguments (`--seed`, `--width`, `--fullscreen`...). |
| `env` | `{}` | Environment variables for the game. |

The first run with a mod builds its content cache (about a minute and a half), later runs take seconds.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `inox.client` | `${env:APPDATA}/horizon/inox-indev/horizon-client.exe` | The Horizon client with the Inox loader. |
| `inox.resources` | picked on the first run | The prepared game resources (`.../.local/horizon-client/26.3`). **Inox: Choose the Game Resources** picks again. |
| `inox.launcherDir` | `${env:APPDATA}/horizon-launcher` | Where the prepared versions are looked for. |
| `inox.gameDir` | `${workspaceFolder}/run` | The game folder of runs: its worlds, options, logs and content cache. |
| `inox.installDir` | `${env:APPDATA}/horizon/horizon-mods` | Where **Build and Install** puts the `.imod`. |
| `inox.cargoHorizonMod` | `cargo horizon-mod` | The command that builds and makes mods. |

## Develop the extension

`npm test` checks the launch logic and the schema (against the Ruby mod in `test/fixtures`). To try a
change without packaging: open this folder in VS Code and press F5 (**Run Extension**), which opens a
second VS Code window with it loaded. The schema follows `crates/horizon-mods/src/imod.rs` in the fork:
change both together.

License: MIT.
