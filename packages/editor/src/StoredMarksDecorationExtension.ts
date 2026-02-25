import { Extension } from "@tiptap/core";
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const StoredMarksDecorationKey = new PluginKey("storedMarksDecoration");

/** Mark types that get a cursor decoration when stored on an empty selection. */
const DECORATED_MARKS = ["bold", "italic", "strike"] as const;
const MARK_PRIORITY = ["code", "bold", "italic", "strike", "link"] as const;
const DELIMITER_BY_MARK: Record<
	string,
	{ start: string; end: string } | undefined
> = {
	code: { start: "`", end: "`" },
	bold: { start: "**", end: "**" },
	italic: { start: "*", end: "*" },
	strike: { start: "~~", end: "~~" },
	link: { start: "[", end: "]" },
};

/**
 * Shows a zero-width widget decoration at the cursor when inline marks
 * (bold, italic, strikethrough) are stored on an empty selection.
 * This gives a visual cue that formatting is active before any text is typed.
 */
export const StoredMarksDecorationExtension = Extension.create({
	name: "storedMarksDecoration",

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: StoredMarksDecorationKey,
				props: {
					decorations: (state: EditorState) => {
						const { selection, storedMarks } = state;
						if (!selection.empty) return null;

						// Check stored marks OR marks at the current cursor position
						const marks = storedMarks || selection.$from.marks();
						if (!marks || marks.length === 0) return null;

						const activeNames = marks
							.map((m) => m.type.name)
							.filter((n): n is (typeof DECORATED_MARKS)[number] =>
								(DECORATED_MARKS as readonly string[]).includes(n),
							);

						if (activeNames.length === 0) return null;
						const activeSet = new Set(activeNames);
						const ordered = MARK_PRIORITY.filter((mark) => activeSet.has(mark));
						const leftDelimiter = ordered
							.map((mark) => DELIMITER_BY_MARK[mark]?.start ?? "")
							.join("");
						const rightDelimiter = [...ordered]
							.reverse()
							.map((mark) => DELIMITER_BY_MARK[mark]?.end ?? "")
							.join("");

						const leftWidget = Decoration.widget(
							selection.head,
							() => createDelimiterWidget(leftDelimiter, "start"),
							{ side: -1 },
						);
						const rightWidget = Decoration.widget(
							selection.head,
							() => createDelimiterWidget(rightDelimiter, "end"),
							{ side: 1 },
						);

						return DecorationSet.create(state.doc, [leftWidget, rightWidget]);
					},
				},
			}),
		];
	},
});

function createDelimiterWidget(delimiter: string, boundary: "start" | "end") {
	const span = document.createElement("span");
	span.className = `pm-md-delimiter pm-md-delimiter-${boundary}`;
	span.contentEditable = "false";
	span.textContent = delimiter;
	return span;
}
