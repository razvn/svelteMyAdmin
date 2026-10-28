import { describe, expect, it } from 'vitest';
import { legacyRedirectTarget, mapLegacyRoute } from './legacy';

const map = (qs: string) => mapLegacyRoute(new URLSearchParams(qs));

describe('mapLegacyRoute', () => {
	it('maps the home page and bare index.php', () => {
		expect(map('route=/')).toBe('/');
		expect(map('')).toBe('/');
		expect(map('db=x')).toBe('/db/x/structure');
		expect(map('db=x&table=y')).toBe('/db/x/table/y/browse');
	});

	it('maps server routes', () => {
		expect(map('route=/server/databases')).toBe('/server/databases');
		expect(map('route=/server/sql')).toBe('/server/sql');
		expect(map('route=/server/status')).toBe('/server/status');
		expect(map('route=/server/status/processes')).toBe('/server/status/processes');
		expect(map('route=/server/status/monitor')).toBe('/server/status/monitor');
		expect(map('route=/server/status/advisor')).toBe('/server/status');
		expect(map('route=/server/variables')).toBe('/server/variables');
		expect(map('route=/server/collations')).toBe('/server/charsets');
		expect(map('route=/server/privileges')).toBe('/server/privileges');
		expect(map('route=/server/engines')).toBe('/server/engines');
		expect(map('route=/server/binlog')).toBe('/server/binlog');
		expect(map('route=/server/replication')).toBe('/server/replication');
		expect(map('route=/server/user-groups')).toBe('/server/user-groups');
	});

	it('maps database routes', () => {
		expect(map('route=/database/structure&db=sma_test')).toBe('/db/sma_test/structure');
		expect(map('route=/database/sql&db=sma_test')).toBe('/db/sma_test/sql');
		expect(map('route=/database/operations&db=sma_test')).toBe('/db/sma_test/operations');
		expect(map('route=/database/search&db=a')).toBe('/db/a/search');
		expect(map('route=/database/qbe&db=a')).toBe('/db/a/query');
		expect(map('route=/database/routines&db=a')).toBe('/db/a/routines');
		expect(map('route=/database/events&db=a')).toBe('/db/a/events');
		expect(map('route=/database/triggers&db=a')).toBe('/db/a/triggers');
		expect(map('route=/database/designer&db=a')).toBe('/db/a/designer');
		expect(map('route=/database/structure')).toBe('/server/databases');
	});

	it('maps table routes', () => {
		expect(map('route=/table/structure&db=x&table=y')).toBe('/db/x/table/y/structure');
		expect(map('route=/table/sql&db=x&table=y')).toBe('/db/x/table/y/sql');
		expect(map('route=/table/change&db=x&table=y')).toBe('/db/x/table/y/insert');
		expect(map('route=/table/search&db=x&table=y')).toBe('/db/x/table/y/search');
		expect(map('route=/table/operations&db=x&table=y')).toBe('/db/x/table/y/operations');
		expect(map('route=/table/zoom-search&db=x&table=y')).toBe('/db/x/table/y/zoom-search');
		expect(map('route=/table/relation&db=x&table=y')).toBe('/db/x/table/y/relation');
		expect(map('route=/table/structure&db=x')).toBe('/db/x/structure');
		expect(map('route=/table/structure')).toBe('/');
	});

	it('maps /sql (browse) with context', () => {
		expect(map('route=/sql&db=x&table=y')).toBe('/db/x/table/y/browse');
		expect(map('route=/sql&db=x')).toBe('/db/x/sql');
		expect(map('route=/sql')).toBe('/server/sql');
	});

	it('maps /export and /import with context', () => {
		expect(map('route=/export&db=x&table=y')).toBe('/db/x/table/y/export');
		expect(map('route=/export&db=x')).toBe('/db/x/export');
		expect(map('route=/export')).toBe('/server/export');
		expect(map('route=/import&db=x&table=y')).toBe('/db/x/table/y/import');
		expect(map('route=/import&db=x')).toBe('/db/x/import');
		expect(map('route=/import')).toBe('/server/import');
		expect(map('route=/table/export&db=x&table=y')).toBe('/db/x/table/y/export');
		expect(map('route=/database/import&db=x')).toBe('/db/x/import');
	});

	it('maps privileges with context', () => {
		expect(map('route=/server/privileges&db=x')).toBe('/db/x/privileges');
		expect(map('route=/server/privileges&db=x&table=y')).toBe('/db/x/table/y/privileges');
	});

	it('encodes names safely', () => {
		expect(map('route=/database/structure&db=a/b%20c?')).toBe('/db/a%2Fb%20c%3F/structure');
		expect(map('route=/table/sql&db=../x&table=%23')).toBe('/db/..%2Fx/table/%23/sql');
	});

	it('sends unknown routes home', () => {
		expect(map('route=/nope')).toBe('/');
		expect(map('route=/server/nope')).toBe('/');
		expect(map('route=/database/nope&db=x')).toBe('/');
		expect(map('route=/server/__proto__')).toBe('/');
		expect(map('route=/table/constructor&db=x&table=y')).toBe('/');
	});

	it('accepts plain records', () => {
		expect(mapLegacyRoute({ route: '/table/sql', db: 'x', table: 'y' })).toBe('/db/x/table/y/sql');
	});
});

describe('legacyRedirectTarget', () => {
	it('recognises legacy URLs', () => {
		expect(legacyRedirectTarget(new URL('http://h/index.php?route=/table/sql&db=x&table=y'))).toBe(
			'/db/x/table/y/sql'
		);
		expect(legacyRedirectTarget(new URL('http://h/index.php'))).toBe('/');
		expect(legacyRedirectTarget(new URL('http://h/?route=/server/status'))).toBe('/server/status');
	});
	it('ignores everything else', () => {
		expect(legacyRedirectTarget(new URL('http://h/'))).toBeNull();
		expect(legacyRedirectTarget(new URL('http://h/server/databases'))).toBeNull();
		expect(legacyRedirectTarget(new URL('http://h/login?route=/x'))).toBeNull();
	});
});
