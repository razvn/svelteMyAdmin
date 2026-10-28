import { describe, expect, it } from 'vitest';
import { detectServerType, versionToInt } from './dbi';

describe('server detection', () => {
	it('detects the flavour', () => {
		expect(detectServerType('8.4.4', 'MySQL Community Server - GPL')).toBe('MySQL');
		expect(detectServerType('11.4.2-MariaDB-ubu2404', 'mariadb.org binary distribution')).toBe(
			'MariaDB'
		);
		expect(detectServerType('8.0.36-28', 'Percona Server (GPL), Release 28')).toBe(
			'Percona Server'
		);
	});
	it('parses versions', () => {
		expect(versionToInt('8.4.4')).toBe(80404);
		expect(versionToInt('11.4.2-MariaDB-ubu2404')).toBe(110402);
		expect(versionToInt('nope')).toBe(0);
	});
});
