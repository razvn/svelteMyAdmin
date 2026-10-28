<script lang="ts">
	import type { Component } from 'svelte';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { cn } from '#lib/utils.ts';

	type Tone = 'primary' | 'success' | 'warning' | 'info' | 'destructive';

	interface Props {
		label: string;
		value: string | number;
		icon: Component;
		tone?: Tone;
		/** Secondary line under the value, e.g. a rate or a trend. */
		hint?: string;
		class?: string;
		'data-testid'?: string;
	}

	let {
		label,
		value,
		icon: Icon,
		tone = 'primary',
		hint,
		class: className,
		'data-testid': testid
	}: Props = $props();

	const TONES: Record<Tone, string> = {
		primary: 'bg-primary-soft text-primary',
		success: 'bg-success-soft text-success',
		warning: 'bg-warning-soft text-warning',
		info: 'bg-info-soft text-info',
		destructive: 'bg-destructive-soft text-destructive'
	};
</script>

<Card.Root class={cn('gap-0 p-5', className)} data-testid={testid} data-slot="stat-card">
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0">
			<p class="text-sm text-muted-foreground">{label}</p>
			<p class="mt-1 truncate text-2xl leading-8 font-semibold tracking-tight tabular-nums">
				{value}
			</p>
		</div>
		<span
			aria-hidden="true"
			class={cn('flex size-11 shrink-0 items-center justify-center rounded-xl', TONES[tone])}
		>
			<Icon class="size-5" />
		</span>
	</div>
	{#if hint}
		<p class="mt-3 truncate text-xs text-muted-foreground">{hint}</p>
	{/if}
</Card.Root>
