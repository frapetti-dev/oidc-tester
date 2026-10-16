<script module lang="ts">
	/** Pretty-prints objects and JSON strings; any other text is shown verbatim. */
	function format(value: unknown): { text: string; json: boolean } {
		if (value === undefined) return { text: '', json: false };
		if (typeof value !== 'string') {
			const s = JSON.stringify(value, null, 2);
			return s === undefined ? { text: String(value), json: false } : { text: s, json: true };
		}
		const trimmed = value.trimStart();
		if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return { text: value, json: false };
		try {
			return { text: JSON.stringify(JSON.parse(value), null, 2), json: true };
		} catch {
			return { text: value, json: false };
		}
	}
</script>

<script lang="ts">
	import { contextMenu } from '#lib/state/contextMenu.svelte.js';
	import Button from './Button.svelte';
	import JsonHighlight from './JsonHighlight.svelte';
	import { menu } from './contextMenu';

	let { value }: { value: unknown } = $props();

	const formatted = $derived(format(value));
	const text = $derived(formatted.text);
	let status = $state<'idle' | 'copied' | 'failed'>('idle');
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function copy() {
		try {
			await navigator.clipboard.writeText(text);
			status = 'copied';
		} catch {
			status = 'failed';
		}
		clearTimeout(timer);
		timer = setTimeout(() => (status = 'idle'), 1500);
	}
</script>

<div class="relative">
	<pre
		data-testid="code"
		class="code-block pr-20"
		{@attach menu(
			() => [{ label: 'Copy', onselect: () => contextMenu.copy(text) }],
			'Code actions'
		)}>{#if formatted.json}<JsonHighlight {text} />{:else}{text}{/if}</pre>
	<div class="absolute top-1.5 right-1.5">
		<Button variant="ghost" onclick={copy}>
			{status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed' : 'Copy'}
		</Button>
	</div>
</div>
