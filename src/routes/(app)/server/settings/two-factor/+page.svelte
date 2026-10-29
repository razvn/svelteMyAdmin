<script lang="ts">
	import { enhance } from '$app/forms';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import { Alert, AlertDescription } from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as RadioGroup from '#lib/components/ui/radio-group/index.ts';
	import ChallengeFields from '#lib/components/two-factor/challenge-fields.svelte';
	import SetupFields from '#lib/components/two-factor/setup-fields.svelte';
	import { useI18n } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	const { t } = useI18n();
	let { data, form }: PageProps = $props();

	let choice = $state('');
	const configured = $derived(data.backend.id !== '');
	const setupView = $derived(form && 'setup' in form ? form.setup : null);
	const confirmView = $derived(form && 'confirm' in form ? form.confirm : null);
	const configuring = $derived(form && 'configure' in form ? String(form.configure) : '');
</script>

<svelte:head>
	<title>{t('Two-factor authentication')} - {t('Settings')} - svelteMyAdmin</title>
</svelte:head>

<div class="flex flex-col gap-6" data-testid="two-factor-page">
	{#if data.saved === 'configured'}
		<Alert data-testid="2fa-saved">
			<CircleCheck />
			<AlertDescription>{t('Two-factor authentication has been configured.')}</AlertDescription>
		</Alert>
	{:else if data.saved === 'removed'}
		<Alert data-testid="2fa-saved">
			<CircleCheck />
			<AlertDescription>{t('Two-factor authentication has been removed.')}</AlertDescription>
		</Alert>
	{/if}
	{#if form?.error}
		<Alert variant="destructive" data-testid="2fa-error">
			<CircleAlert />
			<AlertDescription>{form.error}</AlertDescription>
		</Alert>
	{/if}

	<Card.Root>
		<Card.Header>
			<Card.Title>{t('Two-factor authentication status')}</Card.Title>
		</Card.Header>
		<Card.Content class="text-sm" data-testid="2fa-status">
			{#if !data.enabled}
				<p>
					{t(
						'Two-factor authentication is not available, enable phpMyAdmin configuration storage to use it.'
					)}
				</p>
			{:else if configured}
				<p>{t('Two-factor authentication is available and configured for this account.')}</p>
			{:else}
				<p>{t('Two-factor authentication is available, but not configured for this account.')}</p>
			{/if}
		</Card.Content>
	</Card.Root>

	{#if data.enabled && configured && confirmView}
		<Card.Root>
			<Card.Header>
				<Card.Title>{t('Confirm disabling two-factor authentication')}</Card.Title>
				<Card.Description>
					{t(
						'By disabling two factor authentication you will be again able to login using password only.'
					)}
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<form method="POST" action="?/remove" class="grid max-w-md gap-4" use:enhance>
					<input type="hidden" name="2fa_step" value="confirm" />
					<ChallengeFields view={confirmView} idPrefix="confirm-2fa" />
					{#if confirmView.backend !== 'WebAuthn' && confirmView.backend !== 'invalid'}
						<Button type="submit" variant="destructive">{t('Disable two-factor authentication')}</Button>
					{/if}
				</form>
			</Card.Content>
		</Card.Root>
	{:else if data.enabled && configured}
		<Card.Root>
			<Card.Header>
				<Card.Title data-testid="2fa-backend-name">{t(data.backend.name)}</Card.Title>
				<Card.Description>{t('You have enabled two factor authentication.')}</Card.Description>
			</Card.Header>
			<Card.Content class="grid gap-4 text-sm">
				<p>{t(data.backend.description)}</p>
				<form method="POST" action="?/remove" use:enhance>
					<Button type="submit" variant="secondary">{t('Disable two-factor authentication')}</Button>
				</form>
			</Card.Content>
		</Card.Root>
	{:else if data.enabled && setupView}
		<Card.Root>
			<Card.Header>
				<Card.Title>{t('Configure two-factor authentication')}</Card.Title>
			</Card.Header>
			<Card.Content>
				<form method="POST" action="?/configure" class="grid max-w-md gap-4" use:enhance>
					<input type="hidden" name="2fa_configure" value={configuring} />
					<input type="hidden" name="2fa_step" value="confirm" />
					<SetupFields view={setupView} />
					{#if setupView.backend !== 'WebAuthn'}
						<Button type="submit">{t('Enable two-factor authentication')}</Button>
					{/if}
				</form>
			</Card.Content>
		</Card.Root>
	{:else if data.enabled}
		<Card.Root>
			<Card.Header>
				<Card.Title>{t('Configure two-factor authentication')}</Card.Title>
			</Card.Header>
			<Card.Content>
				<form method="POST" action="?/configure" class="grid gap-4" use:enhance>
					<RadioGroup.Root name="2fa_configure" bind:value={choice} class="gap-4">
						{#each data.backends.filter((b) => b.id !== '') as b (b.id)}
							<div class="flex items-start gap-3">
								<RadioGroup.Item value={b.id} id="2fa-choice-{b.id}" class="mt-1" />
								<Label for="2fa-choice-{b.id}" class="grid gap-1 font-normal">
									<strong class="font-medium">{t(b.name)}</strong>
									<span class="text-muted-foreground">{t(b.description)}</span>
								</Label>
							</div>
						{/each}
					</RadioGroup.Root>
					<div>
						<Button type="submit" disabled={choice === ''}
							>{t('Configure two-factor authentication')}</Button
						>
					</div>
				</form>
			</Card.Content>
		</Card.Root>
	{/if}
</div>
