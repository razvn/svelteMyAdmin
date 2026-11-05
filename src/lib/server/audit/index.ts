/**
 * Per-person audit log (app-specific, `AuditLog` in config.json, docs/AUDIT.md). Each request gets
 * a `RequestAudit` (`locals.audit`) that knows who is acting, so routes only describe what happened.
 */
import type { AuditLogConfig } from '#lib/server/config/schema.ts';
import { formatLine, type Actor, type AuditBody } from './events.ts';
import { auditSink, type AuditSink } from './sink.ts';

export type { Actor, AuditBody, AuditEvent, DeniedReason } from './events.ts';

export interface RequestAudit {
	/** Log one event; `actor` overrides the request's actor fields. No-op when the log is off. */
	write(body: AuditBody, actor?: Partial<Actor>): void;
}

export const noAudit: RequestAudit = { write() {} };

export function requestAudit(
	config: AuditLogConfig,
	actor: Actor,
	sink: AuditSink = auditSink(config),
	now: () => Date = () => new Date()
): RequestAudit {
	return {
		write(body, override) {
			const line = formatLine(
				{ ts: now().toISOString(), ...actor, ...override, ...body },
				config.maxSqlLength
			);
			sink.write(line);
		}
	};
}
