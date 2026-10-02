import { describe, expect, it } from 'vitest';
import { createThemeController, THEME_STORAGE_KEY, type ThemeEnv } from './theme';

function fakeEnv(opts: { stored?: string; prefersDark?: boolean } = {}) {
	const store = new Map<string, string>();
	if (opts.stored !== undefined) store.set(THEME_STORAGE_KEY, opts.stored);
	const classes = new Set<string>();
	const listeners = new Set<() => void>();
	const media = {
		matches: opts.prefersDark ?? false,
		addEventListener: (_: 'change', fn: () => void) => void listeners.add(fn),
		removeEventListener: (_: 'change', fn: () => void) => void listeners.delete(fn)
	};
	const env: ThemeEnv = {
		storage: {
			getItem: (k) => store.get(k) ?? null,
			setItem: (k, v) => void store.set(k, v)
		},
		matchMedia: () => media,
		root: {
			classList: {
				toggle: (name: string, force?: boolean) => {
					if (force) classes.add(name);
					else classes.delete(name);
					return classes.has(name);
				}
			}
		}
	};
	return {
		env,
		store,
		isDark: () => classes.has('dark'),
		setOsDark(value: boolean) {
			media.matches = value;
			for (const fn of listeners) fn();
		},
		listenerCount: () => listeners.size
	};
}

describe('theme controller', () => {
	it('REQ-UI-002 Dark stores the choice and sets the dark class', () => {
		const t = fakeEnv();
		const theme = createThemeController(t.env);
		theme.set('dark');
		expect(t.store.get('oidct.theme')).toBe('dark');
		expect(t.isDark()).toBe(true);
	});

	it('REQ-UI-002 Light removes the dark class even when the OS prefers dark', () => {
		const t = fakeEnv({ prefersDark: true, stored: 'dark' });
		const theme = createThemeController(t.env);
		expect(t.isDark()).toBe(true);
		theme.set('light');
		expect(t.store.get('oidct.theme')).toBe('light');
		expect(t.isDark()).toBe(false);
	});

	it('REQ-UI-002 System follows prefers-color-scheme, including later OS changes', () => {
		const t = fakeEnv({ prefersDark: true });
		const theme = createThemeController(t.env);
		expect(theme.mode).toBe('system');
		expect(t.isDark()).toBe(true);
		t.setOsDark(false);
		expect(t.isDark()).toBe(false);
		t.setOsDark(true);
		expect(t.isDark()).toBe(true);
	});

	it('REQ-UI-002 OS changes are ignored while an explicit mode is chosen', () => {
		const t = fakeEnv({ stored: 'light' });
		createThemeController(t.env);
		t.setOsDark(true);
		expect(t.isDark()).toBe(false);
	});

	it('REQ-UI-002 on load the stored value is applied', () => {
		const t = fakeEnv({ stored: 'dark' });
		const theme = createThemeController(t.env);
		expect(theme.mode).toBe('dark');
		expect(t.isDark()).toBe(true);
	});

	it('REQ-UI-002 an invalid stored value falls back to System', () => {
		const t = fakeEnv({ stored: 'purple', prefersDark: false });
		const theme = createThemeController(t.env);
		expect(theme.mode).toBe('system');
		expect(t.isDark()).toBe(false);
	});

	it('REQ-UI-002 dispose stops following the OS', () => {
		const t = fakeEnv();
		const theme = createThemeController(t.env);
		expect(t.listenerCount()).toBe(1);
		theme.dispose();
		expect(t.listenerCount()).toBe(0);
	});
});
