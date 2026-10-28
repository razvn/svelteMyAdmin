import {
	resolveDbTab,
	resolveServerTab,
	resolveTableTab,
	type NavConfig
} from '#lib/nav/config.ts';
import type { AppConfig } from '../config/schema';

/** The browser-visible navigation settings derived from the phpMyAdmin style config. */
export function toNavConfig(c: AppConfig): NavConfig {
	return {
		groupingEnabled: c.NavigationTreeEnableGrouping,
		dbSeparator: c.NavigationTreeDbSeparator,
		dbFilterMinimum: c.NavigationTreeDisplayDbFilterMinimum,
		itemFilterMinimum: c.NavigationTreeDisplayItemFilterMinimum,
		maxItems: Math.max(1, c.MaxNavigationItems),
		firstLevelItems: Math.max(1, c.FirstLevelNavigationItems),
		defaultTabTable: resolveTableTab(c.DefaultTabTable),
		quickTabTable: resolveTableTab(c.NavigationTreeDefaultTabTable),
		defaultTabDatabase: resolveDbTab(c.DefaultTabDatabase),
		defaultTabServer: resolveServerTab(c.DefaultTabServer),
		showTables: c.NavigationTreeShowTables,
		showViews: c.NavigationTreeShowViews,
		showFunctions: c.NavigationTreeShowFunctions,
		showProcedures: c.NavigationTreeShowProcedures,
		showEvents: c.NavigationTreeShowEvents,
		expansionEnabled: c.NavigationTreeEnableExpansion,
		autoexpandSingleDb: c.NavigationTreeAutoexpandSingleDb,
		width: Math.min(640, Math.max(160, c.NavigationWidth || 240)),
		displayLogo: c.NavigationDisplayLogo
	};
}
