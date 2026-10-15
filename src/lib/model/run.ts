import { z } from 'zod';
import { migrateLegacyRun } from './legacy';
import { FlowSchema, IdpSchema } from './schema';

const HeaderSchema = z.tuple([z.string(), z.string()]);

const RecordedRequestSchema = z.object({
	method: z.string(),
	url: z.string(),
	headers: z.array(HeaderSchema),
	body: z.string().nullable()
});

export const HttpExchangeSchema = z.object({
	id: z.string(),
	startedAt: z.string(),
	durationMs: z.number(),
	request: RecordedRequestSchema,
	response: z.object({
		status: z.number(),
		statusText: z.string(),
		httpVersion: z.string(),
		headers: z.array(HeaderSchema),
		body: z.string(),
		bodyBase64: z.string().nullable()
	})
});

export const HttpFailureSchema = z.object({
	kind: z.enum(['invalidRequest', 'tls', 'dns', 'connect', 'timeout', 'proxy', 'other']),
	message: z.string(),
	request: RecordedRequestSchema
});

export const RunErrorSourceSchema = z.enum([
	'authorization',
	'token',
	'network',
	'tls',
	'validation',
	'user'
]);
export type RunErrorSource = z.infer<typeof RunErrorSourceSchema>;

export const RunErrorSchema = z.object({
	source: RunErrorSourceSchema,
	error: z.string(),
	error_description: z.string().optional(),
	error_uri: z.string().optional(),
	httpStatus: z.number().optional(),
	detail: z.string().optional()
});
export type RunError = z.infer<typeof RunErrorSchema>;

export const ValidationSchema = z.object({
	id: z.string(),
	level: z.enum(['ok', 'warn', 'error']),
	message: z.string()
});
export type Validation = z.infer<typeof ValidationSchema>;

export const CallbackResultSchema = z.object({
	code: z.string().optional(),
	access_token: z.string().optional(),
	id_token: z.string().optional(),
	token_type: z.string().optional(),
	expires_in: z.string().optional(),
	scope: z.string().optional(),
	state: z.string().optional(),
	error: z.string().optional(),
	error_description: z.string().optional(),
	error_uri: z.string().optional(),
	iss: z.string().optional(),
	raw: z.record(z.string(), z.string())
});
export type CallbackResult = z.infer<typeof CallbackResultSchema>;

export const TokensSchema = z.object({
	access_token: z.string().optional(),
	id_token: z.string().optional(),
	refresh_token: z.string().optional(),
	token_type: z.string().optional(),
	expires_in: z.number().optional(),
	scope: z.string().optional(),
	raw: z.record(z.string(), z.unknown())
});
export type Tokens = z.infer<typeof TokensSchema>;

export const RunSchema = z.preprocess(
	migrateLegacyRun,
	z.object({
		id: z.string(),
		workspaceId: z.string(),
		idpId: z.string(),
		clientId: z.string(),
		flowId: z.string(),
		flowSnapshot: FlowSchema,
		idpSnapshot: IdpSchema,
		startedAt: z.string(),
		finishedAt: z.string(),
		status: z.enum(['success', 'error', 'cancelled']),
		authorizeUrl: z.string().optional(),
		navigations: z.array(z.object({ url: z.string(), at: z.string() })),
		callback: CallbackResultSchema.optional(),
		exchanges: z.array(HttpExchangeSchema),
		failures: z.array(HttpFailureSchema),
		tokens: TokensSchema.optional(),
		error: RunErrorSchema.optional(),
		validations: z.array(ValidationSchema)
	})
);
export type Run = z.infer<typeof RunSchema>;
