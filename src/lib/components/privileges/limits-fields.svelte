<script lang="ts">
	import { Input } from '#lib/components/ui/input/index.ts';
	import type { ResourceLimits } from '#lib/sql/privileges/index.ts';

	interface Props {
		limits: ResourceLimits;
		disabled?: boolean;
	}

	let { limits = $bindable(), disabled = false }: Props = $props();

	const FIELDS = [
		{
			key: 'maxQuestions',
			name: 'max_questions',
			label: 'MAX QUERIES PER HOUR',
			help: 'Limits the number of queries the user may send to the server per hour.'
		},
		{
			key: 'maxUpdates',
			name: 'max_updates',
			label: 'MAX UPDATES PER HOUR',
			help: 'Limits the number of commands that change any table or database the user may execute per hour.'
		},
		{
			key: 'maxConnections',
			name: 'max_connections',
			label: 'MAX CONNECTIONS PER HOUR',
			help: 'Limits the number of new connections the user may open per hour.'
		},
		{
			key: 'maxUserConnections',
			name: 'max_user_connections',
			label: 'MAX USER CONNECTIONS',
			help: 'Limits the number of simultaneous connections the user may have.'
		}
	] as const;
</script>

<div class="grid gap-3" data-testid="resource-limits">
	<p class="text-xs text-muted-foreground">
		Note: Setting these options to 0 (zero) removes the limit.
	</p>
	<div class="grid gap-4 sm:grid-cols-2">
		{#each FIELDS as f (f.key)}
			<div class="grid gap-1.5">
				<label for="limit-{f.name}" class="text-sm" title={f.help}>
					<code class="font-mono text-[13px] font-medium">{f.label}</code>
				</label>
				<Input
					id="limit-{f.name}"
					type="number"
					name={f.name}
					min="0"
					step="1"
					{disabled}
					title={f.help}
					bind:value={limits[f.key]}
				/>
			</div>
		{/each}
	</div>
</div>
