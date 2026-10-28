<script lang="ts">
	import { resolve } from '$app/paths';
	import { bare } from '#lib/nav/paths.ts';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Monitor from '@lucide/svelte/icons/monitor';
	import Palette from '@lucide/svelte/icons/palette';
	import Server from '@lucide/svelte/icons/server';
	import Settings from '@lucide/svelte/icons/settings';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import AppearanceSettings from '#lib/components/home/appearance-settings.svelte';
	import CollationForm from '#lib/components/home/collation-form.svelte';
	import InfoList from '#lib/components/home/info-list.svelte';
	import { buttonVariants } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const serverRows = $derived([
		{ label: 'Server', value: data.server.label, testid: 'server-name' },
		{ label: 'Connection', value: data.server.connection },
		{ label: 'Server type', value: data.server.type, testid: 'server-type' },
		{
			label: 'Server connection',
			value: data.server.ssl ? 'SSL is used' : 'SSL is not being used'
		},
		{ label: 'Server version', value: data.server.version, testid: 'server-version' },
		{ label: 'Protocol version', value: data.server.protocolVersion },
		{ label: 'User', value: data.server.user },
		{ label: 'Server charset', value: data.server.charset }
	]);
	const webRows = $derived([
		{ label: 'Node.js', value: data.webServer.nodeVersion },
		{ label: 'mysql2', value: data.webServer.mysql2Version },
		{ label: 'SvelteKit', value: data.webServer.kitVersion }
	]);
</script>

<svelte:head>
	<title>svelteMyAdmin</title>
</svelte:head>

<h1 class="text-2xl font-semibold tracking-tight">Welcome to svelteMyAdmin</h1>

<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2"
				><Settings class="size-4" />General settings</Card.Title
			>
		</Card.Header>
		<Card.Content class="grid gap-4">
			<CollationForm
				current={data.collation}
				collations={data.collations}
				error={form?.collationError}
				saved={form?.collationSaved}
			/>
			{#if data.showChgPassword}
				<a
					href={resolve(bare('/server/user-password'))}
					class={buttonVariants({ variant: 'outline' })}
				>
					<KeyRound />
					Change password
				</a>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2"
				><Palette class="size-4" />Appearance settings</Card.Title
			>
		</Card.Header>
		<Card.Content>
			<AppearanceSettings />
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2"
				><Server class="size-4" />Database server</Card.Title
			>
		</Card.Header>
		<Card.Content><InfoList rows={serverRows} /></Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2"><Monitor class="size-4" />Web server</Card.Title>
		</Card.Header>
		<Card.Content><InfoList rows={webRows} /></Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2"
				><Sparkles class="size-4" />svelteMyAdmin</Card.Title
			>
		</Card.Header>
		<Card.Content class="grid gap-4">
			<InfoList
				rows={[{ label: 'Version', value: data.webServer.appVersion, testid: 'app-version' }]}
			/>
			<ul class="grid gap-1 text-sm">
				<li class="text-muted-foreground">Roadmap: <code>docs/ROADMAP.md</code></li>
				<li>
					<a
						class="text-primary underline-offset-4 hover:underline"
						href="https://docs.phpmyadmin.net/en/latest/"
						rel="noreferrer"
						target="_blank">phpMyAdmin documentation</a
					>
				</li>
			</ul>
		</Card.Content>
	</Card.Root>
</div>
