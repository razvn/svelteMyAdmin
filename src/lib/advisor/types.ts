/** One rule of libraries/advisory_rules_*.php (same keys as PHP). */
export interface AdvisorRule {
	id: string;
	name: string;
	/** Expression; the rule is skipped ("unchecked") when it is falsy. */
	precondition?: string;
	/** Expression whose result becomes `value`. */
	formula: string;
	/** Expression using `value`; the rule fires when truthy. */
	test: string;
	issue: string;
	recommendation: string;
	/** sprintf-like format (`%s`, `%d`, `%%`). */
	justification: string;
	/** Comma separated expressions used as the arguments of `justification`. */
	justification_formula?: string;
}

export interface UsedVariable {
	name: string;
	value: string;
}

/** A rule with its justification formatted (fired / notfired) or untouched (unchecked). */
export interface RuleResult {
	id: string;
	name: string;
	issue: string;
	recommendation: string;
	justification: string;
	formula: string;
	test: string;
	/** Variables referenced by precondition, formula, test and justification, with current values. */
	used: UsedVariable[];
}

export interface AdvisorRunResult {
	fired: RuleResult[];
	notfired: RuleResult[];
	/** Precondition was false. */
	unchecked: RuleResult[];
	/** "Failed calculating value for rule 'x'. Error when evaluating: ..." */
	errors: string[];
}
