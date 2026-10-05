import { describe, expect, it } from 'vitest';
import { layoutMode } from './layout';

describe('layoutMode', () => {
	it('REQ-UI-006 layoutMode thresholds', () => {
		expect(layoutMode(0)).toBe('wide');
		expect(layoutMode(899)).toBe('narrow');
		expect(layoutMode(900)).toBe('medium');
		expect(layoutMode(1199)).toBe('medium');
		expect(layoutMode(1200)).toBe('wide');
	});
});
