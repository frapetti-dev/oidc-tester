import type { Preview } from '@storybook/sveltekit';
import { addons } from 'storybook/preview-api';
import { GLOBALS_UPDATED } from 'storybook/internal/core-events';
import '../src/app.css';

type ThemeGlobal = 'light' | 'dark';

function applyTheme(theme: ThemeGlobal | undefined) {
	document.documentElement.classList.toggle('dark', theme === 'dark');
}

// The toolbar switch re-renders the story without re-running `beforeEach`.
addons.getChannel().on(GLOBALS_UPDATED, ({ globals }: { globals: { theme?: ThemeGlobal } }) => {
	applyTheme(globals.theme);
});

const preview: Preview = {
	globalTypes: {
		theme: {
			description: 'Color theme (toggles the .dark class on <html>)',
			toolbar: {
				title: 'Theme',
				icon: 'circlehollow',
				items: [
					{ value: 'light', title: 'Light' },
					{ value: 'dark', title: 'Dark' }
				],
				dynamicTitle: true
			}
		}
	},
	initialGlobals: { theme: 'light' },
	beforeEach: ({ globals }) => {
		applyTheme(globals.theme);
	},
	parameters: {
		controls: {
			matchers: {
				color: /(background|color)$/i,
				date: /Date$/i
			}
		},

		a11y: {
			// 'todo' - show a11y violations in the test UI only
			// 'error' - fail CI on a11y violations
			// 'off' - skip a11y checks entirely
			test: 'todo'
		}
	}
};

export default preview;
