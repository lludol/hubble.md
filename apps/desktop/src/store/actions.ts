import { toast } from "sonner";
import { desktopApi } from "../desktopApi";
import { classifyFileChange } from "../externalFileChange";
import { latest } from "../lib/latest";
import {
	applyFileAction,
	appStore,
	cleanFileState,
	emptyDoc,
	type FileEntry,
	getBaseline,
	isInWorkspace,
	LOADING_DELAY_MS,
	MAX_RECENT,
	type SortMode,
	sidebarOpenStore,
	switcherOpenStore,
	viewerStore,
	withOpenedDoc,
	workspaceStore,
} from "./state";

export async function refreshFiles(path = workspaceStore.get().workspacePath) {
	if (!path) return;
	let files: FileEntry[] = [];

	try {
		files = await desktopApi.listDirectory(path);
	} catch {
		files = [];
	}

	workspaceStore.set((state) => {
		if (state.workspacePath !== path) return state;
		return { ...state, files };
	});
}

export function touchFile(path: string) {
	workspaceStore.set((state) => {
		if (!isInWorkspace(path, state.workspacePath)) return state;
		return {
			...state,
			files: state.files.map((file) =>
				file.path === path
					? { ...file, modified_at: Math.floor(Date.now() / 1000) }
					: file,
			),
		};
	});
}

function dirname(filePath: string): string | null {
	const forwardSlash = filePath.lastIndexOf("/");
	const backSlash = filePath.lastIndexOf("\\");
	const separatorIndex = Math.max(forwardSlash, backSlash);
	if (separatorIndex < 0) return null;
	if (separatorIndex === 0) return filePath.slice(0, 1);
	return filePath.slice(0, separatorIndex);
}

function extname(filePath: string): string {
	const basename = filePath.split(/[\\/]/).pop() ?? filePath;
	const dot = basename.lastIndexOf(".");
	return dot > 0 ? basename.slice(dot) : "";
}

function joinPath(parent: string, name: string): string {
	const separator = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
	return parent.endsWith("/") || parent.endsWith("\\")
		? `${parent}${name}`
		: `${parent}${separator}${name}`;
}

if (workspaceStore.get().workspacePath) {
	void refreshFiles();
}

export function setSortMode(mode: SortMode) {
	workspaceStore.select("sortMode").set(mode);
}

export function setWorkspaceSwitcherOpen(isOpen: boolean) {
	switcherOpenStore.set(isOpen);
}

export function setSidebarOpen(isOpen: boolean) {
	sidebarOpenStore.set(isOpen);
}

export function toggleSidebar() {
	sidebarOpenStore.set((open) => !open);
}

export function clearViewer() {
	viewerStore.set((state) => emptyDoc(state.lastOpenedPath));
}

/** Opens a workspace and reveals the sidebar. */
export async function openWorkspaceWithSidebar() {
	await openWorkspace();
	if (workspaceStore.get().workspacePath !== null) {
		sidebarOpenStore.set(true);
	}
}

/** Opens a workspace by path. If no path given, shows a folder picker first. */
export async function openWorkspace(path?: string) {
	let nextPath = path;
	if (!nextPath) {
		const selected = await desktopApi.openFolderPicker();
		if (typeof selected !== "string") return;
		nextPath = selected;
	}

	workspaceStore.set((state) => {
		const filtered = state.recentWorkspaces.filter((p) => p !== nextPath);
		return {
			...state,
			workspacePath: nextPath,
			recentWorkspaces: [nextPath, ...filtered].slice(0, MAX_RECENT),
			files: [],
		};
	});
	switcherOpenStore.set(false);
	await refreshFiles(nextPath);

	const lastFile = workspaceStore.get().lastOpenedPaths[nextPath];
	if (lastFile) {
		await loadPath(lastFile);
		return;
	}

	clearViewer();
}

export function updateEditorContent(path: string, content: string) {
	const current = viewerStore.get();
	if (current.currentPath === path && current.content === content) return;

	viewerStore.set((state) => {
		if (state.currentPath !== path) return state;
		if (
			state.externalChange.kind === "conflict" &&
			content === state.externalChange.diskContent
		) {
			return {
				...state,
				...cleanFileState(content),
			};
		}
		return {
			...state,
			content,
			status: "ready",
			error: null,
		};
	});
}

export async function savePathContent(
	path: string,
	content: string,
	options?: { force?: boolean },
) {
	const current = viewerStore.get();
	const force = options?.force === true;
	if (current.currentPath !== path) return;
	if (!force && current.externalChange.kind === "conflict") return;
	if (!force && current.content === content && content === getBaseline(current))
		return;

	if (!force) {
		try {
			const currentDiskContent = await desktopApi.readFileText(path);
			const nextCurrent = viewerStore.get();
			if (nextCurrent.currentPath !== path) return;
			const action = classifyFileChange({
				editorContent: content,
				baseline: getBaseline(nextCurrent),
				diskContent: currentDiskContent,
			});
			if (action !== "none") {
				viewerStore.set((state) => {
					if (state.currentPath !== path) return state;
					return applyFileAction(state, currentDiskContent, action);
				});
				return;
			}
		} catch {
			// Fall through to the write path if the file cannot be read during preflight.
		}
	}

	try {
		await desktopApi.writeFileText(path, content);
		touchFile(path);
		viewerStore.set((state) => {
			if (state.currentPath !== path) return state;
			return {
				...state,
				...cleanFileState(content),
			};
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		toast.error("Failed to save file", { description: message });
		viewerStore.set((state) => {
			if (state.currentPath !== path) return state;
			return {
				...state,
				status: "error",
				error: message,
			};
		});
	}
}

export async function renameCurrentMarkdownFile(nextName: string) {
	const current = viewerStore.get();
	if (!current.currentPath) return;

	const trimmedName = nextName.trim();
	if (trimmedName.length === 0 || /[\\/]/.test(trimmedName)) return;

	const parent = dirname(current.currentPath);
	if (!parent) return;

	const currentExt = extname(current.currentPath);
	const nextFileName = /\.[^/.\\]+$/.test(trimmedName)
		? trimmedName
		: `${trimmedName}${currentExt}`;
	const nextPath = joinPath(parent, nextFileName);
	if (nextPath === current.currentPath) return;

	try {
		await savePathContent(current.currentPath, current.content, {
			force: true,
		});
		await desktopApi.renameFile(current.currentPath, nextPath);
		appStore.set((state) => ({
			...state,
			workspace: {
				...state.workspace,
				files: state.workspace.files.map((file) =>
					file.path === current.currentPath
						? { ...file, path: nextPath }
						: file,
				),
				lastOpenedPaths: Object.fromEntries(
					Object.entries(state.workspace.lastOpenedPaths).map(
						([workspacePath, openedPath]) => [
							workspacePath,
							openedPath === current.currentPath ? nextPath : openedPath,
						],
					),
				),
			},
			document: {
				...state.document,
				currentPath: nextPath,
				lastOpenedPath:
					state.document.lastOpenedPath === current.currentPath
						? nextPath
						: state.document.lastOpenedPath,
			},
		}));
		await refreshFiles();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		toast.error("Failed to rename file", { description: message });
	}
}

export function handleExternalFileChange(
	path: string,
	nextDiskContent: string,
) {
	viewerStore.set((state) => {
		if (state.currentPath !== path) return state;
		const action = classifyFileChange({
			editorContent: state.content,
			baseline: getBaseline(state),
			diskContent: nextDiskContent,
		});
		return applyFileAction(state, nextDiskContent, action);
	});
}

export function reloadFromDiskConflict() {
	viewerStore.set((state) => {
		if (state.externalChange.kind !== "conflict") return state;
		return {
			...state,
			...cleanFileState(state.externalChange.diskContent),
		};
	});
}

/** Force-writes the current editor content to disk, overwriting any external changes. */
export async function forceKeepLocalEdits() {
	const current = viewerStore.get();
	if (current.currentPath === null) return;
	await savePathContent(current.currentPath, current.content, { force: true });
}

export const loadPath = latest(async ({ isStale }, path: string) => {
	const timer = window.setTimeout(() => {
		if (isStale()) return;
		viewerStore.set((state) => ({ ...state, status: "loading", error: null }));
	}, LOADING_DELAY_MS);

	try {
		const content = await desktopApi.readFileText(path);
		if (isStale()) return;
		appStore.set((state) => withOpenedDoc(state, path, content));
	} catch (err) {
		if (isStale()) return;
		const message = err instanceof Error ? err.message : String(err);
		toast.error("Failed to open file", { description: message });
		viewerStore.set((state) => ({
			...emptyDoc(state.lastOpenedPath),
			status: "error",
			error: message,
		}));
	} finally {
		window.clearTimeout(timer);
	}
});
