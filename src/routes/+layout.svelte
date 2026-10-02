<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { themeController } from '$lib/theme/theme';

	let { children } = $props();

	// Apply the stored theme as soon as the app starts (the SPA never runs on the server).
	themeController();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
