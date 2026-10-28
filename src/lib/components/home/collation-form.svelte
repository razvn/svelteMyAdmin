<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';

	interface Props {
		current: string;
		collations: { name: string; charset: string }[];
		error?: string;
		saved?: string;
	}

	let { current, collations, error, saved }: Props = $props();

	let value = $derived(current);
	let saving = $state(false);

	const byCharset = $derived(
		Object.entries(Object.groupBy(collations, (c) => c.charset)).map(([charset, list]) => ({
			charset,
			list: list ?? []
		}))
	);
</script>

<form
	method="POST"
	action="?/collation"
	class="grid gap-2"
	use:enhance={() => {
		saving = true;
		return async ({ update }) => {
			await update({ reset: false });
			saving = false;
		};
	}}
>
	<Label for="collation_connection">Server connection collation</Label>
	<div class="flex gap-2">
		<Select.Root type="single" name="collation_connection" bind:value>
			<Select.Trigger
				id="collation_connection"
				class="min-w-0 flex-1"
				data-testid="collation-select"
			>
				{value}
			</Select.Trigger>
			<Select.Content class="max-h-72">
				{#each byCharset as group (group.charset)}
					<Select.Group>
						<Select.GroupHeading>{group.charset}</Select.GroupHeading>
						{#each group.list as c (c.name)}
							<Select.Item value={c.name} label={c.name}>{c.name}</Select.Item>
						{/each}
					</Select.Group>
				{/each}
			</Select.Content>
		</Select.Root>
		<Button type="submit" variant="secondary" disabled={saving || value === current}>Apply</Button>
	</div>
	{#if error}
		<p class="text-sm text-destructive" role="alert">{error}</p>
	{:else if saved}
		<p class="text-sm text-muted-foreground" role="status">Connection collation set to {saved}.</p>
	{/if}
</form>
