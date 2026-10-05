export type LayoutMode = 'wide' | 'medium' | 'narrow';

/** REQ-UI-006. A width of 0 means "not measured yet" and renders the wide layout. */
export function layoutMode(width: number): LayoutMode {
	if (width === 0 || width >= 1200) return 'wide';
	return width >= 900 ? 'medium' : 'narrow';
}
