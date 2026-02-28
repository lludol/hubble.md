import {
	computePosition,
	flip,
	offset,
	shift,
	type VirtualElement,
} from "@floating-ui/dom";
import { getActiveLinkRange } from "@hubble.md/editor";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Editor } from "@tiptap/core";
import { keymatch } from "keymatch";
import MingcutePencilFill from "~icons/mingcute/pencil-fill";
import { type RefObject, useEffect, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import { FOCUS_LINK_POPOVER_EVENT } from "./SmartLinkExtension";
import { useEditorInputMode } from "./useEditorInputMode";

type PopoverMode = "hidden" | "preview" | "actions";
type MachineState = {
	mode: PopoverMode;
	activeKey: string | null;
};
type MachineEvent =
	| { type: "LINK_SESSION_CHANGED"; activeKey: string | null }
	| { type: "EXPAND_REQUESTED" }
	| { type: "TOGGLE_ACTIONS_REQUESTED" }
	| { type: "ESCAPE_REQUESTED" };
// Modes: hidden=dismissed for current link session, preview=compact chip,
// actions=expanded menu (input focus is managed by effect, not machine state).

const INITIAL_MACHINE_STATE: MachineState = {
	mode: "hidden",
	activeKey: null,
};

function machineReducer(
	state: MachineState,
	event: MachineEvent,
): MachineState {
	switch (event.type) {
		case "LINK_SESSION_CHANGED": {
			const { activeKey } = event;
			if (!activeKey) return INITIAL_MACHINE_STATE;
			if (state.activeKey !== activeKey) {
				return { mode: "preview", activeKey };
			}
			return { ...state, activeKey };
		}
		case "EXPAND_REQUESTED": {
			if (!state.activeKey) return state;
			return { ...state, mode: "actions" };
		}
		case "TOGGLE_ACTIONS_REQUESTED": {
			if (!state.activeKey) return state;
			if (state.mode === "preview") {
				return { ...state, mode: "actions" };
			}
			if (state.mode === "actions") {
				return { ...state, mode: "preview" };
			}
			return state;
		}
		case "ESCAPE_REQUESTED": {
			if (state.mode === "actions") {
				return { ...state, mode: "preview" };
			}
			if (state.mode === "preview" && state.activeKey) {
				return {
					...state,
					mode: "hidden",
				};
			}
			return state;
		}
		default:
			return state;
	}
}

async function copyLinkToClipboard(href: string) {
	try {
		await navigator.clipboard.writeText(href);
		toast.success("Link copied");
	} catch {
		toast.error("Failed to copy link");
	}
}

export function LinkPopover({
	editor,
	containerRef,
}: {
	editor: Editor | null;
	containerRef: RefObject<HTMLDivElement | null>;
}) {
	const [floatingX, setFloatingX] = useState(0);
	const [floatingY, setFloatingY] = useState(0);
	const [hrefValue, setHrefValue] = useState("");
	const [activeLink, setActiveLink] = useState<{
		from: number;
		to: number;
		href: string;
	} | null>(null);
	const [machineState, dispatch] = useReducer(
		machineReducer,
		INITIAL_MACHINE_STATE,
	);
	const { inputMode } = useEditorInputMode({ editor, containerRef });
	const inputRef = useRef<HTMLInputElement | null>(null);
	const popoverRef = useRef<HTMLDivElement | null>(null);
	const positionUpdateRef = useRef<(() => void) | null>(null);

	useEffect(() => {
		if (!editor) return;
		const update = () => {
			const link = getActiveLinkRange(editor.state);
			setActiveLink(link);
			if (link) setHrefValue(link.href);
			const nextActiveKey = link ? `${link.from}:${link.to}` : null;
			dispatch({ type: "LINK_SESSION_CHANGED", activeKey: nextActiveKey });
			const container = containerRef.current;
			if (!container || !link) return;
			const floatingEl = popoverRef.current;
			if (!floatingEl) return;
			const selectionPos = editor.state.selection.from;
			const reference: VirtualElement = {
				contextElement: container,
				getBoundingClientRect() {
					const coords = editor.view.coordsAtPos(selectionPos);
					return {
						x: coords.left,
						y: coords.top,
						left: coords.left,
						top: coords.top,
						right: coords.right,
						bottom: coords.bottom,
						width: coords.right - coords.left,
						height: coords.bottom - coords.top,
						toJSON() {
							return this;
						},
					};
				},
			};

			void computePosition(reference, floatingEl, {
				strategy: "fixed",
				placement: "top",
				middleware: [
					offset(4),
					flip({ fallbackPlacements: ["bottom"] }),
					shift({ padding: 8 }),
				],
			}).then(({ x, y }) => {
				setFloatingX(x);
				setFloatingY(y);
			});
		};
		positionUpdateRef.current = update;

		update();
		editor.on("selectionUpdate", update);
		editor.on("transaction", update);
		editor.on("focus", update);
		editor.on("blur", update);
		window.addEventListener("resize", update);
		window.addEventListener("scroll", update, true);

		return () => {
			positionUpdateRef.current = null;
			editor.off("selectionUpdate", update);
			editor.off("transaction", update);
			editor.off("focus", update);
			editor.off("blur", update);
			window.removeEventListener("resize", update);
			window.removeEventListener("scroll", update, true);
		};
	}, [editor, containerRef]);

	useEffect(() => {
		const onFocusRequest = () => {
			dispatch({ type: "EXPAND_REQUESTED" });
		};
		window.addEventListener(
			FOCUS_LINK_POPOVER_EVENT,
			onFocusRequest as EventListener,
		);
		return () => {
			window.removeEventListener(
				FOCUS_LINK_POPOVER_EVENT,
				onFocusRequest as EventListener,
			);
		};
	}, []);

	useEffect(() => {
		positionUpdateRef.current?.();
		if (machineState.mode !== "actions") return;
		queueMicrotask(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		});
	}, [machineState.mode]);

	useEffect(() => {
		if (!editor || !activeLink) return;
		const onKeyDown = (event: KeyboardEvent) => {
			const isInputFocused = document.activeElement === inputRef.current;
			const isVisible = machineState.mode !== "hidden";

			if (isInputFocused && keymatch(event, "Enter")) {
				event.preventDefault();
				dispatch({ type: "ESCAPE_REQUESTED" });
				editor.commands.focus(undefined, { scrollIntoView: false });
				return;
			}

			if ((isVisible || editor.isFocused) && keymatch(event, "Escape")) {
				event.preventDefault();
				const shouldReturnFocusToEditor =
					machineState.mode === "preview" || machineState.mode === "actions";
				dispatch({ type: "ESCAPE_REQUESTED" });
				if (shouldReturnFocusToEditor) {
					queueMicrotask(() => {
						editor.commands.focus(undefined, { scrollIntoView: false });
					});
				}
				return;
			}

			if (keymatch(event, "CmdOrCtrl+K")) {
				if (!isVisible) return;
				// Popover owns Cmd+K while visible to avoid editor shortcut races.
				event.preventDefault();
				event.stopPropagation();
				dispatch({ type: "TOGGLE_ACTIONS_REQUESTED" });
				return;
			}
			if (isVisible && keymatch(event, "CmdOrCtrl+Enter")) {
				event.preventDefault();
				event.stopPropagation();
				void visitLink(activeLink.href);
				return;
			}
			if (isVisible && keymatch(event, "CmdOrCtrl+Shift+C")) {
				event.preventDefault();
				event.stopPropagation();
				void copyLinkToClipboard(activeLink.href);
				return;
			}

			if (machineState.mode !== "actions") return;
			if (keymatch(event, "CmdOrCtrl+Backspace")) {
				event.preventDefault();
				removeActiveLink(editor, activeLink.from, activeLink.to);
			}
		};

		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [editor, activeLink, machineState.mode]);

	if (!editor || !activeLink || machineState.mode === "hidden") return null;

	const handleInput = (href: string) => {
		setHrefValue(href);
		const linkType = editor.state.schema.marks.link;
		if (!linkType) return;
		const tr = editor.state.tr.removeMark(
			activeLink.from,
			activeLink.to,
			linkType,
		);
		tr.addMark(activeLink.from, activeLink.to, linkType.create({ href }));
		editor.view.dispatch(tr);
	};

	return (
		<div
			ref={popoverRef}
			className="fixed z-[2]"
			style={{
				insetInlineStart: `${floatingX}px`,
				insetBlockStart: `${floatingY}px`,
			}}
		>
			{machineState.mode === "preview" ? (
				<button
					type="button"
					className="flex h-7 w-[165px] cursor-pointer overflow-hidden rounded-[2px] border border-zinc-300 bg-gradient-to-b from-white to-zinc-50 text-left shadow-[0_1px_3px_rgba(0,0,0,0.1)]"
					onClick={() => dispatch({ type: "EXPAND_REQUESTED" })}
				>
					<span
						title={activeLink.href}
						className="min-w-0 flex-1 overflow-hidden px-2 py-[5px] pr-3 text-[11px] leading-[16px] text-zinc-700 whitespace-nowrap [mask-image:linear-gradient(to_right,black_84%,transparent)] [-webkit-mask-image:linear-gradient(to_right,black_84%,transparent)]"
					>
						{activeLink.href}
					</span>
					<span className="relative flex h-full w-[42px] items-center justify-center overflow-hidden rounded-ee-[2px] rounded-se-[2px] bg-accent text-white">
						<span
							className={`absolute inset-0 flex items-center justify-center text-[11px] font-semibold leading-[16px] tracking-[0.12em] transition-transform duration-200 ${inputMode === "keyboard" ? "translate-y-0" : "-translate-y-[120%]"}`}
						>
							⌘K
						</span>
						<span
							className={`absolute inset-0 flex items-center justify-center transition-transform duration-200 ${inputMode === "keyboard" ? "translate-y-[120%]" : "translate-y-0"}`}
						>
							<MingcutePencilFill aria-label="Edit link" className="h-3 w-3" />
						</span>
					</span>
				</button>
			) : (
				<div className="w-[238px] overflow-hidden rounded-[2px] border border-zinc-300 bg-gradient-to-b from-white to-zinc-50 shadow-[0_1px_3px_rgba(0,0,0,0.1)]">
					<input
						ref={inputRef}
						type="text"
						value={hrefValue}
						onChange={(event) => handleInput(event.target.value)}
						className="block w-full border-none bg-transparent px-2 py-[5px] text-[11px] leading-[16px] text-black outline-none"
					/>
					<div className="border-block-start border-zinc-300">
						<div className="grid h-[30px] grid-cols-[1fr_1fr_63px] items-stretch text-[11px] leading-[16px]">
							<button
								type="button"
								className="flex items-center justify-center gap-1 font-semibold text-zinc-700"
								onClick={() =>
									removeActiveLink(editor, activeLink.from, activeLink.to)
								}
							>
								<span>Remove</span>
								<span className="text-[9px] leading-[14px] tracking-[0.12em] text-zinc-500">
									⌘⌫
								</span>
							</button>
							<button
								type="button"
								className="flex items-center justify-center gap-1 font-semibold text-zinc-700"
								onClick={() => {
									void copyLinkToClipboard(activeLink.href);
								}}
							>
								<span>Copy</span>
								<span className="text-[9px] leading-[14px] tracking-[0.12em] text-zinc-500">
									⌘⇧C
								</span>
							</button>
							<button
								type="button"
								className="flex items-center justify-center gap-1 rounded-ee-[2px] rounded-se-[2px] bg-accent font-semibold text-white"
								onClick={() => {
									void visitLink(activeLink.href);
								}}
							>
								<span>Visit</span>
								<span className="text-[9px] leading-[14px] tracking-[0.12em] text-green-200">
									⌘↩
								</span>
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

function removeActiveLink(editor: Editor, from: number, to: number) {
	const linkType = editor.state.schema.marks.link;
	if (!linkType) return;
	const tr = editor.state.tr.removeMark(from, to, linkType);
	editor.view.dispatch(tr);
	editor.commands.focus(undefined, { scrollIntoView: false });
}

async function visitLink(href: string) {
	try {
		const parsed = new URL(href);
		const protocol = parsed.protocol.toLowerCase();
		if (protocol !== "http:" && protocol !== "https:") {
			// TODO: Replace console warnings with app toast notifications.
			console.warn(`[LinkPopover] blocked non-http(s) URL: ${href}`);
			return;
		}
		await openUrl(href);
	} catch {
		// TODO: Replace console warnings with app toast notifications.
		console.warn(`[LinkPopover] invalid URL: ${href}`);
	}
}
