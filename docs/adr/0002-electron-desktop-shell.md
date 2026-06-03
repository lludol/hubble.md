# Electron desktop shell

The desktop app will replace Tauri with Electron in `apps/desktop` so the renderer can be exposed over Chrome DevTools Protocol for agentic Chrome DevTools MCP access during development and testing. This trades Tauri's smaller native runtime for Chromium-level inspection/control, while keeping Node filesystem access in Electron main, exposing only a typed `window.desktopApi` bridge to the renderer, and preserving Workspace Folder, Plain Folder, and Loose File editing through granted filesystem scopes.
