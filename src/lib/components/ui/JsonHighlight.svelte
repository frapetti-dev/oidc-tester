<script lang="ts">
	import { tokenizeJson } from './jsonTokens.js';

	let { text }: { text: string } = $props();

	const tokens = $derived(tokenizeJson(text));

	const CLASS = {
		key: 'text-json-key',
		string: 'text-json-string',
		number: 'text-json-number',
		literal: 'text-json-literal',
		punct: 'text-fg-muted'
	} as const;
</script>

{#each tokens as token, i (i)}{#if token.kind === 'space'}{token.text}{:else}<span
			class={CLASS[token.kind]}
			data-token={token.kind}>{token.text}</span
		>{/if}{/each}
