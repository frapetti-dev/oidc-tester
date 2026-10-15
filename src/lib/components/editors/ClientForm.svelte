<script lang="ts">
	import FormSection from '#lib/components/ui/FormSection.svelte';
	import SecretField from '#lib/components/ui/SecretField.svelte';
	import SelectField from '#lib/components/ui/SelectField.svelte';
	import TextField from '#lib/components/ui/TextField.svelte';
	import type { Client, ClientAuth } from '#lib/model/schema.js';
	import type { WorkspaceStore } from '#lib/state/workspace.svelte.js';

	interface Props {
		client: Client;
		store: WorkspaceStore;
	}

	let { client, store }: Props = $props();

	const AUTH_OPTIONS: Array<{ value: ClientAuth; label: string }> = [
		{ value: 'none', label: 'None (public client)' },
		{ value: 'client_secret_basic', label: 'client_secret_basic' },
		{ value: 'client_secret_post', label: 'client_secret_post' },
		{ value: 'client_secret_jwt', label: 'client_secret_jwt' }
	];
	const JWT_ALG_OPTIONS = ['HS256', 'HS384', 'HS512'].map((value) => ({ value }));

	const needsSecret = $derived(client.auth !== 'none');
</script>

<div class="@container flex max-w-[44rem] flex-col">
	<FormSection id="client.client" title="Client">
		<TextField label="Name" bind:value={client.name} />
		<TextField label="Client ID" mono bind:value={client.clientId} />
		<div class="field-grid">
			<SelectField label="Client authentication" options={AUTH_OPTIONS} bind:value={client.auth} />
			{#if client.auth === 'client_secret_jwt'}
				<SelectField
					label="Assertion algorithm"
					options={JWT_ALG_OPTIONS}
					bind:value={client.jwtAlg}
				/>
			{/if}
		</div>
		{#if needsSecret}
			<SecretField
				label="Client secret"
				hasSecret={client.hasSecret}
				onsave={(value) => store.setClientSecret(client, value)}
				onclear={() => store.clearClientSecret(client)}
			/>
		{/if}
	</FormSection>
</div>
