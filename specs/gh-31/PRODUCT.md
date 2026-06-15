# Stronger markdown file crawling

## Summary

Opening a large folder in Hubble Desktop should keep the editor usable and avoid recursive filesystem watchers. The sidebar is a refreshable Markdown File snapshot, while the currently open file is watched directly for external edits.

## Problem

Opening a large repo root can currently hang the desktop app or trigger watcher exhaustion. Users experience this as beachballing, `EMFILE` errors, or repeated sidebar refresh work after unrelated filesystem changes.

## Goals

- Large Workspace Folders and Plain Folders remain usable after opening.
- The sidebar lists only Markdown Files that are inside the open folder and not ignored.
- Explicitly opened or restored files remain viewable even when ignored and absent from the sidebar.
- The active file continues to detect external disk changes.
- The sidebar can be refreshed on app focus and from a manual menu action.

## Non-goals

- No continuous directory-tree watcher for the sidebar.
- No persisted sidebar index.
- No Cloud Sync or web Workspace behavior changes.
- No new user-facing file type support beyond existing markdown extensions.
- No requirement for users to install Watchman or another external service.

## Behavior

1. When a user opens a Workspace Folder or Plain Folder, Hubble Desktop loads the folder and builds a sidebar snapshot from markdown files.
2. The initial crawl includes `.md`, `.markdown`, and `.mdown` files.
3. The crawl excludes non-markdown files from the sidebar.
4. The crawl respects `.gitignore` and `.ignore` files from the open folder and nested folders.
5. The crawl always excludes `.git/`, `dist/`, and `node_modules/`, even if ignore files do not.
6. Ignore rules affect sidebar discovery only; an ignored file can still be viewed when opened explicitly or restored from app state.
7. Ignored folders do not appear in the sidebar and do not need to be opened by Hubble to find sidebar-visible children.
8. Expanding a sidebar folder is presentational: it reveals paths from the current snapshot and does not start a folder-specific crawl.
9. Hubble does not maintain a recursive filesystem watcher for the sidebar file tree.
10. When the app window regains focus, Hubble refreshes the sidebar snapshot for the current workspace.
11. The File menu includes `Sync Workspace`, enabled when a workspace is open, to manually refresh the sidebar snapshot.
12. App-driven file creates, renames, and deletes continue to update the sidebar through existing actions.
13. External creates, renames, deletes, or ignore-file edits appear in the sidebar after app focus or `Sync Workspace`.
14. If the active markdown file changes on disk, the editor keeps the existing external-change conflict behavior whether or not that file appears in the sidebar.
15. If the active markdown file is ignored, it can stay open while remaining absent from the sidebar.
16. If the active markdown file is deleted externally, the existing active-file watcher behavior handles that file without requiring a sidebar watcher.
17. Repeated focus events should settle into one sidebar refresh instead of starting overlapping refreshes.
18. Workspace switching is latest-wins: stale refreshes from a previous open folder must not mutate the newly opened folder state.
19. Closing and reopening the app starts a fresh sidebar crawl; no persisted index is required for this slice.

## UX validation

Use Hubble Desktop with a large repo folder:

1. Open `/Users/benholmes/Projects` or another large folder.
2. Confirm there is no recursive watcher `EMFILE` spam and the app remains responsive.
3. Confirm the sidebar lists sidebar-visible markdown files only.
4. Open a specific markdown file with Open File; confirm it loads even if absent from the sidebar.
5. Add an ignore rule for the active file; use `Sync Workspace` and confirm the file can stay open while disappearing from the sidebar.
6. Create, rename, or delete a markdown file outside the app; focus Hubble or choose `Sync Workspace` and confirm the sidebar refreshes.
7. Edit the active markdown file outside the app and confirm the existing external-change behavior still appears.
8. Switch folders while a refresh is in flight; confirm the latest folder remains the one shown.
