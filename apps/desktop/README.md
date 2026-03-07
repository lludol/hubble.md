# Desktop App

Desktop app for Hubble.md (TypeScript + Tauri v2).

## Prerequisites

Before running the desktop app, install:

- [Node.js](https://nodejs.org/en/download)
- [pnpm](https://pnpm.io/installation)
- [Rust via rustup](https://www.rust-lang.org/tools/install)
- macOS desktop builds: Xcode Command Line Tools via `xcode-select --install`
- Windows / Linux desktop builds: the system dependencies from the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)

## Build a production bundle

If you just want to build Hubble and try the app, use the root shortcut:

```
pnpm install
pnpm bundle:desktop
```

This creates the desktop bundle for your platform. On macOS, open `src-tauri/target/release/bundle/macos/Hubble.app` when the build finishes.

From `apps/desktop`, the underlying Tauri command is:

```
pnpm tauri build
```

## Development workflow

If you want the live desktop dev flow instead of a production bundle:

From repo root:

```
pnpm dev:desktop
```

This starts the Tauri app and watches shared packages used by the desktop app.

## Run Tauri directly

If you want the Tauri desktop shell directly, build the workspace first from the repo root, then start the Tauri dev server:

```
pnpm build
pnpm --filter @hubble.md/desktop tauri dev
```

## Build a desktop bundle manually

To build from the repo root without using the shortcut:

```
pnpm build
pnpm --filter "./apps/desktop" tauri build
```

Or from `apps/desktop`:

```
pnpm build
pnpm tauri build
```

