import { createHash } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	Menu,
	protocol,
	shell,
} from "electron";

type FileEntry = {
	path: string;
	modified_at: number;
};

type MenuState = {
	hasWorkspace: boolean;
};

const isDev = !app.isPackaged;
const debugPort = process.env.HUBBLE_DESKTOP_DEBUG_PORT ?? "9222";

if (isDev && process.env.HUBBLE_DESKTOP_ENABLE_CDP === "1") {
	app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
	app.commandLine.appendSwitch("remote-debugging-port", debugPort);
}

let mainWindow: BrowserWindow | null = null;
let pendingOpenPath: string | null = firstExistingFileArg(
	process.argv.slice(1),
);
let menuState: MenuState = { hasWorkspace: false };
const watchers = new Map<string, FSWatcher>();
const grantedFiles = new Set<string>();
const grantedRoots = new Set<string>();
let grantsLoaded = false;

function grantsPath(): string {
	return path.join(app.getPath("userData"), "grants.json");
}

async function loadGrants() {
	try {
		const raw = await fs.readFile(grantsPath(), "utf8");
		const parsed = JSON.parse(raw) as { files?: unknown; roots?: unknown };
		if (Array.isArray(parsed.files)) {
			for (const filePath of parsed.files) {
				if (typeof filePath === "string")
					grantedFiles.add(resolvePath(filePath));
			}
		}
		if (Array.isArray(parsed.roots)) {
			for (const rootPath of parsed.roots) {
				if (typeof rootPath === "string")
					grantedRoots.add(resolvePath(rootPath));
			}
		}
	} catch {
		// Missing or malformed grants just means the user must pick paths again.
	} finally {
		grantsLoaded = true;
	}
}

async function saveGrants() {
	if (!grantsLoaded) return;
	await fs.mkdir(path.dirname(grantsPath()), { recursive: true });
	await fs.writeFile(
		grantsPath(),
		JSON.stringify(
			{
				files: [...grantedFiles],
				roots: [...grantedRoots],
			},
			null,
			2,
		),
	);
}

function resolvePath(input: string): string {
	if (typeof input !== "string" || input.trim().length === 0) {
		throw new Error("Path is required");
	}
	if (input === "~") return app.getPath("home");
	if (input.startsWith("~/") || input.startsWith("~\\")) {
		return path.resolve(app.getPath("home"), input.slice(2));
	}
	return path.resolve(input);
}

function grantFile(filePath: string) {
	grantedFiles.add(resolvePath(filePath));
	void saveGrants();
}

function grantRoot(rootPath: string) {
	grantedRoots.add(resolvePath(rootPath));
	void saveGrants();
}

function grantFileWithParent(filePath: string) {
	const resolved = resolvePath(filePath);
	grantFile(resolved);
	grantRoot(path.dirname(resolved));
}

function isWithin(rootPath: string, candidatePath: string): boolean {
	const relative = path.relative(rootPath, candidatePath);
	return (
		relative === "" ||
		(!relative.startsWith("..") && !path.isAbsolute(relative))
	);
}

function assertGranted(input: string): string {
	const resolved = resolvePath(input);
	if (grantedFiles.has(resolved)) return resolved;
	for (const root of grantedRoots) {
		if (isWithin(root, resolved)) return resolved;
	}
	throw new Error(`Path is outside granted scope: ${input}`);
}

function assertGrantedRoot(input: string): string {
	const resolved = assertGranted(input);
	grantRoot(resolved);
	return resolved;
}

async function pathExistsAsFile(input: string): Promise<boolean> {
	try {
		return (await fs.stat(input)).isFile();
	} catch {
		return false;
	}
}

function firstExistingFileArg(args: string[]): string | null {
	for (const arg of args) {
		if (arg.startsWith("-")) continue;
		const resolved = path.resolve(arg);
		try {
			if (fsSync.statSync(resolved).isFile()) {
				grantFileWithParent(resolved);
				return resolved;
			}
		} catch {
			// Keep scanning.
		}
	}
	return null;
}

function sendToRenderer(channel: string, ...args: unknown[]) {
	mainWindow?.webContents.send(channel, ...args);
}

function buildMenu() {
	const template: Electron.MenuItemConstructorOptions[] = [
		{
			label: "File",
			submenu: [
				{
					id: "new-markdown-file",
					label: "New File",
					accelerator: "CmdOrCtrl+N",
					click: () => sendToRenderer("desktop:menu-create-markdown-file"),
				},
				{
					id: "new-workspace",
					label: "Add Folder...",
					accelerator: "CmdOrCtrl+Shift+N",
					click: () => sendToRenderer("desktop:menu-open-folder"),
				},
				{ type: "separator" },
				{
					id: "open",
					label: "Open...",
					accelerator: "CmdOrCtrl+O",
					click: () => sendToRenderer("desktop:menu-open-file"),
				},
				{
					id: "open-workspace",
					label: "Open Folder...",
					accelerator: "CmdOrCtrl+Shift+O",
					enabled: menuState.hasWorkspace,
					click: () => sendToRenderer("desktop:menu-show-workspace-switcher"),
				},
				{ type: "separator" },
				{ role: "close" },
			],
		},
		{
			label: "Edit",
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				{ role: "selectAll" },
			],
		},
	];

	if (isDev) {
		template.push({
			label: "View",
			submenu: [
				{ role: "reload" },
				{ role: "forceReload" },
				{ type: "separator" },
				{ role: "toggleDevTools" },
			],
		});
	}

	if (process.platform === "darwin") {
		template.unshift({
			label: app.name,
			submenu: [
				{ role: "services" },
				{ type: "separator" },
				{ role: "hide" },
				{ role: "hideOthers" },
				{ role: "unhide" },
				{ type: "separator" },
				{ role: "quit" },
			],
		});
	}

	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function extensionFromImage(
	bytes: Uint8Array,
	mimeType: string | null,
): string {
	const mime = mimeType?.trim().toLowerCase() ?? "";
	if (mime.includes("png")) return "png";
	if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
	if (mime.includes("webp")) return "webp";
	if (mime.includes("gif")) return "gif";
	if (mime.includes("bmp")) return "bmp";
	if (mime.includes("svg")) return "svg";

	if (
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47
	) {
		return "png";
	}
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return "jpg";
	}
	if (Buffer.from(bytes.subarray(0, 6)).toString() === "GIF87a") return "gif";
	if (Buffer.from(bytes.subarray(0, 6)).toString() === "GIF89a") return "gif";
	if (
		bytes.length >= 12 &&
		Buffer.from(bytes.subarray(0, 4)).toString() === "RIFF" &&
		Buffer.from(bytes.subarray(8, 12)).toString() === "WEBP"
	) {
		return "webp";
	}
	if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "bmp";
	return "png";
}

function fileAssetsDir(filePath: string): string {
	const parsed = path.parse(filePath);
	if (!parsed.name) throw new Error(`Unable to resolve file name: ${filePath}`);
	return path.join(parsed.dir, `${parsed.name}.assets`);
}

async function collectMarkdownFiles(dir: string, out: FileEntry[]) {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;
		const entryPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			await collectMarkdownFiles(entryPath, out);
		} else if (/\.(md|markdown|mdown)$/i.test(entry.name)) {
			const stat = await fs.stat(entryPath);
			out.push({
				path: entryPath,
				modified_at: Math.floor(stat.mtimeMs / 1000),
			});
		}
	}
}

async function createWindow() {
	mainWindow = new BrowserWindow({
		title: "Hubble",
		width: 800,
		height: 600,
		titleBarStyle: "hidden",
		trafficLightPosition: { x: 12, y: 10 },
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			preload: path.join(__dirname, "../preload/preload.mjs"),
			sandbox: false,
		},
	});

	if (isDev && process.env.ELECTRON_RENDERER_URL) {
		await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
	} else {
		await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
	}
}

function registerIpc() {
	ipcMain.handle(
		"desktop:list-directory",
		async (_event, { path: dirPath }) => {
			const root = assertGrantedRoot(dirPath);
			const stat = await fs.stat(root);
			if (!stat.isDirectory()) throw new Error(`Not a directory: ${dirPath}`);
			const entries: FileEntry[] = [];
			await collectMarkdownFiles(root, entries);
			return entries;
		},
	);

	ipcMain.handle(
		"desktop:read-file-text",
		async (_event, { path: filePath }) => {
			const resolved = assertGranted(filePath);
			return await fs.readFile(resolved, "utf8");
		},
	);

	ipcMain.handle(
		"desktop:write-file-text",
		async (_event, { path: filePath, content }) => {
			const resolved = assertGranted(filePath);
			await fs.writeFile(resolved, String(content));
		},
	);

	ipcMain.handle(
		"desktop:rename-file",
		async (_event, { fromPath, toPath }) => {
			const from = assertGranted(fromPath);
			const to = resolvePath(toPath);
			assertGranted(path.dirname(to));
			await fs.rename(from, to);
			grantFileWithParent(to);
		},
	);

	ipcMain.handle(
		"desktop:persist-pasted-image",
		async (_event, { filePath, bytes, mimeType }) => {
			const resolvedFilePath = assertGranted(filePath);
			if (!Array.isArray(bytes) || bytes.length === 0) {
				throw new Error("Clipboard image bytes are empty");
			}
			const imageBytes = Uint8Array.from(bytes);
			const assetsDir = fileAssetsDir(resolvedFilePath);
			await fs.mkdir(assetsDir, { recursive: true });
			grantRoot(assetsDir);

			const hash = createHash("sha256").update(imageBytes).digest("hex");
			const shortHash = hash.slice(0, 12);
			const ext = extensionFromImage(imageBytes, mimeType);
			let imagePath = path.join(assetsDir, `${shortHash}.${ext}`);
			let deduped = false;

			if (await pathExistsAsFile(imagePath)) {
				const existing = await fs.readFile(imagePath);
				if (Buffer.compare(existing, imageBytes) === 0) {
					deduped = true;
				} else {
					imagePath = path.join(assetsDir, `${hash}.${ext}`);
					if (await pathExistsAsFile(imagePath)) {
						const existingFull = await fs.readFile(imagePath);
						if (Buffer.compare(existingFull, imageBytes) === 0) {
							deduped = true;
						} else {
							throw new Error(
								`Hash collision while saving image at ${imagePath}`,
							);
						}
					}
				}
			}

			if (!deduped && !(await pathExistsAsFile(imagePath))) {
				await fs.writeFile(imagePath, imageBytes);
			}

			grantFile(imagePath);
			return {
				relativeMarkdownPath: path
					.relative(path.dirname(resolvedFilePath), imagePath)
					.split(path.sep)
					.join("/"),
				deduped,
			};
		},
	);

	ipcMain.handle("desktop:delete-file", async (_event, { path: filePath }) => {
		await fs.rm(assertGranted(filePath));
	});

	ipcMain.handle(
		"desktop:read-binary-file",
		async (_event, { path: filePath }) =>
			Array.from(await fs.readFile(assertGranted(filePath))),
	);

	ipcMain.handle(
		"desktop:write-binary-file",
		async (_event, { path: filePath, bytes }) => {
			if (!Array.isArray(bytes)) throw new Error("Bytes must be an array");
			await fs.writeFile(assertGranted(filePath), Uint8Array.from(bytes));
		},
	);

	ipcMain.handle("desktop:open-file-picker", async (_event, options = {}) => {
		const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
			properties: ["openFile"],
			defaultPath:
				typeof options.defaultPath === "string"
					? options.defaultPath
					: undefined,
			title: "Open Markdown file",
			filters: [
				{ name: "Markdown", extensions: ["md", "markdown", "mdown"] },
				{ name: "Text", extensions: ["txt", "text"] },
			],
		});
		const selected = result.filePaths[0] ?? null;
		if (selected) grantFileWithParent(selected);
		return selected;
	});

	ipcMain.handle("desktop:open-folder-picker", async () => {
		const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
			properties: ["openDirectory"],
			title: "Open Folder",
		});
		const selected = result.filePaths[0] ?? null;
		if (selected) grantRoot(selected);
		return selected;
	});

	ipcMain.handle(
		"desktop:save-markdown-file-picker",
		async (_event, options = {}) => {
			const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
				defaultPath:
					typeof options.defaultPath === "string"
						? options.defaultPath
						: undefined,
				title: "New Markdown file",
				filters: [{ name: "Markdown", extensions: ["md"] }],
			});
			if (result.canceled || !result.filePath) return null;
			const selected = result.filePath.endsWith(".md")
				? result.filePath
				: `${result.filePath}.md`;
			grantFileWithParent(selected);
			return selected;
		},
	);

	ipcMain.handle(
		"desktop:watch-path",
		(_event, { watchId, path: watchPath, options }) => {
			const resolved = assertGranted(watchPath);
			const watcher = chokidar.watch(resolved, {
				ignoreInitial: true,
				depth: options?.recursive ? undefined : 0,
			});
			const emit = (changedPath: string) => {
				sendToRenderer(`desktop:watch-path:${watchId}`, [
					path.resolve(changedPath),
				]);
			};
			watcher.on("add", emit);
			watcher.on("change", emit);
			watcher.on("unlink", emit);
			watcher.on("addDir", emit);
			watcher.on("unlinkDir", emit);
			watchers.set(String(watchId), watcher);
		},
	);

	ipcMain.handle("desktop:unwatch-path", async (_event, { watchId }) => {
		const watcher = watchers.get(String(watchId));
		if (watcher) {
			watchers.delete(String(watchId));
			await watcher.close();
		}
	});

	ipcMain.handle("desktop:open-external-url", async (_event, { url }) => {
		if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
			throw new Error("Only http(s) external URLs are allowed");
		}
		await shell.openExternal(url);
	});

	ipcMain.handle("desktop:resolve-path", (_event, { path }) =>
		resolvePath(path),
	);

	ipcMain.handle("desktop:get-launch-file-path", () => {
		const pathToOpen = pendingOpenPath;
		pendingOpenPath = null;
		return pathToOpen;
	});

	ipcMain.handle("desktop:set-menu-state", (_event, state: MenuState) => {
		menuState = { hasWorkspace: state.hasWorkspace === true };
		buildMenu();
	});
}

protocol.registerSchemesAsPrivileged([
	{
		scheme: "hubble-asset",
		privileges: {
			secure: true,
			supportFetchAPI: true,
			corsEnabled: true,
			standard: true,
		},
	},
]);

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
	app.quit();
} else {
	app.on("second-instance", (_event, argv) => {
		const openPath = firstExistingFileArg(argv.slice(1));
		if (!openPath) return;
		pendingOpenPath = openPath;
		if (mainWindow) {
			if (mainWindow.isMinimized()) mainWindow.restore();
			mainWindow.focus();
			sendToRenderer("desktop:open-file", openPath);
		}
	});

	app.on("open-file", (event, filePath) => {
		event.preventDefault();
		const resolved = resolvePath(filePath);
		grantFileWithParent(resolved);
		pendingOpenPath = resolved;
		sendToRenderer("desktop:open-file", resolved);
	});

	app.whenReady().then(async () => {
		await loadGrants();
		await saveGrants();
		protocol.handle("hubble-asset", (request) => {
			const url = new URL(request.url);
			const encodedPath = url.pathname.startsWith("/")
				? url.pathname.slice(1)
				: url.pathname;
			const filePath = assertGranted(decodeURIComponent(encodedPath));
			return new Response(fsSync.readFileSync(filePath));
		});
		registerIpc();
		buildMenu();
		await createWindow();
	});

	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") app.quit();
	});

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			void createWindow();
		}
	});
}
