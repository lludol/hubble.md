import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi } from "../src/desktopApi/types";

function subscribe(channel: string, callback: (...args: never[]) => void) {
	const listener = (_event: Electron.IpcRendererEvent, ...args: never[]) =>
		callback(...args);
	ipcRenderer.on(channel, listener);
	return () => ipcRenderer.removeListener(channel, listener);
}

let nextWatchId = 0;

const desktopApi = {
	listDirectory: (path) =>
		ipcRenderer.invoke("desktop:list-directory", { path }),
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
	resolvePath: (path) => ipcRenderer.invoke("desktop:resolve-path", { path }),
	toAssetUrl: (path) =>
		`hubble-asset://local/?path=${encodeURIComponent(path)}`,
	getLaunchFilePath: () => ipcRenderer.invoke("desktop:get-launch-file-path"),
	setMenuState: (state) => ipcRenderer.invoke("desktop:set-menu-state", state),
	onOpenFile: (callback) =>
		subscribe("desktop:open-file", (path: string) => callback(path)),
	onMenuCreateMarkdownFile: (callback) =>
		subscribe("desktop:menu-create-markdown-file", callback),
	onMenuOpenFile: (callback) => subscribe("desktop:menu-open-file", callback),
	onMenuOpenFolder: (callback) =>
		subscribe("desktop:menu-open-folder", callback),
	onMenuShowWorkspaceSwitcher: (callback) =>
		subscribe("desktop:menu-show-workspace-switcher", callback),
} satisfies DesktopApi;

contextBridge.exposeInMainWorld("desktopApi", desktopApi);
