import {
	LinkExtension,
	listExtensions,
	MarkdownRolloverExtension,
	markdownToTiptapDoc,
	tiptapDocToMarkdown,
} from "@hubble.md/editor";
import { useStoreValue } from "@simplestack/store/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { watch } from "@tauri-apps/plugin-fs";
import { TaskItem } from "@tiptap/extension-list";
import { EditorContent, type JSONContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { keymatch } from "keymatch";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createAppMenu } from "./appMenu";
import { Sidebar } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { Button } from "./components/ui/button";
import { FormattingStatusBar } from "./editor/FormattingStatusBar";
import { handleImagePaste } from "./editor/handleImagePaste";
import { createImageExtension } from "./editor/ImageExtension";
import { LinkCreationGhostExtension } from "./editor/LinkCreationGhostExtension";
import { LinkPopover } from "./editor/LinkPopover";
import { SmartLinkExtension } from "./editor/SmartLinkExtension";
import { VirtualCursor } from "./editor/VirtualCursor";
import { createNote } from "./noteActions";
import { EDITOR_INPUT_ATTR, SIDEBAR_NAV_SELECTOR } from "./selectors";
import {
	forceKeepLocalEdits,
	handleExternalFileChange,
	loadPath,
	openWorkspaceWithSidebar,
	refreshFiles,
	reloadFromDiskConflict,
	savePathContent,
	setSidebarOpen,
	setWorkspaceSwitcherOpen,
	updateEditorContent,
} from "./store/actions";
import {
	uiStore,
	viewerStore,
	workspacePathStore,
	workspaceStore,
} from "./store/state";
import "./editor/prosemirror.css";

// Forces editor refresh when underlying TipTap extensions change
const HMR_REV = (() => {
	if (!import.meta.hot) return 0;
	const hotData = import.meta.hot.data as { __editorRev?: number };
	hotData.__editorRev = (hotData.__editorRev ?? 0) + 1;
	return hotData.__editorRev;
})();

function focusSidebarNav() {
	document.querySelector<HTMLElement>(SIDEBAR_NAV_SELECTOR)?.focus();
}
function getParentPath(path: string) {
	const forwardSlash = path.lastIndexOf("/");
	const backSlash = path.lastIndexOf("\\");
	const separatorIndex = Math.max(forwardSlash, backSlash);
	if (separatorIndex < 0) return null;
	if (separatorIndex === 0) return path.slice(0, 1);
	return path.slice(0, separatorIndex);
}

function App() {
	const state = useStoreValue(viewerStore);
	const workspacePath = useStoreValue(workspacePathStore);
	const hasWorkspace = workspacePath !== null;
	const [scrollContainerEl, setScrollContainerEl] =
		useState<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!workspacePath) return;

		let disposed = false;
		let unwatch: null | (() => void) = null;

		const isIgnoredPath = (path: string) =>
			path.includes("/.hubble/") ||
			path.endsWith("/.hubble") ||
			path.includes("\\.hubble\\");

		const handleChange = async (paths: string[]) => {
			const changedPaths = paths.filter((path) => !isIgnoredPath(path));
			if (changedPaths.length === 0) return;
			void refreshFiles(workspacePath);
		};

		const setup = async () => {
			unwatch = await watch(
				workspacePath,
				(event) => {
					const paths = Array.isArray(event.paths) ? event.paths : [];
					void handleChange(paths);
				},
				{ recursive: true },
			);
			if (disposed && unwatch) {
				unwatch();
			}
		};

		void setup();
		return () => {
			disposed = true;
			if (unwatch) {
				unwatch();
			}
		};
	}, [workspacePath]);

	useEffect(() => {
		const currentPath = state.currentPath;
		const parentPath = currentPath ? getParentPath(currentPath) : null;
		if (!currentPath || !parentPath) return;

		let disposed = false;
		let unwatch: null | (() => void) = null;

		const handleChange = async (paths: string[]) => {
			if (!paths.includes(currentPath)) return;
			try {
				const nextContent = await invoke<string>("read_file_text", {
					path: currentPath,
				});
				handleExternalFileChange(currentPath, nextContent);
			} catch {
				await loadPath(currentPath);
			}
		};

		const setup = async () => {
			unwatch = await watch(
				parentPath,
				(event) => {
					const paths = Array.isArray(event.paths) ? event.paths : [];
					void handleChange(paths);
				},
				{ recursive: false },
			);
			if (disposed && unwatch) {
				unwatch();
			}
		};

		void setup();
		return () => {
			disposed = true;
			if (unwatch) {
				unwatch();
			}
		};
	}, [state.currentPath]);

	const openFilePicker = useCallback(async () => {
		const defaultPath = workspaceStore.get().workspacePath ?? undefined;
		const selected = await open({
			multiple: false,
			directory: false,
			title: "Open Markdown file",
			defaultPath,
			filters: [
				{ name: "Markdown", extensions: ["md", "markdown", "mdown"] },
				{ name: "Text", extensions: ["txt", "text"] },
			],
		});
		if (typeof selected === "string") {
			await loadPath(selected);
		}
	}, []);

	useEffect(() => {
		const setupMenu = async () => {
			const menu = await createAppMenu({
				newNote: () => void createNote(),
				open: () => void openFilePicker(),
				newWorkspace: () => void openWorkspaceWithSidebar(),
				openWorkspace: () => setWorkspaceSwitcherOpen(true),
				hasWorkspace,
			});
			await menu.setAsAppMenu();
		};
		void setupMenu();
		const onKeyDown = async (event: KeyboardEvent) => {
			if (keymatch(event, "CmdOrCtrl+N")) {
				event.preventDefault();
				await createNote();
			} else if (keymatch(event, "CmdOrCtrl+Shift+O")) {
				if (!workspaceStore.get().workspacePath) return;
				event.preventDefault();
				setWorkspaceSwitcherOpen(true);
			} else if (keymatch(event, "CmdOrCtrl+Shift+N")) {
				event.preventDefault();
				await openWorkspaceWithSidebar();
			} else if (keymatch(event, "CmdOrCtrl+O")) {
				event.preventDefault();
				await openFilePicker();
			} else if (keymatch(event, "CmdOrCtrl+Shift+E")) {
				event.preventDefault();
				const opening = !uiStore.get().sidebarOpen;
				setSidebarOpen(opening);
				if (opening) {
					requestAnimationFrame(() => focusSidebarNav());
				}
			} else if (keymatch(event, "CmdOrCtrl+0")) {
				event.preventDefault();
				focusSidebarNav();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [openFilePicker, hasWorkspace]);

	useEffect(() => {
		let disposed = false;
		let unlisten: (() => void) | null = null;
		const setup = async () => {
			const nextUnlisten = await listen<{ path?: string }>(
				"hubble://open-file",
				async (event) => {
					const path = event.payload?.path;
					if (path) {
						await loadPath(path);
					}
				},
			);
			if (disposed) {
				nextUnlisten();
				return;
			}
			unlisten = nextUnlisten;
		};
		void setup();
		return () => {
			disposed = true;
			if (unlisten) {
				unlisten();
			}
		};
	}, []);

	useEffect(() => {
		let active = true;
		const init = async () => {
			const launchPath = await invoke<string | null>("get_launch_file_path");
			if (!active) return;

			if (typeof launchPath === "string" && launchPath.length > 0) {
				await loadPath(launchPath);
				return;
			}
			const nextState = viewerStore.get();
			const workspace = workspaceStore.get();
			const lastPath =
				nextState.lastOpenedPath ??
				(workspace.workspacePath
					? workspace.lastOpenedPaths[workspace.workspacePath]
					: undefined);
			if (lastPath) {
				await loadPath(lastPath);
			}
		};
		void init();
		return () => {
			active = false;
		};
	}, []);

	return (
		<main className="flex h-dvh flex-col bg-background text-foreground">
			<Toolbar scrollContainer={scrollContainerEl} />
			<div className="flex min-h-0 flex-1 overflow-hidden">
				<Sidebar />
				<section className="flex-1 overflow-hidden" aria-live="polite">
					{state.status === "loading" && <p>Loading…</p>}
					{state.status === "error" && (
						<p>{state.error ?? "Failed to open file."}</p>
					)}
					{state.status !== "loading" &&
						state.status !== "error" &&
						!state.currentPath && (
							<div className="flex h-full items-center justify-center p-6">
								<div className="flex max-w-sm flex-col items-center gap-2 text-center">
									{!hasWorkspace && (
										<>
											<h2 className="text-xl font-semibold">
												Welcome to Hubble.md
											</h2>
											<p className="text-sm text-muted-foreground mb-2">
												Let's write some markdown together.
											</p>
										</>
									)}
									<div className="flex flex-wrap items-center justify-center gap-2">
										<Button onClick={() => void openFilePicker()}>
											Open file
										</Button>
										{!hasWorkspace && (
											<Button
												variant="outline"
												onClick={() => void openWorkspaceWithSidebar()}
											>
												Open folder
											</Button>
										)}
									</div>
								</div>
							</div>
						)}
					{state.status === "ready" && state.currentPath && (
						<div className="flex h-full min-h-0 flex-col">
							{state.externalChange.kind === "conflict" && (
								<ExternalChangeBanner
									onKeepMyEdits={() => void forceKeepLocalEdits()}
									onReloadFromDisk={reloadFromDiskConflict}
								/>
							)}
							<MarkdownEditor
								key={`${state.currentPath}:${HMR_REV}`}
								path={state.currentPath}
								initialMarkdown={state.content}
								onScrollContainerChange={setScrollContainerEl}
							/>
						</div>
					)}
				</section>
			</div>
		</main>
	);
}

function ExternalChangeBanner({
	onReloadFromDisk,
	onKeepMyEdits,
}: {
	onReloadFromDisk: () => void;
	onKeepMyEdits: () => void;
}) {
	return (
		<div className="border-b border-border bg-muted/40">
			<div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
				<p className="m-0 text-sm text-muted-foreground">
					File changed on disk. Reload it or keep your editor edits.
				</p>
				<div className="flex shrink-0 items-center gap-2">
					<Button size="sm" variant="outline" onClick={onReloadFromDisk}>
						Reload from disk
					</Button>
					<Button size="sm" onClick={onKeepMyEdits}>
						Keep my edits
					</Button>
				</div>
			</div>
		</div>
	);
}

const SAVE_DEBOUNCE_MS = 120;

function MarkdownEditor({
	path,
	initialMarkdown,
	onScrollContainerChange,
}: {
	path: string;
	initialMarkdown: string;
	onScrollContainerChange?: (el: HTMLDivElement | null) => void;
}) {
	const latestMarkdownRef = useRef(initialMarkdown);
	const saveTimerRef = useRef<number | null>(null);
	const editorRootRef = useRef<HTMLDivElement | null>(null);
	const editorViewportRef = useRef<HTMLDivElement | null>(null);
	const [editorViewportEl, setEditorViewportEl] =
		useState<HTMLDivElement | null>(null);
	const setEditorViewport = useCallback(
		(node: HTMLDivElement | null) => {
			editorViewportRef.current = node;
			setEditorViewportEl(node);
			onScrollContainerChange?.(node);
		},
		[onScrollContainerChange],
	);
	const initialDoc = useMemo(
		() => markdownToTiptapDoc(initialMarkdown),
		[initialMarkdown],
	);

	const editor = useEditor({
		extensions: [
			StarterKit.configure({
				listItem: false,
			}),
			LinkExtension,
			SmartLinkExtension,
			LinkCreationGhostExtension,
			MarkdownRolloverExtension,
			createImageExtension(path),
			...listExtensions,
			TaskItem.configure({
				nested: true,
			}),
		],
		content: initialDoc,
		onUpdate: ({ editor: currentEditor }) => {
			const markdown = tiptapDocToMarkdown(
				currentEditor.getJSON() as JSONContent,
			);
			latestMarkdownRef.current = markdown;
			updateEditorContent(path, markdown);

			if (saveTimerRef.current !== null) {
				window.clearTimeout(saveTimerRef.current);
			}
			saveTimerRef.current = window.setTimeout(() => {
				void savePathContent(path, latestMarkdownRef.current);
			}, SAVE_DEBOUNCE_MS);
		},
		autofocus: "end",
		editorProps: {
			attributes: {
				class: "min-h-full outline-none",
				[EDITOR_INPUT_ATTR]: "",
			},
			handlePaste: (_view, event): boolean => {
				const currentEditor = editor;
				if (!currentEditor) return false;
				return handleImagePaste({
					editor: currentEditor,
					filePath: path,
					event,
				});
			},
		},
	});

	useEffect(() => {
		if (!editor) return;
		latestMarkdownRef.current = initialMarkdown;
		const current = tiptapDocToMarkdown(editor.getJSON() as JSONContent);
		if (current === initialMarkdown) return;
		editor.commands.setContent(markdownToTiptapDoc(initialMarkdown), {
			emitUpdate: false,
		});
	}, [editor, initialMarkdown]);

	useEffect(() => {
		return () => {
			if (saveTimerRef.current !== null) {
				window.clearTimeout(saveTimerRef.current);
			}
			void savePathContent(path, latestMarkdownRef.current);
		};
	}, [path]);

	return (
		<div className="relative flex h-full min-h-0 flex-col" ref={editorRootRef}>
			<div
				className="relative min-h-0 flex-1 overflow-auto overscroll-contain"
				ref={setEditorViewport}
			>
				<EditorContent editor={editor} className="h-full" />
				<VirtualCursor
					editor={editor}
					containerRef={editorRootRef}
					viewportRef={editorViewportRef}
				/>
			</div>
			<LinkPopover editor={editor} containerRef={editorRootRef} />
			<FormattingStatusBar editor={editor} scrollContainer={editorViewportEl} />
		</div>
	);
}

export default App;
