import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod/v4";
import { fileNameFromPath, normalizeDisplayPath } from "../lib/filePath";

export type SidebarSortMode = "alpha" | "recent";
export type SidebarFile = {
	path: string;
	modifiedAt?: number;
};

type FolderNode = {
	id: string;
	name: string;
	modifiedAt: number;
	folders: Map<string, FolderNode>;
	files: SidebarFile[];
};

export type SidebarRow =
	| {
			kind: "folder";
			id: string;
			label: string;
			depth: number;
			expanded: boolean;
	  }
	| {
			kind: "file";
			file: SidebarFile;
			label: string;
			depth: number;
	  };

type ExpandedState = {
	key: string | null;
	folders: Set<string>;
};

const expandedFoldersSchema = z.array(z.string());

export function useSidebarTree({
	files,
	getDisplayPath,
	highlightPath,
	sortMode,
	storageScope,
}: {
	files: SidebarFile[];
	getDisplayPath: (path: string) => string;
	highlightPath: string | null;
	sortMode: SidebarSortMode;
	storageScope?: string | null;
}) {
	const storageKey = storageScope
		? `hubble-sidebar-expanded-folders:${storageScope}`
		: null;
	const revealedPathRef = useRef<string | null>(null);
	const [expandedState, setExpandedState] = useState<ExpandedState>(() => ({
		key: storageKey,
		folders: readExpandedFolders(storageKey),
	}));
	const expandedFolders =
		expandedState.key === storageKey
			? expandedState.folders
			: new Set<string>();

	useEffect(() => {
		revealedPathRef.current = null;
		setExpandedState({
			key: storageKey,
			folders: readExpandedFolders(storageKey),
		});
	}, [storageKey]);

	useEffect(() => {
		if (expandedState.key !== storageKey) return;
		writeExpandedFolders(storageKey, expandedState.folders);
	}, [storageKey, expandedState]);

	const tree = useMemo(
		() => buildFileTree(files, getDisplayPath),
		[files, getDisplayPath],
	);
	const activeAncestorIds = useMemo(
		() =>
			highlightPath
				? getFolderAncestorIds(getDisplayPath(highlightPath))
				: new Set<string>(),
		[highlightPath, getDisplayPath],
	);
	const rows = useMemo(
		() => flattenTree(tree, sortMode, expandedFolders),
		[tree, sortMode, expandedFolders],
	);

	useEffect(() => {
		if (!highlightPath || revealedPathRef.current === highlightPath) return;
		revealedPathRef.current = highlightPath;
		if (activeAncestorIds.size === 0) return;
		// Auto-expand ancestors once per selected file so manual collapse still works.
		setExpandedState((current) => {
			const next = new Set(
				current.key === storageKey
					? current.folders
					: readExpandedFolders(storageKey),
			);
			let changed = false;
			for (const id of activeAncestorIds) {
				if (next.has(id)) continue;
				next.add(id);
				changed = true;
			}
			return changed ? { key: storageKey, folders: next } : current;
		});
	}, [activeAncestorIds, highlightPath, storageKey]);

	const setExpanded = useCallback(
		(id: string, expanded: boolean) => {
			setExpandedState((current) => {
				const next = new Set(
					current.key === storageKey
						? current.folders
						: readExpandedFolders(storageKey),
				);
				if (expanded) next.add(id);
				else next.delete(id);
				return { key: storageKey, folders: next };
			});
		},
		[storageKey],
	);
	const expandFolder = useCallback(
		(id: string) => setExpanded(id, true),
		[setExpanded],
	);
	const collapseFolder = useCallback(
		(id: string) => setExpanded(id, false),
		[setExpanded],
	);
	const toggleFolder = useCallback(
		(id: string) => setExpanded(id, !expandedFolders.has(id)),
		[expandedFolders, setExpanded],
	);

	return { collapseFolder, expandFolder, rows, toggleFolder };
}

function makeFolder(id: string, name: string): FolderNode {
	return {
		id,
		name,
		modifiedAt: 0,
		folders: new Map(),
		files: [],
	};
}

function buildFileTree(
	files: SidebarFile[],
	getDisplayPath: (path: string) => string,
): FolderNode {
	const root = makeFolder("", "");

	for (const file of files) {
		const displayPath = normalizeDisplayPath(getDisplayPath(file.path));
		if (!displayPath) continue;
		const segments = displayPath.split("/").filter(Boolean);
		const fileName = segments.pop();
		if (!fileName) continue;

		let parent = root;
		const modifiedAt = file.modifiedAt ?? 0;
		for (const segment of segments) {
			const id = `${parent.id}${segment}/`;
			let folder = parent.folders.get(segment);
			if (!folder) {
				folder = makeFolder(id, segment);
				parent.folders.set(segment, folder);
			}
			folder.modifiedAt = Math.max(folder.modifiedAt, modifiedAt);
			parent = folder;
		}

		parent.files.push({
			...file,
			path: file.path,
			modifiedAt,
		});
		parent.modifiedAt = Math.max(parent.modifiedAt, modifiedAt);
	}

	return root;
}

function flattenTree(
	root: FolderNode,
	sortMode: SidebarSortMode,
	expandedFolders: Set<string>,
): SidebarRow[] {
	const rows: SidebarRow[] = [];
	appendFolderChildren(root, 0, sortMode, expandedFolders, rows);
	return rows;
}

function appendFolderChildren(
	folder: FolderNode,
	depth: number,
	sortMode: SidebarSortMode,
	expandedFolders: Set<string>,
	rows: SidebarRow[],
) {
	const folders = [...folder.folders.values()].sort((a, b) =>
		compareNodes(a, b, sortMode),
	);
	const files = [...folder.files].sort((a, b) => compareFiles(a, b, sortMode));

	for (const child of folders) {
		const compacted = compactFolder(child);
		const expanded = expandedFolders.has(compacted.folder.id);
		rows.push({
			kind: "folder",
			id: compacted.folder.id,
			label: compacted.label,
			depth,
			expanded,
		});
		if (expanded) {
			appendFolderChildren(
				compacted.folder,
				depth + 1,
				sortMode,
				expandedFolders,
				rows,
			);
		}
	}

	for (const file of files) {
		rows.push({
			kind: "file",
			file,
			label: fileNameFromPath(file.path),
			depth,
		});
	}
}

/** Collapses chains like `deeply/nested/folder` into one folder row. */
function compactFolder(folder: FolderNode): {
	folder: FolderNode;
	label: string;
} {
	const names = [folder.name];
	let cursor = folder;
	while (cursor.files.length === 0 && cursor.folders.size === 1) {
		const onlyChild = cursor.folders.values().next().value as
			| FolderNode
			| undefined;
		if (!onlyChild) break;
		names.push(onlyChild.name);
		cursor = onlyChild;
	}
	return { folder: cursor, label: names.join("/") };
}

function compareNodes(
	a: Pick<FolderNode, "name" | "modifiedAt">,
	b: Pick<FolderNode, "name" | "modifiedAt">,
	sortMode: SidebarSortMode,
) {
	if (sortMode === "recent") {
		const byModified = b.modifiedAt - a.modifiedAt;
		if (byModified !== 0) return byModified;
	}
	return a.name.localeCompare(b.name);
}

function compareFiles(
	a: SidebarFile,
	b: SidebarFile,
	sortMode: SidebarSortMode,
) {
	if (sortMode === "recent") {
		const byModified = (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0);
		if (byModified !== 0) return byModified;
	}
	return fileNameFromPath(a.path).localeCompare(fileNameFromPath(b.path));
}

function getFolderAncestorIds(displayPath: string): Set<string> {
	const segments = normalizeDisplayPath(displayPath).split("/").filter(Boolean);
	segments.pop();
	const ancestors = new Set<string>();
	let current = "";
	for (const segment of segments) {
		current = `${current}${segment}/`;
		ancestors.add(current);
	}
	return ancestors;
}

function readExpandedFolders(storageKey: string | null): Set<string> {
	if (!storageKey || typeof localStorage === "undefined") return new Set();
	try {
		const raw = localStorage.getItem(storageKey);
		return new Set(expandedFoldersSchema.parse(raw ? JSON.parse(raw) : []));
	} catch {
		return new Set();
	}
}

function writeExpandedFolders(
	storageKey: string | null,
	expandedFolders: Set<string>,
) {
	if (!storageKey || typeof localStorage === "undefined") return;
	localStorage.setItem(storageKey, JSON.stringify([...expandedFolders]));
}
