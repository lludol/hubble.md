import { Menu } from "@base-ui/react/menu";
import { Button, Toolbar as SharedToolbar } from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import type { CSSProperties } from "react";
import { toast } from "sonner";
import MingcuteCopy2Line from "~icons/mingcute/copy-2-line";
import MingcuteFolderOpenLine from "~icons/mingcute/folder-open-line";
import MingcuteMore2Line from "~icons/mingcute/more-2-line";
import { desktopApi } from "../desktopApi";
import { revealFileLabel } from "../lib/revealFile";
import { renameCurrentMarkdownFile, toggleSidebar } from "../store/actions";
import {
	currentPathStore,
	sidebarOpenStore,
	workspacePathStore,
} from "../store/state";

const dragRegionStyle = {
	WebkitAppRegion: "drag",
} as CSSProperties;

export function Toolbar({
	scrollContainer,
	showSidebarBadge = false,
}: {
	scrollContainer: HTMLDivElement | null;
	showSidebarBadge?: boolean;
}) {
	const workspacePath = useStoreValue(workspacePathStore);
	const sidebarOpen = useStoreValue(sidebarOpenStore);
	const currentPath = useStoreValue(currentPathStore);

	return (
		<SharedToolbar
			currentPath={currentPath ?? null}
			sidebarOpen={sidebarOpen}
			sidebarBadge={showSidebarBadge}
			scrollContainer={scrollContainer}
			rootProps={{ style: dragRegionStyle }}
			onToggleSidebar={toggleSidebar}
			onRenameCurrentPath={(nextName) =>
				void renameCurrentMarkdownFile(nextName)
			}
			rightSlot={
				workspacePath && currentPath ? (
					<NoteActionsMenu path={currentPath} />
				) : undefined
			}
		/>
	);
}

function NoteActionsMenu({ path }: { path: string }) {
	async function revealFile() {
		try {
			await desktopApi.revealFile(path);
		} catch {
			toast.error("Failed to reveal file");
		}
	}

	async function copyFilePath() {
		try {
			await navigator.clipboard.writeText(path);
			toast.success("File path copied");
		} catch {
			toast.error("Failed to copy file path");
		}
	}

	return (
		<Menu.Root>
			<Menu.Trigger
				render={
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Note actions"
						title="Note actions"
					/>
				}
			>
				<MingcuteMore2Line className="size-4" />
			</Menu.Trigger>
			<Menu.Portal>
				<Menu.Positioner align="end" side="bottom" sideOffset={4}>
					<Menu.Popup className="z-50 w-44 origin-(--transform-origin) rounded-sm border border-border bg-popover p-1 text-[11px] text-popover-foreground outline-hidden transition-[transform,opacity] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
						<Menu.Item
							className="flex w-full cursor-pointer items-center gap-2 rounded-sm [padding-block:0.375rem] [padding-inline:0.5rem] text-start text-[11px] outline-hidden select-none data-highlighted:bg-accent"
							onClick={() => void revealFile()}
						>
							<MingcuteFolderOpenLine className="size-3 shrink-0" />
							<span>{revealFileLabel(desktopApi.platform)}</span>
						</Menu.Item>
						<Menu.Item
							className="flex w-full cursor-pointer items-center gap-2 rounded-sm [padding-block:0.375rem] [padding-inline:0.5rem] text-start text-[11px] outline-hidden select-none data-highlighted:bg-accent"
							onClick={() => void copyFilePath()}
						>
							<MingcuteCopy2Line className="size-3 shrink-0" />
							<span>Copy file path</span>
						</Menu.Item>
					</Menu.Popup>
				</Menu.Positioner>
			</Menu.Portal>
		</Menu.Root>
	);
}
