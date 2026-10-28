/**
 * zod schemas for the JSON payloads posted by the routine / event / trigger editors.
 */
import { z } from 'zod';
import { EVENT_STATUSES, EVENT_TYPES } from '#lib/sql/event.ts';
import {
	PARAM_DIRECTIONS,
	ROUTINE_TYPES,
	SECURITY_TYPES,
	SQL_DATA_ACCESS
} from '#lib/sql/routine-types.ts';
import { TRIGGER_EVENTS, TRIGGER_TIMINGS } from '#lib/sql/trigger.ts';

const text = (max = 65535) => z.string().max(max);

export const routineTypeSchema = z.enum(ROUTINE_TYPES);

export const routineDefSchema = z.object({
	type: routineTypeSchema,
	name: text(64),
	definer: text(300),
	params: z
		.array(
			z.object({
				direction: z.enum(PARAM_DIRECTIONS),
				name: text(64),
				type: text(30),
				length: text(2000),
				opts: text(64)
			})
		)
		.max(200),
	returns: z.object({ type: text(30), length: text(2000), opts: text(64) }),
	definition: text(),
	deterministic: z.boolean(),
	securityType: z.enum([...SECURITY_TYPES, '']),
	sqlDataAccess: z.enum([...SQL_DATA_ACCESS, '']),
	comment: text(1024)
});

export const executeParamsSchema = z
	.array(
		z.object({
			direction: z.enum(PARAM_DIRECTIONS),
			name: text(64),
			type: text(30),
			value: text(),
			isNull: z.boolean()
		})
	)
	.max(200);

export const eventDefSchema = z.object({
	name: text(64),
	status: z.enum(EVENT_STATUSES),
	type: z.enum(EVENT_TYPES),
	executeAt: text(64),
	intervalValue: text(32),
	intervalField: text(32),
	starts: text(64),
	ends: text(64),
	definition: text(),
	preserve: z.boolean(),
	definer: text(300),
	comment: text(1024)
});

export const triggerDefSchema = z.object({
	name: text(64),
	table: text(64),
	timing: z.enum(TRIGGER_TIMINGS),
	event: z.enum(TRIGGER_EVENTS),
	definition: text(),
	definer: text(300)
});

/** Parse a JSON string field of a form post; null when invalid. */
export function parseJsonField<T>(schema: z.ZodType<T>, raw: unknown): T | null {
	if (typeof raw !== 'string') return null;
	try {
		const parsed = schema.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}
