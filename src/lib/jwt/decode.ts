import { base64url } from 'jose';

export type JsonObject = Record<string, unknown>;

export type InspectedToken =
	| {
			kind: 'jws';
			header: JsonObject;
			payload: JsonObject;
			signature: string;
			parts: [string, string, string];
	  }
	| { kind: 'jwe'; header: JsonObject }
	| { kind: 'opaque' }
	| { kind: 'malformed'; reason: string };

export type TokenSegment = {
	part: 'header' | 'payload' | 'signature' | 'separator' | 'raw';
	text: string;
};

const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]*$/;

/** Decodes one base64url segment holding a JSON object; returns the reason on failure. */
function decodeJsonObject(segment: string, label: string): JsonObject | string {
	let text: string;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(base64url.decode(segment));
	} catch {
		return `${label} is not valid base64url text`;
	}
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return `${label} is not valid JSON`;
	}
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return `${label} is not a JSON object`;
	}
	return value as JsonObject;
}

/** REQ-JWT-001: classify a token string as JWS, JWE, opaque or malformed. */
export function inspectToken(token: string): InspectedToken {
	const trimmed = token.trim();
	const parts = trimmed.split('.');
	const dotted = parts.length > 1 && parts.every((part) => BASE64URL_SEGMENT.test(part));

	if (parts.length === 3) {
		const header = decodeJsonObject(parts[0], 'JWS header');
		if (typeof header === 'string') return { kind: 'malformed', reason: header };
		const payload = decodeJsonObject(parts[1], 'JWS payload');
		if (typeof payload === 'string') return { kind: 'malformed', reason: payload };
		return {
			kind: 'jws',
			header,
			payload,
			signature: parts[2],
			parts: [parts[0], parts[1], parts[2]]
		};
	}
	if (parts.length === 5) {
		const header = decodeJsonObject(parts[0], 'JWE header');
		if (typeof header === 'string') return { kind: 'malformed', reason: header };
		return { kind: 'jwe', header };
	}
	if (dotted) {
		return {
			kind: 'malformed',
			reason: `expected 3 (JWS) or 5 (JWE) dot-separated parts, found ${parts.length}`
		};
	}
	return { kind: 'opaque' };
}

/** REQ-JWT-002: segments of an encoded JWS for color coding; other tokens are one raw segment. */
export function splitTokenSegments(token: string): TokenSegment[] {
	const inspected = inspectToken(token);
	if (inspected.kind !== 'jws') return [{ part: 'raw', text: token }];
	const [header, payload, signature] = inspected.parts;
	return [
		{ part: 'header', text: header },
		{ part: 'separator', text: '.' },
		{ part: 'payload', text: payload },
		{ part: 'separator', text: '.' },
		{ part: 'signature', text: signature }
	];
}

/** REQ-JWT-002: decoded header/payload display. */
export function prettyJson(value: unknown): string {
	return JSON.stringify(value, null, 2);
}
