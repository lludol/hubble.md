# Stronger markdown file crawling

## Context

Issue #31 specifies stronger desktop markdown crawling for large open folders. Research against `/Users/benholmes/Projects` showed the recursive watcher was the bottleneck, not the initial markdown crawl:

- Snapshot crawl found thousands of markdown files in roughly one second.
- The folder had roughly 24k non-ignored directories.
- Recursive watching hit `EMFILE: too many open files, watch` and made the app beachball.

The implementation should remove the sidebar's directory-tree watcher and keep only a direct watcher for the active file.

Relevant code:

- `apps/desktop/electron/main.ts` owns filesystem grants, `desktop:list-directory`, recursive markdown crawling, ignore parsing, menus, and `desktop:watch-path`.
- `apps/desktop/electron/preload.ts` exposes the typed renderer bridge.
- `apps/desktop/src/desktopApi/types.ts` defines the renderer-facing API.
- `apps/desktop/src/App.tsx` subscribes to menu events, active-file watcher events, startup restoration, and app-level refresh triggers.
- `apps/desktop/src/store/actions.ts` owns `refreshFiles`, file mutations, explicit `loadPath`, persisted last-opened path updates, and external file change handling.
- `apps/desktop/src/store/persistence.ts` persists `workspacePath`, `lastOpenedPaths`, `document.lastOpenedPath`, and sidebar open state, but not the file list.
- `docs/adr/0008-desktop-sidebar-index-is-ephemeral-navigation-state.md` records the sidebar file list as navigation state, not a file access boundary.

## Affected apps and packages

- `apps/desktop`: implement the watcher removal, focus/menu refresh bridge, renderer subscriptions, docs, and tests.
- `packages/ui`: no planned changes.
- `packages/sync`, `packages/sync-backend`, `packages/convex-client`, `packages/cli`, `apps/www`: no planned changes.

## Architecture

Use a snapshot-plus-refresh model.

- `desktop:list-directory` remains the one-shot markdown discovery API.
- `refreshFiles()` remains the renderer action that replaces `workspace.files` when the workspace path still matches.
- No workspace/sidebar watcher is created.
- `desktopApi.watchPath(currentPath, { recursive: false })` remains for the active editor file.
- Electron main emits `desktop:window-focus` when the BrowserWindow focuses.
- The renderer debounces focus events and calls `refreshFiles()`.
- Electron main adds a `Sync Workspace` File menu item that emits `desktop:menu-sync-workspace`.
- The renderer handles `Sync Workspace` through the same refresh callback.

## Detailed plan

1. Remove the indexer prototype.
   - Delete `apps/desktop/electron/fileIndex.ts`.
   - Delete `apps/desktop/electron/fileIndex.test.ts`.
   - Delete `apps/desktop/electron/fileRules.ts`.
   - Delete `apps/desktop/electron/fileRules.test.ts`.
   - Remove `watchWorkspaceFiles` / `unwatchWorkspaceFiles` bridge and IPC.
   - Keep ignore-aware snapshot crawling in `main.ts` for this slice.
2. Keep active-file watching.
   - Preserve the existing `App.tsx` effect that watches `state.currentPath`.
   - Keep `recursive: false`.
   - Keep existing external-change conflict behavior.
3. Add app-focus refresh.
   - In `createWindow()`, register `mainWindow.on("focus", () => sendToRenderer("desktop:window-focus"))`.
   - Expose `desktopApi.onWindowFocus(callback)`.
   - In `App.tsx`, debounce focus events by a short delay, then call `refreshFiles()` if a workspace is open.
4. Add manual menu refresh.
   - Add `File > Sync Workspace`.
   - Enable it only when `menuState.hasWorkspace` is true.
   - Emit `desktop:menu-sync-workspace`.
   - Expose `desktopApi.onMenuSyncWorkspace(callback)`.
   - Reuse the same renderer refresh callback as focus refresh.
5. Preserve explicit ignored-file access.
   - Do not use sidebar membership as an access check.
   - Leave `loadPath` and file picker behavior independent from `workspace.files`.
6. Keep stale refreshes safe.
   - Rely on `refreshFiles(path)` checking `state.workspacePath !== path` before writing files.
   - Do not clear the active editor just because a file is absent from the refreshed sidebar snapshot.

## Testing and validation

Automated checks:

- `pnpm --filter @hubble.md/desktop test`
- `pnpm check`
- `pnpm build:desktop`

Manual desktop validation:

1. Run the desktop app.
2. Open `/Users/benholmes/Projects`.
3. Confirm no `EMFILE` watcher spam appears.
4. Confirm the app remains responsive while scrolling the sidebar.
5. Confirm `File > Sync Workspace` is enabled with a workspace open.
6. Create or delete a markdown file outside Hubble; choose `Sync Workspace`; confirm the sidebar updates.
7. Create or delete a markdown file outside Hubble; blur and refocus Hubble; confirm the sidebar updates.
8. Edit the active markdown file outside Hubble; confirm the active-file watcher still triggers existing external-change behavior.
9. Open an ignored markdown file explicitly; confirm it is viewable and absent from the sidebar.

## Risks and mitigations

- External sidebar changes are not instant. This is intentional; focus refresh and manual sync replace high-cost recursive watching.
- Large refreshes can still take time. Current measurement shows snapshot crawling is acceptable compared with watcher overhead.
- Focus events can fire repeatedly. Debounce renderer refreshes.
- Menu sync can race with workspace switching. Keep path guards in `refreshFiles`.

## Deferred optimizations

- Persist the sidebar snapshot and validate it on next boot with cache versioning, file mtimes, and ignore-file mtimes.
- Stream partial results into the sidebar instead of replacing the snapshot after each crawl.
- Add bounded subtree watchers only for small or expanded folders, with a hard watcher budget.
- Add an optional Watchman backend behind the same refresh/index interface for very large folders.
- Use Git-backed discovery for Git folders with `git ls-files --cached --others --exclude-standard`.
