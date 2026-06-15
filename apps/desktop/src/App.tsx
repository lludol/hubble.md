import { Button, EditorView, type WikiTarget } from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import { keymatch } from "keymatch";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SettingsDialog } from "./components/SettingsDialog";
import { Sidebar } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import {
	SidebarUpdateCallout,
	UpdatesSection,
} from "./components/UpdatesSection";
import { desktopApi } from "./desktopApi";
import type { DesktopUpdateState } from "./desktopApi/types";
import { createEmbedExtension } from "./editor/EmbedExtension";
import { handleImageDrop, handleImagePaste } from "./editor/handleImagePaste";
import { createImageExtension } from "./editor/ImageExtension";
import { createMarkdownFile } from "./fileActions";
import { SIDEBAR_NAV_SELECTOR } from "./selectors";
import {
	forceKeepLocalEdits,
	getPendingRenameTarget,
	handleExternalFileChange,
	loadPath,
	openWorkspace,
	openWorkspaceWithSidebar,
	refreshFiles,
	reloadFromDiskConflict,
	savePathContent,
	setSidebarOpen,
	setWorkspaceSwitcherOpen,
	updateEditorContent,
} from "./store/actions";
import {
	sidebarOpenStore,
	uiStore,
	viewerStore,
	workspacePathStore,
	workspaceStore,
} from "./store/state";

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

function App() {
	const state = useStoreValue(viewerStore);
	const workspacePath = useStoreValue(workspacePathStore);
	const sidebarOpen = useStoreValue(sidebarOpenStore);
	const hasWorkspace = workspacePath !== null;
	const [scrollContainerEl, setScrollContainerEl] =
		useState<HTMLDivElement | null>(null);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [updateState, setUpdateState] = useState<DesktopUpdateState | null>(
		null,
	);
	const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
	const syncWorkspaceTimerRef = useRef<number | null>(null);
	const readyVersion =
		updateState?.status === "ready"
			? (updateState.availableVersion ?? "__unknown__")
			: null;
	const showUpdateCallout = readyVersion !== dismissedVersion;

	const openSettings = useCallback(() => {
		setSettingsOpen(true);
	}, []);

	const installUpdate = useCallback(async () => {
		try {
			await desktopApi.installUpdate();
		} catch (error) {
			toast.error("Failed to install update", {
				description: error instanceof Error ? error.message : String(error),
			});
		}
	}, []);

	const triggerPrimaryUpdateAction = useCallback(async () => {
		if (!updateState?.isSupported) return;
		if (updateState.status === "ready") {
			await installUpdate();
			return;
		}
		await desktopApi.checkForUpdates();
	}, [installUpdate, updateState]);

	useEffect(() => {
		const currentPath = state.currentPath;
		if (!currentPath) return;

		let disposed = false;
		let unwatch: null | (() => void) = null;

		const handleChange = async (paths: string[]) => {
			if (!paths.includes(currentPath)) return;
			if (getPendingRenameTarget(currentPath)) return;
			try {
				const nextContent = await desktopApi.readFileText(currentPath);
				if (viewerStore.get().currentPath !== currentPath) return;
				handleExternalFileChange(currentPath, nextContent);
			} catch {
				if (viewerStore.get().currentPath !== currentPath) return;
				await loadPath(currentPath);
			}
		};

		const setup = async () => {
			unwatch = await desktopApi.watchPath(
				currentPath,
				{ recursive: false },
				(paths) => void handleChange(paths),
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
		const defaultPath =
			viewerStore.get().currentPath ??
			workspaceStore.get().workspacePath ??
			undefined;
		const selected = await desktopApi.openFilePicker({ defaultPath });
		if (typeof selected === "string") {
			await loadPath(selected);
		}
	}, []);

	const syncWorkspace = useCallback((delayMs = 0) => {
		if (syncWorkspaceTimerRef.current !== null) {
			window.clearTimeout(syncWorkspaceTimerRef.current);
		}
		syncWorkspaceTimerRef.current = window.setTimeout(() => {
			syncWorkspaceTimerRef.current = null;
			// The sidebar is snapshot-based; focus/menu sync replaces the old
			// recursive workspace watcher that could exhaust file handles.
			if (!workspaceStore.get().workspacePath) return;
			void refreshFiles();
		}, delayMs);
	}, []);

	useEffect(() => {
		return () => {
			if (syncWorkspaceTimerRef.current !== null) {
				window.clearTimeout(syncWorkspaceTimerRef.current);
			}
		};
	}, []);

	useEffect(() => {
		void desktopApi.setMenuState({ hasWorkspace });
	}, [hasWorkspace]);

	useEffect(() => {
		const onKeyDown = async (event: KeyboardEvent) => {
			if (keymatch(event, "CmdOrCtrl+N")) {
				event.preventDefault();
				await createMarkdownFile();
			} else if (keymatch(event, "CmdOrCtrl+,")) {
				event.preventDefault();
				openSettings();
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
	}, [openFilePicker, openSettings]);

	useEffect(() => {
		let active = true;
		void desktopApi.getUpdateState().then((nextState) => {
			if (active) setUpdateState(nextState);
		});
		const unsubscribe = desktopApi.onUpdateStateChange((nextState) => {
			setUpdateState(nextState);
		});
		return () => {
			active = false;
			unsubscribe();
		};
	}, []);

	useEffect(() => {
		const unlisten = desktopApi.onOpenFile((path) => {
			void loadPath(path);
		});
		return () => {
			unlisten();
		};
	}, []);

	useEffect(() => {
		const disposers = [
			desktopApi.onMenuCreateMarkdownFile(() => void createMarkdownFile()),
			desktopApi.onMenuOpenFile(() => void openFilePicker()),
			desktopApi.onMenuOpenFolder(() => void openWorkspaceWithSidebar()),
			desktopApi.onMenuOpenSettings(() => openSettings()),
			desktopApi.onMenuShowWorkspaceSwitcher(() =>
				setWorkspaceSwitcherOpen(true),
			),
			desktopApi.onMenuSyncWorkspace(() => syncWorkspace()),
		];
		return () => {
			for (const dispose of disposers) dispose();
		};
	}, [openFilePicker, openSettings, syncWorkspace]);

	useEffect(() => {
		// Window focus can fire in bursts when switching apps, so debounce the
		// sidebar refresh and keep the editor interactive while it runs.
		const dispose = desktopApi.onWindowFocus(() => syncWorkspace(300));
		return () => {
			dispose();
		};
	}, [syncWorkspace]);

	useEffect(() => {
		let active = true;
		const init = async () => {
			const launchPath = await desktopApi.getLaunchFilePath();
			if (!active) return;

			if (typeof launchPath === "string" && launchPath.length > 0) {
				await loadPath(launchPath);
				return;
			}
			const launchWorkspacePath = await desktopApi.getLaunchWorkspacePath();
			if (!active) return;

			if (
				typeof launchWorkspacePath === "string" &&
				launchWorkspacePath.length > 0
			) {
				await openWorkspace(launchWorkspacePath);
				setSidebarOpen(true);
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
			<Toolbar
				scrollContainer={scrollContainerEl}
				showSidebarBadge={!sidebarOpen && showUpdateCallout}
			/>
			<div className="flex min-h-0 flex-1 overflow-hidden">
				<Sidebar
					footer={
						updateState?.status === "ready" && showUpdateCallout ? (
							<SidebarUpdateCallout
								onInstall={installUpdate}
								onDismiss={() =>
									setDismissedVersion(readyVersion ?? "__unknown__")
								}
							/>
						) : undefined
					}
				/>
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
			<SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen}>
				{updateState ? (
					<UpdatesSection
						state={updateState}
						onPrimaryAction={() => void triggerPrimaryUpdateAction()}
					/>
				) : null}
			</SettingsDialog>
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

function MarkdownEditor({
	path,
	initialMarkdown,
	onScrollContainerChange,
}: {
	path: string;
	initialMarkdown: string;
	onScrollContainerChange?: (el: HTMLDivElement | null) => void;
}) {
	const workspace = useStoreValue(workspaceStore);
	const wikiTargets: WikiTarget[] = workspace.files.map((file) => {
		const target = relativeWorkspacePath(file.path, workspace.workspacePath);
		return {
			path: file.path,
			target,
			title: wikiDisplayNameForTarget(target),
		};
	});
	return (
		<EditorView
			path={path}
			initialMarkdown={initialMarkdown}
			wikiTargets={wikiTargets}
			extensions={[
				createImageExtension(path),
				createEmbedExtension({
					workspacePath: workspace.workspacePath,
					filePath: path,
				}),
			]}
			onPaste={(editor, event) => handleImagePaste({ editor, event })}
			onDrop={(editor, event) => handleImageDrop({ editor, event })}
			onLocalChange={updateEditorContent}
			onSave={savePathContent}
			onScrollContainerChange={onScrollContainerChange}
			onOpenExternalLink={desktopApi.openExternalUrl}
			onOpenWikiLink={(target) => void loadPath(resolveWikiPath(target))}
			onMessage={(message, kind) =>
				kind === "success" ? toast.success(message) : toast.error(message)
			}
		/>
	);
}

function relativeWorkspacePath(path: string, workspacePath: string | null) {
	if (!workspacePath) return path;
	const prefix = workspacePath.endsWith("/")
		? workspacePath
		: `${workspacePath}/`;
	return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function resolveWikiPath(target: string) {
	if (target.startsWith("/")) return target;
	const workspacePath = workspaceStore.get().workspacePath;
	return workspacePath ? `${workspacePath}/${target.split("#")[0]}` : target;
}

function wikiDisplayNameForTarget(target: string) {
	const withoutHeading = target.split("#")[0] || target;
	const fileName = withoutHeading.split(/[\\/]/).pop() || withoutHeading;
	return fileName.replace(/\.(md|markdown|mdown)$/i, "");
}

export default App;
