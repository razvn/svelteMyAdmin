<script lang="ts">
	import { enhance } from '$app/forms';
	import LimitsFields from './limits-fields.svelte';
	import PrivilegeGrid from './privilege-grid.svelte';
	import SslFields from './ssl-fields.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	import { hydration } from '#lib/hooks/hydration.svelte.ts';
	import type { PrivServer, ResourceLimits, SslRequirement } from '#lib/sql/privileges/index.ts';

	interface Props {
		server: PrivServer;
		initial: {
			privileges: string[];
			grantOption: boolean;
			ssl: SslRequirement;
			limits: ResourceLimits;
		};
		canEdit: boolean;
	}

	const { t } = useI18n();
	let { server, initial, canEdit }: Props = $props();

	// The parent re-creates this component (keyed) when the saved state changes.
	// svelte-ignore state_referenced_locally
	let privileges = $state([...initial.privileges]);
	// svelte-ignore state_referenced_locally
	let grantOption = $state(initial.grantOption);
	// svelte-ignore state_referenced_locally
	let ssl = $state<SslRequirement>({ ...initial.ssl });
	// svelte-ignore state_referenced_locally
	let limits = $state<ResourceLimits>({ ...initial.limits });
	let submitting = $state(false);
</script>

<form
	method="POST"
	class="flex flex-col gap-6"
	use:enhance={() => {
		submitting = true;
		return async ({ update }) => {
			await update({ reset: false });
			submitting = false;
		};
	}}
>
	<Card.Root>
		<Card.Header><Card.Title>{t('Global privileges')}</Card.Title></Card.Header>
		<Card.Content>
			<PrivilegeGrid
				scope="global"
				{server}
				bind:selected={privileges}
				bind:grantOption
				disabled={!canEdit}
			/>
		</Card.Content>
	</Card.Root>
	<Card.Root>
		<Card.Header><Card.Title>{t('Resource limits')}</Card.Title></Card.Header>
		<Card.Content><LimitsFields bind:limits disabled={!canEdit} /></Card.Content>
	</Card.Root>
	<Card.Root>
		<Card.Header><Card.Title>{t('SSL')}</Card.Title></Card.Header>
		<Card.Content><SslFields bind:ssl disabled={!canEdit} /></Card.Content>
	</Card.Root>
	{#if canEdit}
		<div class="flex justify-end">
			<Button type="submit" disabled={!hydration.ready || submitting} data-testid="save-privileges">
				{t('Go')}
			</Button>
		</div>
	{/if}
</form>
