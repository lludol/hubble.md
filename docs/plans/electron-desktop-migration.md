# Electron Desktop Migration Plan

Replace Tauri with Electron in `apps/desktop` while preserving the desktop feature surface and adding a stable debug entrypoint for Chrome DevTools MCP.

## Phase 1: Transition

### Package and commands

- Add Electron, Electron Vite, electron-builder, chokidar, and needed type packages to `apps/desktop`.
- Replace Tauri scripts:
  - `pnpm dev:desktop` runs normal Electron dev.
  - `pnpm dev:desktop:debug` runs Electron dev with `HUBBLE_DESKTOP_DEBUG_PORT` defaulting to `9222`.
  - `pnpm build:desktop` builds renderer, preload, and main, then runs checks.
  - `pnpm bundle:desktop` creates the macOS Electron bundle.
- Keep `apps/desktop` as the package path and app identity.

### Electron shell

- Add Electron main/preload sources under `apps/desktop/electron/`.
- Main owns windows, app lifecycle, single-instance handling, file-open events, menus, dialogs, filesystem, file watchers, external URL opening, and local asset serving.
- Preload exposes only a typed `window.desktopApi`.
- Renderer keeps React state, editor behavior, and DOM/editor keyboard shortcuts.

### Typed adapter

- Add a shared `DesktopApi` type and ambient `window.desktopApi` declaration.
- Replace direct Tauri imports with domain methods:
  - `readFileText`
  - `writeFileText`
  - `listDirectory`
  - `persistPastedImage`
  - `openFilePicker`
  - `openFolderPicker`
  - `saveMarkdownFilePicker`
  - `watchPath`
  - `openExternalUrl`
  - `toAssetUrl`
  - `onOpenFile`
  - `setMenuState`
  - menu action listeners
- Rename touched note terminology to file terminology, including `noteActions.ts` to `fileActions.ts` and `createNote` to `createMarkdownFile`.

### Security boundary

- Use `contextIsolation: true` and `nodeIntegration: false`.
- Implement filesystem work in main, not preload or renderer.
- Track granted filesystem scopes from explicit user actions: picked folders, picked files, launch files, and trusted recents.
- Validate every IPC path with resolved absolute paths before filesystem access.
- Preserve Workspace Folder, Plain Folder, and Loose File editing.
- Serve asset URLs only for granted paths.

### Feature parity

- Preserve current desktop behavior:
  - folder and file opening
  - Markdown File creation
  - recursive workspace watching
  - active file watching and conflict detection
  - pasted image persistence
  - local image rendering
  - external link opening
  - native app menu and context menu actions
  - single-instance behavior
  - `.md`, `.markdown`, `.mdown` file associations
- Configure electron-builder for macOS first. Do not claim Windows/Linux parity until tested.

### Remove Tauri

- Delete `apps/desktop/src-tauri`.
- Remove Tauri dependencies, scripts, docs, generated files, and Vite Tauri comments.
- Update root and desktop READMEs from Tauri to Electron.
- Update `pnpm-lock.yaml`.

### Acceptance checks

- `pnpm check`
- `pnpm build:desktop`
- `pnpm dev:desktop`
- `pnpm dev:desktop:debug`, then connect Chrome DevTools MCP to `http://127.0.0.1:$HUBBLE_DESKTOP_DEBUG_PORT`
- Manual desktop smoke test:
  - open a Workspace Folder
  - open a Plain Folder
  - open a Loose File
  - create a Markdown File
  - edit and save
  - detect an external file change
  - paste an image and reload it
  - open an external link
  - open a markdown file through the OS association
