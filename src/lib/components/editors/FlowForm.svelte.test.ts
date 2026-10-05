import { page } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Flow, FlowType, Idp } from '#lib/model/schema.js';
import type { Run } from '#lib/model/run.js';
import type { DeviceUserCode } from '#lib/oauth/device.js';
import { createMemoryIpc, type MemoryIpc } from '#lib/testing/memoryIpc.js';
import { WorkspaceStore } from '#lib/state/workspace.svelte.js';
import { SECTIONS_STORAGE_KEY, resetSectionMemory } from '#lib/state/sections.svelte.js';
import '../../../app.css';
import FlowForm from './FlowForm.svelte';

let ipc: MemoryIpc;
let store: WorkspaceStore;
let idp: Idp;

beforeEach(async () => {
	localStorage.removeItem(SECTIONS_STORAGE_KEY);
	resetSectionMemory();
	ipc = createMemoryIpc();
	store = new WorkspaceStore(ipc);
	await store.init();
	const added = store.addIdp()!;
	idp = store.current!.idps.find((i) => i.id === added.id)!;
	idp.issuer = 'https://idp.example';
	idp.endpoints.authorization = 'https://idp.example/authorize';
	idp.client.clientId = 'my-client';
});
afterEach(() => store.dispose());

interface Overrides {
	runs?: Run[];
	running?: boolean;
	deviceCode?: DeviceUserCode | null;
	onrun?: () => void;
	oncancel?: () => void;
}

async function mount(type: FlowType, over: Overrides = {}): Promise<Flow> {
	const added = store.addFlow(idp.id, type)!;
	const flow = idp.flows.find((f) => f.id === added.id)!;
	await render(FlowForm, {
		idp,
		flow,
		store,
		ipc,
		runs: over.runs ?? [],
		running: over.running ?? false,
		deviceCode: over.deviceCode ?? null,
		onrun: over.onrun ?? vi.fn(),
		oncancel: over.oncancel ?? vi.fn()
	});
	return flow;
}

const preview = () => page.getByTestId('authorize-preview');

function runWith(flow: Flow, refresh: string | undefined, id: string): Run {
	return {
		id,
		workspaceId: 'w',
		idpId: idp.id,
		flowId: flow.id,
		flowSnapshot: $state.snapshot(flow),
		idpSnapshot: $state.snapshot(idp),
		startedAt: '2026-01-01T00:00:00Z',
		finishedAt: '2026-01-01T00:00:01Z',
		status: 'success',
		navigations: [],
		exchanges: [],
		failures: [],
		validations: [],
		tokens: refresh ? { refresh_token: refresh, raw: {} } : { raw: {} }
	};
}

describe('FlowForm', () => {
	it('REQ-FLOW-013 client_credentials shows only its matrix fields plus headers', async () => {
		await mount('client_credentials');
		await expect.element(page.getByLabelText('Audience')).toBeVisible();
		await expect.element(page.getByLabelText('Resource')).toBeVisible();
		await expect.element(page.getByText('Extra token params')).toBeVisible();
		await expect.element(page.getByText('Flow headers')).toBeVisible();
		expect(page.getByLabelText('Redirect URI').query()).toBeNull();
		expect(page.getByLabelText('Nonce', { exact: true }).query()).toBeNull();
		expect(page.getByText('Authorize URL').query()).toBeNull();
	});

	it('REQ-FLOW-013 password shows username and a secret field wired to the keychain', async () => {
		const flow = await mount('password');
		await expect.element(page.getByLabelText('Username')).toBeVisible();
		await page.getByLabelText('Password').fill('hunter2');
		await page.getByLabelText('Username').click();
		await vi.waitFor(() => expect(flow.params.hasPassword).toBe(true));
		expect(ipc.secrets.get(`flow:${flow.id}:password`)).toBe('hunter2');
		await page.getByRole('button', { name: 'Clear' }).click();
		await vi.waitFor(() => expect(flow.params.hasPassword).toBe(false));
	});

	it('REQ-FLOW-013 PKCE method and verifier only for authorization_code_pkce', async () => {
		await mount('authorization_code_pkce');
		await expect.element(page.getByLabelText('PKCE method')).toBeVisible();
		await expect.element(page.getByLabelText('Code verifier')).toBeVisible();
	});

	it('REQ-FLOW-013 plain authorization_code hides PKCE fields', async () => {
		await mount('authorization_code');
		await expect.element(page.getByLabelText('Redirect URI')).toBeVisible();
		expect(page.getByLabelText('PKCE method').query()).toBeNull();
		expect(page.getByLabelText('Code verifier').query()).toBeNull();
	});

	it('REQ-CAP-006 warns for a custom-scheme redirect URI and not for http(s)', async () => {
		await mount('authorization_code');
		const field = page.getByLabelText('Redirect URI');
		await field.fill('myapp://cb');
		await expect
			.element(page.getByRole('alert'))
			.toMatchTextContent(
				'Custom-scheme redirect URIs may not be capturable on this platform; use http(s).'
			);
		await field.fill('https://spoofed.invalid/cb');
		await vi.waitFor(() => expect(page.getByRole('alert').query()).toBeNull());
	});

	it('REQ-AUTHZ-008 preview follows edits and Copy puts it on the clipboard', async () => {
		await mount('authorization_code');
		await expect.element(preview()).toMatchTextContent('client_id=my-client');
		await page.getByLabelText('Scope').fill('openid custom');
		await expect.element(preview()).toMatchTextContent(/scope=openid(\+|%20)custom/);

		const written: string[] = [];
		vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(async (text) => {
			written.push(text);
		});
		await page.getByRole('button', { name: 'Copy' }).click();
		await vi.waitFor(() => expect(written).toHaveLength(1));
		expect(written[0]).toMatch(/^https:\/\/idp\.example\/authorize\?/);
		expect(written[0]).toContain('client_id=my-client');
	});

	it('REQ-PKCE-004 Regenerate replaces the verifier and the preview code_challenge', async () => {
		await mount('authorization_code_pkce');
		const verifier = page.getByLabelText('Code verifier');
		await vi.waitFor(() => expect((verifier.element() as HTMLInputElement).value).toHaveLength(64));
		const before = (verifier.element() as HTMLInputElement).value;
		expect(before).toMatch(/^[A-Za-z0-9\-._~]{64}$/);
		const challengeBefore = /code_challenge=([^&]+)/.exec(
			preview().element().textContent ?? ''
		)![1];

		await page.getByRole('button', { name: 'Regenerate' }).click();
		await vi.waitFor(() => expect((verifier.element() as HTMLInputElement).value).not.toBe(before));
		await vi.waitFor(() =>
			expect(/code_challenge=([^&]+)/.exec(preview().element().textContent ?? '')![1]).not.toBe(
				challengeBefore
			)
		);
	});

	it('REQ-DISC-005 lists a warning naming an unsupported grant type', async () => {
		idp.discovery = { grant_types_supported: ['client_credentials'] };
		await mount('authorization_code');
		await expect.element(page.getByText(/authorization_code/).first()).toBeVisible();
		await expect
			.element(page.getByRole('list', { name: 'Discovery warnings' }))
			.toMatchTextContent('Grant type "authorization_code" is not listed');
	});

	it('REQ-DISC-005 shows no warning when the lists contain the value', async () => {
		idp.discovery = {
			grant_types_supported: ['authorization_code'],
			response_types_supported: ['code']
		};
		await mount('authorization_code');
		await expect.element(page.getByLabelText('Redirect URI')).toBeVisible();
		expect(page.getByRole('list', { name: 'Discovery warnings' }).query()).toBeNull();
	});

	it('REQ-FLOW-007 "Use from run…" lists only runs with a refresh token and fills the field', async () => {
		const added = store.addFlow(idp.id, 'refresh_token')!;
		const flow = idp.flows.find((f) => f.id === added.id)!;
		const runs = [runWith(flow, 'rt-abc', 'r1'), runWith(flow, undefined, 'r2')];
		await render(FlowForm, {
			idp,
			flow,
			store,
			ipc,
			runs,
			running: false,
			deviceCode: null,
			onrun: vi.fn(),
			oncancel: vi.fn()
		});
		const picker = page.getByLabelText('Use from run');
		expect((picker.element() as HTMLSelectElement).options).toHaveLength(2);
		await picker.selectOptions((picker.element() as HTMLSelectElement).options[1].value);
		await expect.element(page.getByLabelText('Refresh token')).toHaveValue('rt-abc');
		expect(flow.params.refreshToken).toBe('rt-abc');
	});

	it('run bar: Run is disabled while running and Cancel appears', async () => {
		const oncancel = vi.fn();
		await mount('client_credentials', { running: true, oncancel });
		await expect.element(page.getByRole('button', { name: /Running/ })).toBeDisabled();
		await page.getByRole('button', { name: 'Cancel' }).click();
		expect(oncancel).toHaveBeenCalledOnce();
	});

	it('REQ-UI-014 flow sections: Advanced is collapsed by default, omitted when empty, and counts set fields', async () => {
		await mount('client_credentials');
		expect(page.getByRole('button', { name: 'Advanced', exact: true }).query()).toBeNull();
		for (const title of ['Request', 'Extra parameters & headers']) {
			await expect
				.element(page.getByRole('button', { name: title, exact: true }))
				.toHaveAttribute('aria-expanded', 'true');
		}
	});

	it('REQ-UI-014 Advanced holds the optional authorize params and persists being opened', async () => {
		const flow = await mount('authorization_code');
		flow.params.prompt = 'login';
		const advanced = page.getByRole('button', { name: 'Advanced', exact: true });
		await expect.element(advanced).toHaveAttribute('aria-expanded', 'false');
		expect(page.getByLabelText('Prompt').query()).toBeNull();
		await expect.element(page.getByText('1 set')).toBeVisible();

		await advanced.click();
		await expect.element(page.getByLabelText('Prompt')).toHaveValue('login');
		expect(localStorage.getItem(SECTIONS_STORAGE_KEY) ?? '').toContain('"flow.advanced":true');
	});

	it('REQ-UI-015 the action bar keeps Run and the authorize preview together', async () => {
		await mount('authorization_code');
		const run = page.getByRole('button', { name: 'Run', exact: true }).element();
		const bar = run.parentElement!;
		expect(getComputedStyle(bar).position).toBe('sticky');
		await expect.element(preview()).toBeVisible();
		expect(bar.contains(preview().element())).toBe(true);
		expect(bar.contains(page.getByRole('button', { name: 'Copy' }).element())).toBe(true);

		await page.getByRole('button', { name: 'Show full URL' }).click();
		await expect.element(page.getByRole('button', { name: 'Hide full URL' })).toBeVisible();
	});

	it('run bar: shows the device user code, opens the verification URI and counts down', async () => {
		await mount('device_code', {
			deviceCode: {
				userCode: 'WDJB-MJHT',
				verificationUri: 'https://idp.example/device',
				expiresAt: Date.now() + 120_000,
				interval: 5
			}
		});
		await expect.element(page.getByTestId('user-code')).toMatchTextContent('WDJB-MJHT');
		await expect.element(page.getByText(/Expires in 1[12]\ds/)).toBeVisible();
		await page.getByRole('button', { name: 'https://idp.example/device' }).click();
		expect(ipc.opened).toEqual(['https://idp.example/device']);
	});
});
