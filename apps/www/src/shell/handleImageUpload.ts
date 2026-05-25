import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

type ImageSize = {
	width: number;
	height: number;
};

const MAX_PLACEHOLDER_WIDTH = 900;

export function handleImagePaste(args: {
	editor: Editor | null;
	event: ClipboardEvent;
}): boolean {
	const file = Array.from(args.event.clipboardData?.items ?? [])
		.find((item) => item.type.startsWith("image/"))
		?.getAsFile();
	if (!file) return false;
	args.event.preventDefault();
	void insertUploadImage({
		editor: args.editor,
		file,
		pos: args.editor?.state.selection.from ?? 0,
	});
	return true;
}

export function handleImageDrop(args: {
	editor: Editor | null;
	event: DragEvent;
}): boolean {
	const file = Array.from(args.event.dataTransfer?.files ?? []).find((item) =>
		item.type.startsWith("image/"),
	);
	if (!file) return false;
	args.event.preventDefault();
	const dropPos = args.editor?.view.posAtCoords({
		left: args.event.clientX,
		top: args.event.clientY,
	})?.pos;
	void insertUploadImage({
		editor: args.editor,
		file,
		pos: dropPos ?? args.editor?.state.selection.from ?? 0,
	});
	return true;
}

async function insertUploadImage({
	editor,
	file,
	pos,
}: {
	editor: Editor | null;
	file: File;
	pos: number;
}) {
	if (!editor) return;
	const insertPos = Math.min(pos, editor.state.doc.content.size);
	const size = placeholderSize(
		await decodeImageSize(file).catch(() => ({ width: 640, height: 360 })),
	);
	const imageNode = editor.state.schema.nodes.image.create({
		src: "",
		alt: "",
		uploadId: crypto.randomUUID(),
		uploadStatus: "uploading",
		uploadFile: file,
		width: size.width,
		height: size.height,
	});
	const paragraph = editor.state.schema.nodes.paragraph.create();
	const tr = editor.state.tr.insert(insertPos, [imageNode, paragraph]);
	const cursorPos = Math.min(
		insertPos + imageNode.nodeSize + 1,
		tr.doc.content.size,
	);
	tr.setSelection(TextSelection.near(tr.doc.resolve(cursorPos), 1));
	editor.view.dispatch(tr);
	editor.commands.focus(undefined, { scrollIntoView: false });
}

async function decodeImageSize(file: File): Promise<ImageSize> {
	if ("createImageBitmap" in window) {
		const bitmap = await createImageBitmap(file);
		const size = { width: bitmap.width, height: bitmap.height };
		bitmap.close();
		return size;
	}
	const url = URL.createObjectURL(file);
	try {
		const image = new Image();
		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error("Failed to decode image"));
			image.src = url;
		});
		return {
			width: image.naturalWidth,
			height: image.naturalHeight,
		};
	} finally {
		URL.revokeObjectURL(url);
	}
}

function placeholderSize(size: ImageSize): ImageSize {
	const width = Math.max(1, size.width);
	const height = Math.max(1, size.height);
	const scale = Math.min(1, MAX_PLACEHOLDER_WIDTH / width);
	return {
		width: Math.round(width * scale),
		height: Math.round(height * scale),
	};
}
