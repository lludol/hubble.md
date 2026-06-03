/// <reference types="vite/client" />
/// <reference types="unplugin-icons/types/react" />

import type { DesktopApi } from "./desktopApi/types";

declare global {
	interface Window {
		desktopApi: DesktopApi;
	}
}
