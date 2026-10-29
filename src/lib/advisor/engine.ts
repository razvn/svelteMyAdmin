/** Rules engine (libraries/classes/Advisor.php). Pure: callers supply the fetched status/variables. */
import {
	collectNames,
	evaluateNode,
	parse,
	toBool,
	toStr,
	type Node,
	type Value
} from './expression.ts';
import { buildFunctions, vsprintf } from './functions.ts';
import { BEFORE_MYSQL_80003_RULES, GENERIC_RULES } from './rules.ts';
import type { AdvisorRule, AdvisorRunResult, RuleResult, UsedVariable } from './types.ts';

export interface AdvisorInput {
	/** SHOW GLOBAL STATUS. */
	status: Record<string, string>;
	/** SHOW GLOBAL VARIABLES. */
	variables: Record<string, string>;
	/** Numeric server version (80404). */
	versionInt: number;
	isMariaDB: boolean;
	/** MemTotal in KiB of the host running the server, 0 when unknown. */
	systemMemory: number;
	/** Override of the rule set (tests). */
	rules?: AdvisorRule[];
}

/** Rules for the server: the before-8.0.3 query cache rules also apply to MariaDB. */
export function rulesFor(isMariaDB: boolean, versionInt: number): AdvisorRule[] {
	if (!isMariaDB && versionInt >= 80003) return GENERIC_RULES;
	return [...GENERIC_RULES, ...BEFORE_MYSQL_80003_RULES];
}

const parsed = new Map<string, Node>();
function parseCached(src: string): Node {
	let n = parsed.get(src);
	if (!n) {
		n = parse(src);
		parsed.set(src, n);
	}
	return n;
}

export function runAdvisor(input: AdvisorInput): AdvisorRunResult {
	const base: Record<string, Value> = {
		...input.status,
		...input.variables,
		system_memory: input.systemMemory,
		value: 0
	};
	const globals: Record<string, Value> = {
		PMA_MYSQL_INT_VERSION: input.versionInt,
		IS_MARIADB: input.isMariaDB
	};
	const rules = input.rules ?? rulesFor(input.isMariaDB, input.versionInt);
	const result: AdvisorRunResult = { fired: [], notfired: [], unchecked: [], errors: [] };

	// Defaults for InnoDB variables when InnoDB is disabled.
	for (const k of [
		'innodb_buffer_pool_size',
		'innodb_log_file_size',
		'innodb_log_files_in_group'
	]) {
		if (!(k in base)) base[k] = 0;
	}

	const vars: Record<string, Value> = { ...base, ...globals };
	const functions = buildFunctions((id) => result.fired.some((r) => r.id === id));
	const ev = (src: string) => evaluateNode(parseCached(src), { variables: vars, functions });
	const err = (what: string, e: unknown) =>
		result.errors.push(
			`${what} Error when evaluating: ${e instanceof Error ? e.message : String(e)}`
		);

	const usedOf = (rule: AdvisorRule): UsedVariable[] => {
		const names = new Set<string>();
		try {
			for (const src of [rule.precondition, rule.formula, rule.test, rule.justification_formula]) {
				if (src)
					collectNames(
						parseCached(src.includes(',') && src === rule.justification_formula ? `[${src}]` : src),
						names
					);
			}
		} catch {
			/* surfaced by evaluation */
		}
		names.delete('value');
		return [...names].map((name) => ({
			name,
			value: name in vars ? toStr(vars[name]) : '(not available)'
		}));
	};

	for (const rule of rules) {
		vars.value = 0;
		if (rule.precondition !== undefined) {
			let ok: Value;
			try {
				ok = ev(rule.precondition);
			} catch (e) {
				err(`Failed evaluating precondition for rule '${rule.name}'.`, e);
				continue;
			}
			if (!toBool(ok)) {
				result.unchecked.push(toResult(rule, rule.justification, usedOf(rule)));
				continue;
			}
		}
		let value: Value;
		try {
			value = ev(rule.formula);
		} catch (e) {
			err(`Failed calculating value for rule '${rule.name}'.`, e);
			continue;
		}
		vars.value = value;
		let isFired: boolean;
		try {
			isFired = toBool(ev(rule.test));
		} catch (e) {
			err(`Failed running test for rule '${rule.name}'.`, e);
			continue;
		}
		let justification: string;
		if (rule.justification_formula !== undefined) {
			try {
				const params = ev(`[${rule.justification_formula}]`) as Value[];
				justification = vsprintf(rule.justification, params);
			} catch (e) {
				err(`Failed formatting string for rule '${rule.name}'.`, e);
				continue;
			}
		} else {
			justification = rule.justification;
		}
		(isFired ? result.fired : result.notfired).push(toResult(rule, justification, usedOf(rule)));
	}
	return result;
}

function toResult(rule: AdvisorRule, justification: string, used: UsedVariable[]): RuleResult {
	return {
		id: rule.id,
		name: rule.name,
		issue: rule.issue,
		recommendation: rule.recommendation,
		justification,
		formula: rule.formula,
		test: rule.test,
		used
	};
}

const esc = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Issue / recommendation text -> HTML. The rule texts are static and trusted (they carry <a>/<b>);
 * `{variable}` becomes a link to the variables page, external links open in a new tab.
 */
export function ruleHtml(text: string, variablesHref: (name: string) => string): string {
	return text
		.replace(
			/\{([a-z_0-9]+)\}/gi,
			(_m, name: string) => `<a href="${esc(variablesHref(name))}">${esc(name)}</a>`
		)
		.replace(
			/href=("|')(https?:\/\/[^"']+)\1/gi,
			(_m, _q, url: string) => `href="${url}" target="_blank" rel="noopener noreferrer"`
		);
}

/** Plain text (accordion title): `{var}` -> var, tags stripped. */
export function ruleText(text: string): string {
	return text.replace(/\{([a-z_0-9]+)\}/gi, '$1').replace(/<[^>]*>/g, '');
}
