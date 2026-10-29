<script lang="ts">
	import { enhance } from '$app/forms';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import BrandMark from '#lib/components/app-shell/brand-mark.svelte';
	import ThemeToggle from '#lib/components/theme-toggle.svelte';
	import * as Alert from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import LanguageSelect from '#lib/components/i18n/language-select.svelte';
	import { useI18n } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let server = $derived(String(form?.server || data.selectedServer));
	let submitting = $state(false);
	const { t } = useI18n();

	const serverLabel = $derived(data.servers.find((s) => String(s.index) === server)?.label ?? '');
</script>

<svelte:head>
	<title>{t('Log in')} - svelteMyAdmin</title>
</svelte:head>

<main class="grid min-h-screen bg-background text-foreground lg:grid-cols-2">
	<aside
		class="relative hidden flex-col justify-between overflow-hidden bg-linear-to-br from-primary from-35% to-chart-5 p-12 text-primary-foreground lg:flex"
	>
		<div
			aria-hidden="true"
			class="absolute -top-24 -right-24 size-96 rounded-full bg-primary-foreground/10"
		></div>
		<div
			aria-hidden="true"
			class="absolute -bottom-32 -left-16 size-112 rounded-full bg-primary-foreground/10"
		></div>
		<div class="relative flex items-center gap-3">
			<BrandMark class="ring-2 ring-white/40" />
			<span class="text-xl font-semibold tracking-tight">svelteMyAdmin</span>
		</div>
		<div class="relative max-w-md">
			<p class="text-4xl leading-tight font-semibold tracking-tight">
				{t('A modern MySQL & MariaDB administration tool')}
			</p>
			<p class="mt-4 text-lg text-primary-foreground/80">
				{t(
					'Browse databases, run queries and keep an eye on your servers from one clean dashboard.'
				)}
			</p>
		</div>
		<p class="relative text-sm text-primary-foreground/70">
			{t('Compatible with phpMyAdmin configuration storage.')}
		</p>
	</aside>

	<div class="relative flex flex-col items-center justify-center gap-8 p-6">
		<div class="absolute end-4 top-4"><ThemeToggle /></div>
		<div class="flex items-center gap-3 lg:hidden">
			<BrandMark />
			<span class="text-xl font-semibold tracking-tight">svelteMyAdmin</span>
		</div>
		<Card.Root class="w-full max-w-md">
			<Card.Header>
				<Card.Title>
					<h1 class="text-2xl font-semibold tracking-tight">{t('Log in')}</h1>
				</Card.Title>
				<Card.Description>{t('Use your MySQL / MariaDB account to continue.')}</Card.Description>
			</Card.Header>
			<Card.Content>
				<form
					method="POST"
					class="grid gap-4"
					use:enhance={() => {
						submitting = true;
						return async ({ update }) => {
							await update({ reset: false });
							submitting = false;
						};
					}}
				>
					{#if data.expired && !form?.error}
						<Alert.Root data-testid="login-expired">
							<CircleAlert />
							<Alert.Description>{data.expiredMessage}</Alert.Description>
						</Alert.Root>
					{/if}
					{#if form?.error}
						<Alert.Root variant="destructive" data-testid="login-error">
							<CircleAlert />
							<Alert.Description>{form.error}</Alert.Description>
						</Alert.Root>
					{/if}

					<input type="hidden" name="redirect" value={data.redirectTo} />

					{#if data.servers.length > 1}
						<div class="grid gap-2">
							<Label for="server">{t('Server')}</Label>
							<Select.Root type="single" name="server" bind:value={server}>
								<Select.Trigger id="server" class="w-full">{serverLabel}</Select.Trigger>
								<Select.Content>
									{#each data.servers as s (s.index)}
										<Select.Item value={String(s.index)} label={s.label}>{s.label}</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
					{:else}
						<input type="hidden" name="server" value={data.selectedServer} />
					{/if}

					{#if data.allowArbitraryServer}
						<div class="grid grid-cols-[1fr_6rem] gap-2">
							<div class="grid gap-2">
								<Label for="pma_servername">{t('Host')}</Label>
								<Input
									id="pma_servername"
									name="pma_servername"
									placeholder={t('default server')}
									autocomplete="off"
									value={form?.host ?? ''}
								/>
							</div>
							<div class="grid gap-2">
								<Label for="pma_serverport">{t('Port')}</Label>
								<Input
									id="pma_serverport"
									name="pma_serverport"
									inputmode="numeric"
									placeholder="3306"
									autocomplete="off"
									value={form?.port ?? ''}
								/>
							</div>
						</div>
					{/if}

					<div class="grid gap-2">
						<Label for="username">{t('Username')}</Label>
						<Input
							id="username"
							name="username"
							autocomplete="username"
							required
							value={form?.username ?? ''}
						/>
					</div>

					<div class="grid gap-2">
						<Label for="password">{t('Password')}</Label>
						<Input id="password" name="password" type="password" autocomplete="current-password" />
					</div>

					<div class="grid gap-2">
						<Label for="lang">{t('Language')}</Label>
						<LanguageSelect id="lang" name="lang" />
					</div>

					<Button type="submit" disabled={submitting} class="w-full">
						{submitting ? t('Logging in...') : t('Log in')}
					</Button>
				</form>
			</Card.Content>
		</Card.Root>
	</div>
</main>
