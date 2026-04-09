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
import { TextSelection } from "@tiptap/pm/state";
import { keymatch } from "keymatch";
import {
	type RefObject,
	useCallback,
	useEffect,
	useReducer,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import MingcutePencilFill from "~icons/mingcute/pencil-fill";
import { cn } from "../lib/utils";
import { linkCreationGhostKey } from "./LinkCreationGhostExtension";
import styles from "./LinkPopover.module.css";
import {
	FOCUS_LINK_POPOVER_EVENT,
	LINK_CREATION_REQUESTED_EVENT,
} from "./SmartLinkExtension";
import { useEditorInputMode } from "./useEditorInputMode";

// ── State machine ───────────────────────────────────────────────────

type PopoverMode = "hidden" | "preview" | "actions" | "creating";
type MachineState = {
	mode: PopoverMode;
	activeKey: string | null;
	pendingCreation: boolean;
};
type MachineEvent =
	| { type: "LINK_SESSION_CHANGED"; activeKey: string | null }
	| { type: "EXPAND_REQUESTED" }
	| { type: "TOGGLE_ACTIONS_REQUESTED" }
	| { type: "ESCAPE_REQUESTED" }
	| { type: "CREATION_REQUESTED" }
	| { type: "CREATION_CONFIRMED" }
	| { type: "TITLE_INPUT_REQUESTED" };

const INITIAL_MACHINE_STATE: MachineState = {
	mode: "hidden",
	activeKey: null,
	pendingCreation: false,
};

function machineReducer(
	state: MachineState,
	event: MachineEvent,
): MachineState {
	switch (event.type) {
		case "LINK_SESSION_CHANGED": {
			const { activeKey } = event;
			if (state.mode === "creating") return state;
			if (!activeKey) {
				if (state.pendingCreation && state.activeKey === null) {
					// No text typed yet — keep waiting for first character
					return state;
				}
				return INITIAL_MACHINE_STATE;
			}
			if (state.activeKey !== activeKey) {
				return {
					mode: "preview",
					activeKey,
					pendingCreation: state.pendingCreation,
				};
			}
			return { ...state, activeKey };
		}
		case "EXPAND_REQUESTED": {
			if (state.mode === "creating") return state;
			if (!state.activeKey) return state;
			return { ...state, mode: "actions" };
		}
		case "TOGGLE_ACTIONS_REQUESTED": {
			if (!state.activeKey) return state;
			if (state.mode === "preview") return { ...state, mode: "actions" };
			if (state.mode === "actions") return { ...state, mode: "preview" };
			return state;
		}
		case "ESCAPE_REQUESTED": {
			if (state.mode === "creating") return INITIAL_MACHINE_STATE;
			if (state.mode === "actions") return { ...state, mode: "preview" };
			if (state.mode === "preview") {
				if (state.pendingCreation) {
					return { ...INITIAL_MACHINE_STATE };
				}
				return { ...state, mode: "hidden" };
			}
			return state;
		}
		case "CREATION_REQUESTED": {
			return {
				mode: "creating",
				activeKey: null,
				pendingCreation: false,
			};
		}
		case "CREATION_CONFIRMED": {
			return { ...INITIAL_MACHINE_STATE };
		}
		case "TITLE_INPUT_REQUESTED": {
			return { mode: "preview", activeKey: null, pendingCreation: true };
		}
		default:
			return state;
	}
}

function getLinkSession(editor: Editor) {
	const link = getActiveLinkRange(editor.state);
	return {
		link,
		activeKey: link ? `${link.from}:${link.to}` : null,
	};
}

// ── Anchor state ────────────────────────────────────────────────────
// The popover is "anchored" to a link once it has entered the link AND
// its floating position has been computed at least once. CSS transitions
// are only applied while anchored — this prevents jarring motion when
// jumping between links (keyboard or mouse) or clicking around with the
// pointer. The anchor detaches on any pointer-driven selection and on
// keyboard moves that land on a different link; it re-anchors after the
// first position compute on the new link.

type LinkAnchorState = {
	// The link the cursor is currently inside.
	activeKey: string | null;
	// The link the popover has been positioned over at least once.
	// When anchoredKey === activeKey, transitions are enabled.
	anchoredKey: string | null;
};

type LinkAnchorEvent =
	| {
			// Fired on every editor update; carries the new active link and
			// whether this change should detach the anchor.
			type: "LINK_SYNCED";
			activeKey: string | null;
			shouldDetach: boolean;
	  }
	| {
			// Fired after floating-ui resolves the popover position, marking
			// the popover as fully anchored to activeKey.
			type: "POSITIONED";
			activeKey: string | null;
	  };

const INITIAL_LINK_ANCHOR_STATE: LinkAnchorState = {
	activeKey: null,
	anchoredKey: null,
};

function linkAnchorReducer(
	state: LinkAnchorState,
	event: LinkAnchorEvent,
): LinkAnchorState {
	switch (event.type) {
		case "LINK_SYNCED": {
			const { activeKey, shouldDetach } = event;
			if (!activeKey) return INITIAL_LINK_ANCHOR_STATE;
			// Detach (drop anchoredKey) when moving to a new link or when the
			// caller signals the move should suppress animation.
			if (shouldDetach || state.activeKey !== activeKey) {
				return { activeKey, anchoredKey: null };
			}
			return { ...state, activeKey };
		}
		case "POSITIONED": {
			const { activeKey } = event;
			// Only anchor if the position resolves for the link we're tracking.
			if (!activeKey || state.activeKey !== activeKey) return state;
			return { activeKey, anchoredKey: activeKey };
		}
		default:
			return state;
	}
}

// ── Helpers ─────────────────────────────────────────────────────────

async function copyLinkToClipboard(href: string) {
	try {
		await navigator.clipboard.writeText(href);
		toast.success("Link copied");
	} catch {
		toast.error("Failed to copy link");
	}
}

function removeActiveLink(editor: Editor, from: number, to: number) {
	const linkType = editor.state.schema.marks.link;
	if (!linkType) return;
	if (from === to) {
		// Zero-width links live in stored marks, so removal updates stored marks.
		const marks = (
			editor.state.storedMarks ?? editor.state.selection.$from.marks()
		).filter((mark) => mark.type !== linkType);
		const tr = editor.state.tr.setStoredMarks(
			marks.length === 0 ? null : marks,
		);
		editor.view.dispatch(tr);
		editor.commands.focus(undefined, { scrollIntoView: false });
		return;
	}
	const tr = editor.state.tr.removeMark(from, to, linkType);
	editor.view.dispatch(tr);
	editor.commands.focus(undefined, { scrollIntoView: false });
}

function insertLinkedText(editor: Editor, pos: number, href: string) {
	const linkType = editor.state.schema.marks.link;
	if (!linkType) return;
	const textNode = editor.state.schema.text(href, [linkType.create({ href })]);
	const tr = editor.state.tr.insert(pos, textNode);
	editor.view.dispatch(tr);
}

function applyLinkMarkAtPos(editor: Editor, pos: number, href: string) {
	const linkType = editor.state.schema.marks.link;
	if (!linkType) return;
	const tr = editor.state.tr;
	tr.setSelection(TextSelection.create(tr.doc, pos));
	tr.setStoredMarks([linkType.create({ href })]);
	editor.view.dispatch(tr);
}

function clearGhostText(editor: Editor) {
	const current = linkCreationGhostKey.getState(editor.state);
	if (current) {
		editor.view.dispatch(editor.state.tr.setMeta(linkCreationGhostKey, null));
	}
}

async function visitLink(href: string) {
	try {
		const parsed = new URL(href);
		const protocol = parsed.protocol.toLowerCase();
		if (protocol !== "http:" && protocol !== "https:") {
			toast.error("Only http(s) links can be opened");
			return;
		}
		await openUrl(href);
	} catch {
		toast.error("Invalid link URL");
	}
}

// ── Positioning ─────────────────────────────────────────────────────
type PositionUpdateReason =
	| "selection"
	| "transaction"
	| "focus"
	| "blur"
	| "resize"
	| "scroll"
	| "layout";

const PREVIEW_SHELL_INLINE_SIZE = 250;
const PREVIEW_INLINE_SIZE_START = 100;
const PREVIEW_INLINE_SIZE_END = 174;
const PREVIEW_HORIZONTAL_OVERFLOW =
	(PREVIEW_SHELL_INLINE_SIZE - PREVIEW_INLINE_SIZE_END) / 2;
const PREVIEW_REVEAL_DURATION_MS = 180;

// Returns true when a selection change should detach the anchor,
// suppressing position transitions on the next update.
// Detaches when:
//   - the user moved with the pointer (mouse/trackpad click)
//   - the cursor jumped to a different link via keyboard
function shouldDetachAnchor({
	reason,
	inputMode,
	activeKey,
	previousSelectionActiveKey,
}: {
	reason: PositionUpdateReason;
	inputMode: "pointer" | "keyboard";
	activeKey: string | null;
	previousSelectionActiveKey: string | null;
}) {
	if (!activeKey || reason !== "selection") return false;
	if (inputMode === "pointer") return true;
	return previousSelectionActiveKey !== activeKey;
}

function updateFloatingPosition(
	editor: Editor,
	viewport: HTMLDivElement,
	floatingEl: HTMLDivElement,
	pos: number,
	mode: PopoverMode,
	setX: (x: number) => void,
	setY: (y: number) => void,
) {
	const boundaryPadding = {
		top: 8,
		right: mode === "preview" ? -PREVIEW_HORIZONTAL_OVERFLOW : 0,
		bottom: 8,
		left: mode === "preview" ? -PREVIEW_HORIZONTAL_OVERFLOW : 0,
	};
	const reference: VirtualElement = {
		contextElement: viewport,
		getBoundingClientRect() {
			const coords = editor.view.coordsAtPos(pos);
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

	return computePosition(reference, floatingEl, {
		strategy: "absolute",
		placement: "top",
		middleware: [
			offset(4),
			flip({
				boundary: viewport,
				fallbackPlacements: ["bottom"],
				padding: boundaryPadding,
			}),
			shift({
				boundary: viewport,
				padding: boundaryPadding,
			}),
		],
	}).then(({ x, y }) => {
		setX(x);
		setY(y);
	});
}

function playPreviewRevealAnimation(previewButton: HTMLButtonElement) {
	const easing =
		getComputedStyle(previewButton)
			.getPropertyValue("--ease-spring-snappy")
			.trim() || "ease-out";
	return previewButton.animate(
		[
			{
				inlineSize: `${PREVIEW_INLINE_SIZE_START}px`,
				opacity: 0.82,
				transform: "translateY(2px) scale(0.985)",
			},
			{
				inlineSize: `${PREVIEW_INLINE_SIZE_END}px`,
				opacity: 1,
				transform: "translateY(0) scale(1)",
			},
		],
		{
			duration: PREVIEW_REVEAL_DURATION_MS,
			easing,
		},
	);
}

function usePreviewRevealAnimation({
	mode,
	activeKey,
	inputMode,
	positionUpdateRef,
}: {
	mode: PopoverMode;
	activeKey: string | null;
	inputMode: "pointer" | "keyboard";
	positionUpdateRef: RefObject<
		((reason?: PositionUpdateReason) => void) | null
	>;
}) {
	const previewButtonRef = useRef<HTMLButtonElement | null>(null);
	const previewRevealAnimationRef = useRef<Animation | null>(null);
	const previousPopoverModeRef = useRef<PopoverMode>(mode);
	const previousPreviewKeyRef = useRef<string | null>(activeKey);

	const playPreviewReveal = useCallback(() => {
		const previewButton = previewButtonRef.current;
		if (!previewButton) return;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		previewRevealAnimationRef.current?.cancel();
		const animation = playPreviewRevealAnimation(previewButton);
		previewRevealAnimationRef.current = animation;
		animation.addEventListener(
			"finish",
			() => {
				if (previewRevealAnimationRef.current === animation) {
					previewRevealAnimationRef.current = null;
				}
				positionUpdateRef.current?.("layout");
			},
			{ once: true },
		);
		animation.addEventListener(
			"cancel",
			() => {
				if (previewRevealAnimationRef.current === animation) {
					previewRevealAnimationRef.current = null;
				}
			},
			{ once: true },
		);
	}, [positionUpdateRef]);

	useEffect(() => {
		return () => {
			previewRevealAnimationRef.current?.cancel();
		};
	}, []);

	useEffect(() => {
		const previousMode = previousPopoverModeRef.current;
		const previousPreviewKey = previousPreviewKeyRef.current;
		const shouldRevealFromHidden =
			previousMode === "hidden" && mode === "preview";
		const shouldReplayPreviewReveal =
			previousMode === "preview" &&
			mode === "preview" &&
			inputMode === "pointer" &&
			previousPreviewKey !== null &&
			activeKey !== null &&
			previousPreviewKey !== activeKey;

		if (shouldRevealFromHidden || shouldReplayPreviewReveal) {
			playPreviewReveal();
		}

		previousPopoverModeRef.current = mode;
		previousPreviewKeyRef.current = activeKey;
	}, [mode, activeKey, inputMode, playPreviewReveal]);

	return previewButtonRef;
}

// ── Component ───────────────────────────────────────────────────────

export function LinkPopover({
	editor,
	containerRef,
	viewportRef,
}: {
	editor: Editor | null;
	containerRef: RefObject<HTMLDivElement | null>;
	viewportRef: RefObject<HTMLDivElement | null>;
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
	const positionUpdateRef = useRef<
		((reason?: PositionUpdateReason) => void) | null
	>(null);
	const machineStateRef = useRef(machineState);
	const anchorRef = useRef(INITIAL_LINK_ANCHOR_STATE);
	const lastSelectionActiveKeyRef = useRef<string | null>(null);
	const positionRequestIdRef = useRef(0);
	const [animatePosition, setAnimatePosition] = useState(false);
	const previewButtonRef = usePreviewRevealAnimation({
		mode: machineState.mode,
		activeKey: machineState.activeKey,
		inputMode,
		positionUpdateRef,
	});

	// Creation-mode state
	const [creationCursorPos, setCreationCursorPos] = useState<number | null>(
		null,
	);
	const [creationHref, setCreationHref] = useState("");

	useEffect(() => {
		machineStateRef.current = machineState;
	}, [machineState]);

	const dispatchMachineEvent = useCallback((event: MachineEvent) => {
		const previousState = machineStateRef.current;
		const nextState = machineReducer(previousState, event);
		machineStateRef.current = nextState;
		dispatch(event);
	}, []);
	const setAnchorState = useCallback((event: LinkAnchorEvent) => {
		anchorRef.current = linkAnchorReducer(anchorRef.current, event);
	}, []);
	const openCreationTitleInput = useCallback(() => {
		if (!editor || creationCursorPos === null) return;
		clearGhostText(editor);
		if (creationHref) {
			applyLinkMarkAtPos(editor, creationCursorPos, creationHref);
		}
		dispatchMachineEvent({ type: "TITLE_INPUT_REQUESTED" });
		editor.commands.focus(undefined, { scrollIntoView: false });
	}, [editor, creationCursorPos, creationHref, dispatchMachineEvent]);

	// ── Link detection + positioning for existing links ─────────────
	useEffect(() => {
		if (!editor) return;
		const update = (reason: PositionUpdateReason = "layout") => {
			const { link, activeKey } = getLinkSession(editor);
			setActiveLink(link);
			if (link) setHrefValue(link.href);
			dispatchMachineEvent({
				type: "LINK_SESSION_CHANGED",
				activeKey,
			});

			const viewport = viewportRef.current;
			const floatingEl = popoverRef.current;
			const isCreating =
				machineStateRef.current.mode === "creating" &&
				creationCursorPos !== null;
			const shouldPosition = Boolean(
				link || machineStateRef.current.pendingCreation || isCreating,
			);
			// Transitions are allowed only when the popover is already anchored
			// to this exact link. Read the ref before advancing so we can compare
			// against the previous anchor state.
			const isAnchored =
				activeKey !== null &&
				anchorRef.current.activeKey === activeKey &&
				anchorRef.current.anchoredKey === activeKey;
			const shouldDetach = shouldDetachAnchor({
				reason,
				inputMode,
				activeKey,
				previousSelectionActiveKey: lastSelectionActiveKeyRef.current,
			});

			setAnchorState({
				type: "LINK_SYNCED",
				activeKey,
				shouldDetach,
			});
			setAnimatePosition(
				isAnchored &&
					reason !== "scroll" &&
					reason !== "resize" &&
					!shouldDetach,
			);
			if (reason === "selection") {
				lastSelectionActiveKeyRef.current = activeKey;
			}
			if (!viewport || !floatingEl || !shouldPosition) return;
			const requestId = ++positionRequestIdRef.current;
			void updateFloatingPosition(
				editor,
				viewport,
				floatingEl,
				isCreating ? creationCursorPos : editor.state.selection.from,
				machineStateRef.current.mode,
				setFloatingX,
				setFloatingY,
			).then(() => {
				if (requestId !== positionRequestIdRef.current) return;
				setAnchorState({ type: "POSITIONED", activeKey });
			});
		};
		positionUpdateRef.current = update;
		update();

		const handleSelectionUpdate = () => update("selection");
		const handleTransaction = () => update("transaction");
		const handleFocus = () => update("focus");
		const handleBlur = () => update("blur");
		const handleResize = () => update("resize");
		const handleScroll = () => update("scroll");

		editor.on("selectionUpdate", handleSelectionUpdate);
		editor.on("transaction", handleTransaction);
		editor.on("focus", handleFocus);
		editor.on("blur", handleBlur);
		window.addEventListener("resize", handleResize);
		viewportRef.current?.addEventListener("scroll", handleScroll, {
			passive: true,
		});

		return () => {
			positionUpdateRef.current = null;
			editor.off("selectionUpdate", handleSelectionUpdate);
			editor.off("transaction", handleTransaction);
			editor.off("focus", handleFocus);
			editor.off("blur", handleBlur);
			window.removeEventListener("resize", handleResize);
			viewportRef.current?.removeEventListener("scroll", handleScroll);
		};
	}, [
		editor,
		viewportRef,
		dispatchMachineEvent,
		setAnchorState,
		creationCursorPos,
		inputMode,
	]);

	// ── Listen for FOCUS_LINK_POPOVER_EVENT (selection-based flow) ──
	useEffect(() => {
		const onFocusRequest = () => {
			dispatchMachineEvent({ type: "EXPAND_REQUESTED" });
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
	}, [dispatchMachineEvent]);

	// ── Listen for LINK_CREATION_REQUESTED_EVENT (empty-selection Cmd+K) ──
	useEffect(() => {
		const onCreationRequested = (event: Event) => {
			const pos = (event as CustomEvent<{ pos: number }>).detail.pos;
			setCreationCursorPos(pos);
			setCreationHref("");
			dispatchMachineEvent({ type: "CREATION_REQUESTED" });
		};
		window.addEventListener(LINK_CREATION_REQUESTED_EVENT, onCreationRequested);
		return () => {
			window.removeEventListener(
				LINK_CREATION_REQUESTED_EVENT,
				onCreationRequested,
			);
		};
	}, [dispatchMachineEvent]);

	// ── Focus input when entering creating or actions mode ──────────
	useEffect(() => {
		positionUpdateRef.current?.("layout");
		if (machineState.mode !== "actions" && machineState.mode !== "creating")
			return;
		queueMicrotask(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		});
	}, [machineState.mode]);

	// ── Ghost text decoration management ────────────────────────────
	useEffect(() => {
		if (!editor) return;
		if (
			machineState.mode === "creating" &&
			creationCursorPos !== null &&
			creationHref
		) {
			editor.view.dispatch(
				editor.state.tr.setMeta(linkCreationGhostKey, {
					pos: creationCursorPos,
					text: creationHref,
				}),
			);
		} else if (machineState.mode !== "creating") {
			clearGhostText(editor);
		}
	}, [editor, machineState.mode, creationCursorPos, creationHref]);

	// ── Pointer: creating mode ──────────────────────────────────────
	useEffect(() => {
		if (!editor || machineState.mode !== "creating") return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (popoverRef.current?.contains(target)) return;

			requestAnimationFrame(() => {
				const clickedCreationCursor =
					creationCursorPos !== null &&
					editor.view.dom.contains(target) &&
					editor.state.selection.empty &&
					editor.state.selection.from === creationCursorPos;

				if (clickedCreationCursor) {
					openCreationTitleInput();
					return;
				}

				clearGhostText(editor);
				const { link, activeKey } = getLinkSession(editor);
				setActiveLink(link);
				if (link) setHrefValue(link.href);
				// Clicking anywhere else should behave like Escape: exit creation
				// mode, then recompute visibility from the editor's real selection.
				dispatchMachineEvent({ type: "ESCAPE_REQUESTED" });
				dispatchMachineEvent({ type: "LINK_SESSION_CHANGED", activeKey });
			});
		};

		window.addEventListener("pointerdown", onPointerDown, true);
		return () => window.removeEventListener("pointerdown", onPointerDown, true);
	}, [
		editor,
		machineState.mode,
		creationCursorPos,
		openCreationTitleInput,
		dispatchMachineEvent,
	]);

	// ── Keyboard: creating mode ─────────────────────────────────────
	useEffect(() => {
		if (!editor || machineState.mode !== "creating") return;
		const onKeyDown = (event: KeyboardEvent) => {
			const isInputFocused = document.activeElement === inputRef.current;

			if (isInputFocused && keymatch(event, "Enter")) {
				event.preventDefault();
				event.stopPropagation();
				if (creationHref && creationCursorPos !== null) {
					clearGhostText(editor);
					insertLinkedText(editor, creationCursorPos, creationHref);
				}
				dispatchMachineEvent({ type: "CREATION_CONFIRMED" });
				editor.commands.focus(undefined, { scrollIntoView: false });
				return;
			}

			if (isInputFocused && event.key === "Tab") {
				event.preventDefault();
				event.stopPropagation();
				openCreationTitleInput();
				return;
			}

			if (keymatch(event, "Escape")) {
				event.preventDefault();
				event.stopPropagation();
				clearGhostText(editor);
				dispatchMachineEvent({ type: "ESCAPE_REQUESTED" });
				editor.commands.focus(undefined, { scrollIntoView: false });
				return;
			}

			if (keymatch(event, "CmdOrCtrl+K")) {
				event.preventDefault();
				event.stopPropagation();
			}
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [
		editor,
		machineState.mode,
		creationHref,
		creationCursorPos,
		dispatchMachineEvent,
		openCreationTitleInput,
	]);

	// ── Keyboard: existing link (preview / actions) ─────────────────
	useEffect(() => {
		if (!editor || !activeLink) return;
		if (machineState.mode === "creating") return;
		const onKeyDown = (event: KeyboardEvent) => {
			const isInputFocused = document.activeElement === inputRef.current;
			const isVisible =
				machineState.mode !== "hidden" || machineState.pendingCreation;

			if (
				isInputFocused &&
				hrefValue.length === 0 &&
				(event.key === "Backspace" || event.key === "Delete")
			) {
				event.preventDefault();
				event.stopPropagation();
				removeActiveLink(editor, activeLink.from, activeLink.to);
				return;
			}

			if (isInputFocused && keymatch(event, "Enter")) {
				event.preventDefault();
				dispatchMachineEvent({ type: "ESCAPE_REQUESTED" });
				editor.commands.focus(undefined, { scrollIntoView: false });
				return;
			}

			if ((isVisible || editor.isFocused) && keymatch(event, "Escape")) {
				event.preventDefault();
				const shouldReturnFocusToEditor =
					machineState.mode === "preview" || machineState.mode === "actions";
				queueMicrotask(() => {
					dispatchMachineEvent({ type: "ESCAPE_REQUESTED" });
					if (shouldReturnFocusToEditor) {
						editor.commands.focus(undefined, {
							scrollIntoView: false,
						});
					}
				});
				return;
			}

			if (keymatch(event, "CmdOrCtrl+K")) {
				if (!isVisible) return;
				event.preventDefault();
				event.stopPropagation();
				dispatchMachineEvent({ type: "TOGGLE_ACTIONS_REQUESTED" });
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
		};

		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [
		editor,
		activeLink,
		machineState.mode,
		machineState.pendingCreation,
		dispatchMachineEvent,
		hrefValue,
	]);

	// ── Early return: nothing visible ───────────────────────────────
	if (!editor) return null;
	if (machineState.mode === "creating") {
		// Render creating UI below (no activeLink needed)
	} else if (machineState.mode === "hidden") {
		return null;
	} else if (!activeLink && !machineState.pendingCreation) {
		return null;
	}

	// ── Handlers ────────────────────────────────────────────────────
	const handleExistingLinkInput = (href: string) => {
		if (!activeLink) return;
		setHrefValue(href);
		const linkType = editor.state.schema.marks.link;
		if (!linkType) return;
		if (activeLink.from === activeLink.to) {
			// Zero-width links edit stored marks because there is no text range yet.
			const marks = (
				editor.state.storedMarks ?? editor.state.selection.$from.marks()
			).filter((mark) => mark.type !== linkType);
			const tr = editor.state.tr.setStoredMarks([
				...marks,
				linkType.create({ href }),
			]);
			editor.view.dispatch(tr);
			return;
		}
		const tr = editor.state.tr.removeMark(
			activeLink.from,
			activeLink.to,
			linkType,
		);
		tr.addMark(activeLink.from, activeLink.to, linkType.create({ href }));
		editor.view.dispatch(tr);
	};

	// ── Render ──────────────────────────────────────────────────────
	const actionHintClass =
		"text-[9px] leading-[14px] tracking-[0.12em] text-muted-foreground/85";
	const actionButtonClass =
		"h-auto flex-1 rounded-none border-0 px-2 text-foreground shadow-none inset-shadow-none hover:bg-muted/80";

	return (
		<div
			ref={popoverRef}
			className={cn(
				"absolute z-[4] w-[250px]",
				animatePosition &&
					"transition-position motion-reduce:transition-none duration-[var(--cursor-motion-duration)] ease-cursor-motion",
			)}
			style={{
				insetInlineStart: `${floatingX}px`,
				insetBlockStart: `${floatingY}px`,
			}}
		>
			{machineState.mode === "creating" ? (
				<div className="w-full overflow-hidden rounded-sm border border-border bg-popover shadow-panel">
					<div className="p-1">
						<Input
							ref={inputRef}
							type="text"
							value={creationHref}
							placeholder="Paste or type a link"
							onChange={(event) => setCreationHref(event.target.value)}
							className="h-7 rounded-[calc(var(--radius)-1px)] border-border bg-background px-2 py-[5px] text-[11px] leading-[16px]"
						/>
					</div>
					<div className="flex h-6 items-center px-2 text-[9px] leading-[14px] tracking-[0.12em] text-muted-foreground/85">
						<span>⇥ to set title</span>
					</div>
				</div>
			) : machineState.mode === "preview" ? (
				<div className="flex justify-center">
					<Button
						ref={previewButtonRef}
						variant="outline"
						size="sm"
						className={cn(
							"h-7 min-w-0 justify-start gap-0 overflow-hidden border-border bg-card px-0 text-left shadow-panel inset-shadow-chrome hover:bg-card",
							styles.previewButton,
						)}
						onClick={() => dispatchMachineEvent({ type: "EXPAND_REQUESTED" })}
					>
						<span
							title={activeLink?.href ?? creationHref}
							className="min-w-0 flex-1 overflow-hidden px-2.5 py-[5px] pr-3 text-[11px] leading-[16px] text-foreground whitespace-nowrap [mask-image:linear-gradient(to_right,black_84%,transparent)] [-webkit-mask-image:linear-gradient(to_right,black_84%,transparent)]"
						>
							{activeLink?.href ?? creationHref}
						</span>
						<span className="relative flex h-full w-[42px] shrink-0 items-center justify-center overflow-hidden border-s border-border bg-primary text-primary-foreground">
							<span
								className={cn(
									"absolute inset-0 flex items-center justify-center text-[11px] font-semibold leading-[16px] tracking-[0.12em] transition-transform duration-[var(--default-transition-duration)] ease-spring-snappy",
									inputMode === "keyboard"
										? "translate-y-0"
										: "-translate-y-[120%]",
								)}
							>
								⌘K
							</span>
							<span
								className={cn(
									"absolute inset-0 flex items-center justify-center transition-transform duration-[var(--default-transition-duration)] ease-spring-snappy",
									inputMode === "keyboard"
										? "translate-y-[120%]"
										: "translate-y-0",
								)}
							>
								<MingcutePencilFill
									aria-label="Edit link"
									className="h-3 w-3"
								/>
							</span>
						</span>
					</Button>
				</div>
			) : (
				<div className="w-full overflow-hidden rounded-sm border border-border bg-popover shadow-panel">
					<div className="p-1">
						<Input
							ref={inputRef}
							type="text"
							value={hrefValue}
							placeholder="⌫ to remove link"
							onChange={(event) => handleExistingLinkInput(event.target.value)}
							className="h-7 rounded-[calc(var(--radius)-1px)] border-border bg-background px-2 py-[5px] text-[11px] leading-[16px]"
						/>
					</div>
					<Separator className="bg-border/90" />
					<div className="flex h-8 items-stretch text-[11px] leading-[16px]">
						<Button
							type="button"
							variant="ghost"
							size="xs"
							className={actionButtonClass}
							onClick={() => {
								if (!activeLink) return;
								removeActiveLink(editor, activeLink.from, activeLink.to);
							}}
						>
							<span>Remove</span>
						</Button>
						<Separator
							orientation="vertical"
							className="self-stretch bg-border/90"
						/>
						<Button
							type="button"
							variant="ghost"
							size="xs"
							className={actionButtonClass}
							onClick={() => {
								if (!activeLink) return;
								void copyLinkToClipboard(activeLink.href);
							}}
						>
							<span>Copy</span>
							<span className={actionHintClass}>⌘⇧C</span>
						</Button>
						<Separator
							orientation="vertical"
							className="self-stretch bg-border/90"
						/>
						<Button
							type="button"
							variant="default"
							size="xs"
							className="h-auto min-w-[72px] rounded-none border-0 px-2 text-primary-foreground shadow-none inset-shadow-none hover:brightness-105"
							onClick={() => {
								if (!activeLink) return;
								void visitLink(activeLink.href);
							}}
						>
							<span>Visit</span>
							<span className="text-[9px] leading-[14px] tracking-[0.12em] text-primary-foreground/75">
								⌘↩
							</span>
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
