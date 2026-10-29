<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { namedAction } from '#lib/nav/account-tabs.ts';
	import type { Snippet } from 'svelte';
	import PrivilegeGrid from './privilege-grid.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { hydration } from '#lib/hooks/hydration.svelte.ts';
	import type { PrivServer, Scope } from '#lib/sql/privileges/index.ts';

	interface Props {
		server: PrivServer;
		scope: Scope;
		title: string;
		initial: { privileges: string[]; grantOption: boolean };
		canEdit: boolean;
		/** Hidden fields the action needs (`dbname`, `tablename`, ...), each possibly repeated. */
		hidden: Record<string, string[]>;
		/** Extra form content below the grid (column privileges). */
		extra?: Snippet;
		idPrefix?: string;
	}

	let {
		server,
		scope,
		title,
		initial,
		canEdit,
		hidden,
		extra,
		idPrefix = 'priv'
	}: Props = $props();

	// The parent re-creates this component (keyed) when the saved state changes.
	// svelte-ignore state_referenced_locally
	let privileges = $state([...initial.privileges]);
	// svelte-ignore state_referenced_locally
	let grantOption = $state(initial.grantOption);
	let submitting = $state(false);
</script>

<form
	method="POST"
	action={namedAction(page.url.search, 'save')}
	class="flex flex-col gap-6"
	data-testid="scoped-editor"
	use:enhance={() => {
		submitting = true;
		return async ({ update }) => {
			await update({ reset: false });
			submitting = false;
		};
	}}
>
	{#each Object.entries(hidden) as [name, values] (name)}
		{#each values as value, i (i)}
			<input type="hidden" {name} {value} />
		{/each}
	{/each}
	<Card.Root>
		<Card.Header><Card.Title>{title}</Card.Title></Card.Header>
		<Card.Content>
			<PrivilegeGrid
				{scope}
				{server}
				bind:selected={privileges}
				bind:grantOption
				disabled={!canEdit}
				{idPrefix}
			/>
		</Card.Content>
	</Card.Root>
	{@render extra?.()}
	{#if canEdit}
		<div class="flex justify-end">
			<Button type="submit" disabled={!hydration.ready || submitting} data-testid="save-privileges">
				Go
			</Button>
		</div>
	{/if}
</form>
