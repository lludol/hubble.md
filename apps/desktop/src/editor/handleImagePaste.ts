import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { desktopApi } from "../desktopApi";

export async function persistPastedImage({
	filePath,
	imageFile,
}: {
	filePath: string;
	imageFile: File;
}): Promise<string> {
	const bytes = Array.from(new Uint8Array(await imageFile.arrayBuffer()));
	const result = await desktopApi.persistPastedImage({
		filePath,
		bytes,
		mimeType: imageFile.type || null,
	});
	const relativeMarkdownPath = result.relativeMarkdownPath;
	if (relativeMarkdownPath.trim().length === 0) {
		throw new Error("Image persisted but returned empty markdown path.");
	}
	return relativeMarkdownPath;
}

export function handleImagePaste({
	editor,
	event,
}: {
	editor: Editor | null;
	event: ClipboardEvent;
}): boolean {
	if (!editor) return false;
	const items = event.clipboardData?.items;
	if (!items) return false;
	const imageItem = Array.from(items).find((item) =>
		item.type.startsWith("image/"),
	);
	const imageFile = imageItem?.getAsFile();
	if (!imageFile) return false;
	event.preventDefault();
	void insertUploadImage({ editor, file: imageFile });
	return true;
}

export function handleImageDrop({
	editor,
	event,
}: {
	editor: Editor | null;
	event: DragEvent;
}): boolean {
	if (!editor) return false;
	const imageFile = Array.from(event.dataTransfer?.files ?? []).find((file) =>
		file.type.startsWith("image/"),
	);
	if (!imageFile) return false;
	event.preventDefault();
	const pos = editor.view.posAtCoords({
		left: event.clientX,
		top: event.clientY,
	})?.pos;
	void insertUploadImage({ editor, file: imageFile, pos });
	return true;
}

async function insertUploadImage({
	editor,
	file,
	pos,
}: {
	editor: Editor;
	file: File;
	pos?: number;
}) {
	const size = placeholderSize(await decodeImageSize(file));
	const imageNode = editor.schema.nodes.image?.create({
		src: "",
		alt: "",
		uploadId: crypto.randomUUID(),
		uploadStatus: "uploading",
		uploadFile: file,
		width: size.width,
		height: size.height,
	});
	const paragraphNode = editor.schema.nodes.paragraph?.create();
	if (!imageNode || !paragraphNode) return;

	const insertPos = pos ?? editor.state.selection.from;
	const transaction = editor.state.tr.insert(insertPos, [
		imageNode,
		paragraphNode,
	]);
	const cursorPos = insertPos + imageNode.nodeSize + 1;
	editor.view.dispatch(
		transaction.setSelection(
			TextSelection.near(transaction.doc.resolve(cursorPos)),
		),
	);
	editor.commands.focus();
}

function decodeImageSize(
	file: File,
): Promise<{ width: number; height: number }> {
	return new Promise((resolve) => {
		const url = URL.createObjectURL(file);
		const img = new Image();
		const cleanup = () => URL.revokeObjectURL(url);
		img.onload = () => {
			const width = img.naturalWidth || 640;
			const height = img.naturalHeight || 360;
			cleanup();
			resolve({ width, height });
		};
		img.onerror = () => {
			cleanup();
			resolve({ width: 640, height: 360 });
		};
		img.src = url;
	});
}

function placeholderSize({
	width,
	height,
}: {
	width: number;
	height: number;
}): { width: number; height: number } {
	const maxWidth = 900;
	if (width <= maxWidth) return { width, height };
	return { width: maxWidth, height: Math.round((height / width) * maxWidth) };
}
