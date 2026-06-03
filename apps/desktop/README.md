# Desktop App

Desktop app for Hubble.md (TypeScript + Electron).

## Prerequisites

Install:

- [Node.js](https://nodejs.org/en/download)
- [pnpm](https://pnpm.io/installation)
- macOS desktop builds: Xcode Command Line Tools via `xcode-select --install`

## Development

From repo root:

```sh
pnpm install
pnpm dev:desktop
```

For Chrome DevTools MCP access:

```sh
pnpm dev:desktop:debug
```

The debug command exposes the Electron renderer over Chrome DevTools Protocol at `http://127.0.0.1:${HUBBLE_DESKTOP_DEBUG_PORT:-9222}`.

## Build

From repo root:

```sh
pnpm build:desktop
pnpm bundle:desktop
```

`bundle:desktop` creates a macOS Electron bundle under `apps/desktop/release/`.
