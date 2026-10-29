<script lang="ts">
	import { highlightSql, type TokenKind } from '#lib/transformations/highlight.ts';
	import type { Transformed } from '#lib/transformations/types.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	const { t } = useI18n();

	interface Props {
		value: Transformed;
	}

	let { value }: Props = $props();

	const tokenClass: Record<TokenKind, string> = {
		keyword: 'font-semibold text-primary',
		string: 'text-success',
		number: 'text-warning',
		comment: 'text-muted-foreground italic',
		punct: 'text-muted-foreground',
		plain: ''
	};
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- hrefs are signed wrapper URLs or sanitised links -->
{#if value.type === 'text'}
	<span
		class="whitespace-pre-wrap"
		title={value.title ? t(value.title) : undefined}
		data-transformed="text"
	>{value.text}</span>
{:else if value.type === 'link'}
	<a
		class="text-primary underline-offset-2 hover:underline"
		href={value.href}
		title={value.title}
		target={value.blank ? '_blank' : undefined}
		rel={value.blank ? 'noopener noreferrer' : undefined}
		data-transformed="link">{value.text}</a
	>
{:else if value.type === 'image'}
	<a href={value.href} target="_blank" rel="noopener noreferrer" data-transformed="image">
		<img
			src={value.src}
			alt={value.alt}
			loading="lazy"
			class="inline-block object-contain"
			style:max-width={value.width ? `${value.width}px` : undefined}
			style:max-height={value.height ? `${value.height}px` : undefined}
		/>
	</a>
{:else if value.type === 'code'}
	<pre
		class="max-h-60 max-w-md overflow-auto rounded-md bg-muted px-2 py-1 font-mono text-xs whitespace-pre-wrap"
		data-transformed="code"
		data-language={value.language}>{#if value.language === 'sql'}{#each highlightSql(value.text) as tbl, i (i)}<span
					class={tokenClass[tbl.kind]}>{tbl.text}</span
				>{/each}{:else}{value.text}{/if}</pre>
{:else if value.type === 'frame'}
	<iframe
		title={t('Formatted value')}
		srcdoc={value.srcdoc}
		sandbox=""
		class="h-24 w-64 rounded-md border bg-background"
		data-transformed="frame"
	></iframe>
{/if}
