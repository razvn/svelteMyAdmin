/**
 * Failed second-factor attempts: at most `max` failures per `windowMs` per key (server + user, so
 * re-logging in does not reset the counter). In-memory, per process.
 */
export class AttemptLimiter {
	private failures = new Map<string, number[]>();

	constructor(
		private readonly max = 5,
		private readonly windowMs = 5 * 60_000,
		private readonly now: () => number = Date.now
	) {}

	private recent(key: string): number[] {
		const t = this.now();
		const list = (this.failures.get(key) ?? []).filter((x) => t - x < this.windowMs);
		if (list.length > 0) this.failures.set(key, list);
		else this.failures.delete(key);
		return list;
	}

	/** Seconds until another attempt is allowed; 0 when allowed. */
	retryAfter(key: string): number {
		const list = this.recent(key);
		if (list.length < this.max) return 0;
		return Math.max(1, Math.ceil((list[0] + this.windowMs - this.now()) / 1000));
	}

	fail(key: string): void {
		const list = this.recent(key);
		list.push(this.now());
		this.failures.set(key, list);
	}

	reset(key: string): void {
		this.failures.delete(key);
	}
}

export const secondFactorLimiter = new AttemptLimiter();

export const limiterKey = (serverIndex: number, user: string) => `${serverIndex}:${user}`;
