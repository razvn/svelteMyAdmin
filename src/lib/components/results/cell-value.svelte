<script lang="ts">
	import * as Popover from '#lib/components/ui/popover/index.ts';
	import type { ColumnKind } from '#lib/table/column-kind.ts';
	import {
		binarySize,
	binaryTitle,
		formatBinary,
		isBinaryCell,
		prettyJson,
		truncate,
		type Cell
	} from './format.ts';
	import type { CellLink } from './types.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t } = useI18n();

	interface Props {
		cell: Cell;
		kind: ColumnKind;
		/** Show at most this many characters until expanded (0 = never truncate). */
		limitChars: number;
		expanded?: boolean;
		ontoggle?: () => void;
		link?: CellLink | null;
		/** URL that downloads the raw bytes of a binary cell. */
		download?: string | null;
	}

	let { cell, kind, limitChars, expanded = false, ontoggle, link, download }: Props = $props();

	const shown = $derived(
		typeof cell === 'string'
			? expanded
				? { text: cell, truncated: false }
				: truncate(cell, limitChars)
			: null
	);
	const canCollapse = $derived(
		typeof cell === 'string' && expanded && limitChars > 0 && Array.from(cell).length > limitChars
	);
	const json = $derived(kind === 'json' && typeof cell === 'string' ? prettyJson(cell) : null);
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- hrefs are signed URLs built by the server -->
{#if cell === null}
	<span class="text-muted-foreground italic">NULL</span>
{:else if isBinaryCell(cell)}
	<span class="font-mono text-xs text-muted-foreground" title={binaryTitle(cell)}
		>{t('[BLOB - {size}]', { size: binarySize(cell) })}</span
	>
	{#if download && cell.bytes > 0}
		<a class="ms-2 text-xs text-primary underline-offset-2 hover:underline" href={download} download
			>{t('Download')}</a
		>
	{/if}
{:else if json !== null && shown}
	<Popover.Root>
		<Popover.Trigger
			class="max-w-xs cursor-pointer truncate text-start font-mono text-xs underline decoration-dotted underline-offset-2"
			title={t('Show formatted JSON')}
		>
			{shown.text}{shown.truncated ? '…' : ''}
		</Popover.Trigger>
		<Popover.Content class="max-h-96 w-96 overflow-auto">
			<pre class="font-mono text-xs whitespace-pre-wrap" data-testid="json-popover">{json}</pre>
		</Popover.Content>
	</Popover.Root>
{:else if shown}
	<span
		class={[
			expanded ? 'break-words whitespace-pre-wrap' : 'whitespace-nowrap',
			kind === 'geometry' && 'font-mono text-xs'
		]}
	>
		{#if link}
			<a
				class="text-primary underline-offset-2 hover:underline"
				href={link.href}
				title={link.title ?? undefined}>{shown.text}</a
			>
		{:else}
			{shown.text}
		{/if}{shown.truncated ? '…' : ''}
	</span>
	{#if shown.truncated || canCollapse}
		<button
			type="button"
			class="ms-1 text-xs text-primary underline-offset-2 hover:underline"
			onclick={(e) => {
				e.stopPropagation();
				ontoggle?.();
			}}
		>
			{expanded ? t('less') : t('more')}
		</button>
	{/if}
{/if}
