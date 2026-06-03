# hubble.md context

Glossary for shared terms across the project. Implementation details belong in code or ADRs — not here.

## Glossary

### Workspace

A logical container of Markdown Files and Assets. Lives as a row in the Convex `workspaces` table. Identified by `name` (human-meaningful, unique within a deployment) and `_id` (Convex ID). The Convex row is the source of truth; everything else is a view into it.

### Workspace Folder

A folder on a device's local filesystem that is bound to a [[Workspace]]. The binding is denoted by a `.hubble/config.json` file inside the folder containing the `workspaceId` and a `deviceId`. Multiple Workspace Folders on multiple devices can be bound to the same Workspace.

### Plain Folder

A folder open in the desktop app that is *not* bound to a Workspace — no `.hubble/config.json`. The desktop app can read and edit it as a general markdown viewer; nothing syncs.

### Markdown File

A markdown document on the local filesystem or in a Workspace.

### Loose File

A Markdown File opened directly from the filesystem, not through a Workspace Folder or Plain Folder. The desktop app can read and edit it with access scoped to the file and nearby assets; nothing syncs.

### Asset

A binary file referenced by a Markdown File, such as an image. Asset paths in markdown use the desktop-canonical `<markdown-file-stem>.assets/<hash>.<ext>` convention relative to the Markdown File's folder.

### Workspace Snapshot

The client's currently loaded view of a [[Workspace]] — an atomically assembled bundle of (workspace name, files list, last-opened file content). The app shell renders only when a Workspace Snapshot exists; the UI never shows a partially-loaded one. Switching workspaces means preparing a new snapshot in the background and replacing the previous Workspace Snapshot in a single update once it's ready.
