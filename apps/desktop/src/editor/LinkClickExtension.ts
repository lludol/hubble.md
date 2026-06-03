import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { toast } from "sonner";
import { desktopApi } from "../desktopApi";
import { loadPath } from "../store/actions";
import { workspaceStore } from "../store/state";

function resolveHref(href: string): string | null {
	if (!href) return null;
	try {
		const url = new URL(href);
		const protocol = url.protocol.toLowerCase();
		if (protocol === "http:" || protocol === "https:") return href;
		return null;
	} catch {
		return null;
	}
}

async function followLink(href: string) {
	const resolved = resolveHref(href);
	if (!resolved) {
		toast.error("Cannot open link");
		return;
	}
	try {
		new URL(resolved);
		await desktopApi.openExternalUrl(resolved);
	} catch {
		await loadPath(resolved);
	}
}

function resolveWikiPath(href: string, target: string | null) {
	const path = href.startsWith("/") ? href : target || href;
	if (path.startsWith("/")) return path;
	const workspacePath = workspaceStore.get().workspacePath;
	return workspacePath ? `${workspacePath}/${path}` : path;
}

async function followLinkMark(attrs: {
	href: string;
	kind: "url" | "wiki";
	target: string | null;
}) {
	if (attrs.kind === "wiki") {
		await loadPath(resolveWikiPath(attrs.href, attrs.target));
		return;
	}
	await followLink(attrs.href);
}

function findLinkAtEvent(
	view: EditorView,
	event: MouseEvent,
): { href: string; kind: "url" | "wiki"; target: string | null } | null {
	const state = view.state;
	const posData = view.posAtCoords({ left: event.clientX, top: event.clientY });
	if (!posData) return null;
	const $pos = state.doc.resolve(posData.pos);
	for (const mark of $pos.marks()) {
		if (mark.type.name === "link" && typeof mark.attrs.href === "string") {
			return {
				href: mark.attrs.href,
				kind: mark.attrs.kind === "wiki" ? "wiki" : "url",
				target:
					typeof mark.attrs.target === "string" ? mark.attrs.target : null,
			};
		}
	}
	return null;
}

const MOD_CLASS = "mod-held";

function setModHeld(el: HTMLElement, held: boolean) {
	el.classList.toggle(MOD_CLASS, held);
}

export const LinkClickExtension = Extension.create({
	name: "linkClick",
	addProseMirrorPlugins() {
		const root = this.editor.view.dom;

		const onKey = (e: KeyboardEvent) =>
			setModHeld(root, e.metaKey || e.ctrlKey);
		const onBlur = () => setModHeld(root, false);

		window.addEventListener("keydown", onKey);
		window.addEventListener("keyup", onKey);
		window.addEventListener("blur", onBlur);

		return [
			new Plugin({
				props: {
					handleDOMEvents: {
						mousedown(view, event) {
							if (!event.metaKey && !event.ctrlKey) return false;
							const link = findLinkAtEvent(view, event);
							if (!link) return false;
							event.preventDefault();
							void followLinkMark(link);
							return true;
						},
					},
				},
				destroy() {
					window.removeEventListener("keydown", onKey);
					window.removeEventListener("keyup", onKey);
					window.removeEventListener("blur", onBlur);
					setModHeld(root, false);
				},
			}),
		];
	},
});
