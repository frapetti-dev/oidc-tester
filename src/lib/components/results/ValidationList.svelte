<script lang="ts">
	import type { Validation } from '#lib/model/run.js';
	import Badge from '#lib/components/ui/Badge.svelte';

	let { validations }: { validations: Validation[] } = $props();

	const LEVEL_VARIANT = { ok: 'success', warn: 'warning', error: 'danger' } as const;
</script>

<ul class="flex flex-col gap-1">
	{#each validations as validation (validation.id)}
		<li class="flex items-start gap-2" data-testid="validation-row" data-level={validation.level}>
			<Badge variant={LEVEL_VARIANT[validation.level]}>{validation.level}</Badge>
			<span class="text-fg">{validation.message}</span>
		</li>
	{/each}
</ul>
