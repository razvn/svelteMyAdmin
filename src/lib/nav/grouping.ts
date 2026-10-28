/**
 * Database grouping by `NavigationTreeDbSeparator` (see Navigation/NavigationTree.php groupTree).
 * Databases sharing the part before the first separator are collected in a group, but only when
 * at least two of them share it (phpMyAdmin leaves singletons ungrouped).
 */

export interface GroupOptions {
	enabled: boolean;
	separator: string;
}

export interface DbLeaf {
	kind: 'db';
	/** Full database name. */
	name: string;
	/** Text shown in the tree (without group prefix inside a group). */
	label: string;
}

export interface DbGroup {
	kind: 'group';
	prefix: string;
	children: DbLeaf[];
}

export type DbTreeEntry = DbLeaf | DbGroup;

export function groupDatabases(names: string[], opts: GroupOptions): DbTreeEntry[] {
	const { enabled, separator } = opts;
	const leaf = (name: string, label = name): DbLeaf => ({ kind: 'db', name, label });
	if (!enabled || separator === '') return names.map((n) => leaf(n));

	const prefixOf = (name: string): string | null => {
		const i = name.indexOf(separator);
		// no separator, or nothing before it, or nothing after it: not groupable
		if (i <= 0 || i + separator.length >= name.length) return null;
		return name.slice(0, i);
	};

	const counts = new Map<string, number>();
	for (const n of names) {
		const p = prefixOf(n);
		if (p !== null) counts.set(p, (counts.get(p) ?? 0) + 1);
	}

	const result: DbTreeEntry[] = [];
	const groups = new Map<string, DbGroup>();
	for (const name of names) {
		const prefix = prefixOf(name);
		if (prefix === null || (counts.get(prefix) ?? 0) < 2) {
			result.push(leaf(name));
			continue;
		}
		let group = groups.get(prefix);
		if (!group) {
			group = { kind: 'group', prefix, children: [] };
			groups.set(prefix, group);
			result.push(group);
		}
		group.children.push(leaf(name, name.slice(prefix.length + separator.length)));
	}
	return result;
}

/** Case-insensitive substring filter used by the database filter box. */
export function filterNames(names: string[], query: string): string[] {
	const q = query.trim().toLowerCase();
	return q === '' ? names : names.filter((n) => n.toLowerCase().includes(q));
}
