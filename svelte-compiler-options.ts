import type { Options } from '@sveltejs/vite-plugin-svelte';

/** Svelte compiler options shared by the SvelteKit app (`vite.config.ts`) and Storybook (`.storybook/vite.config.ts`). */
export const compilerOptions: NonNullable<Options['compilerOptions']> = {
	// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
	runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
};
