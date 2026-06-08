import { Node } from "@tiptap/core";
import {
	NodeViewWrapper,
	type ReactNodeViewProps,
	ReactNodeViewRenderer,
} from "@tiptap/react";
import { useEffect, useRef } from "react";
import "./EmbedExtension.css";

type EmbedAttrs = {
	name: string;
	tagName: string;
	props: Record<string, string>;
};

type EmbedBundle = {
	mount: (
		shadowRoot: ShadowRoot,
		props: Record<string, string>,
		hubble: HubbleEmbedApi,
	) => undefined | (() => void);
};

type HubbleEmbedApi = {
	listFiles(glob: string): Promise<
		{
			name: string;
			path: string;
			modified_at: number;
			size: number;
		}[]
	>;
};

declare global {
	interface Window {
		__hubbleEmbeds?: Record<string, EmbedBundle>;
	}
}

const EMBED_ELEMENT = "hubble-embed-host";
const loadedBundles = new Map<string, Promise<EmbedBundle>>();

export function createEmbedExtension(workspacePath: string | null) {
	return Node.create({
		name: "embed",
		group: "block",
		atom: true,
		selectable: true,
		draggable: true,

		addAttributes() {
			return {
				name: { default: "" },
				tagName: { default: "" },
				props: { default: {} },
			};
		},

		renderHTML({ node }) {
			const attrs = node.attrs as EmbedAttrs;
			return [attrs.tagName || `embed-${attrs.name}`, attrs.props ?? {}];
		},

		addNodeView() {
			return ReactNodeViewRenderer((props) => (
				<EmbedNodeView {...props} workspacePath={workspacePath} />
			));
		},
	});
}

class HubbleEmbedElement extends HTMLElement {
	#cleanup: (() => void) | null = null;
	#renderVersion = 0;

	connectedCallback() {
		if (!this.shadowRoot) {
			this.attachShadow({ mode: "open" });
		}
		void this.renderEmbed();
	}

	disconnectedCallback() {
		this.#cleanup?.();
		this.#cleanup = null;
		this.#renderVersion += 1;
	}

	static get observedAttributes() {
		return ["embed-name", "workspace-path", "props-json"];
	}

	attributeChangedCallback() {
		if (this.isConnected) void this.renderEmbed();
	}

	async renderEmbed() {
		const shadowRoot = this.shadowRoot;
		if (!shadowRoot) return;

		this.#renderVersion += 1;
		const version = this.#renderVersion;
		this.#cleanup?.();
		this.#cleanup = null;
		shadowRoot.replaceChildren();

		const name = this.getAttribute("embed-name") ?? "";
		const workspacePath = this.getAttribute("workspace-path");
		const props = parseProps(this.getAttribute("props-json"));

		if (!workspacePath) {
			renderError(shadowRoot, "Open a workspace to render embeds.");
			return;
		}
		if (!isValidEmbedName(name)) {
			renderError(shadowRoot, `Invalid embed name: ${name || "(empty)"}`);
			return;
		}

		try {
			const bundle = await loadEmbedBundle(workspacePath, name);
			if (version !== this.#renderVersion) return;
			const cleanup = bundle.mount(
				shadowRoot,
				props,
				createHubbleApi(workspacePath),
			);
			this.#cleanup = typeof cleanup === "function" ? cleanup : null;
		} catch (error) {
			if (version !== this.#renderVersion) return;
			renderError(
				shadowRoot,
				error instanceof Error ? error.message : String(error),
			);
		}
	}
}

if (!customElements.get(EMBED_ELEMENT)) {
	customElements.define(EMBED_ELEMENT, HubbleEmbedElement);
}

function EmbedNodeView({
	node,
	workspacePath,
}: ReactNodeViewProps & { workspacePath: string | null }) {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const attrs = node.attrs as EmbedAttrs;
	const propsJson = JSON.stringify(attrs.props ?? {});

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;

		const element = document.createElement(EMBED_ELEMENT);
		element.setAttribute("embed-name", attrs.name);
		if (workspacePath) element.setAttribute("workspace-path", workspacePath);
		element.setAttribute("props-json", propsJson);
		host.replaceChildren(element);
	}, [attrs.name, propsJson, workspacePath]);

	return (
		<NodeViewWrapper className="hubble-embed">
			<div className="hubble-embed-host" ref={hostRef} />
		</NodeViewWrapper>
	);
}

async function loadEmbedBundle(workspacePath: string, name: string) {
	const key = `${workspacePath}\n${name}`;
	const existing = loadedBundles.get(key);
	if (existing) return await existing;

	const loading = loadEmbedBundleUncached(workspacePath, name);
	loadedBundles.set(key, loading);
	try {
		return await loading;
	} catch (error) {
		loadedBundles.delete(key);
		throw error;
	}
}

async function loadEmbedBundleUncached(workspacePath: string, name: string) {
	const bundlePath = joinPath(
		workspacePath,
		".hubble",
		"embeds",
		name,
		"dist",
		"embed.js",
	);
	const before = window.__hubbleEmbeds?.[name];
	const code = await window.desktopApi.readFileText(bundlePath);
	const url = URL.createObjectURL(
		new Blob([code], { type: "text/javascript" }),
	);
	try {
		await import(/* @vite-ignore */ url);
	} finally {
		URL.revokeObjectURL(url);
	}

	const bundle = window.__hubbleEmbeds?.[name];
	if (!bundle || bundle === before || typeof bundle.mount !== "function") {
		throw new Error(`Embed bundle did not register "${name}".`);
	}
	return bundle;
}

function renderError(shadowRoot: ShadowRoot, message: string) {
	const error = document.createElement("p");
	error.className = "hubble-embed-error";
	error.textContent = message;
	shadowRoot.append(error);
}

function createHubbleApi(workspacePath: string): HubbleEmbedApi {
	return {
		listFiles: (glob) => window.desktopApi.listEmbedFiles(workspacePath, glob),
	};
}

function parseProps(raw: string | null): Record<string, string> {
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return {};
		return Object.fromEntries(
			Object.entries(parsed).map(([key, value]) => [key, String(value)]),
		);
	} catch {
		return {};
	}
}

function joinPath(root: string, ...parts: string[]) {
	const normalizedRoot = root.replace(/[\\/]+$/, "");
	return [normalizedRoot, ...parts].join("/");
}

function isValidEmbedName(name: string) {
	return /^[a-z0-9][a-z0-9-]*$/.test(name);
}
