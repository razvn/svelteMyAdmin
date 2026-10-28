import { describe, expect, it } from 'vitest';
import { hasInnodbStatus, prefixLikePattern, variablePrefixesFor } from './engines.ts';

describe('variablePrefixesFor', () => {
	it('knows the prefixes of the common engines', () => {
		expect(variablePrefixesFor('InnoDB')).toEqual(['innodb_']);
		expect(variablePrefixesFor('MyISAM')).toEqual(['myisam_', 'key_']);
		expect(variablePrefixesFor('Aria')).toEqual(['aria_']);
		expect(variablePrefixesFor('MEMORY')).toEqual([]);
	});
});

describe('prefixLikePattern', () => {
	it('escapes LIKE wildcards inside the prefix', () => {
		expect(prefixLikePattern('innodb_')).toBe('innodb\\_%');
		expect(prefixLikePattern('a%b')).toBe('a\\%b%');
	});
});

describe('hasInnodbStatus', () => {
	it('is true only for InnoDB, any case', () => {
		expect(hasInnodbStatus('InnoDB')).toBe(true);
		expect(hasInnodbStatus('innodb')).toBe(true);
		expect(hasInnodbStatus('MyISAM')).toBe(false);
	});
});
