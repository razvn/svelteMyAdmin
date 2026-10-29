<script lang="ts">
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import {
		GRANT_OPTION,
		describePrivilege,
		groupedPrivileges,
		type PrivServer,
		type Scope
	} from '#lib/sql/privileges/index.ts';

	interface Props {
		scope: Scope;
		server: PrivServer;
		/** Checked privilege keywords. Posted as repeated `priv` fields. */
		selected: string[];
		/** Posted as `grant_option` when checked. */
		grantOption?: boolean;
		showGrantOption?: boolean;
		disabled?: boolean;
		/** Prefix of the element ids (several grids may live on one page). */
		idPrefix?: string;
	}

	let {
		scope,
		server,
		selected = $bindable(),
		grantOption = $bindable(false),
		showGrantOption = true,
		disabled = false,
		idPrefix = 'priv'
	}: Props = $props();

	const groups = $derived(groupedPrivileges(scope, server));
	const allNames = $derived(groups.flatMap((g) => g.items.map((p) => p.name)));
	const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

	function setMany(names: string[], on: boolean) {
		const rest = selected.filter((n) => !names.includes(n));
		selected = on ? [...rest, ...names.filter((n) => !rest.includes(n))] : rest;
	}
	function toggle(name: string, on: boolean) {
		setMany([name], on);
	}
	const countIn = (names: string[]) => names.filter((n) => selected.includes(n)).length;
</script>

{#each selected as name (name)}
	<input type="hidden" name="priv" value={name} />
{/each}
{#if grantOption}
	<input type="hidden" name="grant_option" value="1" />
{/if}

<div class="grid gap-5" data-testid="privilege-grid" data-scope={scope}>
	<div class="flex items-center gap-2">
		<Checkbox
			id="{idPrefix}-check-all"
			aria-label="Check all"
			{disabled}
			checked={allNames.length > 0 && countIn(allNames) === allNames.length}
			indeterminate={countIn(allNames) > 0 && countIn(allNames) < allNames.length}
			onCheckedChange={(v) => setMany(allNames, v === true)}
		/>
		<label for="{idPrefix}-check-all" class="text-sm font-medium">Check all</label>
		<span class="text-xs text-muted-foreground"
			>Note: MySQL privilege names are expressed in English.</span
		>
	</div>

	{#each groups as group (group.group)}
		{@const names = group.items.map((p) => p.name)}
		<fieldset class="grid gap-3 rounded-lg border p-4" data-group={group.group}>
			<legend class="flex items-center gap-2 px-1 text-sm font-semibold">
				<Checkbox
					id="{idPrefix}-group-{group.group}"
					aria-label="Check all {group.label}"
					{disabled}
					checked={countIn(names) === names.length}
					indeterminate={countIn(names) > 0 && countIn(names) < names.length}
					onCheckedChange={(v) => setMany(names, v === true)}
				/>
				<label for="{idPrefix}-group-{group.group}">{group.label}</label>
			</legend>
			<div class="grid gap-x-6 gap-y-2.5 sm:grid-cols-2 xl:grid-cols-3">
				{#each group.items as p (p.name)}
					{@const id = `${idPrefix}-${slug(p.name)}`}
					<div class="flex items-start gap-2">
						<Checkbox
							{id}
							aria-label={p.name}
							{disabled}
							class="mt-0.5"
							checked={selected.includes(p.name)}
							onCheckedChange={(v) => toggle(p.name, v === true)}
						/>
						<label
							for={id}
							class="grid gap-0.5 text-sm"
							title={describePrivilege(p, scope, server)}
						>
							<code class="font-mono text-[13px] font-medium">{p.name}</code>
							<span class="text-xs leading-snug text-muted-foreground">
								{describePrivilege(p, scope, server)}
							</span>
						</label>
					</div>
				{/each}
				{#if group.group === 'administration' && showGrantOption && GRANT_OPTION.scopes.includes(scope as never)}
					<div class="flex items-start gap-2">
						<Checkbox
							id="{idPrefix}-grant-option"
							aria-label="GRANT OPTION"
							{disabled}
							class="mt-0.5"
							bind:checked={grantOption}
						/>
						<label for="{idPrefix}-grant-option" class="grid gap-0.5 text-sm">
							<code class="font-mono text-[13px] font-medium">GRANT</code>
							<span class="text-xs leading-snug text-muted-foreground"
								>{GRANT_OPTION.description}</span
							>
						</label>
					</div>
				{/if}
			</div>
		</fieldset>
	{/each}
</div>
