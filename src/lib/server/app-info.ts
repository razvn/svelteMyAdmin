import { VERSION as KIT_VERSION } from '@sveltejs/kit';
import mysql2Package from 'mysql2/package.json' with { type: 'json' };
import appPackage from '../../../package.json' with { type: 'json' };

/** Versions shown on the home page ("Web server" and "svelteMyAdmin" cards). */
export function getAppInfo() {
	return {
		appVersion: appPackage.version,
		nodeVersion: process.version,
		mysql2Version: mysql2Package.version,
		kitVersion: KIT_VERSION
	};
}
