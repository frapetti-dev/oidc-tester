import type { FlowType } from '$lib/model/schema';

export interface SidebarWorkspace {
	id: string;
	name: string;
}

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
