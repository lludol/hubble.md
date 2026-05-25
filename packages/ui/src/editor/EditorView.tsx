import {
	LinkExtension,
	listExtensions,
	MarkdownRolloverExtension,
	markdownToTiptapDoc,
	tiptapDocToMarkdown,
} from "@hubble.md/editor";
import type { Editor } from "@tiptap/core";
import { TaskItem } from "@tiptap/extension-list";
import {
	EditorContent,
	type EditorOptions,
	type JSONContent,
	useEditor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LinkClickExtension } from "./LinkClickExtension";
import { LinkCreationGhostExtension } from "./LinkCreationGhostExtension";
import { LinkPopover, type WikiTarget } from "./LinkPopover";
import { SmartLinkExtension } from "./SmartLinkExtension";
import { VirtualCursor } from "./VirtualCursor";
import "./EditorView.css";
import { FormattingStatusBar } from "./FormattingStatusBar";
import type { VirtualCursorMode } from "./virtualCursorMode";

const DEFAULT_SAVE_DEBOUNCE_MS = 120;

export type { WikiTarget };

export type EditorViewProps = {
	path: string;
	initialMarkdown: string;
	wikiTargets?: WikiTarget[];
	extensions?: EditorOptions["extensions"];
	editorProps?: EditorOptions["editorProps"];
	onPaste?: (editor: Editor, event: ClipboardEvent) => boolean;
	onDrop?: (editor: Editor, event: DragEvent) => boolean;
	saveDebounceMs?: number;
	onLocalChange: (path: string, markdown: string) => void;
	onSave: (path: string, markdown: string) => void | Promise<void>;
	onScrollContainerChange?: (el: HTMLDivElement | null) => void;
	onOpenExternalLink: (href: string) => void | Promise<void>;
	onOpenWikiLink: (target: string) => void | Promise<void>;
	onMessage?: (message: string, kind: "success" | "error") => void;
};

export function EditorView({
	path,
	initialMarkdown,
	wikiTargets = [],
	extensions = [],
	editorProps,
	onPaste,
	onDrop,
	saveDebounceMs = DEFAULT_SAVE_DEBOUNCE_MS,
	onLocalChange,
	onSave,
	onScrollContainerChange,
	onOpenExternalLink,
	onOpenWikiLink,
	onMessage,
}: EditorViewProps) {
	const latestMarkdownRef = useRef(initialMarkdown);
	const saveTimerRef = useRef<number | null>(null);
	const editorRootRef = useRef<HTMLDivElement | null>(null);
	const editorViewportRef = useRef<HTMLDivElement | null>(null);
	const [editorViewportEl, setEditorViewportEl] =
		useState<HTMLDivElement | null>(null);
	const [cursorModeOverride, setCursorModeOverride] =
		useState<VirtualCursorMode | null>(null);
	const pathRef = useRef(path);
	const editorRef = useRef<Editor | null>(null);
	pathRef.current = path;

	const setEditorViewport = useCallback(
		(node: HTMLDivElement | null) => {
			editorViewportRef.current = node;
			setEditorViewportEl(node);
			onScrollContainerChange?.(node);
		},
		[onScrollContainerChange],
	);

	// Only used at editor creation. Later file loads sync through setContent.
	// biome-ignore lint/correctness/useExhaustiveDependencies: editor instance persists across file switches.
	const initialDoc = useMemo(() => markdownToTiptapDoc(initialMarkdown), []);

	const scheduleSave = useCallback(() => {
		const savePath = pathRef.current;
		if (saveTimerRef.current !== null) {
			window.clearTimeout(saveTimerRef.current);
		}
		saveTimerRef.current = window.setTimeout(() => {
			void onSave(savePath, latestMarkdownRef.current);
		}, saveDebounceMs);
	}, [onSave, saveDebounceMs]);

	const editor = useEditor({
		extensions: [
			StarterKit.configure({ listItem: false }),
			LinkExtension,
			SmartLinkExtension,
			LinkClickExtension.configure({ onOpenExternalLink, onOpenWikiLink }),
			LinkCreationGhostExtension,
			MarkdownRolloverExtension,
			...listExtensions,
			...extensions,
			TaskItem.configure({ nested: true }),
		],
		content: initialDoc,
		onUpdate: ({ editor: current }) => {
			const doc = current.getJSON() as JSONContent;
			if (hasUploadImage(doc)) return;
			const markdown = tiptapDocToMarkdown(doc);
			latestMarkdownRef.current = markdown;
			onLocalChange(pathRef.current, markdown);
			scheduleSave();
		},
		autofocus: "end",
		editorProps: {
			...editorProps,
			attributes: {
				...editorProps?.attributes,
				"data-editor-input": "",
			},
			handlePaste: (view, event, slice): boolean => {
				if (editorProps?.handlePaste?.(view, event, slice)) return true;
				const currentEditor = editorRef.current;
				if (!currentEditor || !onPaste) return false;
				return onPaste(currentEditor, event);
			},
			handleDrop: (view, event, slice, moved): boolean => {
				if (editorProps?.handleDrop?.(view, event, slice, moved)) return true;
				const currentEditor = editorRef.current;
				if (!currentEditor || !onDrop) return false;
				return onDrop(currentEditor, event);
			},
		},
	});
	editorRef.current = editor;

	useEffect(() => {
		if (!editor) return;
		latestMarkdownRef.current = initialMarkdown;
		const current = tiptapDocToMarkdown(editor.getJSON() as JSONContent);
		if (current !== initialMarkdown) {
			editor.commands.setContent(markdownToTiptapDoc(initialMarkdown), {
				emitUpdate: false,
			});
		}
	}, [editor, initialMarkdown]);

	useEffect(() => {
		if (!editor) return;
		const focusPath = path;
		requestAnimationFrame(() => {
			if (pathRef.current !== focusPath) return;
			editor.commands.focus("end");
		});
	}, [editor, path]);

	useEffect(() => {
		return () => {
			if (saveTimerRef.current !== null) {
				window.clearTimeout(saveTimerRef.current);
				saveTimerRef.current = null;
				void onSave(path, latestMarkdownRef.current);
			}
		};
	}, [path, onSave]);

	return (
		<div
			className="relative flex h-full min-h-0 flex-col"
			ref={editorRootRef}
			data-hubble-editor
		>
			<div
				className="relative min-h-0 flex-1 overflow-auto overscroll-contain"
				ref={setEditorViewport}
			>
				<EditorContent editor={editor} className="h-full" />
				<VirtualCursor
					editor={editor}
					containerRef={editorRootRef}
					viewportRef={editorViewportRef}
					modeOverride={cursorModeOverride}
				/>
				<LinkPopover
					editor={editor}
					containerRef={editorRootRef}
					viewportRef={editorViewportRef}
					wikiTargets={wikiTargets}
					onOpenExternalLink={onOpenExternalLink}
					onOpenWikiLink={onOpenWikiLink}
					onMessage={onMessage}
					onCursorModeChange={setCursorModeOverride}
				/>
			</div>
			<FormattingStatusBar editor={editor} scrollContainer={editorViewportEl} />
		</div>
	);
}

function hasUploadImage(node: JSONContent): boolean {
	if (node.type === "image" && node.attrs?.uploadId) return true;
	return node.content?.some(hasUploadImage) ?? false;
}
