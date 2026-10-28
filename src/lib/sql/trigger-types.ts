/** Client-safe constants for triggers (no imports). */
export const TRIGGER_TIMINGS = ['BEFORE', 'AFTER'] as const;
export const TRIGGER_EVENTS = ['INSERT', 'UPDATE', 'DELETE'] as const;
export type TriggerTiming = (typeof TRIGGER_TIMINGS)[number];
export type TriggerEvent = (typeof TRIGGER_EVENTS)[number];
