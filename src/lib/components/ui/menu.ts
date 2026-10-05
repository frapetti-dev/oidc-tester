export type MenuItem = {
	label: string;
	onselect: () => void | Promise<void>;
	disabled?: boolean;
	danger?: boolean;
	shortcut?: string;
};

export type MenuEntry = MenuItem | 'separator';

export interface Point {
	x: number;
	y: number;
}

export interface Size {
	width: number;
	height: number;
}

function place(at: number, size: number, viewport: number, margin: number): number {
	const start = at + size > viewport - margin ? at - size : at;
	const max = viewport - size - margin;
	return max < margin ? margin : Math.min(max, Math.max(margin, start));
}

/**
 * Top-left of a menu opened at `at`: flips left/up when it would overflow the viewport, then
 * clamps so a `margin` stays free on every side (menus larger than the viewport pin to `margin`).
 */
export function placeMenu(at: Point, size: Size, viewport: Size, margin = 4): Point {
	return {
		x: place(at.x, size.width, viewport.width, margin),
		y: place(at.y, size.height, viewport.height, margin)
	};
}
