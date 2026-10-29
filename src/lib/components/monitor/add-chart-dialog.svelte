<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import { PRESETS, chartFromPreset } from '#lib/monitor/presets.ts';
	import { DataPointSchema, type ChartDef, type SeriesDef } from '#lib/monitor/types.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.ts';

	interface Props {
		open: boolean;
		/** Status variable names offered in the custom variable list. */
		statusNames: string[];
		/** Used to build a unique id. */
		nextId: () => string;
		onadd: (chart: ChartDef) => void;
	}

	let { open = $bindable(), statusNames, nextId, onadd }: Props = $props();

	let preset = $state('questions');
	let title = $state('');
	let unit = $state('');
	let display = $state<'differential' | 'absolute'>('differential');
	let divisor = $state('1');
	let variable = $state('');
	let variables = $state<string[]>([]);
	let error = $state('');

	const custom = $derived(preset === 'custom');

	function addVariable() {
		const name = variable.trim();
		if (!name) return;
		if (!DataPointSchema.safeParse({ type: 'statusvar', name }).success) {
			error = 'Invalid variable name.';
			return;
		}
		error = '';
		if (!variables.includes(name)) variables = [...variables, name];
		variable = '';
	}

	function submit() {
		error = '';
		if (!custom) {
			const chart = chartFromPreset(preset, nextId());
			if (chart) {
				onadd(chart);
				open = false;
			}
			return;
		}
		const names = variable.trim() ? [...variables, variable.trim()] : variables;
		const div = Number(divisor);
		if (!title.trim()) return void (error = 'A title is required.');
		if (names.length === 0) return void (error = 'Add at least one status variable.');
		if (!(div > 0) || !Number.isFinite(div)) return void (error = 'The divisor must be positive.');
		const series: SeriesDef[] = [];
		for (const name of names) {
			if (!DataPointSchema.safeParse({ type: 'statusvar', name }).success) {
				return void (error = `Invalid variable name: ${name}`);
			}
			series.push({
				label: name,
				points: [{ type: 'statusvar', name }],
				display,
				divisor: div
			});
		}
		onadd({ id: nextId(), title: title.trim(), unit: unit.trim(), series });
		title = unit = variable = '';
		variables = [];
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg" data-testid="add-chart-dialog">
		<Dialog.Header>
			<Dialog.Title>Add chart</Dialog.Title>
			<Dialog.Description>
				Pick a preset chart or build one from status variables.
			</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col gap-4">
			<div class="flex flex-col gap-1.5">
				<Label for="preset-chart">Preset chart</Label>
				<NativeSelect id="preset-chart" bind:value={preset} class="w-full">
					{#each PRESETS as p (p.key)}
						<NativeSelectOption value={p.key}>{p.label}</NativeSelectOption>
					{/each}
					<NativeSelectOption value="custom">Custom (status variables)</NativeSelectOption>
				</NativeSelect>
			</div>
			{#if custom}
				<div class="flex flex-col gap-1.5">
					<Label for="chart-title">Chart title</Label>
					<Input id="chart-title" bind:value={title} placeholder="My chart" />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="chart-var">Status variable</Label>
					<div class="flex gap-2">
						<Input
							id="chart-var"
							list="monitor-status-names"
							bind:value={variable}
							placeholder="e.g. Com_select"
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									addVariable();
								}
							}}
						/>
						<datalist id="monitor-status-names">
							{#each statusNames as n (n)}
								<option value={n}></option>
							{/each}
						</datalist>
						<Button variant="outline" onclick={addVariable} data-testid="add-variable"
							>Add variable</Button
						>
					</div>
					{#if variables.length}
						<ul class="flex flex-wrap gap-1.5" data-testid="chart-variables">
							{#each variables as v (v)}
								<li
									class="flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-0.5 font-mono text-xs text-primary"
								>
									{v}
									<button
										type="button"
										aria-label="Remove {v}"
										onclick={() => (variables = variables.filter((x) => x !== v))}
									>
										<X class="size-3" />
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
				<div class="grid grid-cols-3 gap-3">
					<div class="flex flex-col gap-1.5">
						<Label for="chart-display">Value</Label>
						<NativeSelect id="chart-display" bind:value={display} class="w-full">
							<NativeSelectOption value="differential">Per second (difference)</NativeSelectOption>
							<NativeSelectOption value="absolute">Absolute value</NativeSelectOption>
						</NativeSelect>
					</div>
					<div class="flex flex-col gap-1.5">
						<Label for="chart-divisor">Divide by</Label>
						<Input id="chart-divisor" type="number" min="0" step="any" bind:value={divisor} />
					</div>
					<div class="flex flex-col gap-1.5">
						<Label for="chart-unit">Unit</Label>
						<Input id="chart-unit" bind:value={unit} placeholder="KiB/s" />
					</div>
				</div>
			{/if}
			{#if error}
				<p class="text-sm text-destructive" role="alert">{error}</p>
			{/if}
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button onclick={submit} data-testid="add-chart-submit">Add chart</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
