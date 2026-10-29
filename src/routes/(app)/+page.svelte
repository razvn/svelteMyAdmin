<script lang="ts">
	import { resolve } from '$app/paths';
	import { bare } from '#lib/nav/paths.ts';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Monitor from '@lucide/svelte/icons/monitor';
	import Palette from '@lucide/svelte/icons/palette';
	import Server from '@lucide/svelte/icons/server';
	import Settings from '@lucide/svelte/icons/settings';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Activity from '@lucide/svelte/icons/activity';
	import Clock from '@lucide/svelte/icons/clock';
	import Database from '@lucide/svelte/icons/database';
	import AppearanceSettings from '#lib/components/home/appearance-settings.svelte';
	import CollationForm from '#lib/components/home/collation-form.svelte';
	import InfoList from '#lib/components/home/info-list.svelte';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import StatCard from '#lib/components/app-shell/stat-card.svelte';
	import { formatNumber, formatUptimeShort } from '#lib/format.ts';
	import { Alert, AlertDescription } from '#lib/components/ui/alert/index.ts';
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

<PageHeader
	title="Welcome to svelteMyAdmin"
	description="Overview of {data.server.label} and your connection settings."
/>

{#if !data.storageComplete}
	<Alert variant="warning" data-testid="storage-warning">
		<AlertDescription>
			The phpMyAdmin configuration storage is not completely configured, some extended features have
			been deactivated.
			<a
				class="font-medium underline underline-offset-4"
				href={resolve(bare('/server/check-relations'))}>Find out why</a
			>.
		</AlertDescription>
	</Alert>
{/if}

<section aria-label="Server overview" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
	<StatCard
		label="Server version"
		value={data.kpi.version}
		icon={Server}
		tone="primary"
		hint={data.server.type}
	/>
	<StatCard
		label="Uptime"
		value={data.kpi.available ? formatUptimeShort(data.kpi.uptime) : 'n/a'}
		icon={Clock}
		tone="success"
		hint="Since the last server start"
	/>
	<StatCard
		label="Databases"
		value={formatNumber(data.databases.length)}
		icon={Database}
		tone="info"
		hint="Visible to {data.server.user}"
	/>
	<StatCard
		label="Queries per hour"
		value={data.kpi.available ? formatNumber(data.kpi.questionsPerHour) : 'n/a'}
		icon={Activity}
		tone="warning"
		hint="{formatNumber(data.kpi.threadsConnected)} connected threads"
	/>
</section>

<div class="grid items-start gap-6 md:grid-cols-2 xl:grid-cols-3">
	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2"
				><Settings class="size-4 text-primary" />General settings</Card.Title
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
				><Palette class="size-4 text-primary" />Appearance settings</Card.Title
			>
		</Card.Header>
		<Card.Content>
			<AppearanceSettings />
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2"
				><Server class="size-4 text-primary" />Database server</Card.Title
			>
		</Card.Header>
		<Card.Content><InfoList rows={serverRows} /></Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2"
				><Monitor class="size-4 text-primary" />Web server</Card.Title
			>
		</Card.Header>
		<Card.Content><InfoList rows={webRows} /></Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2"
				><Sparkles class="size-4 text-primary" />svelteMyAdmin</Card.Title
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
						class="font-medium text-primary underline-offset-4 hover:underline"
						href="https://docs.phpmyadmin.net/en/latest/"
						rel="noreferrer"
						target="_blank">phpMyAdmin documentation</a
					>
				</li>
			</ul>
		</Card.Content>
	</Card.Root>
</div>
