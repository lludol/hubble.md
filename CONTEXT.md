# hubble.md context

Glossary for shared terms across the project. Implementation details belong in code or ADRs — not here.

## Glossary

### Workspace

A logical container of notes and assets. Lives as a row in the Convex `workspaces` table. Identified by `name` (human-meaningful, unique within a deployment) and `_id` (Convex ID). The Convex row is the source of truth; everything else is a view into it.

### Workspace Folder

A folder on a device's local filesystem that is bound to a [[Workspace]]. The binding is denoted by a `.hubble/config.json` file inside the folder containing the `workspaceId` and a `deviceId`. Multiple Workspace Folders on multiple devices can be bound to the same Workspace.

### Plain Folder

A folder open in the desktop app that is *not* bound to a Workspace — no `.hubble/config.json`. The desktop app can read and edit it as a general markdown viewer; nothing syncs.

### Asset

A binary file referenced by a note, such as an image. Asset paths in markdown use the desktop-canonical `<note-stem>.assets/<hash>.<ext>` convention relative to the note's folder.
