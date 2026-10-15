<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn } from 'storybook/test';
	import { newFlow, newIdp } from '#lib/model/schema.js';
	import type { Run } from '#lib/model/run.js';
	import TokensPanel from './TokensPanel.svelte';

	function encode(value: unknown): string {
		return btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
	}

	const jwt = (payload: Record<string, unknown>) =>
		`${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(payload)}.c2ln`;

	const accessToken = jwt({ iss: 'http://localhost:4455', sub: 'alice', scope: 'openid' });
	const idToken = jwt({ iss: 'http://localhost:4455', sub: 'alice', aud: 'public-spa' });

	function makeRun(overrides: Partial<Run> = {}): Run {
		return {
			id: 'run-1',
			workspaceId: 'scratchpad',
			idpId: 'idp-1',
			clientId: 'client-1',
			flowId: 'flow-1',
			flowSnapshot: newFlow('authorization_code_pkce'),
			idpSnapshot: newIdp(),
			startedAt: '2025-01-01T10:00:00.000Z',
			finishedAt: '2025-01-01T10:00:02.000Z',
			status: 'success',
			navigations: [],
			exchanges: [],
			failures: [],
			validations: [
				{ id: 'sig.id_token', level: 'ok', message: 'Signature valid (RS256)' },
				{ id: 'idt.iss', level: 'ok', message: 'iss matches the issuer' }
			],
			tokens: {
				access_token: accessToken,
				id_token: idToken,
				refresh_token: 'opaque-refresh-token',
				token_type: 'Bearer',
				expires_in: 3600,
				scope: 'openid profile',
				raw: { access_token: accessToken, token_type: 'Bearer', expires_in: 3600 }
			},
			...overrides
		};
	}

	const { Story } = defineMeta({
		title: 'Results/TokensPanel',
		component: TokensPanel
	});
</script>

<Story
	name="No run shows the empty state"
	args={{ run: null }}
	play={async ({ canvas }) => {
		await expect(canvas.getByText('No run yet')).toBeVisible();
	}}
/>

<Story
	name="Run without tokens says so"
	args={{ run: makeRun({ status: 'cancelled', tokens: undefined }) }}
	play={async ({ canvas }) => {
		await expect(canvas.getByText('This run returned no tokens')).toBeVisible();
	}}
/>

<Story
	name="Every returned token gets its own view, with signature and raw response"
	args={{ run: makeRun() }}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('region', { name: 'Access token' })).toBeVisible();
		await expect(canvas.getByRole('region', { name: 'ID token' })).toBeVisible();
		await expect(canvas.getByRole('region', { name: 'Refresh token' })).toBeVisible();
		const idSection = canvas.getByRole('region', { name: 'ID token' });
		await expect(idSection).toHaveTextContent('Signature valid (RS256)');
		await expect(idSection).toHaveTextContent('iss matches the issuer');
		await expect(canvas.getByTestId('token-summary')).toHaveTextContent('expires_in 3600');
		await expect(canvas.getByRole('region', { name: 'Raw token response' })).toHaveTextContent(
			'"token_type": "Bearer"'
		);
		await expect(canvas.queryByRole('button', { name: 'Use refresh token' })).toBeNull();
		await expect(canvas.queryByRole('button', { name: 'Call UserInfo' })).toBeNull();
	}}
/>

<Story
	name="REQ-FLOW-007 Use refresh token hands the refresh token to the caller"
	parameters={{ req: ['REQ-FLOW-007'] }}
	args={{ run: makeRun(), onuserefresh: fn() }}
	play={async ({ canvas, userEvent, args }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Use refresh token' }));
		await expect(args.onuserefresh).toHaveBeenCalledTimes(1);
		await expect(args.onuserefresh).toHaveBeenCalledWith('opaque-refresh-token');
	}}
/>

<Story
	name="REQ-FLOW-007 No refresh token means no Use refresh token button"
	parameters={{ req: ['REQ-FLOW-007'] }}
	args={{
		run: makeRun({
			tokens: { access_token: 'opaque-access', token_type: 'Bearer', raw: {} }
		}),
		onuserefresh: fn()
	}}
	play={async ({ canvas }) => {
		await expect(canvas.queryByRole('button', { name: 'Use refresh token' })).toBeNull();
	}}
/>

<Story
	name="REQ-FLOW-014 Call UserInfo triggers the callback and displays the response"
	parameters={{ req: ['REQ-FLOW-014'] }}
	args={{
		run: makeRun(),
		onuserinfo: fn(),
		userinfo: { sub: 'alice', email: 'alice@example.test' }
	}}
	play={async ({ canvas, userEvent, args }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Call UserInfo' }));
		await expect(args.onuserinfo).toHaveBeenCalledTimes(1);
		await expect(canvas.getByRole('region', { name: 'UserInfo' })).toHaveTextContent(
			'"email": "alice@example.test"'
		);
	}}
/>

<Story
	name="REQ-FLOW-014 Call UserInfo is disabled without an access token"
	parameters={{ req: ['REQ-FLOW-014'] }}
	args={{
		run: makeRun({ tokens: { id_token: idToken, raw: {} } }),
		onuserinfo: fn()
	}}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('button', { name: 'Call UserInfo' })).toBeDisabled();
	}}
/>
