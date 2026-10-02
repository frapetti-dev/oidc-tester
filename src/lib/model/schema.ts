import { z } from 'zod';

export const SCHEMA_VERSION = 1;
export const SCRATCHPAD_ID = 'scratchpad';

export const KVSchema = z.object({
	name: z.string(),
	value: z.string(),
	enabled: z.boolean()
});
export type KV = z.infer<typeof KVSchema>;

export const FLOW_TYPES = [
	'authorization_code',
	'authorization_code_pkce',
	'implicit',
	'hybrid',
	'client_credentials',
	'password',
	'refresh_token',
	'device_code'
] as const;
export const FlowTypeSchema = z.enum(FLOW_TYPES);
export type FlowType = z.infer<typeof FlowTypeSchema>;

export const ClientAuthSchema = z.enum([
	'none',
	'client_secret_basic',
	'client_secret_post',
	'client_secret_jwt'
]);
export type ClientAuth = z.infer<typeof ClientAuthSchema>;

export const HttpSettingsSchema = z.object({
	headers: z.array(KVSchema),
	tlsInsecure: z.boolean(),
	proxy: z.object({ mode: z.enum(['none', 'system', 'url']), url: z.string() }),
	timeoutMs: z.number().int().positive().default(30000),
	origin: z.string(),
	corsCheck: z.boolean()
});
export type HttpSettings = z.infer<typeof HttpSettingsSchema>;

export const EndpointsSchema = z.object({
	authorization: z.string(),
	token: z.string(),
	userinfo: z.string(),
	jwks: z.string(),
	deviceAuthorization: z.string(),
	endSession: z.string()
});
export type Endpoints = z.infer<typeof EndpointsSchema>;

export const FlowParamsSchema = z.object({
	redirectUri: z.string(),
	scope: z.string(),
	responseType: z.string(),
	responseMode: z.enum(['', 'query', 'fragment']),
	state: z.object({ mode: z.enum(['auto', 'fixed']), value: z.string() }),
	nonce: z.object({ mode: z.enum(['auto', 'fixed', 'off']), value: z.string() }),
	pkceMethod: z.enum(['S256', 'plain']),
	usePkce: z.boolean(),
	prompt: z.string(),
	loginHint: z.string(),
	maxAge: z.string(),
	acrValues: z.string(),
	uiLocales: z.string(),
	claims: z.string(),
	audience: z.string(),
	resource: z.string(),
	username: z.string(),
	hasPassword: z.boolean(),
	refreshToken: z.string(),
	extraAuthParams: z.array(KVSchema),
	extraTokenParams: z.array(KVSchema)
});
export type FlowParams = z.infer<typeof FlowParamsSchema>;

export const FlowSchema = z.object({
	id: z.string(),
	name: z.string(),
	type: FlowTypeSchema,
	cleanSession: z.boolean(),
	headers: z.array(KVSchema),
	params: FlowParamsSchema
});
export type Flow = z.infer<typeof FlowSchema>;

export const IdpSchema = z.object({
	id: z.string(),
	name: z.string(),
	issuer: z.string(),
	discovery: z.record(z.string(), z.unknown()).nullable(),
	discoveredAt: z.string().nullable(),
	endpoints: EndpointsSchema,
	client: z.object({
		clientId: z.string(),
		auth: ClientAuthSchema,
		hasSecret: z.boolean(),
		jwtAlg: z.enum(['HS256', 'HS384', 'HS512'])
	}),
	http: HttpSettingsSchema,
	flows: z.array(FlowSchema)
});
export type Idp = z.infer<typeof IdpSchema>;

export const WorkspaceSchema = z.object({
	schemaVersion: z.literal(SCHEMA_VERSION),
	id: z.string(),
	name: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
	idps: z.array(IdpSchema)
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

const RESPONSE_TYPE_DEFAULTS: Record<FlowType, string> = {
	authorization_code: 'code',
	authorization_code_pkce: 'code',
	implicit: 'id_token token',
	hybrid: 'code id_token',
	client_credentials: '',
	password: '',
	refresh_token: '',
	device_code: ''
};

export const FLOW_TYPE_LABELS: Record<FlowType, string> = {
	authorization_code: 'Authorization Code',
	authorization_code_pkce: 'Authorization Code + PKCE',
	implicit: 'Implicit',
	hybrid: 'Hybrid',
	client_credentials: 'Client Credentials',
	password: 'Password (ROPC)',
	refresh_token: 'Refresh Token',
	device_code: 'Device Code'
};

export function newId(): string {
	return crypto.randomUUID();
}

export function newHttpSettings(): HttpSettings {
	return {
		headers: [],
		tlsInsecure: false,
		proxy: { mode: 'system', url: '' },
		timeoutMs: 30000,
		origin: '',
		corsCheck: false
	};
}

export function newFlow(type: FlowType): Flow {
	return {
		id: newId(),
		name: FLOW_TYPE_LABELS[type],
		type,
		cleanSession: false,
		headers: [],
		params: {
			redirectUri: 'http://localhost:8080/callback',
			scope: type === 'client_credentials' ? '' : 'openid profile email',
			responseType: RESPONSE_TYPE_DEFAULTS[type],
			responseMode: '',
			state: { mode: 'auto', value: '' },
			nonce: { mode: 'auto', value: '' },
			pkceMethod: 'S256',
			usePkce: type === 'authorization_code_pkce',
			prompt: '',
			loginHint: '',
			maxAge: '',
			acrValues: '',
			uiLocales: '',
			claims: '',
			audience: '',
			resource: '',
			username: '',
			hasPassword: false,
			refreshToken: '',
			extraAuthParams: [],
			extraTokenParams: []
		}
	};
}

export function newIdp(name = 'New IdP'): Idp {
	return {
		id: newId(),
		name,
		issuer: '',
		discovery: null,
		discoveredAt: null,
		endpoints: {
			authorization: '',
			token: '',
			userinfo: '',
			jwks: '',
			deviceAuthorization: '',
			endSession: ''
		},
		client: { clientId: '', auth: 'none', hasSecret: false, jwtAlg: 'HS256' },
		http: newHttpSettings(),
		flows: []
	};
}

export function newWorkspace(name: string, id: string = newId()): Workspace {
	const now = new Date().toISOString();
	return { schemaVersion: SCHEMA_VERSION, id, name, createdAt: now, updatedAt: now, idps: [] };
}

export function newScratchpad(): Workspace {
	return newWorkspace('Scratchpad', SCRATCHPAD_ID);
}

export function secretKeys(ws: Workspace): string[] {
	return ws.idps.flatMap((idp) => [
		`idp:${idp.id}:client_secret`,
		...idp.flows.map((f) => `flow:${f.id}:password`)
	]);
}
