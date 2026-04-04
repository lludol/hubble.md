import { describe, expect, it } from "vitest";
import { markdownToTiptapDoc } from "./markdownToProsemirror";
import { tiptapDocToMarkdown } from "./prosemirrorToMarkdown";

describe("link markdown conversion", () => {
	it("parses markdown links into link marks", () => {
		const doc = markdownToTiptapDoc("[OpenAI](https://openai.com)");
		const paragraph = doc.content?.[0];
		expect(paragraph?.type).toBe("paragraph");
		const textNode = paragraph?.content?.[0];
		expect(textNode?.type).toBe("text");
		expect(textNode?.text).toBe("OpenAI");
		expect(textNode?.marks).toEqual([
			{ type: "link", attrs: { href: "https://openai.com" } },
		]);
	});

	it("serializes link marks back to markdown links", () => {
		const markdown = tiptapDocToMarkdown({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{
							type: "text",
							text: "OpenAI",
							marks: [{ type: "link", attrs: { href: "https://openai.com" } }],
						},
					],
				},
			],
		});
		expect(markdown).toBe("[OpenAI](https://openai.com)");
	});
});

describe("link where text equals href", () => {
	it("parses as regular link mark", () => {
		const doc = markdownToTiptapDoc(
			"[https://example.com](https://example.com)",
		);
		const paragraph = doc.content?.[0];
		const textNode = paragraph?.content?.[0];
		expect(textNode?.type).toBe("text");
		expect(textNode?.text).toBe("https://example.com");
		expect(textNode?.marks).toEqual([
			{ type: "link", attrs: { href: "https://example.com" } },
		]);
	});

	it("round-trips through markdown", () => {
		const input = "[https://example.com](https://example.com)";
		const doc = markdownToTiptapDoc(input);
		const output = tiptapDocToMarkdown(doc);
		expect(output).toBe(input);
	});
});
