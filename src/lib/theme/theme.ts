export const THEME_STORAGE_KEY = 'oidct.theme';
export const THEME_MODES = ['system', 'light', 'dark'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

const DARK_QUERY = '(prefers-color-scheme: dark)';

export interface ThemeEnv {
	storage: Pick<Storage, 'getItem' | 'setItem'> | null;
	matchMedia: (query: string) => {
		matches: boolean;
		addEventListener(type: 'change', listener: () => void): void;
		removeEventListener(type: 'change', listener: () => void): void;
	};
	root: { classList: Pick<DOMTokenList, 'toggle'> };
}

export interface ThemeController {
	readonly mode: ThemeMode;
	set(mode: ThemeMode): void;
	dispose(): void;
}

function isThemeMode(value: string | null): value is ThemeMode {
	return THEME_MODES.some((mode) => mode === value);
}

/**
 * Applies the stored theme (default: system) to `env.root` and, while in system
 * mode, keeps following the OS `prefers-color-scheme` until disposed.
 */
export function createThemeController(env: ThemeEnv): ThemeController {
	const stored = env.storage?.getItem(THEME_STORAGE_KEY) ?? null;
	let mode: ThemeMode = isThemeMode(stored) ? stored : 'system';
	const media = env.matchMedia(DARK_QUERY);

	const apply = () => {
		env.root.classList.toggle('dark', mode === 'dark' || (mode === 'system' && media.matches));
	};
	media.addEventListener('change', apply);
	apply();

	return {
		get mode() {
			return mode;
		},
		set(next) {
			mode = next;
			env.storage?.setItem(THEME_STORAGE_KEY, next);
			apply();
		},
		dispose() {
			media.removeEventListener('change', apply);
		}
	};
}

let shared: ThemeController | undefined;

/** Browser-wide singleton shared by the layout (startup) and `ThemeToggle`. */
export function themeController(): ThemeController {
	shared ??= createThemeController({
		storage: window.localStorage,
		matchMedia: (query) => window.matchMedia(query),
		root: document.documentElement
	});
	return shared;
}
