<script module lang="ts">
	/** Pretty-prints objects and JSON strings; any other text is shown verbatim. */
	function format(value: unknown): string {
		if (value === undefined) return '';
		if (typeof value !== 'string') return JSON.stringify(value, null, 2) ?? String(value);
		const trimmed = value.trimStart();
		if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
		try {
			return JSON.stringify(JSON.parse(value), null, 2);
		} catch {
			return value;
		}
	}
</script>

<script lang="ts">
	import Button from './Button.svelte';

	let { value }: { value: unknown } = $props();

	const text = $derived(format(value));
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
	<pre data-testid="code" class="code-block pr-20">{text}</pre>
	<div class="absolute top-1.5 right-1.5">
		<Button variant="ghost" onclick={copy}>
			{status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed' : 'Copy'}
		</Button>
	</div>
</div>
