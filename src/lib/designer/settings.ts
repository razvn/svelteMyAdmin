/**
 * Designer settings, stored per user as JSON in `pma__designer_settings.settings_data`. The keys and the
 * string values are the ones phpMyAdmin's designer writes (js/src/designer/move.js saveValueInConfig),
 * so both applications read each other's settings.
 */

export const DESIGNER_KEYS = [
	'angular_direct',
	'snap_to_grid',
	'relation_lines',
	'full_screen',
	'small_big_all',
	'side_menu',
	'pin_text'
] as const;
export type DesignerKey = (typeof DESIGNER_KEYS)[number];

/** Raw stored settings: every value is a string ('angular' / 'direct', 'on' / 'off', 'true' / 'false', 'v' / '>'). */
export type StoredSettings = Partial<Record<DesignerKey, string>>;

export interface DesignerView {
	angular: boolean;
	snapToGrid: boolean;
	relationLines: boolean;
	fullScreen: boolean;
	/** All cards collapsed ('v' in phpMyAdmin). */
	small: boolean;
	sideMenu: boolean;
	pinText: boolean;
}

export const DEFAULT_VIEW: DesignerView = {
	angular: false,
	snapToGrid: false,
	relationLines: true,
	fullScreen: false,
	small: false,
	sideMenu: false,
	pinText: false
};

export function isDesignerKey(k: string): k is DesignerKey {
	return (DESIGNER_KEYS as readonly string[]).includes(k);
}

/** Parse `settings_data`; anything that is not a JSON object (or has unknown keys / non scalars) is dropped. */
export function parseSettings(json: string | null | undefined): StoredSettings {
	if (!json) return {};
	let data: unknown;
	try {
		data = JSON.parse(json);
	} catch {
		return {};
	}
	if (typeof data !== 'object' || data === null || Array.isArray(data)) return {};
	const out: StoredSettings = {};
	for (const [k, v] of Object.entries(data)) {
		if (!isDesignerKey(k)) continue;
		if (typeof v === 'string') out[k] = v;
		else if (typeof v === 'boolean') out[k] = String(v);
	}
	return out;
}

/** Merge one value into the stored JSON text and keep unknown keys of other applications. */
export function mergeSetting(
	json: string | null | undefined,
	key: DesignerKey,
	value: string
): string {
	let data: Record<string, unknown> = {};
	try {
		const parsed: unknown = json ? JSON.parse(json) : {};
		if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
			data = parsed as Record<string, unknown>;
		}
	} catch {
		data = {};
	}
	data[key] = value;
	return JSON.stringify(data);
}

export function toView(s: StoredSettings): DesignerView {
	return {
		angular: s.angular_direct === 'angular',
		snapToGrid: s.snap_to_grid === 'on',
		relationLines: s.relation_lines !== 'false',
		fullScreen: s.full_screen === 'on',
		small: s.small_big_all === 'v',
		sideMenu: s.side_menu === 'true',
		pinText: s.pin_text === 'true'
	};
}

/** The raw string phpMyAdmin stores for a view option. */
export function settingValue(key: DesignerKey, view: DesignerView): string {
	switch (key) {
		case 'angular_direct':
			return view.angular ? 'angular' : 'direct';
		case 'snap_to_grid':
			return view.snapToGrid ? 'on' : 'off';
		case 'relation_lines':
			return String(view.relationLines);
		case 'full_screen':
			return view.fullScreen ? 'on' : 'off';
		case 'small_big_all':
			return view.small ? 'v' : '>';
		case 'side_menu':
			return String(view.sideMenu);
		case 'pin_text':
			return String(view.pinText);
	}
}
