import {
	newFlow,
	newId,
	newIdp,
	type Flow,
	type FlowType,
	type Idp,
	type Workspace
} from '#lib/model/schema.js';
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

export function addIdp(ws: Workspace, name?: string): Idp {
	const idp = newIdp(name);
	ws.idps.push(idp);
	return idp;
}

export function addFlow(idp: Idp, type: FlowType): Flow {
	const flow = newFlow(type);
	idp.flows.push(flow);
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

export function duplicateFlow(
	idp: Idp,
	flowId: string
): { copy: Flow; secretCopies: SecretCopy[] } {
	const index = idp.flows.findIndex((f) => f.id === flowId);
	if (index < 0) throw new Error(`Flow not found: ${flowId}`);
	const { copy, secretCopies } = cloneFlow(idp.flows[index]);
	copy.name = `${copy.name} (copy)`;
	idp.flows.splice(index + 1, 0, copy);
	return { copy, secretCopies };
}

export function duplicateIdp(
	ws: Workspace,
	idpId: string
): { copy: Idp; secretCopies: SecretCopy[] } {
	const index = ws.idps.findIndex((i) => i.id === idpId);
	if (index < 0) throw new Error(`IdP not found: ${idpId}`);
	const source = ws.idps[index];
	const copy = jsonClone(source);
	copy.id = newId();
	copy.name = `${copy.name} (copy)`;
	const secretCopies: SecretCopy[] = [];
	if (source.client.hasSecret) {
		secretCopies.push({ from: clientSecretKey(source.id), to: clientSecretKey(copy.id) });
	}
	copy.flows = source.flows.map((flow) => {
		const cloned = cloneFlow(flow);
		secretCopies.push(...cloned.secretCopies);
		return cloned.copy;
	});
	ws.idps.splice(index + 1, 0, copy);
	return { copy, secretCopies };
}

/** Removes the flow; returns the keychain keys that held its secrets. */
export function deleteFlow(idp: Idp, flowId: string): string[] {
	const index = idp.flows.findIndex((f) => f.id === flowId);
	if (index < 0) return [];
	const [removed] = idp.flows.splice(index, 1);
	return removed.params.hasPassword ? [passwordKey(removed.id)] : [];
}

export function deleteIdp(ws: Workspace, idpId: string): string[] {
	const index = ws.idps.findIndex((i) => i.id === idpId);
	if (index < 0) return [];
	const [removed] = ws.idps.splice(index, 1);
	return [
		...(removed.client.hasSecret ? [clientSecretKey(removed.id)] : []),
		...removed.flows.filter((f) => f.params.hasPassword).map((f) => passwordKey(f.id))
	];
}
