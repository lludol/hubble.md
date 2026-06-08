import {
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
export const EDITOR_INPUT_SELECTOR = "[data-editor-input]";

function isEditableElement(el: Element | null): boolean {
	if (!el) return false;
	if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
		return true;
	return (el as HTMLElement).isContentEditable;
}

export function useSidebarKeyboardNav<T>({
	items,
	onSelect,
	onEnter,
	onExpand,
	onCollapse,
	navRef,
	activeIndex = -1,
}: {
	items: T[];
	onSelect: (item: T) => void;
	onEnter?: (item: T) => void;
	onExpand?: (item: T) => void;
	onCollapse?: (item: T) => void;
	navRef: RefObject<HTMLElement | null>;
	activeIndex?: number;
}) {
	const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
	const focusedIndexRef = useRef(focusedIndex);
	focusedIndexRef.current = focusedIndex;
	const getActionIndex = useCallback(
		() => focusedIndexRef.current ?? (activeIndex >= 0 ? activeIndex : null),
		[activeIndex],
	);

	useEffect(() => {
		if (focusedIndex === null) return;
		navRef.current
			?.querySelector(`[data-sidebar-index="${focusedIndex}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [focusedIndex, navRef]);

	// Enter opens hovered item even when nav isn't focused
	useEffect(() => {
		const onGlobalEnter = (event: KeyboardEvent) => {
			if (event.key !== "Enter") return;
			const idx = getActionIndex();
			if (idx === null) return;
			if (navRef.current?.contains(document.activeElement)) return;
			if (isEditableElement(document.activeElement)) return;
			event.preventDefault();
			if (items[idx]) (onEnter ?? onSelect)(items[idx]);
		};
		window.addEventListener("keydown", onGlobalEnter);
		return () => window.removeEventListener("keydown", onGlobalEnter);
	}, [getActionIndex, items, onEnter, onSelect, navRef]);

	const onKeyDown = useCallback(
		(event: React.KeyboardEvent) => {
			if (items.length === 0) return;

			switch (event.key) {
				case "ArrowDown":
				case "ArrowUp": {
					event.preventDefault();
					const delta = event.key === "ArrowDown" ? 1 : -1;
					setFocusedIndex((prev) => {
						const start = prev ?? (activeIndex >= 0 ? activeIndex : -1);
						return Math.max(0, Math.min(start + delta, items.length - 1));
					});
					break;
				}
				case "Enter": {
					const idx = getActionIndex();
					if (idx !== null && items[idx]) {
						event.preventDefault();
						(onEnter ?? onSelect)(items[idx]);
					}
					break;
				}
				case " ": {
					const idx = getActionIndex();
					if (idx !== null && items[idx]) {
						event.preventDefault();
						onSelect(items[idx]);
					}
					break;
				}
				case "ArrowRight": {
					const idx = getActionIndex();
					if (idx !== null && items[idx] && onExpand) {
						event.preventDefault();
						onExpand(items[idx]);
					}
					break;
				}
				case "ArrowLeft": {
					const idx = getActionIndex();
					if (idx !== null && items[idx] && onCollapse) {
						event.preventDefault();
						onCollapse(items[idx]);
					}
					break;
				}
				case "Escape": {
					event.preventDefault();
					setFocusedIndex(null);
					document.querySelector<HTMLElement>(EDITOR_INPUT_SELECTOR)?.focus();
					break;
				}
			}
		},
		[
			items,
			onEnter,
			onSelect,
			onExpand,
			onCollapse,
			activeIndex,
			getActionIndex,
		],
	);

	return { focusedIndex, setFocusedIndex, onKeyDown };
}
