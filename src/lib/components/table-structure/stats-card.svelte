<script lang="ts">
	import * as Card from '#lib/components/ui/card/index.ts';
	import { formatByteDown, formatNumber } from '#lib/format.ts';
	import type { TableStats } from '#lib/server/table/structure.ts';

	interface Props {
		stats: TableStats;
	}

	let { stats }: Props = $props();

	const bytes = (n: number): string => {
		const r = formatByteDown(n, 3, 1);
		return r ? `${r[0]} ${r[1]}` : '0 B';
	};
	const isInnodb = $derived(stats.engine === 'InnoDB');
	const isMerge = $derived(stats.engine === 'MRG_MYISAM' || stats.engine === 'MERGE');
	const total = $derived(stats.dataLength + stats.indexLength);
	const hasOverhead = $derived(stats.dataFree !== null && stats.dataFree > 0);
	const rowFormat = $derived(
		stats.rowFormat === 'Fixed'
			? 'static'
			: stats.rowFormat === 'Dynamic'
				? 'dynamic'
				: (stats.rowFormat ?? '')
	);
	const date = (v: string | null): string => (v ? v.replace('T', ' ').replace(/\.\d+Z$/, '') : '');

	interface Line {
		label: string;
		value: string;
	}
	const space = $derived.by(() => {
		const lines: Line[] = [{ label: 'Data', value: bytes(stats.dataLength) }];
		if (!isMerge) lines.push({ label: 'Index', value: bytes(stats.indexLength) });
		if (stats.dataFree !== null) {
			lines.push({ label: 'Overhead', value: bytes(stats.dataFree) });
			lines.push({ label: 'Effective', value: bytes(Math.max(0, total - stats.dataFree)) });
		}
		if (!isMerge) lines.push({ label: 'Total', value: bytes(total) });
		return lines;
	});
	const rowLines = $derived.by(() => {
		const lines: Line[] = [];
		if (stats.rowFormat) lines.push({ label: 'Format', value: rowFormat });
		if (stats.createOptions) {
			lines.push({ label: 'Options', value: stats.createOptions });
		}
		if (stats.collation) lines.push({ label: 'Collation', value: stats.collation });
		if (stats.rows !== null) {
			lines.push({ label: 'Rows', value: (isInnodb ? '~' : '') + formatNumber(stats.rows) });
		}
		if (stats.avgRowLength > 0) {
			lines.push({ label: 'Row length', value: bytes(stats.avgRowLength) });
		}
		if (stats.rows && stats.rows > 0 && !isMerge) {
			lines.push({ label: 'Row size', value: bytes(total / stats.rows) });
		}
		if (stats.autoIncrement !== null) {
			lines.push({ label: 'Next autoindex', value: formatNumber(stats.autoIncrement) });
		}
		if (stats.createTime) lines.push({ label: 'Creation', value: date(stats.createTime) });
		if (stats.updateTime) lines.push({ label: 'Last update', value: date(stats.updateTime) });
		if (stats.checkTime) lines.push({ label: 'Last check', value: date(stats.checkTime) });
		return lines;
	});
</script>

{#snippet block(title: string, lines: Line[])}
	<section aria-label={title}>
		<h3 class="mb-2 text-sm font-medium text-muted-foreground">{title}</h3>
		<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
			{#each lines as l (l.label)}
				<dt class="text-muted-foreground">{l.label}</dt>
				<dd class="text-end font-mono tabular-nums" data-testid="stat-{l.label}">{l.value}</dd>
			{/each}
		</dl>
	</section>
{/snippet}

<Card.Root data-testid="table-stats">
	<Card.Header>
		<Card.Title>Information</Card.Title>
		{#if stats.comment}
			<Card.Description>Table comments: {stats.comment}</Card.Description>
		{/if}
	</Card.Header>
	<Card.Content class="flex flex-col gap-5">
		{@render block('Space usage', space)}
		{@render block('Row statistics', rowLines)}
		{#if hasOverhead}
			<p class="text-xs text-muted-foreground">
				This table has overhead; OPTIMIZE TABLE reclaims it (Operations tab).
			</p>
		{/if}
	</Card.Content>
</Card.Root>
