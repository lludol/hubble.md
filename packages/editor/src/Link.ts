import { Mark, mergeAttributes } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";

export const LinkExtension = Mark.create({
	name: "link",
	inclusive: true,

	addAttributes() {
		return {
			href: {
				default: "",
			},
		};
	},

	parseHTML() {
		return [
			{
				tag: "span[data-href]",
				getAttrs: (element) => {
					const href = (element as HTMLElement).getAttribute("data-href");
					return { href: href ?? "" };
				},
			},
			{
				tag: "a[href]",
				getAttrs: (element) => {
					const href = (element as HTMLAnchorElement).getAttribute("href");
					return { href: href ?? "" };
				},
			},
		];
	},

	renderHTML({ HTMLAttributes }) {
		const href =
			typeof HTMLAttributes.href === "string" ? HTMLAttributes.href : "";
		return [
			"span",
			mergeAttributes(HTMLAttributes, {
				"data-href": href,
				"data-link": "true",
			}),
			0,
		];
	},
});

export function createLinkMark(href = "") {
	return { type: "link", attrs: { href } };
}

export function getLinkHrefFromAttrs(attrs: unknown): string | null {
	if (!attrs || typeof attrs !== "object") return null;
	const href = (attrs as Record<string, unknown>).href;
	return typeof href === "string" ? href : null;
}

export function getActiveLinkRange(state: EditorState): {
	from: number;
	to: number;
	href: string;
} | null {
	const { selection } = state;
	if (!selection.empty) return null;

	const markType = state.schema.marks.link;
	if (!markType) return null;

	const $pos = state.doc.resolve(selection.from);
	const parent = $pos.parent;

	let index: number | null = null;
	if ($pos.nodeAfter && markType.isInSet($pos.nodeAfter.marks)) {
		index = $pos.index();
	} else if ($pos.nodeBefore && markType.isInSet($pos.nodeBefore.marks)) {
		index = $pos.index() - 1;
	}
	if (index === null || index < 0 || index >= parent.childCount) {
		// No link text node at the cursor; fall back to a zero-width stored link.
		const mark = markType.isInSet(state.storedMarks ?? selection.$from.marks());
		if (!mark) return null;
		const href = getLinkHrefFromAttrs(mark.attrs);
		if (href === null) return null;
		return { from: selection.from, to: selection.from, href };
	}

	let startIndex = index;
	let endIndex = index;

	let from = $pos.start();
	for (let i = 0; i < startIndex; i++) {
		from += parent.child(i).nodeSize;
	}
	let to = from + parent.child(index).nodeSize;

	while (
		startIndex > 0 &&
		!!markType.isInSet(parent.child(startIndex - 1).marks)
	) {
		startIndex -= 1;
		from -= parent.child(startIndex).nodeSize;
	}

	while (
		endIndex + 1 < parent.childCount &&
		!!markType.isInSet(parent.child(endIndex + 1).marks)
	) {
		endIndex += 1;
		to += parent.child(endIndex).nodeSize;
	}

	const mark =
		markType.isInSet(parent.child(index).marks) ??
		markType.create({ href: "" });
	const href = getLinkHrefFromAttrs(mark.attrs);
	if (href === null) return null;
	return { from, to, href };
}
