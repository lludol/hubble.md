import { createMarkdownFileInFolder } from "./store/actions";
import { workspaceStore } from "./store/state";

export async function createMarkdownFile() {
	const workspacePath = workspaceStore.get().workspacePath;
	if (!workspacePath) return;
	await createMarkdownFileInFolder(workspacePath);
}
