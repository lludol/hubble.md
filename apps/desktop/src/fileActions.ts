import { desktopApi } from "./desktopApi";
import { loadPath, refreshFiles } from "./store/actions";
import { workspaceStore } from "./store/state";

export async function createMarkdownFile() {
	const workspacePath = workspaceStore.get().workspacePath;
	if (!workspacePath) return;
	const picked = await desktopApi.saveMarkdownFilePicker({
		defaultPath: workspacePath,
	});
	if (typeof picked !== "string") return;
	const path = picked.endsWith(".md") ? picked : `${picked}.md`;
	await desktopApi.writeFileText(path, "");
	await refreshFiles();
	await loadPath(path);
}
