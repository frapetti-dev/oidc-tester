<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn } from 'storybook/test';
	import TokenView from './TokenView.svelte';
	import ContextMenuHost from '#lib/components/ui/ContextMenuHost.svelte';

	const NOW_SECONDS = 1_700_000_000;
	const NOW = NOW_SECONDS * 1000;

	function encode(value: unknown): string {
		return btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
	}

	function jws(payload: Record<string, unknown>): string {
		return `${encode({ alg: 'RS256', typ: 'JWT', kid: 'key-1' })}.${encode(payload)}.c2lnbmF0dXJl`;
	}

	const validPayload = {
		iss: 'http://localhost:4455',
		sub: 'alice',
		aud: 'public-spa',
		exp: NOW_SECONDS + 3540,
		iat: NOW_SECONDS - 60,
		custom_claim: 'x'
	};
	const validToken = jws(validPayload);
	const expiredToken = jws({ ...validPayload, exp: NOW_SECONDS - 180 });

	const { Story } = defineMeta({
		title: 'Results/TokenView',
		component: TokenView,
		args: { label: 'ID token', sigId: 'sig.id_token', validations: [], now: NOW }
	});
</script>

<Story
	name="REQ-JWT-002 Encoded token is color coded and decoded side by side"
	parameters={{ req: ['REQ-JWT-002'] }}
	args={{ token: validToken }}
	play={async ({ canvas }) => {
		const segments = canvas.getAllByTestId('token-segment');
		const [header, payload, signature] = validToken.split('.');
		const byPart = (part: string) => segments.find((el) => el.dataset.part === part);
		await expect(byPart('header')).toHaveTextContent(header);
		await expect(byPart('header')).toHaveClass('text-jwt-header');
		await expect(byPart('payload')).toHaveTextContent(payload);
		await expect(byPart('payload')).toHaveClass('text-jwt-payload');
		await expect(byPart('signature')).toHaveTextContent(signature);
		await expect(byPart('signature')).toHaveClass('text-jwt-signature');
		const decoded = canvas.getAllByTestId('code');
		await expect(decoded).toHaveLength(2);
		await expect(decoded[0]).toHaveTextContent('"alg": "RS256"');
		await expect(decoded[1]).toHaveTextContent('"sub": "alice"');
	}}
/>

<Story
	name="REQ-JWT-003 Claims table shows descriptions and no description for unknown claims"
	parameters={{ req: ['REQ-JWT-003'] }}
	args={{ token: validToken }}
	play={async ({ canvas }) => {
		const rows = canvas.getAllByTestId('claim-row');
		const row = (name: string) => rows.find((el) => el.dataset.claim === name);
		await expect(row('iss')).toHaveTextContent(
			'Issuer: identifies the party that issued the token'
		);
		await expect(row('iss')).toHaveTextContent('http://localhost:4455');
		await expect(row('custom_claim')).toHaveTextContent('x');
		await expect(
			row('custom_claim')?.querySelector('[data-testid="claim-description"]')
		).toBeNull();
	}}
/>

<Story
	name="REQ-JWT-004 Future expiry is rendered relative"
	parameters={{ req: ['REQ-JWT-004'] }}
	args={{ token: validToken }}
	play={async ({ canvas }) => {
		const exp = canvas.getAllByTestId('claim-row').find((el) => el.dataset.claim === 'exp');
		await expect(exp).toHaveTextContent('in 59 min');
		await expect(exp).toHaveTextContent(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}/);
	}}
/>

<Story
	name="REQ-JWT-004 Expired token is rendered as expired"
	parameters={{ req: ['REQ-JWT-004'] }}
	args={{ token: expiredToken }}
	play={async ({ canvas }) => {
		const exp = canvas.getAllByTestId('claim-row').find((el) => el.dataset.claim === 'exp');
		await expect(exp).toHaveTextContent('expired 3 min ago');
	}}
/>

<Story
	name="REQ-JWT-009 Signature chip hides details until hovered and copies the full message on click"
	parameters={{ req: ['REQ-JWT-009'] }}
	args={{
		token: validToken,
		validations: [
			{ id: 'sig.id_token', level: 'ok', message: 'Signature valid (RS256, kid key-1)' }
		]
	}}
	play={async ({ canvas, userEvent }) => {
		const badge = canvas.getByTestId('sig-badge');
		await expect(badge).toHaveClass('badge-success');
		await expect(badge).toHaveTextContent('Signature valid');
		const detail = canvas.getByTestId('sig-detail');
		await expect(detail).toHaveTextContent('(RS256, kid key-1)');
		await expect(detail).not.toBeVisible();
		await userEvent.hover(badge);
		await expect(detail).toBeVisible();
		const writeText = fn(async () => {});
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		try {
			await userEvent.click(badge);
			await expect(writeText).toHaveBeenCalledWith('Signature valid (RS256, kid key-1)');
		} finally {
			Reflect.deleteProperty(navigator, 'clipboard');
		}
	}}
/>

<Story
	name="Signature badge reports an invalid signature"
	args={{
		token: validToken,
		validations: [{ id: 'sig.id_token', level: 'error', message: 'Signature is invalid' }]
	}}
	play={async ({ canvas }) => {
		const badge = canvas.getByTestId('sig-badge');
		await expect(badge).toHaveTextContent('Signature is invalid');
		await expect(badge).toHaveClass('badge-danger');
	}}
/>

<Story
	name="Signature badge says not checked when no result exists"
	args={{ token: validToken }}
	play={async ({ canvas }) => {
		await expect(canvas.getByTestId('sig-badge')).toHaveTextContent('Signature not checked');
	}}
/>

<Story
	name="ID token checks are listed, other validations are not"
	args={{
		token: validToken,
		validations: [
			{ id: 'sig.id_token', level: 'ok', message: 'Signature valid' },
			{ id: 'idt.iss', level: 'ok', message: 'iss matches the issuer' },
			{ id: 'idt.nonce', level: 'error', message: 'nonce does not match' },
			{ id: 'sig.access_token', level: 'ok', message: 'access token signature valid' }
		]
	}}
	play={async ({ canvas }) => {
		await expect(canvas.getByText('iss matches the issuer')).toBeVisible();
		await expect(canvas.getByText('nonce does not match')).toBeVisible();
		await expect(canvas.queryByText('access token signature valid')).toBeNull();
	}}
/>

<Story
	name="Access token view hides ID token checks"
	args={{
		label: 'Access token',
		sigId: 'sig.access_token',
		token: validToken,
		validations: [
			{ id: 'sig.access_token', level: 'warn', message: 'No key to verify the signature' },
			{ id: 'idt.iss', level: 'ok', message: 'iss matches the issuer' }
		]
	}}
	play={async ({ canvas }) => {
		await expect(canvas.getByTestId('sig-badge')).toHaveClass('badge-warning');
		await expect(canvas.queryByText('iss matches the issuer')).toBeNull();
	}}
/>

<Story
	name="JWE shows only the header"
	args={{
		token: `${encode({ alg: 'RSA-OAEP', enc: 'A256GCM' })}.a.b.c.d`
	}}
	play={async ({ canvas }) => {
		await expect(canvas.getByText(/encrypted/i)).toBeVisible();
		await expect(canvas.getByTestId('code')).toHaveTextContent('"enc": "A256GCM"');
		await expect(canvas.queryByTestId('claim-row')).toBeNull();
		await expect(canvas.queryByTestId('sig-badge')).toBeNull();
	}}
/>

<Story
	name="Opaque token is shown verbatim"
	args={{ label: 'Access token', token: 'opaque-token-value-123' }}
	play={async ({ canvas }) => {
		await expect(canvas.getByTestId('token-raw')).toHaveTextContent('opaque-token-value-123');
		await expect(canvas.queryByTestId('claim-row')).toBeNull();
	}}
/>

<Story
	name="Malformed token shows the reason"
	args={{ token: 'aaa.bbb' }}
	play={async ({ canvas }) => {
		await expect(canvas.getByTestId('token-malformed')).toHaveTextContent(
			'expected 3 (JWS) or 5 (JWE) dot-separated parts, found 2'
		);
		await expect(canvas.getByTestId('token-raw')).toHaveTextContent('aaa.bbb');
	}}
/>

<Story
	name="Copy token button copies the raw token"
	args={{ token: validToken }}
	play={async ({ canvas, userEvent }) => {
		const writeText = fn(async () => {});
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		try {
			await userEvent.click(canvas.getByRole('button', { name: 'Copy token' }));
			await expect(writeText).toHaveBeenCalledTimes(1);
			await expect(writeText).toHaveBeenCalledWith(validToken);
		} finally {
			Reflect.deleteProperty(navigator, 'clipboard');
		}
	}}
/>

<Story
	name="REQ-UI-012 claim row menu copies the value"
	parameters={{ req: ['REQ-UI-012'] }}
	args={{ token: validToken }}
	play={async ({ canvas, userEvent }) => {
		const writeText = fn(async () => {});
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		try {
			const row = canvas.getAllByTestId('claim-row').find((el) => el.dataset.claim === 'sub');
			row?.dispatchEvent(
				new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 })
			);
			await userEvent.click(await canvas.findByRole('menuitem', { name: 'Copy value' }));
			await expect(writeText).toHaveBeenCalledTimes(1);
			await expect(writeText).toHaveBeenCalledWith('alice');
		} finally {
			Reflect.deleteProperty(navigator, 'clipboard');
		}
	}}
>
	{#snippet template(args)}
		<TokenView {...args} />
		<ContextMenuHost />
	{/snippet}
</Story>
