import {
	newClient,
	newFlow,
	newId,
	newIdp,
	type Client,
	type Flow,
	type FlowType,
	type Idp,
	type Workspace
} from '#lib/model/schema.js';
import type { NewFlowDefaults, NewIdpDefaults } from '#lib/model/settings.js';
import { clientSecretKey, passwordKey } from './secrets';

export interface SecretCopy {
	from: string;
	to: string;
}

/** Deep copy that also works for Svelte `$state` proxies (all model data is JSON). */
function jsonClone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

/** Mutating tree operations on a workspace (works on plain objects and `$state` proxies). */

export function addIdp(ws: Workspace, name?: string, defaults?: NewIdpDefaults): Idp {
	const idp = newIdp(name);
	if (defaults) {
		idp.http.timeoutMs = defaults.timeoutMs;
		idp.http.proxy = { ...defaults.proxy };
		idp.http.tlsInsecure = defaults.tlsInsecure;
	}
	ws.idps.push(idp);
	return idp;
}

export function addClient(idp: Idp, name?: string): Client {
	const client = newClient(name);
	idp.clients.push(client);
	return client;
}

export function addFlow(client: Client, type: FlowType, defaults?: NewFlowDefaults): Flow {
	const flow = newFlow(type);
	if (defaults) flow.params.redirectUri = defaults.redirectUri;
	client.flows.push(flow);
	return flow;
}

function cloneFlow(flow: Flow): { copy: Flow; secretCopies: SecretCopy[] } {
	const copy = jsonClone(flow);
	copy.id = newId();
	const secretCopies: SecretCopy[] = [];
	if (flow.params.hasPassword) {
		secretCopies.push({ from: passwordKey(flow.id), to: passwordKey(copy.id) });
	}
	return { copy, secretCopies };
}

function cloneClient(client: Client): { copy: Client; secretCopies: SecretCopy[] } {
	const copy = jsonClone(client);
	copy.id = newId();
	const secretCopies: SecretCopy[] = [];
	if (client.hasSecret) {
		secretCopies.push({ from: clientSecretKey(client.id), to: clientSecretKey(copy.id) });
	}
	copy.flows = client.flows.map((flow) => {
		const cloned = cloneFlow(flow);
		secretCopies.push(...cloned.secretCopies);
		return cloned.copy;
	});
	return { copy, secretCopies };
}

export function duplicateFlow(
	client: Client,
	flowId: string
): { copy: Flow; secretCopies: SecretCopy[] } {
	const index = client.flows.findIndex((f) => f.id === flowId);
	if (index < 0) throw new Error(`Flow not found: ${flowId}`);
	const { copy, secretCopies } = cloneFlow(client.flows[index]);
	copy.name = `${copy.name} (copy)`;
	client.flows.splice(index + 1, 0, copy);
	return { copy, secretCopies };
}

export function duplicateClient(
	idp: Idp,
	clientId: string
): { copy: Client; secretCopies: SecretCopy[] } {
	const index = idp.clients.findIndex((c) => c.id === clientId);
	if (index < 0) throw new Error(`Client not found: ${clientId}`);
	const { copy, secretCopies } = cloneClient(idp.clients[index]);
	copy.name = `${copy.name} (copy)`;
	idp.clients.splice(index + 1, 0, copy);
	return { copy, secretCopies };
}

export function duplicateIdp(
	ws: Workspace,
	idpId: string
): { copy: Idp; secretCopies: SecretCopy[] } {
	const index = ws.idps.findIndex((i) => i.id === idpId);
	if (index < 0) throw new Error(`IdP not found: ${idpId}`);
	const copy = jsonClone(ws.idps[index]);
	copy.id = newId();
	copy.name = `${copy.name} (copy)`;
	const secretCopies: SecretCopy[] = [];
	copy.clients = ws.idps[index].clients.map((client) => {
		const cloned = cloneClient(client);
		secretCopies.push(...cloned.secretCopies);
		return cloned.copy;
	});
	ws.idps.splice(index + 1, 0, copy);
	return { copy, secretCopies };
}

/** Keychain keys holding the secrets of `client` (its secret and its flows' passwords). */
function clientSecretKeys(client: Client): string[] {
	return [
		...(client.hasSecret ? [clientSecretKey(client.id)] : []),
		...client.flows.filter((f) => f.params.hasPassword).map((f) => passwordKey(f.id))
	];
}

/** Removes the flow; returns the keychain keys that held its secrets. */
export function deleteFlow(client: Client, flowId: string): string[] {
	const index = client.flows.findIndex((f) => f.id === flowId);
	if (index < 0) return [];
	const [removed] = client.flows.splice(index, 1);
	return removed.params.hasPassword ? [passwordKey(removed.id)] : [];
}

/** Removes the client with its flows; returns the keychain keys that held their secrets. */
export function deleteClient(idp: Idp, clientId: string): string[] {
	const index = idp.clients.findIndex((c) => c.id === clientId);
	if (index < 0) return [];
	const [removed] = idp.clients.splice(index, 1);
	return clientSecretKeys(removed);
}

export function deleteIdp(ws: Workspace, idpId: string): string[] {
	const index = ws.idps.findIndex((i) => i.id === idpId);
	if (index < 0) return [];
	const [removed] = ws.idps.splice(index, 1);
	return removed.clients.flatMap(clientSecretKeys);
}
