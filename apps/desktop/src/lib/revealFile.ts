import type { DesktopPlatform } from "../desktopApi/types";

export function revealFileLabel(platform: DesktopPlatform) {
	if (platform === "darwin") return "Reveal in Finder";
	if (platform === "win32") return "Reveal in File Explorer";
	return "Reveal in File Manager";
}
