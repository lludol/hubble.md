# Desktop sidebar index is ephemeral navigation state

Opening a large repo root in Hubble Desktop can make the app unresponsive if the app recursively watches every directory in the open folder. The sidebar file tree is useful navigation state, but it is not the source of truth for which files can be viewed.

We choose to treat the desktop sidebar file list as an ephemeral, refreshable snapshot. Electron main owns one-shot markdown discovery for the current workspace. It respects `.gitignore` and `.ignore`, and always prunes known high-cost folders such as `.git/`, `dist/`, and `node_modules/`.

The app does not keep a recursive watcher for the sidebar tree. Instead, the sidebar snapshot refreshes when the app window regains focus and when the user chooses `File > Sync Workspace`. File operations initiated inside Hubble continue to update the sidebar through existing app actions.

The active editor file is different. Hubble keeps a direct non-recursive watcher on the currently open file so external edits can still trigger the existing disk-change conflict behavior.

Folder expansion in the sidebar is presentational. Expanding a folder reveals paths from the current snapshot; it does not request a new crawl for that folder. Ignored files and files outside the sidebar snapshot can still be opened when the user explicitly picks them or when Hubble restores a readable last-opened file. Ignore rules filter sidebar discovery; they are not an access boundary.

The first implementation will not persist the sidebar snapshot between app launches. Rebuilding the snapshot on boot avoids stale-cache invalidation for renamed folders, deleted files, changed ignore rules, and Hubble version changes.

## Consequences

- This refines ADR-0001 for desktop local folders: the editor can be usable even when sidebar navigation is stale or still refreshing.
- The current file may have no matching selected row in the sidebar.
- External sidebar changes are visible after focus refresh or `Sync Workspace`, not instantly.
- Closing and reopening Hubble recrawls the open folder.
- Sidebar absence is not equivalent to file deletion; a file can leave the sidebar because ignore rules changed.
- Recursive watcher exhaustion is avoided for large folders.

## Deferred optimizations

- Persist the sidebar snapshot and validate it on next boot with cache versioning, file mtimes, and ignore-file mtimes.
- Stream partial results into the sidebar instead of replacing the snapshot after each crawl.
- Prioritize crawling expanded or visible folders if streaming results are introduced.
- Add bounded subtree watchers only for small or expanded folders, with a hard watcher budget.
- Add an optional Watchman backend behind the same refresh interface for very large folders.
- Use Git-backed discovery for Git folders with `git ls-files --cached --others --exclude-standard`.
