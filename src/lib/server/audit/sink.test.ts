import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditLogSchema } from '#lib/server/config/schema.ts';
import { createSink } from './sink.ts';

const dirs: string[] = [];
const tmp = () => {
	const d = mkdtempSync(join(tmpdir(), 'sma-audit-'));
	dirs.push(d);
	return d;
};
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
	vi.restoreAllMocks();
});

const read = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : '');
const waitFor = async (cond: () => boolean) => {
	for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
};

describe('audit sinks', () => {
	it('stdout: one line per write', () => {
		const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
		createSink(auditLogSchema.parse({ target: 'stdout' })).write('{"event":"session"}');
		expect(out).toHaveBeenCalledWith('{"event":"session"}\n');
	});

	it('file: appends lines, keeping what was there', async () => {
		const path = join(tmp(), 'audit.jsonl');
		const config = auditLogSchema.parse({ target: 'file', path });
		const first = createSink(config);
		first.write('{"n":1}');
		first.write('{"n":2}');
		await waitFor(() => read(path).split('\n').length === 3);
		createSink(config).write('{"n":3}');
		await waitFor(() => read(path).split('\n').length === 4);
		expect(read(path)).toBe('{"n":1}\n{"n":2}\n{"n":3}\n');
	});

	it('fails open: an unwritable file is reported once and writes never throw', async () => {
		const report = vi.fn();
		const sink = createSink(
			auditLogSchema.parse({ target: 'file', path: join(tmp(), 'missing', 'audit.jsonl') }),
			report
		);
		expect(() => sink.write('{"n":1}')).not.toThrow();
		await waitFor(() => report.mock.calls.length > 0);
		expect(() => sink.write('{"n":2}')).not.toThrow();
		expect(() => sink.write('{"n":3}')).not.toThrow();
		await new Promise((r) => setTimeout(r, 50));
		expect(report).toHaveBeenCalledTimes(1);
	});

	it('fails open on stdout errors too', () => {
		vi.spyOn(process.stdout, 'write').mockImplementation(() => {
			throw new Error('EPIPE');
		});
		const report = vi.fn();
		const sink = createSink(auditLogSchema.parse({ target: 'stdout' }), report);
		expect(() => sink.write('a')).not.toThrow();
		expect(() => sink.write('b')).not.toThrow();
		expect(report).toHaveBeenCalledTimes(1);
	});
});
