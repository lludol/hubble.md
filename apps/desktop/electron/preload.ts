import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi } from "../src/desktopApi/types";

function subscribe<T extends unknown[]>(
	channel: string,
	callback: (...args: T) => void,
) {
	const listener = (_event: Electron.IpcRendererEvent, ...args: T) =>
		callback(...args);
	ipcRenderer.on(channel, listener);
	return () => ipcRenderer.removeListener(channel, listener);
}

let nextWatchId = 0;

const desktopApi = {
	platform: process.platform,
	listDirectory: (path) =>
		ipcRenderer.invoke("desktop:list-directory", { path }),
	listEmbedFiles: (workspacePath, glob) =>
		ipcRenderer.invoke("desktop:embed-list-files", { workspacePath, glob }),
	readWorkspaceConfig: (workspacePath) =>
		ipcRenderer.invoke("desktop:read-workspace-config", { workspacePath }),
	writeWorkspaceConfig: (workspacePath, config) =>
		ipcRenderer.invoke("desktop:write-workspace-config", {
			workspacePath,
			config,
		}),
	readFileText: (path) =>
		ipcRenderer.invoke("desktop:read-file-text", { path }),
	writeFileText: (path, content) =>
		ipcRenderer.invoke("desktop:write-file-text", { path, content }),
	renameFile: (fromPath, toPath) =>
		ipcRenderer.invoke("desktop:rename-file", { fromPath, toPath }),
	persistPastedImage: (input) =>
		ipcRenderer.invoke("desktop:persist-pasted-image", input),
	deleteFile: (path, options) =>
		ipcRenderer.invoke("desktop:delete-file", { path, options }),
	readBinaryFile: (path) =>
		ipcRenderer.invoke("desktop:read-binary-file", { path }),
	writeBinaryFile: (path, bytes) =>
		ipcRenderer.invoke("desktop:write-binary-file", { path, bytes }),
	openFilePicker: (options) =>
		ipcRenderer.invoke("desktop:open-file-picker", options),
	openFolderPicker: () => ipcRenderer.invoke("desktop:open-folder-picker"),
	saveMarkdownFilePicker: (options) =>
		ipcRenderer.invoke("desktop:save-markdown-file-picker", options),
	watchPath: async (path, options, callback) => {
		const watchId = String(++nextWatchId);
		const unsubscribeEvents = subscribe(
			`desktop:watch-path:${watchId}`,
			(paths: string[]) => callback(paths),
		);
		await ipcRenderer.invoke("desktop:watch-path", { watchId, path, options });
		return () => {
			unsubscribeEvents();
			void ipcRenderer.invoke("desktop:unwatch-path", { watchId });
		};
	},
	openExternalUrl: (url) =>
		ipcRenderer.invoke("desktop:open-external-url", { url }),
	revealFile: (path) => ipcRenderer.invoke("desktop:reveal-file", { path }),
	resolvePath: (path) => ipcRenderer.invoke("desktop:resolve-path", { path }),
	toAssetUrl: (path) =>
		`hubble-asset://local/?path=${encodeURIComponent(path)}`,
	getLaunchFilePath: () => ipcRenderer.invoke("desktop:get-launch-file-path"),
	getLaunchWorkspacePath: () =>
		ipcRenderer.invoke("desktop:get-launch-workspace-path"),
	setMenuState: (state) => ipcRenderer.invoke("desktop:set-menu-state", state),
	getUpdateState: () => ipcRenderer.invoke("desktop:get-update-state"),
	checkForUpdates: () => ipcRenderer.invoke("desktop:check-for-updates"),
	installUpdate: () => ipcRenderer.invoke("desktop:install-update"),
	onOpenFile: (callback) =>
		subscribe("desktop:open-file", (path: string) => callback(path)),
	onUpdateStateChange: (callback) =>
		subscribe("desktop:update-state", callback),
	onMenuCreateMarkdownFile: (callback) =>
		subscribe("desktop:menu-create-markdown-file", callback),
	onMenuOpenFile: (callback) => subscribe("desktop:menu-open-file", callback),
	onMenuOpenFolder: (callback) =>
		subscribe("desktop:menu-open-folder", callback),
	onMenuOpenSettings: (callback) =>
		subscribe("desktop:menu-open-settings", callback),
	onMenuShowWorkspaceSwitcher: (callback) =>
		subscribe("desktop:menu-show-workspace-switcher", callback),
	onMenuSyncWorkspace: (callback) =>
		subscribe("desktop:menu-sync-workspace", callback),
	onWindowFocus: (callback) => subscribe("desktop:window-focus", callback),
} satisfies DesktopApi;

contextBridge.exposeInMainWorld("desktopApi", desktopApi);
