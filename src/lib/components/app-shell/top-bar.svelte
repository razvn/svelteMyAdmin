<script lang="ts">
	import { useI18n } from '#lib/i18n/index.ts';
	import { onMount } from 'svelte';
	import Search from '@lucide/svelte/icons/search';
	import Terminal from '@lucide/svelte/icons/terminal';
	import { Button } from '#lib/components/ui/button/index.ts';
	import ThemeToggle from '#lib/components/theme-toggle.svelte';
	import * as Sidebar from '#lib/components/ui/sidebar/index.ts';
	import ServerSwitcher from './server-switcher.svelte';
	import UserMenu from './user-menu.svelte';

	const { t } = useI18n();

	interface Props {
		session: {
			user: string;
			host: string;
			serverLabel: string;
			serverIndex: number;
			canLogout: boolean;
			/** Show "Change password" in the user menu. */
			canChangePassword?: boolean;
		};
		servers: { index: number; label: string; host: string; port: number; auth: string }[];
		onsearch: () => void;
		/** Toggle the SQL console drawer. */
		onconsole?: () => void;
		consoleOpen?: boolean;
	}

	let { session, servers, onsearch, onconsole, consoleOpen = false }: Props = $props();

	let shortcut = $state('Ctrl K');
	onMount(() => {
		if (/Mac|iPhone|iPad/.test(navigator.platform)) shortcut = '⌘K';
	});
</script>

<header class="sticky top-0 z-20 shrink-0 bg-background/85 px-4 pt-4 backdrop-blur md:px-6">
	<div
		class="flex h-16 items-center gap-2 rounded-xl border bg-card px-3 shadow-card sm:gap-3 sm:px-4"
	>
		<Sidebar.Trigger />
		<button
			type="button"
			class="flex h-10 max-w-md min-w-0 flex-1 items-center gap-2.5 rounded-full border border-transparent bg-muted px-4 text-sm text-muted-foreground transition-colors outline-none hover:border-border focus-visible:ring-3 focus-visible:ring-ring/50"
			onclick={onsearch}
			aria-label={t('Open command palette')}
			aria-keyshortcuts="Control+K Meta+K"
		>
			<Search class="size-4 shrink-0" aria-hidden="true" />
			<span class="truncate" aria-hidden="true">{t('Search…')}</span>
			<kbd
				class="ms-auto hidden shrink-0 rounded-md border bg-card px-1.5 py-0.5 font-sans text-[11px] font-medium sm:inline"
				aria-hidden="true"
			>
				{shortcut}
			</kbd>
		</button>

		<div class="ms-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
			{#if servers.length > 1}
				<ServerSwitcher {servers} current={session.serverIndex} />
			{/if}
			{#if onconsole}
				<Button
					type="button"
					variant={consoleOpen ? 'secondary' : 'ghost'}
					size="icon"
					aria-label={t('Toggle SQL console')}
					aria-pressed={consoleOpen}
					aria-keyshortcuts="Control+Alt+C Meta+Alt+C"
					title={t('SQL console ({shortcut})', {
						shortcut: shortcut === '⌘K' ? '⌘⌥C' : 'Ctrl+Alt+C'
					})}
					onclick={onconsole}
				>
					<Terminal class="size-4" aria-hidden="true" />
				</Button>
			{/if}
			<ThemeToggle />
			<UserMenu
				user={session.user}
				host={session.host}
				serverLabel={session.serverLabel}
				canLogout={session.canLogout}
				canChangePassword={session.canChangePassword}
			/>
		</div>
	</div>
</header>
