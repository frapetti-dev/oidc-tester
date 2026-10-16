<script lang="ts">
	import JsonHighlight from '#lib/components/ui/JsonHighlight.svelte';
	import type { Header } from '#lib/ipc/types.js';
	import { formatBody } from './entries';

	interface Props {
		title: string;
		headers: Header[];
		body: string | null;
	}

	let { title, headers, body }: Props = $props();

	const formatted = $derived(formatBody(body, headers));
</script>

<section class="flex flex-col gap-2" aria-label={title}>
	<h4 class="field-label">{title}</h4>
	{#if headers.length > 0}
		<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
			{#each headers as [name, value], i (i)}
				<dt class="font-mono text-fg-muted">{name}</dt>
				<dd class="font-mono break-all">{value}</dd>
			{/each}
		</dl>
	{:else}
		<p class="text-xs text-fg-muted">No headers</p>
	{/if}
	{#if formatted.kind === 'empty'}
		<p class="text-xs text-fg-muted">No body</p>
	{:else if formatted.kind === 'form'}
		<table class="text-xs" aria-label="{title} form body">
			<tbody>
				{#each formatted.rows as row, i (i)}
					<tr>
						<th class="pr-3 text-left font-mono font-normal text-fg-muted">{row.name}</th>
						<td class="font-mono break-all">{row.value}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{:else if formatted.kind === 'json'}
		<pre class="code-block" data-testid="body-json"><JsonHighlight text={formatted.text} /></pre>
	{:else}
		<pre class="code-block" data-testid="body-{formatted.kind}">{formatted.text}</pre>
	{/if}
</section>
