# Hubble.md

Hubble.md is a nice rich-text editor for Markdown files. It's meant to take the best parts of [Typora](https://typora.io) and improve upon them as open source software.

## Quick start

Want to build Hubble locally and try it yourself?

Install:

- [Node.js](https://nodejs.org/en/download)
- [pnpm](https://pnpm.io/installation)
- macOS desktop builds: Xcode Command Line Tools via `xcode-select --install`

Then from the repo root, run:

```sh
pnpm install
pnpm bundle:desktop
```

This creates a production desktop bundle under `apps/desktop/release/`. For more desktop-specific build and dev detail, see [`apps/desktop/README.md`](./apps/desktop/README.md).

## Monorepo structure

This repo uses a pnpm workspace:

```text
.
├── apps
│   ├── desktop  # Electron desktop app
│   └── www      # Project site / landing page
└── packages
    └── editor   # Shared editor package
```

### `apps/desktop`

The main Hubble desktop application. See [`apps/desktop/README.md`](./apps/desktop/README.md) for build, dev, and packaging details.

### `apps/www`

The website package. This is intended to become the landing page for the project.

### `packages/editor`

Shared editor primitives and logic used by the app. Right now this is the core editor module.

## Common commands

From the repo root:

```sh
pnpm install
pnpm build
pnpm bundle:desktop
pnpm check
pnpm typecheck
pnpm dev:desktop
```

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for contribution flow, local setup, and pre-PR checks.
