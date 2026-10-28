import { describe, expect, it } from 'vitest';
import {
	alterAutoIncrement,
	alterConstraints,
	alterIndexes,
	backquote,
	bitString,
	createInsertBatcher,
	formatValue,
	formatViewDefinition,
	splitCreateTable,
	upperClauseKeywords
} from './sql-ddl.ts';

const CREATE = [
	'CREATE TABLE `books` (',
	'  `id` int unsigned NOT NULL AUTO_INCREMENT,',
	"  `title` varchar(200) NOT NULL COMMENT 'has AUTO_INCREMENT in text',",
	'  `author_id` int unsigned NOT NULL,',
	'  PRIMARY KEY (`id`),',
	'  KEY `idx_author` (`author_id`),',
	'  FULLTEXT KEY `ft_title` (`title`),',
	'  CONSTRAINT `fk_a` FOREIGN KEY (`author_id`) REFERENCES `authors` (`id`) ON DELETE CASCADE',
	") ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COMMENT='AUTO_INCREMENT=9'"
].join('\n');

describe('splitCreateTable', () => {
	it('moves constraints, indexes and AUTO_INCREMENT out of the CREATE TABLE', () => {
		const s = splitCreateTable(CREATE, { ifNotExists: false });
		expect(s.create).toBe(
			[
				'CREATE TABLE `books` (',
				'  `id` int unsigned NOT NULL,',
				"  `title` varchar(200) NOT NULL COMMENT 'has AUTO_INCREMENT in text',",
				'  `author_id` int unsigned NOT NULL',
				") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AUTO_INCREMENT=9'"
			].join('\n')
		);
		expect(s.indexes).toEqual(['PRIMARY KEY (`id`)', 'KEY `idx_author` (`author_id`)']);
		expect(s.fulltextIndexes).toEqual(['FULLTEXT KEY `ft_title` (`title`)']);
		expect(s.constraints).toHaveLength(1);
		expect(s.autoIncrement).toEqual(['`id` int unsigned NOT NULL AUTO_INCREMENT']);
		expect(s.autoIncrementValue).toBe('5');
	});

	it('builds the ALTER TABLE statements', () => {
		const s = splitCreateTable(CREATE, { ifNotExists: false });
		expect(alterIndexes('`books`', s, '\n')).toBe(
			'ALTER TABLE `books`\n  ADD PRIMARY KEY (`id`),\n  ADD KEY `idx_author` (`author_id`);\n' +
				'ALTER TABLE `books` ADD FULLTEXT KEY `ft_title` (`title`);\n'
		);
		expect(alterConstraints('`books`', s, '\n')).toBe(
			'ALTER TABLE `books`\n  ADD CONSTRAINT `fk_a` FOREIGN KEY (`author_id`) REFERENCES `authors` (`id`) ON DELETE CASCADE;\n'
		);
		expect(alterAutoIncrement('`books`', s, '\n', true)).toBe(
			'ALTER TABLE `books`\n  MODIFY `id` int unsigned NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;\n'
		);
		expect(alterAutoIncrement('`books`', s, '\n', false)).toBe(
			'ALTER TABLE `books`\n  MODIFY `id` int unsigned NOT NULL AUTO_INCREMENT;\n'
		);
	});

	it('keeps everything inline with IF NOT EXISTS', () => {
		const s = splitCreateTable(CREATE, { ifNotExists: true });
		expect(s.indexes).toEqual([]);
		expect(s.autoIncrement).toEqual([]);
		expect(s.create).toContain('PRIMARY KEY (`id`)');
		expect(s.create).toContain('AUTO_INCREMENT=5');
		expect(s.constraints).toHaveLength(1);
	});

	it('leaves ARCHIVE tables and unknown layouts untouched', () => {
		const archive = 'CREATE TABLE `a` (\n  `id` int NOT NULL,\n  KEY `k` (`id`)\n) ENGINE=ARCHIVE';
		expect(splitCreateTable(archive, { ifNotExists: false }).create).toBe(archive);
		expect(splitCreateTable('CREATE VIEW x AS select 1', { ifNotExists: false }).create).toBe(
			'CREATE VIEW x AS select 1'
		);
	});
});

describe('views', () => {
	const view =
		"CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`%` SQL SECURITY DEFINER VIEW `db`.`v` AS select `a`.`x` AS `x` from `db`.`a` where (`a`.`s` = 'from where') group by `a`.`x`";
	it('strips the db, upper-cases clause keywords outside strings, adds the double space', () => {
		expect(
			formatViewDefinition(view, {
				db: 'db',
				removeDefiner: false,
				simple: false,
				orReplace: false
			})
		).toBe(
			"CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`%` SQL SECURITY DEFINER VIEW `v`  AS SELECT `a`.`x` AS `x` FROM `a` WHERE (`a`.`s` = 'from where') GROUP BY `a`.`x`"
		);
	});
	it('supports the view options', () => {
		expect(
			formatViewDefinition(view, { db: 'db', removeDefiner: true, simple: false, orReplace: true })
		).toMatch(/^CREATE OR REPLACE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `v` {2}AS SELECT/);
		expect(
			formatViewDefinition(view, { db: 'db', removeDefiner: false, simple: true, orReplace: false })
		).toMatch(/^CREATE VIEW `v` {2}AS SELECT/);
	});
	it('upper-cases only keywords', () => {
		expect(upperClauseKeywords("select 'select' as `from`, onx from t")).toBe(
			"SELECT 'select' as `from`, onx FROM t"
		);
	});
});

describe('value quoting', () => {
	const f = (type: string, extra: object = {}) => ({
		type,
		isBinary: false,
		isNumeric: false,
		...extra
	});
	const opts = { hexForBinary: true };
	it('NULL, numbers, strings', () => {
		expect(formatValue(null, f('int'), opts)).toBe('NULL');
		expect(formatValue('12.50', f('decimal', { isNumeric: true }), opts)).toBe('12.50');
		expect(formatValue('', f('varchar'), opts)).toBe("''");
		expect(formatValue('O\'Brien "q" \\ \n\r\0\x1a', f('varchar'), opts)).toBe(
			"'O\\'Brien \\\"q\\\" \\\\ \\n\\r\\0\\Z'"
		);
		expect(formatValue('2024', f('year'), opts)).toBe("'2024'");
	});
	it('binary as hex, empty binary as empty string', () => {
		expect(formatValue(Buffer.from('abc'), f('blob', { isBinary: true }), opts)).toBe('0x616263');
		expect(formatValue(Buffer.alloc(0), f('blob', { isBinary: true }), opts)).toBe("''");
		expect(formatValue(Buffer.from('0'), f('blob', { isBinary: true }), opts)).toBe('0x30');
	});
	it('binary without hex falls back to text when valid UTF-8, hex otherwise', () => {
		const off = { hexForBinary: false };
		expect(formatValue(Buffer.from("a'b"), f('blob', { isBinary: true }), off)).toBe("'a\\'b'");
		expect(formatValue(Buffer.from([0xff, 0xfe]), f('blob', { isBinary: true }), off)).toBe(
			'0xfffe'
		);
	});
	it('bit and geometry', () => {
		expect(formatValue(Buffer.from([0xaa]), f('bit', { length: 8 }), opts)).toBe("b'10101010'");
		expect(formatValue(Buffer.from([1]), f('bit', { length: 8 }), opts)).toBe("b'00000001'");
		expect(bitString(Buffer.from([0x01, 0x00]), 12)).toBe('000100000000');
		expect(formatValue(Buffer.from([0, 1, 2]), f('geometry'), opts)).toBe('0x000102');
	});
});

describe('backquote', () => {
	it('quotes, doubles backquotes, and honours the unquoted mode', () => {
		expect(backquote('a`b')).toBe('`a``b`');
		expect(backquote('plain', false)).toBe('plain');
		expect(backquote('order', false)).toBe('`order`');
		expect(backquote('', true)).toBe('');
	});
});

describe('insert batching', () => {
	const base = {
		command: 'INSERT' as const,
		table: '`t`',
		columns: ['`a`', '`b`'],
		delayed: false,
		ignore: false,
		maxQuerySize: 50000,
		crlf: '\n'
	};
	const run = (o: Partial<Parameters<typeof createInsertBatcher>[0]>, rows: string[][]) => {
		const b = createInsertBatcher({ ...base, syntax: 'both', ...o });
		return rows.map((r) => b.next(r)).join('') + b.finish();
	};
	it('both: extended with column names', () => {
		expect(
			run({}, [
				['1', "'x'"],
				['2', 'NULL']
			])
		).toBe("INSERT INTO `t` (`a`, `b`) VALUES\n(1, 'x'),\n(2, NULL);\n");
	});
	it('extended without names, complete, none', () => {
		expect(run({ syntax: 'extended' }, [['1', '2']])).toBe('INSERT INTO `t` VALUES\n(1, 2);\n');
		expect(
			run({ syntax: 'complete' }, [
				['1', '2'],
				['3', '4']
			])
		).toBe('INSERT INTO `t` (`a`, `b`) VALUES(1, 2);\nINSERT INTO `t` (`a`, `b`) VALUES(3, 4);\n');
		expect(run({ syntax: 'none' }, [['1', '2']])).toBe('INSERT INTO `t` VALUES(1, 2);\n');
	});
	it('INSERT IGNORE, DELAYED and REPLACE', () => {
		expect(run({ ignore: true, syntax: 'none' }, [['1', '2']])).toBe(
			'INSERT IGNORE INTO `t` VALUES(1, 2);\n'
		);
		expect(run({ delayed: true, ignore: true, syntax: 'none' }, [['1', '2']])).toBe(
			'INSERT DELAYED IGNORE INTO `t` VALUES(1, 2);\n'
		);
		expect(run({ command: 'REPLACE', ignore: true, syntax: 'none' }, [['1', '2']])).toBe(
			'REPLACE INTO `t` VALUES(1, 2);\n'
		);
	});
	it('UPDATE statements', () => {
		const b = createInsertBatcher({ ...base, command: 'UPDATE', syntax: 'both', ignore: true });
		expect(
			b.next([], ' `a` = 1 WHERE `a` = 1') + b.next([], ' `a` = 2 WHERE `a` = 2') + b.finish()
		).toBe(
			'UPDATE IGNORE `t` SET `a` = 1 WHERE `a` = 1;\nUPDATE IGNORE `t` SET `a` = 2 WHERE `a` = 2;\n'
		);
	});
	it('splits extended inserts at max_query_size and repeats the header', () => {
		const out = run({ maxQuerySize: 60 }, [
			['1', "'aaaaaaaaaa'"],
			['2', "'bbbbbbbbbb'"],
			['3', "'cccccccccc'"],
			['4', "'dddddddddd'"]
		]);
		const statements = out.split(';\n').filter(Boolean);
		expect(statements.length).toBeGreaterThan(1);
		for (const s of statements)
			expect(s.startsWith('INSERT INTO `t` (`a`, `b`) VALUES\n(')).toBe(true);
		expect(out.match(/\(\d,/g)).toHaveLength(4);
		expect(out.endsWith(';\n')).toBe(true);
	});
	it('max_query_size 0 never splits', () => {
		const out = run(
			{ maxQuerySize: 0 },
			Array.from({ length: 500 }, (_, i) => [String(i), "'x'"])
		);
		expect(out.match(/INSERT INTO/g)).toHaveLength(1);
	});
	it('emits nothing for no rows', () => {
		expect(run({}, [])).toBe('');
	});
});
