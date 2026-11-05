/**
 * Where audit lines go: stdout (collected by the container runtime) or one append-only file. Never
 * the pma__* tables, which the shared MySQL account could rewrite. Fails open: a write error is
 * reported once and never breaks the request.
 */
import { createWriteStream, type WriteStream } from 'node:fs';
import type { AuditLogConfig } from '#lib/server/config/schema.ts';

export interface AuditSink {
	/** Append one line (without its newline). */
	write(line: string): void;
}

type Report = (message: string, error: unknown) => void;

const defaultReport: Report = (message, error) => console.error(message, error);

export function createSink(config: AuditLogConfig, report: Report = defaultReport): AuditSink {
	let failed = false;
	const fail = (error: unknown) => {
		if (failed) return;
		failed = true;
		report('[audit] cannot write the audit log, audit lines are being lost:', error);
	};

	if (config.target === 'stdout') {
		return {
			write(line) {
				try {
					process.stdout.write(line + '\n');
				} catch (e) {
					fail(e);
				}
			}
		};
	}

	const path = config.path;
	let stream: WriteStream | undefined;
	return {
		write(line) {
			if (failed) return;
			try {
				if (!stream) {
					stream = createWriteStream(path, { flags: 'a' });
					stream.on('error', fail);
				}
				stream.write(line + '\n');
			} catch (e) {
				fail(e);
			}
		}
	};
}

const sinks = new Map<string, AuditSink>();

/** The process-wide sink of `config` (one append stream per file). */
export function auditSink(config: AuditLogConfig): AuditSink {
	const key = config.target === 'file' ? `file:${config.path}` : 'stdout';
	let sink = sinks.get(key);
	if (!sink) sinks.set(key, (sink = createSink(config)));
	return sink;
}
