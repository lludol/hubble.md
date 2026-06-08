import { Menu } from "@base-ui/react/menu";
import { Select } from "@base-ui/react/select";
import { useCallback, useEffect, useRef, useState } from "react";
import MingcuteAzSortAscendingLettersLine from "~icons/mingcute/az-sort-ascending-letters-line";
import MingcuteCheckLine from "~icons/mingcute/check-line";
import MingcuteDeleteLine from "~icons/mingcute/delete-line";
import MingcuteEditLine from "~icons/mingcute/edit-line";
import MingcuteMore2Line from "~icons/mingcute/more-2-line";
import MingcuteRightLine from "~icons/mingcute/right-line";
import MingcuteSortDescendingLine from "~icons/mingcute/sort-descending-line";
import {
	dirname,
	fileNameFromPath,
	normalizeDisplayPath,
	splitFileName,
} from "../lib/filePath";
import { cn } from "../lib/utils";
import { Button } from "../primitives/button";
import { useSidebarKeyboardNav } from "./useSidebarKeyboardNav";
import {
	type SidebarFile,
	type SidebarRow,
	type SidebarSortMode,
	useSidebarTree,
} from "./useSidebarTree";

export type { SidebarFile, SidebarSortMode };

const sidebarActionClass =
	"flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-start text-[11px] font-normal outline-hidden select-none";
const sidebarActionIconClass =
	"inline-flex size-4 shrink-0 items-center justify-center [&_svg]:size-3.5";

export function Sidebar({
	files,
	currentPath,
	pendingPath,
	sortMode,
	storageScope,
	header,
	emptyState,
	getDisplayPath = (path) => path,
	onSortModeChange,
	onSelectFile,
	onRenameFile,
	onDeleteFile,
	onCreateFile,
	onDeleteFolder,
}: {
	files: SidebarFile[];
	currentPath: string | null;
	pendingPath?: string | null;
	sortMode: SidebarSortMode;
	/** Stable key used to persist folder expansion for one workspace/open folder. */
	storageScope?: string | null;
	header?: React.ReactNode;
	emptyState?: React.ReactNode;
	getDisplayPath?: (path: string) => string;
	onSortModeChange: (mode: SidebarSortMode) => void;
	onSelectFile: (path: string) => void;
	onRenameFile?: (path: string, nextName: string) => void;
	onDeleteFile?: (path: string) => void;
	onCreateFile?: (folderId: string | null) => Promise<string | null>;
	onDeleteFolder?: (folderId: string) => void;
}) {
	const navRef = useRef<HTMLDivElement>(null);
	const renameInputRef = useRef<HTMLInputElement | null>(null);
	const [openActionsPath, setOpenActionsPath] = useState<string | null>(null);
	const [renamingPath, setRenamingPath] = useState<string | null>(null);
	const [renameDraft, setRenameDraft] = useState("");
	const [deleteOnCancel, setDeleteOnCancel] = useState<{
		path: string;
		draft: string;
	} | null>(null);
	const [renameError, setRenameError] = useState<string | null>(null);
	const highlightPath = pendingPath ?? currentPath;
	const { collapseFolder, expandFolder, rows, toggleFolder } = useSidebarTree({
		files,
		getDisplayPath,
		highlightPath,
		sortMode,
		storageScope,
	});
	const beginRename = useCallback(
		(
			file: SidebarFile,
			label: string,
			options?: { deleteOnUnchangedCancel?: boolean },
		) => {
			const name = splitFileName(label).name;
			setOpenActionsPath(null);
			setRenamingPath(file.path);
			setRenameDraft(name);
			setDeleteOnCancel(
				options?.deleteOnUnchangedCancel
					? { path: file.path, draft: name }
					: null,
			);
			setRenameError(null);
		},
		[],
	);
	const createFile = useCallback(
		async (folderId: string | null) => {
			if (!onCreateFile) return;
			setOpenActionsPath(null);
			if (folderId) expandFolder(folderId);
			const path = await onCreateFile(folderId);
			if (!path) return;
			beginRename({ path }, fileNameFromPath(getDisplayPath(path)), {
				deleteOnUnchangedCancel: true,
			});
		},
		[beginRename, expandFolder, getDisplayPath, onCreateFile],
	);
	const activateRow = useCallback(
		(row: SidebarRow) => {
			if (row.kind === "file") onSelectFile(row.file.path);
			else toggleFolder(row.id);
		},
		[onSelectFile, toggleFolder],
	);
	const enterRowEdit = useCallback(
		(row: SidebarRow) => {
			if (row.kind === "file" && onRenameFile) beginRename(row.file, row.label);
			else activateRow(row);
		},
		[activateRow, beginRename, onRenameFile],
	);
	const expandRow = useCallback(
		(row: SidebarRow) => {
			if (row.kind === "folder") expandFolder(row.id);
		},
		[expandFolder],
	);
	const collapseRow = useCallback(
		(row: SidebarRow) => {
			if (row.kind === "folder") collapseFolder(row.id);
		},
		[collapseFolder],
	);
	const activeIndex = rows.findIndex(
		(row) => row.kind === "file" && row.file.path === highlightPath,
	);
	const { focusedIndex, setFocusedIndex, onKeyDown } = useSidebarKeyboardNav({
		items: rows,
		onSelect: activateRow,
		onEnter: enterRowEdit,
		onExpand: expandRow,
		onCollapse: collapseRow,
		navRef,
		activeIndex,
	});

	useEffect(() => {
		if (highlightPath || rows.length === 0 || focusedIndex !== null) return;
		setFocusedIndex(0);
	}, [focusedIndex, highlightPath, rows.length, setFocusedIndex]);

	useEffect(() => {
		if (!renamingPath) return;
		renameInputRef.current?.focus();
		renameInputRef.current?.select();
	}, [renamingPath]);

	const resetRename = useCallback(() => {
		setRenamingPath(null);
		setRenameDraft("");
		setDeleteOnCancel(null);
		setRenameError(null);
	}, []);

	const cancelRename = useCallback(() => {
		const shouldDelete =
			deleteOnCancel &&
			deleteOnCancel.path === renamingPath &&
			deleteOnCancel.draft === renameDraft;
		if (shouldDelete && onDeleteFile) onDeleteFile(deleteOnCancel.path);
		resetRename();
	}, [deleteOnCancel, onDeleteFile, renameDraft, renamingPath, resetRename]);

	const getRenameError = useCallback(
		(path: string, draft: string) => {
			const nextName = draft.trim();
			if (!nextName) return null;
			const targetName = renameTargetName(path, nextName, getDisplayPath);
			if (!renameTargetExists(path, nextName, files, getDisplayPath))
				return null;
			return `A file ${targetName} already exists at this location.`;
		},
		[files, getDisplayPath],
	);

	const commitRename = useCallback(() => {
		const path = renamingPath;
		if (!path || !onRenameFile) return;
		const nextName = renameDraft.trim();
		if (!nextName) {
			resetRename();
			return;
		}
		const error = getRenameError(path, nextName);
		if (error) {
			setRenameError(error);
			requestAnimationFrame(() => renameInputRef.current?.focus());
			return;
		}
		resetRename();
		onRenameFile(path, nextName);
	}, [getRenameError, onRenameFile, renameDraft, renamingPath, resetRename]);

	return (
		<aside className="flex w-[220px] shrink-0 flex-col overflow-hidden border-e border-sidebar-border bg-sidebar">
			<div className="flex items-center justify-between border-b border-sidebar-border px-2.5 py-1.5">
				{header ?? (
					<span className="text-[11px] font-medium uppercase text-muted-foreground">
						Files
					</span>
				)}
				<div className="flex items-center gap-1">
					{onCreateFile && (
						<Button
							variant="ghost"
							size="icon-xs"
							aria-label="New file"
							title="New file"
							onClick={() => void createFile(null)}
						>
							<MingcuteEditLine className="size-3.5" />
						</Button>
					)}
					<Select.Root
						value={sortMode}
						onValueChange={(mode) => {
							if (mode) onSortModeChange(mode);
						}}
					>
						<Select.Trigger
							render={
								<Button
									variant="ghost"
									size="icon-xs"
									aria-label="Sort by..."
									title="Sort by..."
								/>
							}
						>
							{sortMode === "alpha" ? (
								<MingcuteAzSortAscendingLettersLine className="size-3.5" />
							) : (
								<MingcuteSortDescendingLine className="size-3.5" />
							)}
						</Select.Trigger>
						<Select.Portal>
							<Select.Positioner align="end" side="bottom" sideOffset={4}>
								<Select.Popup className="z-50 w-36 origin-(--transform-origin) rounded-sm border border-border bg-popover p-1 text-[11px] text-popover-foreground shadow-panel inset-shadow-chrome outline-hidden transition-[transform,opacity] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
									<p className="px-2 py-1 text-[10px] font-medium text-muted-foreground">
										Sort by
									</p>
									<SortOption value="recent" label="Recent" />
									<SortOption value="alpha" label="Name" />
								</Select.Popup>
							</Select.Positioner>
						</Select.Portal>
					</Select.Root>
				</div>
			</div>
			<div
				ref={navRef}
				role="tree"
				className="flex-1 overflow-y-auto overscroll-contain py-1 outline-none"
				tabIndex={0}
				onKeyDown={onKeyDown}
				data-sidebar-nav
			>
				{rows.length === 0 && emptyState}
				{rows.map((row, index) => {
					const isActive =
						row.kind === "file" && row.file.path === highlightPath;
					const isFocused = focusedIndex === index;
					const isRenaming =
						row.kind === "file" && row.file.path === renamingPath;
					return (
						<div
							key={row.kind === "folder" ? row.id : row.file.path}
							role="treeitem"
							tabIndex={-1}
							data-sidebar-index={index}
							aria-expanded={row.kind === "folder" ? row.expanded : undefined}
							aria-selected={isActive}
							className={cn(
								"group/sidebar-row flex w-full items-center text-sidebar-foreground hover:bg-sidebar-accent",
								isActive &&
									"bg-sidebar-accent text-sidebar-accent-foreground font-medium",
								isFocused && "bg-sidebar-accent",
								isRenaming && "relative z-30",
							)}
							onPointerEnter={() => setFocusedIndex(index)}
							onPointerLeave={() => setFocusedIndex(null)}
							onContextMenu={(event) => {
								if (row.kind === "file" && !onRenameFile && !onDeleteFile)
									return;
								if (row.kind === "folder" && !onCreateFile && !onDeleteFolder)
									return;
								event.preventDefault();
								setOpenActionsPath(
									row.kind === "file" ? row.file.path : row.id,
								);
							}}
							title={row.label}
						>
							<div
								className={cn(
									"flex min-w-0 flex-1 items-center gap-1 [padding-block:0.25rem] [padding-inline-end:0.5rem] text-start text-[13px]",
									isRenaming ? "overflow-visible" : "truncate",
								)}
								style={
									{
										paddingInlineStart: `${0.5 + row.depth * 0.75}rem`,
									} as React.CSSProperties
								}
							>
								<span className="inline-flex size-3 shrink-0 items-center justify-center text-muted-foreground">
									{row.kind === "folder" && (
										<MingcuteRightLine
											className={cn(
												"size-3 transition-transform duration-150 ease-out",
												row.expanded && "rotate-90",
											)}
										/>
									)}
								</span>
								{isRenaming ? (
									<FileRenameInput
										ref={renameInputRef}
										value={renameDraft}
										error={renameError}
										onChange={(value) => {
											setRenameDraft(value);
											setRenameError(
												row.kind === "file"
													? getRenameError(row.file.path, value)
													: null,
											);
										}}
										onCancel={cancelRename}
										onCommit={commitRename}
									/>
								) : (
									<button
										type="button"
										className="min-w-0 flex-1 truncate border-none bg-transparent p-0 text-start"
										onClick={(event) => {
											if (event.detail > 1) return;
											activateRow(row);
											requestAnimationFrame(() => navRef.current?.focus());
										}}
										onDoubleClick={(event) => {
											if (row.kind !== "file" || !onRenameFile) return;
											event.preventDefault();
											beginRename(row.file, row.label);
										}}
									>
										{row.label}
									</button>
								)}
							</div>
							{row.kind === "folder" && (onCreateFile || onDeleteFolder) && (
								<FolderActionsMenu
									id={row.id}
									label={row.label}
									open={openActionsPath === row.id}
									onOpenChange={(open) =>
										setOpenActionsPath(open ? row.id : null)
									}
									onCreateFile={(id) => void createFile(id)}
									onDeleteFolder={onDeleteFolder}
								/>
							)}
							{row.kind === "file" && (onRenameFile || onDeleteFile) && (
								<FileActionsMenu
									file={row.file}
									label={row.label}
									open={openActionsPath === row.file.path}
									onOpenChange={(open) =>
										setOpenActionsPath(open ? row.file.path : null)
									}
									onRenameFile={beginRename}
									onDeleteFile={onDeleteFile}
								/>
							)}
						</div>
					);
				})}
			</div>
		</aside>
	);
}

function FolderActionsMenu({
	id,
	label,
	open,
	onOpenChange,
	onCreateFile,
	onDeleteFolder,
}: {
	id: string;
	label: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreateFile?: (id: string) => void;
	onDeleteFolder?: (id: string) => void;
}) {
	return (
		<ActionsMenu label={label} open={open} onOpenChange={onOpenChange}>
			{onCreateFile && (
				<ActionItem
					icon={<MingcuteEditLine />}
					onClick={() => onCreateFile(id)}
				>
					New file
				</ActionItem>
			)}
			{onDeleteFolder && (
				<ActionItem
					destructive
					icon={<MingcuteDeleteLine />}
					onClick={() => {
						if (!window.confirm(`Delete ${label} and all its contents?`))
							return;
						onDeleteFolder(id);
					}}
				>
					Delete
				</ActionItem>
			)}
		</ActionsMenu>
	);
}

function FileActionsMenu({
	file,
	label,
	open,
	onOpenChange,
	onRenameFile,
	onDeleteFile,
}: {
	file: SidebarFile;
	label: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onRenameFile?: (file: SidebarFile, label: string) => void;
	onDeleteFile?: (path: string) => void;
}) {
	return (
		<ActionsMenu label={label} open={open} onOpenChange={onOpenChange}>
			{onRenameFile && (
				<ActionItem
					icon={<MingcuteEditLine />}
					onClick={() => onRenameFile(file, label)}
				>
					Rename
				</ActionItem>
			)}
			{onDeleteFile && (
				<ActionItem
					destructive
					icon={<MingcuteDeleteLine />}
					onClick={() => {
						if (!window.confirm(`Delete ${label}?`)) return;
						onDeleteFile(file.path);
					}}
				>
					Delete
				</ActionItem>
			)}
		</ActionsMenu>
	);
}

function ActionsMenu({
	label,
	open,
	onOpenChange,
	children,
}: {
	label: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	children: React.ReactNode;
}) {
	return (
		<Menu.Root open={open} onOpenChange={onOpenChange}>
			<Menu.Trigger
				render={
					<button
						type="button"
						className="me-1 inline-flex size-6 shrink-0 items-center justify-center rounded-sm border border-transparent bg-transparent text-muted-foreground opacity-0 outline-hidden transition-opacity hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/40 group-hover/sidebar-row:opacity-100 aria-expanded:opacity-100"
						aria-label={`Actions for ${label}`}
						title={`Actions for ${label}`}
						onContextMenu={(event) => {
							event.preventDefault();
							onOpenChange(true);
						}}
					/>
				}
			>
				<MingcuteMore2Line className="size-3.5" />
			</Menu.Trigger>
			<Menu.Portal>
				<Menu.Positioner align="end" side="bottom" sideOffset={4}>
					<Menu.Popup className="z-50 w-36 origin-(--transform-origin) rounded-sm border border-border bg-popover p-1 text-[11px] text-popover-foreground shadow-panel inset-shadow-chrome outline-hidden transition-[transform,opacity] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
						{children}
					</Menu.Popup>
				</Menu.Positioner>
			</Menu.Portal>
		</Menu.Root>
	);
}

function ActionItem({
	children,
	destructive,
	icon,
	onClick,
}: {
	children: React.ReactNode;
	destructive?: boolean;
	icon: React.ReactNode;
	onClick: () => void;
}) {
	return (
		<Menu.Item
			className={cn(
				sidebarActionClass,
				"cursor-pointer data-highlighted:bg-accent",
				destructive && "text-destructive",
			)}
			onClick={onClick}
		>
			<span className={sidebarActionIconClass}>{icon}</span>
			<span>{children}</span>
		</Menu.Item>
	);
}

function FileRenameInput({
	ref,
	value,
	error,
	onChange,
	onCancel,
	onCommit,
}: {
	ref: React.Ref<HTMLInputElement>;
	value: string;
	error: string | null;
	onChange: (value: string) => void;
	onCancel: () => void;
	onCommit: () => void;
}) {
	return (
		<span className="relative flex min-w-0 flex-1 items-center">
			<input
				ref={ref}
				aria-invalid={error ? true : undefined}
				className="min-w-0 flex-1 rounded-none border-0 bg-muted/70 p-0 text-[13px] text-sidebar-foreground outline-none selection:bg-muted-foreground/20 selection:text-sidebar-foreground focus:outline-none focus-visible:outline-none focus-visible:ring-0"
				value={value}
				onBlur={onCommit}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						onCommit();
					} else if (event.key === "Escape") {
						event.preventDefault();
						onCancel();
					}
				}}
			/>
			{error && (
				<span className="absolute top-full start-0 z-20 mt-1 w-max max-w-[calc(220px-2rem)] rounded-sm bg-[oklch(0.78_0.11_4)] px-2 py-1.5 text-[11px] font-normal leading-4 text-[oklch(0.18_0.02_4)] shadow-panel">
					{error}
				</span>
			)}
		</span>
	);
}

function renameTargetExists(
	path: string,
	nextName: string,
	files: SidebarFile[],
	getDisplayPath: (path: string) => string,
) {
	const targetDisplayPath = renameTargetDisplayPath(
		path,
		nextName,
		getDisplayPath,
	);

	return files.some((file) => {
		if (file.path === path) return false;
		return (
			normalizeDisplayPath(getDisplayPath(file.path)).toLocaleLowerCase() ===
			targetDisplayPath.toLocaleLowerCase()
		);
	});
}

function renameTargetName(
	path: string,
	nextName: string,
	getDisplayPath: (path: string) => string,
) {
	return fileNameFromPath(
		renameTargetDisplayPath(path, nextName, getDisplayPath),
	);
}

function renameTargetDisplayPath(
	path: string,
	nextName: string,
	getDisplayPath: (path: string) => string,
) {
	const sourceDisplayPath = normalizeDisplayPath(getDisplayPath(path));
	const sourceName = fileNameFromPath(sourceDisplayPath);
	const { extension } = splitFileName(sourceName);
	const parent = dirname(sourceDisplayPath);
	const targetName = stripMatchingExtension(nextName.trim(), extension);
	return normalizeDisplayPath(
		parent
			? `${parent}/${targetName}${extension}`
			: `${targetName}${extension}`,
	);
}

function stripMatchingExtension(name: string, extension: string) {
	if (!extension) return name;
	return name.toLocaleLowerCase().endsWith(extension.toLocaleLowerCase())
		? name.slice(0, -extension.length)
		: name;
}

function SortOption({ value, label }: { value: string; label: string }) {
	return (
		<Select.Item
			value={value}
			className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-start text-[11px] text-foreground outline-hidden select-none data-highlighted:bg-accent"
		>
			<Select.ItemIndicator className="inline-flex" keepMounted>
				<MingcuteCheckLine className="size-3 [[data-selected]_&]:opacity-100 opacity-0" />
			</Select.ItemIndicator>
			<Select.ItemText>{label}</Select.ItemText>
		</Select.Item>
	);
}
