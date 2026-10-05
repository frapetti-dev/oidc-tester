<script lang="ts">
	import AppRoot from '#lib/components/app/AppRoot.svelte';
	import { ipc } from '#lib/ipc/commands.js';
</script>

<AppRoot {ipc} />
