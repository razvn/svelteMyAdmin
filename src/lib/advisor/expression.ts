/**
 * Safe expression language for the advisor rules (a subset of Symfony ExpressionLanguage as used by
 * libraries/classes/Advisor.php): tokenizer, Pratt parser and tree-walking evaluator. There is no
 * `eval` / `Function`; only the registered functions and the supplied variables are reachable.
 *
 * Semantics follow PHP 8 (loose comparison, numeric strings, division by zero is an error) because
 * the rules were written against it and status values are strings.
 */

export type Value = number | string | boolean | null | Value[];

export class ExpressionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ExpressionError';
	}
}

// ---------------------------------------------------------------------------------------------
// Tokenizer

export type Token =
	| { type: 'number'; value: number; pos: number }
	| { type: 'string'; value: string; pos: number }
	| { type: 'name'; value: string; pos: number }
	| { type: 'op'; value: string; pos: number }
	| { type: 'punct'; value: string; pos: number }
	| { type: 'eof'; value: ''; pos: number };

// Longest first.
const OPERATORS = [
	'===',
	'!==',
	'**',
	'&&',
	'||',
	'==',
	'!=',
	'<=',
	'>=',
	'..',
	'<',
	'>',
	'+',
	'-',
	'*',
	'/',
	'%',
	'~',
	'!'
];
const WORD_OPERATORS = new Set(['and', 'or', 'not', 'in']);
const PUNCT = new Set(['(', ')', '[', ']', ',', '?', ':']);

const isDigit = (c: string) => c >= '0' && c <= '9';
const isNameStart = (c: string) => /[A-Za-z_]/.test(c);
const isNameChar = (c: string) => /[A-Za-z0-9_]/.test(c);

export function tokenize(src: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	while (i < src.length) {
		const c = src[i];
		if (/\s/.test(c)) {
			i++;
			continue;
		}
		if (isDigit(c) || (c === '.' && isDigit(src[i + 1] ?? ''))) {
			const m = /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
			// `1..5` must stay a range: the regex above never swallows a trailing dot.
			const text = m![0];
			tokens.push({ type: 'number', value: Number(text), pos: i });
			i += text.length;
			continue;
		}
		if (c === "'" || c === '"') {
			let j = i + 1;
			let out = '';
			let closed = false;
			while (j < src.length) {
				const d = src[j];
				if (d === '\\' && j + 1 < src.length) {
					const next = src[j + 1];
					// Same escapes as Symfony's stripcslashes() on the quoted body.
					out += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next;
					j += 2;
					continue;
				}
				if (d === c) {
					closed = true;
					j++;
					break;
				}
				out += d;
				j++;
			}
			if (!closed) throw new ExpressionError(`Unclosed string at position ${i}`);
			tokens.push({ type: 'string', value: out, pos: i });
			i = j;
			continue;
		}
		if (isNameStart(c)) {
			let j = i + 1;
			while (j < src.length && isNameChar(src[j])) j++;
			const word = src.slice(i, j);
			if (WORD_OPERATORS.has(word)) tokens.push({ type: 'op', value: word, pos: i });
			else tokens.push({ type: 'name', value: word, pos: i });
			i = j;
			continue;
		}
		const op = OPERATORS.find((o) => src.startsWith(o, i));
		if (op) {
			tokens.push({ type: 'op', value: op, pos: i });
			i += op.length;
			continue;
		}
		if (PUNCT.has(c)) {
			tokens.push({ type: 'punct', value: c, pos: i });
			i++;
			continue;
		}
		throw new ExpressionError(`Unexpected character "${c}" around position ${i}`);
	}
	tokens.push({ type: 'eof', value: '', pos: src.length });
	return tokens;
}

// ---------------------------------------------------------------------------------------------
// Parser (Pratt)

export type Node =
	| { kind: 'literal'; value: Value }
	| { kind: 'name'; name: string }
	| { kind: 'call'; name: string; args: Node[] }
	| { kind: 'array'; items: Node[] }
	| { kind: 'unary'; op: string; operand: Node }
	| { kind: 'binary'; op: string; left: Node; right: Node }
	| { kind: 'ternary'; test: Node; then: Node | null; otherwise: Node };

/** Binding powers, same numbers as Symfony's Parser. */
const BINARY: Record<string, { prec: number; right?: boolean }> = {
	or: { prec: 10 },
	'||': { prec: 10 },
	and: { prec: 15 },
	'&&': { prec: 15 },
	'==': { prec: 20 },
	'===': { prec: 20 },
	'!=': { prec: 20 },
	'!==': { prec: 20 },
	'<': { prec: 20 },
	'>': { prec: 20 },
	'<=': { prec: 20 },
	'>=': { prec: 20 },
	in: { prec: 20 },
	'..': { prec: 25 },
	'+': { prec: 30 },
	'-': { prec: 30 },
	'~': { prec: 40 },
	'*': { prec: 60 },
	'/': { prec: 60 },
	'%': { prec: 60 },
	'**': { prec: 200, right: true }
};
const UNARY: Record<string, number> = { not: 50, '!': 50, '-': 500, '+': 500 };

class Parser {
	private i = 0;
	constructor(
		private readonly tokens: Token[],
		private readonly src: string
	) {}

	parse(): Node {
		const node = this.expression(0);
		const t = this.peek();
		if (t.type !== 'eof') this.unexpected(t);
		return node;
	}

	private peek(): Token {
		return this.tokens[this.i];
	}

	private next(): Token {
		return this.tokens[this.i++];
	}

	private unexpected(t: Token): never {
		const what = t.type === 'eof' ? 'end of expression' : `"${t.value}"`;
		throw new ExpressionError(
			`Unexpected token ${what} around position ${t.pos} for "${this.src}"`
		);
	}

	private expect(type: 'punct', value: string): void {
		const t = this.next();
		if (t.type !== type || t.value !== value) this.unexpected(t);
	}

	private expression(minPrec: number): Node {
		let left = this.unaryOrPrimary();
		for (;;) {
			const t = this.peek();
			if (t.type === 'op') {
				let op = t.value;
				let consumed = 1;
				// `not in`
				if (op === 'not' && this.tokens[this.i + 1]?.value === 'in') {
					op = 'not in';
					consumed = 2;
				}
				const info = op === 'not in' ? { prec: 20 } : BINARY[op];
				if (!info || info.prec < minPrec) break;
				this.i += consumed;
				const right = this.expression(info.right ? info.prec : info.prec + 1);
				left = { kind: 'binary', op, left, right };
				continue;
			}
			if (t.type === 'punct' && t.value === '?' && minPrec <= 0) {
				this.next();
				let then: Node | null = null;
				if (!(this.peek().type === 'punct' && this.peek().value === ':')) then = this.expression(0);
				this.expect('punct', ':');
				const otherwise = this.expression(0);
				left = { kind: 'ternary', test: left, then, otherwise };
				continue;
			}
			break;
		}
		return left;
	}

	private unaryOrPrimary(): Node {
		const t = this.peek();
		if (t.type === 'op' && t.value in UNARY) {
			this.next();
			const operand = this.expression(UNARY[t.value]);
			return { kind: 'unary', op: t.value === 'not' ? '!' : t.value, operand };
		}
		return this.primary();
	}

	private primary(): Node {
		const t = this.next();
		switch (t.type) {
			case 'number':
			case 'string':
				return { kind: 'literal', value: t.value };
			case 'name': {
				if (this.peek().type === 'punct' && this.peek().value === '(') {
					this.next();
					return { kind: 'call', name: t.value, args: this.list(')') };
				}
				const lower = t.value.toLowerCase();
				if (lower === 'true') return { kind: 'literal', value: true };
				if (lower === 'false') return { kind: 'literal', value: false };
				if (lower === 'null') return { kind: 'literal', value: null };
				return { kind: 'name', name: t.value };
			}
			case 'punct':
				if (t.value === '(') {
					const inner = this.expression(0);
					this.expect('punct', ')');
					return inner;
				}
				if (t.value === '[') return { kind: 'array', items: this.list(']') };
				return this.unexpected(t);
			default:
				return this.unexpected(t);
		}
	}

	/** Comma separated expressions up to the closing punctuation (consumed). */
	private list(close: ')' | ']'): Node[] {
		const items: Node[] = [];
		if (this.peek().type === 'punct' && this.peek().value === close) {
			this.next();
			return items;
		}
		for (;;) {
			items.push(this.expression(0));
			const t = this.next();
			if (t.type === 'punct' && t.value === ',') continue;
			if (t.type === 'punct' && t.value === close) return items;
			this.unexpected(t);
		}
	}
}

export function parse(src: string): Node {
	return new Parser(tokenize(src), src).parse();
}

/** Variable names referenced by an expression (functions and literals excluded), in first-use order. */
export function collectNames(node: Node, out: Set<string> = new Set()): Set<string> {
	switch (node.kind) {
		case 'name':
			out.add(node.name);
			break;
		case 'call':
			node.args.forEach((a) => collectNames(a, out));
			break;
		case 'array':
			node.items.forEach((a) => collectNames(a, out));
			break;
		case 'unary':
			collectNames(node.operand, out);
			break;
		case 'binary':
			collectNames(node.left, out);
			collectNames(node.right, out);
			break;
		case 'ternary':
			collectNames(node.test, out);
			if (node.then) collectNames(node.then, out);
			collectNames(node.otherwise, out);
			break;
		default:
	}
	return out;
}

// ---------------------------------------------------------------------------------------------
// PHP value semantics

const NUMERIC = /^[ \t\n\r\v\f]*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?[ \t\n\r\v\f]*$/;
const LEADING_NUMERIC = /^[ \t\n\r\v\f]*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;

export const isNumericString = (s: string) => NUMERIC.test(s);

export function typeName(v: Value): string {
	if (v === null) return 'null';
	if (Array.isArray(v)) return 'array';
	if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
	return typeof v === 'boolean' ? 'bool' : 'string';
}

/** PHP truthiness: false, 0, "", "0", null and [] are falsy. */
export function toBool(v: Value): boolean {
	if (Array.isArray(v)) return v.length > 0;
	if (typeof v === 'string') return v !== '' && v !== '0';
	return Boolean(v);
}

export function toStr(v: Value): string {
	if (v === null || v === false) return '';
	if (v === true) return '1';
	if (Array.isArray(v)) return 'Array';
	return String(v);
}

/** Operand of an arithmetic operator: numeric strings are converted, other strings/arrays throw. */
function toNumber(v: Value, op: string, other: Value): number {
	if (typeof v === 'number') return v;
	if (typeof v === 'boolean') return v ? 1 : 0;
	if (v === null) return 0;
	if (typeof v === 'string') {
		if (NUMERIC.test(v)) return Number(v);
		const m = LEADING_NUMERIC.exec(v);
		if (m) return Number(m[0]); // PHP: "A non-numeric value" warning, still computes
	}
	throw new ExpressionError(`Unsupported operand types: ${typeName(v)} ${op} ${typeName(other)}`);
}

function cmpNum(a: number, b: number): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function cmpStr(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/** PHP 8 `<=>`. Returns NaN when the values are uncomparable (arrays of different shape). */
export function compare(a: Value, b: Value): number {
	if (Array.isArray(a) || Array.isArray(b)) {
		if (Array.isArray(a) && Array.isArray(b)) {
			if (a.length !== b.length) return cmpNum(a.length, b.length);
			for (let i = 0; i < a.length; i++) {
				const c = compare(a[i], b[i]);
				if (c !== 0) return c;
			}
			return 0;
		}
		return Array.isArray(a) ? 1 : -1; // arrays are always greater
	}
	if (
		typeof a === 'boolean' ||
		typeof b === 'boolean' ||
		(a === null && b !== null && typeof b !== 'string') ||
		(b === null && a !== null && typeof a !== 'string')
	) {
		return cmpNum(Number(toBool(a)), Number(toBool(b)));
	}
	if (a === null || b === null) return cmpStr(toStr(a), toStr(b));
	if (typeof a === 'number' && typeof b === 'number') return cmpNum(a, b);
	if (typeof a === 'number' && typeof b === 'string') {
		return NUMERIC.test(b) ? cmpNum(a, Number(b)) : cmpStr(String(a), b);
	}
	if (typeof a === 'string' && typeof b === 'number') {
		return NUMERIC.test(a) ? cmpNum(Number(a), b) : cmpStr(a, String(b));
	}
	const sa = a as string;
	const sb = b as string;
	if (NUMERIC.test(sa) && NUMERIC.test(sb)) return cmpNum(Number(sa), Number(sb));
	return cmpStr(sa, sb);
}

export function strictEquals(a: Value, b: Value): boolean {
	if (Array.isArray(a) || Array.isArray(b)) {
		return (
			Array.isArray(a) &&
			Array.isArray(b) &&
			a.length === b.length &&
			a.every((x, i) => strictEquals(x, b[i]))
		);
	}
	return a === b;
}

// ---------------------------------------------------------------------------------------------
// Evaluator

export type ExpressionFunction = (...args: Value[]) => Value;

export interface Scope {
	variables: Record<string, Value>;
	functions: Record<string, ExpressionFunction>;
}

function arith(op: string, l: Value, r: Value): Value {
	if (op === '+' && Array.isArray(l) && Array.isArray(r)) return [...l, ...r];
	const a = toNumber(l, op, r);
	const b = toNumber(r, op, l);
	switch (op) {
		case '+':
			return a + b;
		case '-':
			return a - b;
		case '*':
			return a * b;
		case '/':
			if (b === 0) throw new ExpressionError('Division by zero');
			return a / b;
		case '%': {
			const ai = Math.trunc(a);
			const bi = Math.trunc(b);
			if (bi === 0) throw new ExpressionError('Modulo by zero');
			return ai % bi;
		}
		default:
			return a ** b;
	}
}

export function evaluateNode(node: Node, scope: Scope): Value {
	switch (node.kind) {
		case 'literal':
			return node.value;
		case 'name': {
			if (!Object.hasOwn(scope.variables, node.name)) {
				throw new ExpressionError(`Variable "${node.name}" is not valid`);
			}
			return scope.variables[node.name];
		}
		case 'array':
			return node.items.map((n) => evaluateNode(n, scope));
		case 'call': {
			if (!Object.hasOwn(scope.functions, node.name)) {
				throw new ExpressionError(`The function "${node.name}" does not exist`);
			}
			return scope.functions[node.name](...node.args.map((n) => evaluateNode(n, scope)));
		}
		case 'unary': {
			const v = evaluateNode(node.operand, scope);
			if (node.op === '!') return !toBool(v);
			const n = toNumber(v, node.op, null);
			return node.op === '-' ? -n : n;
		}
		case 'ternary': {
			const test = evaluateNode(node.test, scope);
			if (toBool(test)) return node.then ? evaluateNode(node.then, scope) : test;
			return evaluateNode(node.otherwise, scope);
		}
		case 'binary': {
			// Short-circuit operators first.
			if (node.op === '&&' || node.op === 'and') {
				return toBool(evaluateNode(node.left, scope)) && toBool(evaluateNode(node.right, scope));
			}
			if (node.op === '||' || node.op === 'or') {
				return toBool(evaluateNode(node.left, scope)) || toBool(evaluateNode(node.right, scope));
			}
			const l = evaluateNode(node.left, scope);
			const r = evaluateNode(node.right, scope);
			switch (node.op) {
				case '==':
					return Array.isArray(l) || Array.isArray(r) ? compare(l, r) === 0 : compare(l, r) === 0;
				case '!=':
					return compare(l, r) !== 0;
				case '===':
					return strictEquals(l, r);
				case '!==':
					return !strictEquals(l, r);
				case '<':
					return compare(l, r) < 0;
				case '>':
					return compare(l, r) > 0;
				case '<=':
					return compare(l, r) <= 0;
				case '>=':
					return compare(l, r) >= 0;
				case '~':
					return toStr(l) + toStr(r);
				case 'in':
				case 'not in': {
					if (!Array.isArray(r)) throw new ExpressionError('The "in" operator expects an array');
					const found = r.some((x) => compare(l, x) === 0);
					return node.op === 'in' ? found : !found;
				}
				case '..': {
					const a = Math.trunc(toNumber(l, '..', r));
					const b = Math.trunc(toNumber(r, '..', l));
					const out: number[] = [];
					for (let x = a; x <= b && out.length < 10_000; x++) out.push(x);
					return out;
				}
				default:
					return arith(node.op, l, r);
			}
		}
	}
}

/** Parse and evaluate in one go. */
export function evaluate(src: string, scope: Scope): Value {
	return evaluateNode(parse(src), scope);
}
