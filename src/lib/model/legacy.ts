import { z } from 'zod';

/**
 * Files written before clients existed (REQ-WS-011) stored `client` and `flows` directly on the
 * IdP and runs had no `clientId`. The migrated client reuses the IdP's id, so runs, snapshots and
 * keychain keys line up without any lookup table. Remove once such files no longer need to load.
 */

/** An IdP that still has `client` + `flows` and no `clients`. */
const LegacyIdp = z.looseObject({
	id: z.string(),
	client: z.record(z.string(), z.unknown()),
	flows: z.array(z.unknown()),
	clients: z.undefined().optional()
});

/** A run without `clientId`. */
const LegacyRun = z.looseObject({ idpId: z.string(), clientId: z.undefined().optional() });

const RawWorkspace = z.looseObject({ idps: z.array(z.unknown()) });

export function migrateLegacyIdp(value: unknown): unknown {
	const legacy = LegacyIdp.safeParse(value);
	if (!legacy.success) return value;
	const { client, flows, clients: _none, ...rest } = legacy.data;
	return { ...rest, clients: [{ ...client, id: rest.id, name: 'Default client', flows }] };
}

export function migrateLegacyRun(value: unknown): unknown {
	const legacy = LegacyRun.safeParse(value);
	return legacy.success ? { ...legacy.data, clientId: legacy.data.idpId } : value;
}

/** Ids of the IdPs of a raw workspace document that are still in the pre-clients shape. */
export function legacyIdpIds(rawWorkspace: unknown): string[] {
	const workspace = RawWorkspace.safeParse(rawWorkspace);
	if (!workspace.success) return [];
	return workspace.data.idps.flatMap((idp) => {
		const legacy = LegacyIdp.safeParse(idp);
		return legacy.success ? [legacy.data.id] : [];
	});
}

export const legacyClientSecretKey = (idpId: string) => `idp:${idpId}:client_secret`;
