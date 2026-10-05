import type { MenuEntry, Point } from '$lib/components/ui/menu';

export interface OpenMenu {
	at: Point;
	items: MenuEntry[];
	label: string;
	returnFocus: HTMLElement | null;
}

const NOTICE_MS = 1500;

/** The single open menu plus the transient status message ("Copied") shown by `ContextMenuHost`. */
export class ContextMenuState {
	current = $state<OpenMenu | null>(null);
	notice = $state<string | null>(null);
	private noticeTimer: number | undefined;

	open(at: Point, items: MenuEntry[], label: string, returnFocus: HTMLElement | null): void {
		this.current = { at, items, label, returnFocus };
	}

	/** Opens the menu just under `anchor` (keyboard and button invocations). */
	openAt(anchor: HTMLElement, items: MenuEntry[], label: string): void {
		const rect = anchor.getBoundingClientRect();
		this.open({ x: rect.left, y: rect.bottom + 2 }, items, label, anchor);
	}

	close(): void {
		const focus = this.current?.returnFocus;
		this.current = null;
		focus?.focus();
	}

	async copy(text: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(text);
			this.say('Copied');
		} catch {
			this.say('Could not copy');
		}
	}

	say(message: string): void {
		this.notice = message;
		window.clearTimeout(this.noticeTimer);
		this.noticeTimer = window.setTimeout(() => (this.notice = null), NOTICE_MS);
	}
}

export const contextMenu = new ContextMenuState();
