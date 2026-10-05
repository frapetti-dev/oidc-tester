import type { FlowType } from '#lib/model/schema.js';

export interface WorkspaceSummary {
	id: string;
	name: string;
}

/** REQ-UI-008: state shown by the titlebar run indicator. */
export type RunIndicatorState = 'idle' | 'running' | 'success' | 'error';

export interface SidebarFlow {
	id: string;
	name: string;
	type: FlowType;
}

export interface SidebarIdp {
	id: string;
	name: string;
	flows: SidebarFlow[];
}
