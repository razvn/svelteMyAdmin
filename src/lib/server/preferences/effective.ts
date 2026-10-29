/**
 * The effective configuration of a request: the server config (config.json) overlaid with the user's
 * preferences. Only keys allowed by the preference forms and not in `UserprefsDisallow` take effect and
 * every value is validated (descriptor, then the zod config schema), like Config::loadUserPreferences.
 */
import { configSchema, type AppConfig, type ServerConfig } from '#lib/server/config/schema.ts';
import { overlayPrefs, sanitizePrefs, type PrefData } from '#lib/preferences/logic.ts';

export interface EffectiveConfig {
	config: AppConfig;
	/** Per-user overrides of the active server definition (`Server/hide_db`, `Server/only_db`). */
	serverOverrides: Partial<Pick<ServerConfig, 'hide_db' | 'only_db'>>;
	/** The prefs that were applied (sanitized). */
	applied: PrefData;
}

/** Sanitize with the rules of the given server config. */
export function sanitizeForConfig(base: AppConfig, data: PrefData, serverIndex: number): PrefData {
	return sanitizePrefs(data, {
		disallow: base.UserprefsDisallow,
		developerTab: base.UserprefsDeveloperTab,
		base: base as unknown as Record<string, unknown>,
		serverIndex
	});
}

export function buildEffectiveConfig(
	base: AppConfig,
	data: PrefData,
	serverIndex: number
): EffectiveConfig {
	const applied = sanitizeForConfig(base, data, serverIndex);
	if (Object.keys(applied).length === 0) return { config: base, serverOverrides: {}, applied };

	const baseRecord = base as unknown as Record<string, unknown>;
	const tryApply = (prefs: PrefData): AppConfig | null => {
		const parsed = configSchema.safeParse(overlayPrefs(baseRecord, prefs, serverIndex));
		return parsed.success ? parsed.data : null;
	};

	let config = tryApply(applied);
	let kept = applied;
	if (!config) {
		// A value the descriptors accept but the config schema refuses: keep the valid ones only.
		kept = {};
		for (const [k, v] of Object.entries(applied)) {
			if (tryApply({ ...kept, [k]: v })) kept[k] = v;
		}
		config = tryApply(kept) ?? base;
	}

	const overrides: EffectiveConfig['serverOverrides'] = {};
	if (typeof kept['Server/hide_db'] === 'string') overrides.hide_db = kept['Server/hide_db'];
	if (typeof kept['Server/only_db'] === 'string') overrides.only_db = kept['Server/only_db'];
	return { config, serverOverrides: overrides, applied: kept };
}
