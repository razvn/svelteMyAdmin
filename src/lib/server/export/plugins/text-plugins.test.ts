import { describe, expect, it } from 'vitest';
import { textPlugins } from './text-plugins.ts';

describe('textPlugins', () => {
	it('lists the text formats in the documented order with unique ids', () => {
		expect(textPlugins.map((plugin) => plugin.id)).toEqual([
			'csv',
			'excel',
			'json',
			'xml',
			'yaml',
			'texytext',
			'mediawiki',
			'latex',
			'phparray',
			'htmlword',
			'codegen'
		]);
	});

	it('gives every plugin a label, extension, MIME type and at least one scope', () => {
		for (const plugin of textPlugins) {
			expect(plugin.label).not.toBe('');
			expect(plugin.extension).not.toMatch(/^\./);
			expect(plugin.mimeType).not.toBe('');
			expect(plugin.scopes.length).toBeGreaterThan(0);
			expect(plugin.supports.data || plugin.supports.structure).toBe(true);
		}
	});
});
