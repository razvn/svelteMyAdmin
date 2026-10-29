<script lang="ts">
	import { resolve } from '$app/paths';
	import { bare } from '#lib/nav/paths.ts';
	import Lightbulb from '@lucide/svelte/icons/lightbulb';
	import * as Card from '#lib/components/ui/card/index.ts';
	import * as Alert from '#lib/components/ui/alert/index.ts';
	import * as Collapsible from '#lib/components/ui/collapsible/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { ruleHtml, ruleText } from '#lib/advisor/engine.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	const { t } = useI18n();
	let { data }: PageProps = $props();
	const r = $derived(data.advisor);

	const varHref = (name: string) =>
		`${resolve(bare('/server/variables'))}?filter=${encodeURIComponent(name)}`;
</script>

<svelte:head>
	<title>{t('Advisor')} - svelteMyAdmin</title>
</svelte:head>

<div class="flex flex-col gap-6" data-testid="advisor">
	<Alert.Root variant="info">
		<Lightbulb />
		<Alert.Title>{t('Advisor system')}</Alert.Title>
		<Alert.Description>
			{t(
				'The Advisor system provides recommendations on server variables by analyzing the server status variables. The recommendations are based on simple calculations and rules of thumb that may not apply to your system. Change only one setting at a time and undo it if there is no clearly measurable improvement.'
			)}
		</Alert.Description>
	</Alert.Root>

	{#if r.errors.length > 0}
		<Alert.Root variant="destructive" data-testid="advisor-errors">
			<Alert.Title>{t('Errors occurred while executing rule expressions')}</Alert.Title>
			<Alert.Description>
				<ul class="list-disc ps-5">
					{#each r.errors as e (e)}
						<li>{e}</li>
					{/each}
				</ul>
			</Alert.Description>
		</Alert.Root>
	{/if}

	<Card.Root>
		<Card.Header>
			<Card.Title>{t('Possible performance issues')}</Card.Title>
			<Card.Description class="flex flex-wrap gap-2">
				<Badge variant={r.fired.length ? 'warning' : 'success'} data-testid="fired-count"
					>{t('{n} fired', { n: r.fired.length })}</Badge
				>
				<Badge variant="muted">{t('{n} passed', { n: r.notfired.length })}</Badge>
				<Badge variant="muted">{t('{n} not applicable', { n: r.unchecked.length })}</Badge>
			</Card.Description>
		</Card.Header>
		<Card.Content class="flex flex-col gap-3">
			{#if r.fired.length === 0}
				<p class="text-sm text-muted-foreground">{t('No rule fired.')}</p>
			{/if}
			{#each r.fired as rule, i (rule.id + i)}
				<Collapsible.Root
					open={i === 0}
					class="rounded-xl border bg-warning-soft/40"
					data-testid="advisor-rule"
				>
					<Collapsible.Trigger
						class="flex w-full items-center gap-2 p-4 text-start text-sm font-medium"
					>
						<Badge variant="warning">{t('Issue')}</Badge>
						<span>{ruleText(rule.issue)}</span>
					</Collapsible.Trigger>
					<Collapsible.Content class="px-4 pb-4">
						<dl class="grid gap-x-4 gap-y-2 text-sm md:grid-cols-[10rem_1fr]">
							<dt class="text-muted-foreground">{t('Issue')}</dt>
							<!-- eslint-disable-next-line svelte/no-at-html-tags -- static, trusted rule texts -->
							<dd>{@html ruleHtml(rule.issue, varHref)}</dd>
							<dt class="text-muted-foreground">{t('Recommendation')}</dt>
							<!-- eslint-disable-next-line svelte/no-at-html-tags -- static, trusted rule texts -->
							<dd>{@html ruleHtml(rule.recommendation, varHref)}</dd>
							<dt class="text-muted-foreground">{t('Justification')}</dt>
							<dd>{rule.justification}</dd>
							<dt class="text-muted-foreground">{t('Formula')}</dt>
							<dd><code class="text-xs">{rule.formula}</code></dd>
							<dt class="text-muted-foreground">{t('Test')}</dt>
							<dd><code class="text-xs">{rule.test}</code></dd>
							{#if rule.used.length}
								<dt class="text-muted-foreground">{t('Used variables')}</dt>
								<dd class="flex flex-wrap gap-1.5">
									{#each rule.used as u (u.name)}
										<Badge variant="muted" class="font-mono">{u.name} = {u.value}</Badge>
									{/each}
								</dd>
							{/if}
						</dl>
					</Collapsible.Content>
				</Collapsible.Root>
			{/each}
		</Card.Content>
	</Card.Root>

	{#if r.unchecked.length > 0}
		<Card.Root>
			<Collapsible.Root>
				<Collapsible.Trigger class="w-full p-5 text-start text-sm font-medium">
					{t('Rules that were not evaluated ({n})', { n: r.unchecked.length })}
				</Collapsible.Trigger>
				<Collapsible.Content class="px-5 pb-5">
					<p class="mb-2 text-sm text-muted-foreground">
						{t(
							'Their precondition was not met (for example a feature that is disabled or a variable that this server does not have).'
						)}
					</p>
					<ul class="list-disc ps-5 text-sm" data-testid="advisor-unchecked">
						{#each r.unchecked as rule, i (rule.id + i)}
							<li>{rule.name}</li>
						{/each}
					</ul>
				</Collapsible.Content>
			</Collapsible.Root>
		</Card.Root>
	{/if}
</div>
