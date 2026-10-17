import tailwindcss from '@tailwindcss/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { compilerOptions } from '../svelte-compiler-options.ts';

// Storybook renders components without the SvelteKit plugin: stories use no `$app`/`$env`
// modules, and the kit plugin rejects Storybook's `transformIndexHtml` plugins and `base`.
export default defineConfig({
	plugins: [tailwindcss(), svelte({ configFile: false, compilerOptions })],
	optimizeDeps: { include: ['jose', 'zod'] },
	server: { watch: { ignored: ['**/src-tauri/**'] } }
});
