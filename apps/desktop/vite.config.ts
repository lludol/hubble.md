import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import icons from "unplugin-icons/vite";
import { defineConfig } from "vite";

const devPort = Number(process.env.PORT ?? 1420);

// https://vite.dev/config/
export default defineConfig(async () => ({
	plugins: [
		react(),
		icons({
			compiler: "jsx",
			jsx: "react",
		}),
		tailwindcss(),
	],
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	clearScreen: false,
	server: {
		port: devPort,
		strictPort: false,
	},
}));
