<script lang="ts">
	import { enhance } from '$app/forms';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import ThemeToggle from '#lib/components/theme-toggle.svelte';
	import * as Alert from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let server = $derived(String(form?.server || data.selectedServer));
	let lang = $state('en');
	let submitting = $state(false);

	const serverLabel = $derived(data.servers.find((s) => String(s.index) === server)?.label ?? '');
	const langLabel = $derived(data.languages.find((l) => l.code === lang)?.label ?? '');
</script>

<svelte:head>
	<title>Log in - svelteMyAdmin</title>
</svelte:head>

<main class="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
	<Card.Root class="w-full max-w-sm">
		<Card.Header>
			<Card.Title>
				<h1 class="text-2xl font-semibold tracking-tight">svelteMyAdmin</h1>
			</Card.Title>
			<Card.Description>Log in with your MySQL / MariaDB account.</Card.Description>
			<Card.Action>
				<ThemeToggle />
			</Card.Action>
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
						<Label for="server">Server</Label>
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
							<Label for="pma_servername">Host</Label>
							<Input
								id="pma_servername"
								name="pma_servername"
								placeholder="default server"
								autocomplete="off"
								value={form?.host ?? ''}
							/>
						</div>
						<div class="grid gap-2">
							<Label for="pma_serverport">Port</Label>
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
					<Label for="username">Username</Label>
					<Input
						id="username"
						name="username"
						autocomplete="username"
						required
						value={form?.username ?? ''}
					/>
				</div>

				<div class="grid gap-2">
					<Label for="password">Password</Label>
					<Input id="password" name="password" type="password" autocomplete="current-password" />
				</div>

				<div class="grid gap-2">
					<Label for="lang">Language</Label>
					<Select.Root type="single" name="lang" bind:value={lang}>
						<Select.Trigger id="lang" class="w-full">{langLabel}</Select.Trigger>
						<Select.Content>
							{#each data.languages as l (l.code)}
								<Select.Item value={l.code} label={l.label}>{l.label}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<Button type="submit" disabled={submitting} class="w-full">
					{submitting ? 'Logging in...' : 'Log in'}
				</Button>
			</form>
		</Card.Content>
	</Card.Root>
</main>
