<script lang="ts">
	import { useI18n } from '#lib/i18n/index.ts';
	import { tick } from 'svelte';
	import Server from '@lucide/svelte/icons/server';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { filterServers, type PickableServer } from '#lib/servers/filter.ts';

	const { t } = useI18n();

	interface ServerEntry extends PickableServer {
		/** Stable server name (position or discovery id), the form value. */
		key: string;
		auth: string;
	}

	interface Props {
		servers: ServerEntry[];
		/** `key` of the active server. */
		current: string;
	}

	let { servers, current }: Props = $props();

	/** The search box appears only when the menu would be long. */
	const SEARCH_MIN_SERVERS = 5;

	let form: HTMLFormElement | undefined = $state();
	let target = $state('');
	let query = $state('');
	let filterEl: HTMLInputElement | null = $state(null);

	const showSearch = $derived(servers.length > SEARCH_MIN_SERVERS);
	const matches = $derived(filterServers(servers, query));
	const noMatch = $derived(query.trim() !== '' && matches.length === 0);

	async function choose(key: string) {
		if (key === current) return;
		target = key;
		await tick();
		// The logout endpoint clears the session, then continues with the chosen server.
		form?.requestSubmit();
	}

	function onOpenChange(open: boolean) {
		if (!open) {
			query = '';
			return;
		}
		if (showSearch) void tick().then(() => filterEl?.focus());
	}

	function onSearchKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			// Enter picks the first match, like a search box.
			event.preventDefault();
			event.stopPropagation();
			const first = matches[0];
			if (first) void choose(first.key);
			return;
		}
		// Arrows, Tab and Escape keep their menu behaviour; other keys stay in the search box
		// instead of triggering the menu's typeahead.
		if (event.key === 'Escape' || event.key === 'Tab' || event.key.startsWith('Arrow')) return;
		event.stopPropagation();
	}
</script>

<!-- Logging out first keeps one session per browser: /logout redirects to /login?server=<key>. -->
<form bind:this={form} method="POST" action="/logout" class="hidden">
	<input type="hidden" name="server" value={target} />
</form>

<DropdownMenu.Root {onOpenChange}>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="ghost"
				size="icon"
				class="rounded-full"
				aria-label={t('Switch server')}
			>
				<Server />
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end">
		{#if showSearch}
			<div class="p-1 pb-1.5">
				<Input
					type="search"
					placeholder={t('Filter servers…')}
					aria-label={t('Filter servers')}
					autocomplete="off"
					value={query}
					oninput={(event) => (query = event.currentTarget.value)}
					onkeydown={onSearchKeydown}
					bind:ref={filterEl}
				/>
			</div>
		{/if}
		<DropdownMenu.Label>{t('Server')}</DropdownMenu.Label>
		<DropdownMenu.RadioGroup value={current} onValueChange={(v) => choose(v)}>
			{#each matches as s (s.key)}
				<DropdownMenu.RadioItem value={s.key}>{s.label}</DropdownMenu.RadioItem>
			{/each}
		</DropdownMenu.RadioGroup>
		{#if noMatch}
			<p class="px-2 py-1.5 text-sm text-muted-foreground" role="status">
				{t('No server matches')}
			</p>
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>
