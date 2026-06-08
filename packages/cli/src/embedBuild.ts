import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build, type Plugin } from "vite";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version?: string };

const CONTRACT_VERSION = 1;

export async function buildEmbed(workspacePath: string, name: string) {
	if (!isValidEmbedName(name)) {
		throw new Error(
			"Embed name must use lowercase letters, numbers, or hyphens",
		);
	}

	const embedRoot = path.join(workspacePath, ".hubble", "embeds", name);
	const srcDir = path.join(embedRoot, "src");
	const sourceEntry = await findSourceEntry(srcDir);
	const buildDir = path.join(embedRoot, ".build");
	const tempEntry = path.join(buildDir, "entry.tsx");
	const distDir = path.join(embedRoot, "dist");
	const builderVersion = packageJson.version ?? "0.0.0";

	await fs.mkdir(buildDir, { recursive: true });
	await fs.writeFile(
		tempEntry,
		createRuntimeEntry({ name, sourceEntry, builderVersion }),
	);

	await build({
		configFile: false,
		root: embedRoot,
		define: {
			"process.env.NODE_ENV": JSON.stringify("production"),
		},
		plugins: [react(), rewriteTailwindImportPlugin(), tailwindcss()],
		resolve: {
			alias: [
				{
					find: "react/jsx-runtime",
					replacement: require.resolve("react/jsx-runtime"),
				},
				{
					find: "react/jsx-dev-runtime",
					replacement: require.resolve("react/jsx-dev-runtime"),
				},
				{
					find: "react-dom/client",
					replacement: require.resolve("react-dom/client"),
				},
				{ find: "react-dom", replacement: require.resolve("react-dom") },
				{ find: "react", replacement: require.resolve("react") },
			],
		},
		build: {
			emptyOutDir: true,
			minify: false,
			outDir: distDir,
			sourcemap: false,
			lib: {
				entry: tempEntry,
				formats: ["iife"],
				name: globalName(name),
				fileName: () => "embed.js",
				cssFileName: "embed",
			},
			rollupOptions: {
				output: {
					inlineDynamicImports: true,
				},
			},
		},
	});

	await inlineBuiltCss(distDir);
	await fs.writeFile(
		path.join(distDir, "manifest.json"),
		`${JSON.stringify(
			{
				name,
				builderVersion,
				contractVersion: CONTRACT_VERSION,
				entry: "embed.js",
			},
			null,
			2,
		)}\n`,
	);

	console.log(`Built embed "${name}"`);
	console.log(
		`  ${path.relative(workspacePath, path.join(distDir, "embed.js"))}`,
	);
}

async function inlineBuiltCss(distDir: string) {
	const jsPath = path.join(distDir, "embed.js");
	const cssPath = path.join(distDir, "embed.css");
	const css = await readOptionalText(cssPath);
	const js = await fs.readFile(jsPath, "utf8");
	await fs.writeFile(
		jsPath,
		js.replace(JSON.stringify("__HUBBLE_EMBED_CSS__"), JSON.stringify(css)),
	);
	if (css !== "") await fs.rm(cssPath);
}

function createRuntimeEntry({
	name,
	sourceEntry,
	builderVersion,
}: {
	name: string;
	sourceEntry: string;
	builderVersion: string;
}) {
	const sourceImport = JSON.stringify(toImportPath(sourceEntry));
	const embedName = JSON.stringify(name);
	const version = JSON.stringify(builderVersion);
	return `
import React from "react";
import { createRoot } from "react-dom/client";
import App from ${sourceImport};

const css = "__HUBBLE_EMBED_CSS__";
const metadata = {
	name: ${embedName},
	builderVersion: ${version},
	contractVersion: ${CONTRACT_VERSION},
};

window.__hubbleEmbeds = window.__hubbleEmbeds || {};
window.__hubbleEmbeds[${embedName}] = {
	metadata,
	mount(shadowRoot, props, hubble) {
		if (css) {
			const style = document.createElement("style");
			style.textContent = css;
			shadowRoot.append(style);
		}
		const mountPoint = document.createElement("div");
		shadowRoot.append(mountPoint);
		const root = createRoot(mountPoint);
		root.render(React.createElement(App, { ...props, hubble }));
		return () => root.unmount();
	},
};
`;
}

function rewriteTailwindImportPlugin(): Plugin {
	const tailwindEntry = toImportPath(require.resolve("tailwindcss/index.css"));
	return {
		name: "hubble-rewrite-tailwind-import",
		enforce: "pre",
		transform(code, id) {
			if (!id.endsWith(".css")) return null;
			return code
				.replaceAll('@import "tailwindcss";', `@import "${tailwindEntry}";`)
				.replaceAll("@import 'tailwindcss';", `@import "${tailwindEntry}";`);
		},
	};
}

async function findSourceEntry(srcDir: string) {
	for (const fileName of ["index.tsx", "index.ts", "index.jsx", "index.js"]) {
		const candidate = path.join(srcDir, fileName);
		try {
			const stat = await fs.stat(candidate);
			if (stat.isFile()) return candidate;
		} catch {
			// Keep looking.
		}
	}
	throw new Error(`No embed entry found in ${srcDir}`);
}

async function readOptionalText(filePath: string) {
	try {
		return await fs.readFile(filePath, "utf8");
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			return "";
		}
		throw error;
	}
}

function isValidEmbedName(name: string) {
	return /^[a-z0-9][a-z0-9-]*$/.test(name);
}

function globalName(name: string) {
	return `HubbleEmbed_${name.replaceAll("-", "_")}`;
}

function toImportPath(filePath: string) {
	return filePath.split(path.sep).join("/");
}
