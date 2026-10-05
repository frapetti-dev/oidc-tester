import { describe, expect, it } from 'vitest';
import { placeMenu } from './menu';

const viewport = { width: 800, height: 600 };
const size = { width: 200, height: 100 };

describe('placeMenu', () => {
	it('REQ-UI-009 placeMenu flips and clamps inside the viewport', () => {
		// fits as-is
		expect(placeMenu({ x: 100, y: 100 }, size, viewport)).toEqual({ x: 100, y: 100 });
		// flips left when it would overflow the right edge
		expect(placeMenu({ x: 700, y: 100 }, size, viewport)).toEqual({ x: 500, y: 100 });
		// flips up when it would overflow the bottom edge
		expect(placeMenu({ x: 100, y: 560 }, size, viewport)).toEqual({ x: 100, y: 460 });
		// flipped position that would leave the viewport is clamped to the margin
		expect(placeMenu({ x: 120, y: 10 }, { width: 200, height: 590 }, viewport)).toEqual({
			x: 120,
			y: 4
		});
		expect(placeMenu({ x: 150, y: 50 }, { width: 790, height: 100 }, viewport)).toEqual({
			x: 4,
			y: 50
		});
		// larger than the viewport: pinned to the margin
		expect(placeMenu({ x: 300, y: 300 }, { width: 900, height: 700 }, viewport)).toEqual({
			x: 4,
			y: 4
		});
	});
});
