<script lang="ts">
	import { tick } from 'svelte';
	import Search from '@lucide/svelte/icons/search';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import { hydration } from '#lib/hooks/hydration.svelte.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	import { filterServers, selectionAfterFilter, type PickableServer } from '#lib/servers/filter.ts';

	interface Props {
		id: string;
		name: string;
		servers: PickableServer[];
		/** The selected server index as a string (form value). */
		value: string;
		/** True while a non-empty filter matches nothing: the form must not be submitted. */
		noMatch?: boolean;
	}

	let { id, name, servers, value = $bindable(), noMatch = $bindable(false) }: Props = $props();

	const { t } = useI18n();

	// The filter is a progressive enhancement: the select works as a plain form control without it.
	let filterOpen = $state(false);
	let query = $state('');
	let toggleEl: HTMLButtonElement | null = $state(null);
	let filterEl: HTMLInputElement | null = $state(null);
	let triggerEl: HTMLButtonElement | null = $state(null);

	const matches = $derived(filterServers(servers, query));
	const selectedLabel = $derived(servers.find((s) => String(s.index) === value)?.label ?? '');
	const filterId = $derived(`${id}-filter`);

	async function toggleFilter() {
		if (filterOpen) {
			await closeFilter();
			return;
		}
		filterOpen = true;
		await tick();
		filterEl?.focus();
	}

	async function closeFilter() {
		filterOpen = false;
		query = '';
		noMatch = false;
		await tick();
		toggleEl?.focus();
	}

	function onQueryInput(event: Event) {
		query = (event.currentTarget as HTMLInputElement).value;
		const next = selectionAfterFilter(matches, Number(value));
		if (next !== undefined && String(next) !== value) value = String(next);
		noMatch = query.trim() !== '' && matches.length === 0;
	}

	function onFilterKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			void closeFilter();
		} else if (event.key === 'Enter' || event.key === 'ArrowDown') {
			// Enter must not submit the login form with a filtered list; both keys move on to the select.
			event.preventDefault();
			triggerEl?.focus();
		}
	}
</script>

<div class="grid gap-2">
	{#if filterOpen}
		<Input
			id={filterId}
			type="search"
			placeholder={t('Filter servers…')}
			aria-label={t('Filter servers')}
			autocomplete="off"
			value={query}
			oninput={onQueryInput}
			onkeydown={onFilterKeydown}
			bind:ref={filterEl}
		/>
	{/if}
	<div class="flex items-center gap-2">
		<Select.Root type="single" {name} bind:value>
			<Select.Trigger {id} class="w-full min-w-0" bind:ref={triggerEl}
				>{selectedLabel}</Select.Trigger
			>
			<Select.Content>
				{#each matches as s (s.index)}
					<Select.Item value={String(s.index)} label={s.label}>{s.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
		{#if servers.length > 1}
			<Button
				type="button"
				variant="outline"
				size="icon"
				aria-label={t('Filter servers')}
				aria-expanded={filterOpen}
				aria-controls={filterOpen ? filterId : undefined}
				disabled={!hydration.ready}
				onclick={toggleFilter}
				bind:ref={toggleEl}
			>
				<Search />
			</Button>
		{/if}
	</div>
	{#if noMatch}
		<p class="text-sm text-muted-foreground" role="status">{t('No server matches')}</p>
	{/if}
</div>
