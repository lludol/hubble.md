import { Extension } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";
export const FOCUS_LINK_POPOVER_EVENT = "hubble:focus-link-popover";
export const LINK_CREATION_REQUESTED_EVENT = "hubble:link-creation-requested";

function toggleLinkAtSelection() {
	return () =>
		({
			state,
			dispatch,
		}: {
			state: EditorState;
			dispatch?: (tr: Transaction) => void;
		}) => {
			const linkType = state.schema.marks.link;
			if (!linkType) return false;

			const { selection } = state;

			// Empty selection: enter creation flow (no mark inserted yet)
			if (selection.empty) {
				window.dispatchEvent(
					new CustomEvent(LINK_CREATION_REQUESTED_EVENT, {
						detail: { pos: selection.from },
					}),
				);
				return true;
			}

			// Non-empty selection: apply link mark to selection
			const range = { from: selection.from, to: selection.to };
			const hasLink = state.doc.rangeHasMark(range.from, range.to, linkType);
			if (!hasLink) {
				const tr = state.tr.addMark(
					range.from,
					range.to,
					linkType.create({ href: "" }),
				);
				dispatch?.(tr);
			}
			window.dispatchEvent(new CustomEvent(FOCUS_LINK_POPOVER_EVENT));
			return true;
		};
}

export const SmartLinkExtension = Extension.create({
	name: "smartLinkToggle",
	priority: 1000,
	addCommands() {
		return {
			toggleLinkAtSelection: toggleLinkAtSelection(),
		};
	},
	addKeyboardShortcuts() {
		return {
			"Mod-k": () => this.editor.commands.toggleLinkAtSelection(),
		};
	},
});

declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		smartLinkToggle: {
			toggleLinkAtSelection: () => ReturnType;
		};
	}
}
