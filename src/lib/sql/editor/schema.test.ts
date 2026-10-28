import { describe, expect, it } from 'vitest';
import { normalizeSchema, parseSchemaResponse, toSqlNamespace } from './schema';

describe('schema helpers', () => {
	it('normalizes duplicates and empty names', () => {
		expect(normalizeSchema({ t: ['a', 'a', ''], '': ['x'] })).toEqual({ t: ['a'] });
		expect(normalizeSchema(undefined)).toEqual({});
		expect(toSqlNamespace({ t: ['a'] })).toEqual({ t: ['a'] });
	});
	it('parses the endpoint response defensively', () => {
		expect(parseSchemaResponse({ tables: { books: ['id', 3, 'title'], bad: 1 } })).toEqual({
			books: ['id', 'title']
		});
		expect(parseSchemaResponse(null)).toEqual({});
		expect(parseSchemaResponse({ tables: 5 })).toEqual({});
	});
});
