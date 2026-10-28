import { describe, expect, it } from 'vitest';
import { groupCollations } from './charsets.ts';

describe('groupCollations', () => {
	it('nests collations under their charset and marks defaults', () => {
		const groups = groupCollations(
			[
				{ name: 'utf8mb4', description: 'UTF-8 Unicode', defaultCollation: 'utf8mb4_0900_ai_ci' },
				{
					name: 'latin1',
					description: 'cp1252 West European',
					defaultCollation: 'latin1_swedish_ci'
				}
			],
			[
				{ name: 'utf8mb4_unicode_ci', charset: 'utf8mb4', isDefault: false },
				{ name: 'utf8mb4_0900_ai_ci', charset: 'utf8mb4', isDefault: true },
				{ name: 'latin1_swedish_ci', charset: 'latin1', isDefault: true }
			],
			'utf8mb4_0900_ai_ci'
		);
		expect(groups.map((g) => g.name)).toEqual(['latin1', 'utf8mb4']);
		expect(groups[1]).toEqual({
			name: 'utf8mb4',
			description: 'UTF-8 Unicode',
			defaultCollation: 'utf8mb4_0900_ai_ci',
			collations: [
				{ name: 'utf8mb4_0900_ai_ci', isDefault: true, isServerDefault: true },
				{ name: 'utf8mb4_unicode_ci', isDefault: false, isServerDefault: false }
			]
		});
		expect(groups[0].collations).toEqual([
			{ name: 'latin1_swedish_ci', isDefault: true, isServerDefault: false }
		]);
	});

	it('treats the charset DEFAULT_COLLATE_NAME as default when IS_DEFAULT is empty (MariaDB)', () => {
		const groups = groupCollations(
			[{ name: 'utf8mb4', description: '', defaultCollation: 'utf8mb4_uca1400_ai_ci' }],
			[
				{ name: 'utf8mb4_general_ci', charset: 'utf8mb4', isDefault: false },
				{ name: 'utf8mb4_uca1400_ai_ci', charset: 'utf8mb4', isDefault: false }
			],
			'utf8mb4_unicode_ci'
		);
		expect(groups[0].collations).toEqual([
			{ name: 'utf8mb4_general_ci', isDefault: false, isServerDefault: false },
			{ name: 'utf8mb4_uca1400_ai_ci', isDefault: true, isServerDefault: false }
		]);
	});

	it('keeps charsets without collations and adds unknown charsets', () => {
		const groups = groupCollations(
			[{ name: 'empty', description: 'No collations', defaultCollation: '' }],
			[{ name: 'ascii_general_ci', charset: 'ascii', isDefault: true }],
			'ascii_general_ci'
		);
		expect(groups.map((g) => [g.name, g.description, g.collations.length])).toEqual([
			['ascii', '', 1],
			['empty', 'No collations', 0]
		]);
	});
});
