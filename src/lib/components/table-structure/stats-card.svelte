<script lang="ts">
	import { N_, useI18n } from '#lib/i18n/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
		import type { TableStats } from '#lib/server/table/structure.ts';
	const { t, fmt } = useI18n();

	interface Props {
		stats: TableStats;
	}

	let { stats }: Props = $props();

	const bytes = (n: number): string => {
		const r = fmt.byteDown(n, 3, 1);
		return r ? `${r[0]} ${r[1]}` : '0 B';
	};
	const isInnodb = $derived(stats.engine === 'InnoDB');
	const isMerge = $derived(stats.engine === 'MRG_MYISAM' || stats.engine === 'MERGE');
	const total = $derived(stats.dataLength + stats.indexLength);
	const hasOverhead = $derived(stats.dataFree !== null && stats.dataFree > 0);
	const rowFormat = $derived(
		stats.rowFormat === 'Fixed'
			? t('static')
			: stats.rowFormat === 'Dynamic'
				? t('dynamic')
				: (stats.rowFormat ?? '')
	);
	const date = (v: string | null): string => (v ? v.replace('T', ' ').replace(/\.\d+Z$/, '') : '');

	interface Line {
		label: string;
		value: string;
	}
	const space = $derived.by(() => {
		const lines: Line[] = [{ label: N_('Data'), value: bytes(stats.dataLength) }];
		if (!isMerge) lines.push({ label: N_('Index'), value: bytes(stats.indexLength) });
		if (stats.dataFree !== null) {
			lines.push({ label: N_('Overhead'), value: bytes(stats.dataFree) });
			lines.push({ label: N_('Effective'), value: bytes(Math.max(0, total - stats.dataFree)) });
		}
		if (!isMerge) lines.push({ label: N_('Total'), value: bytes(total) });
		return lines;
	});
	const rowLines = $derived.by(() => {
		const lines: Line[] = [];
		if (stats.rowFormat) lines.push({ label: N_('Format'), value: rowFormat });
		if (stats.createOptions) {
			lines.push({ label: N_('Options'), value: stats.createOptions });
		}
		if (stats.collation) lines.push({ label: N_('Collation'), value: stats.collation });
		if (stats.rows !== null) {
			lines.push({ label: N_('Rows'), value: (isInnodb ? '~' : '') + fmt.number(stats.rows) });
		}
		if (stats.avgRowLength > 0) {
			lines.push({ label: N_('Row length'), value: bytes(stats.avgRowLength) });
		}
		if (stats.rows && stats.rows > 0 && !isMerge) {
			lines.push({ label: N_('Row size'), value: bytes(total / stats.rows) });
		}
		if (stats.autoIncrement !== null) {
			lines.push({ label: N_('Next autoindex'), value: fmt.number(stats.autoIncrement) });
		}
		if (stats.createTime) lines.push({ label: N_('Creation'), value: date(stats.createTime) });
		if (stats.updateTime) lines.push({ label: N_('Last update'), value: date(stats.updateTime) });
		if (stats.checkTime) lines.push({ label: N_('Last check'), value: date(stats.checkTime) });
		return lines;
	});
</script>

{#snippet block(title: string, lines: Line[])}
	<section aria-label={title}>
		<h3 class="mb-2 text-sm font-medium text-muted-foreground">{title}</h3>
		<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
			{#each lines as l (l.label)}
				<dt class="text-muted-foreground">{t(l.label)}</dt>
				<dd class="text-end font-mono tabular-nums" data-testid="stat-{l.label}">{l.value}</dd>
			{/each}
		</dl>
	</section>
{/snippet}

<Card.Root data-testid="table-stats">
	<Card.Header>
		<Card.Title>{t('Information')}</Card.Title>
		{#if stats.comment}
			<Card.Description>{t('Table comments: {comment}', { comment: stats.comment })}</Card.Description>
		{/if}
	</Card.Header>
	<Card.Content class="flex flex-col gap-5">
		{@render block(t('Space usage'), space)}
		{@render block(t('Row statistics'), rowLines)}
		{#if hasOverhead}
			<p class="text-xs text-muted-foreground">
				{t('This table has overhead; OPTIMIZE TABLE reclaims it (Operations tab).')}
			</p>
		{/if}
	</Card.Content>
</Card.Root>
