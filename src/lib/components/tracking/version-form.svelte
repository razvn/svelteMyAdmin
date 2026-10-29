<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { VERSION_STATEMENTS } from '#lib/tracking/report.ts';

	interface Props {
		action: string;
		/** Comma separated default statements (`tracking_default_statements`). */
		defaults: string;
		version: number;
		/** Extra hidden fields (e.g. the selected tables). */
		hidden?: { name: string; value: string }[];
		submitLabel?: string;
	}

	let { action, defaults, version, hidden = [], submitLabel = 'Create version' }: Props = $props();

	/* The route data only seeds the form; the user's edits live in local state. */
	/* svelte-ignore state_referenced_locally */
	let checked = $state(defaults.split(',').map((s) => s.trim()));
	/* svelte-ignore state_referenced_locally */
	let number = $state(String(version));

	const toggle = (name: string, on: boolean) =>
		(checked = on
			? [...checked.filter((n) => n !== name), name]
			: checked.filter((n) => n !== name));
</script>

<form method="POST" {action} use:enhance class="flex flex-col gap-4" data-testid="version-form">
	{#each hidden as h (h.name + h.value)}
		<input type="hidden" name={h.name} value={h.value} />
	{/each}
	{#each checked as name (name)}
		<input type="hidden" name="statement" value={name} />
	{/each}
	<div class="flex flex-col gap-1.5">
		<Label for="tracking-version">Version</Label>
		<Input
			id="tracking-version"
			name="version"
			type="number"
			min={1}
			bind:value={number}
			class="w-28"
			required
		/>
	</div>
	<div class="grid gap-4 md:grid-cols-2">
		{#each Object.entries(VERSION_STATEMENTS) as [group, list] (group)}
			<fieldset class="flex flex-col gap-2">
				<legend class="mb-1 text-sm font-medium"
					>Track these {group.toLowerCase()} statements</legend
				>
				{#each list as name (name)}
					<label class="flex items-center gap-2 text-sm">
						<Checkbox
							aria-label={name}
							checked={checked.includes(name)}
							onCheckedChange={(v) => toggle(name, v === true)}
						/>
						{name}
					</label>
				{/each}
			</fieldset>
		{/each}
	</div>
	<div>
		<Button type="submit" data-testid="create-version">{submitLabel}</Button>
	</div>
</form>
