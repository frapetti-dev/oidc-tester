import { z } from 'zod';
import { THEME_MODES } from '#lib/theme/theme.js';
import { HttpSettingsSchema } from './schema';

export const SETTINGS_DOC = 'settings.json';

export const SettingsSchema = z.object({
	schemaVersion: z.literal(1),
	newIdp: z.object({
		timeoutMs: z.number().int().positive(),
		proxy: HttpSettingsSchema.shape.proxy,
		tlsInsecure: z.boolean()
	}),
	newFlow: z.object({ redirectUri: z.string() }),
	runHistoryLimit: z.number().int().min(0)
});
export type Settings = z.infer<typeof SettingsSchema>;
export type NewIdpDefaults = Settings['newIdp'];
export type NewFlowDefaults = Settings['newFlow'];

/** Settings as carried in an export file: the app settings plus the theme. */
export const BundleSettingsSchema = SettingsSchema.extend({ theme: z.enum(THEME_MODES) });
export type BundleSettings = z.infer<typeof BundleSettingsSchema>;

export function newSettings(): Settings {
	return {
		schemaVersion: 1,
		newIdp: { timeoutMs: 30000, proxy: { mode: 'system', url: '' }, tlsInsecure: false },
		newFlow: { redirectUri: 'http://localhost:8080/callback' },
		runHistoryLimit: 200
	};
}
