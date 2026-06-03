import { NewNoteButton, Toolbar as SharedToolbar } from "@hubble.md/ui";
import { useStoreValue } from "@simplestack/store/react";
import type { CSSProperties } from "react";
import { createMarkdownFile } from "../fileActions";
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
}: {
	scrollContainer: HTMLDivElement | null;
}) {
	const workspacePath = useStoreValue(workspacePathStore);
	const sidebarOpen = useStoreValue(sidebarOpenStore);
	const currentPath = useStoreValue(currentPathStore);

	return (
		<SharedToolbar
			currentPath={currentPath ?? null}
			sidebarOpen={sidebarOpen}
			scrollContainer={scrollContainer}
			rootProps={{ style: dragRegionStyle }}
			onToggleSidebar={toggleSidebar}
			onRenameCurrentPath={(nextName) =>
				void renameCurrentMarkdownFile(nextName)
			}
			rightSlot={
				workspacePath ? (
					<NewNoteButton onClick={() => void createMarkdownFile()} />
				) : undefined
			}
		/>
	);
}
