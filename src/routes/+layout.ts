export const ssr = false;
export const prerender = false;

// Web E2E only: route every Tauri command to the Playwright harness (see src/lib/ipc/e2e.ts).
export async function load(): Promise<void> {
	if (import.meta.env.VITE_E2E === '1') {
		const { installE2eIpc } = await import('$lib/ipc/e2e');
		installE2eIpc();
	}
}
