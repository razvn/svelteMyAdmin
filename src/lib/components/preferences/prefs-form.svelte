<script lang="ts">
	import { enhance } from '$app/forms';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import { Alert, AlertDescription } from '#lib/components/ui/alert/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.ts';
	import { Textarea } from '#lib/components/ui/textarea/index.ts';
	import { hydration } from '#lib/hooks/hydration.svelte.ts';
	import type { FieldView, FormView } from '#lib/server/preferences/page.ts';

	interface Props {
		view: FormView;
		/** Values to show instead of the saved ones (a rejected submission). */
		posted?: Record<string, string> | null;
		errors?: Record<string, string> | null;
		message?: string | null;
	}

	let { view, posted = null, errors = null, message = null }: Props = $props();

	const allFields = (): FieldView[] => view.sections.flatMap((s) => s.fields);
	let values = $state<Record<string, string>>(
		Object.fromEntries(allFields().map((f) => [f.path, posted?.[f.path] ?? f.value]))
	);
	let submitting = $state(false);

	const isDirty = (f: FieldView) => String(values[f.path]) !== f.value;
	const differs = (f: FieldView) => String(values[f.path]) !== f.serverDefault;
	const dirtyCount = $derived(allFields().filter(isDirty).length);

	function resetAll() {
		for (const f of allFields()) values[f.path] = f.value;
	}
	const inputId = (f: FieldView) => `pref-${f.path.replace(/[^A-Za-z0-9]/g, '-')}`;
</script>

<form
	method="POST"
	action="?/save"
	novalidate
	class="flex flex-col gap-6"
	data-testid="prefs-form"
	use:enhance={() => {
		submitting = true;
		return async ({ update }) => {
			await update({ reset: false });
			submitting = false;
		};
	}}
>
	{#if message}
		<Alert variant="destructive" role="alert"><AlertDescription>{message}</AlertDescription></Alert>
	{/if}
	{#if errors && Object.keys(errors).length > 0}
		<Alert variant="destructive" role="alert" data-testid="prefs-errors">
			<AlertDescription>Some values are not valid. Fix the highlighted fields.</AlertDescription>
		</Alert>
	{/if}

	{#each view.sections as section (section.id)}
		<Card.Root data-testid="section-{section.id}">
			<Card.Header>
				<Card.Title>{section.title}</Card.Title>
				{#if section.description}<Card.Description>{section.description}</Card.Description>{/if}
			</Card.Header>
			<Card.Content class="flex flex-col divide-y">
				{#each section.fields as f (f.path)}
					{@const id = inputId(f)}
					<div
						class="grid gap-2 py-3 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] md:gap-6 {isDirty(
							f
						)
							? '-mx-3 rounded-lg border-l-2 border-primary bg-primary-soft/40 px-3'
							: ''}"
						data-testid="field-{f.path}"
						data-dirty={isDirty(f)}
					>
						<div class="flex min-w-0 flex-col gap-1">
							<label for={id} class="flex flex-wrap items-center gap-2 text-sm font-medium">
								{f.label}
								{#if differs(f)}
									<Badge variant="info" data-testid="badge-{f.path}">Differs from default</Badge>
								{/if}
							</label>
							{#if f.help}<p class="text-xs text-muted-foreground">{f.help}</p>{/if}
							{#if f.comment}<p class="text-xs text-muted-foreground">{f.comment}</p>{/if}
							{#if errors?.[f.path]}
								<p class="text-xs text-destructive" role="alert">{errors[f.path]}</p>
							{/if}
						</div>
						<div class="flex items-start gap-2">
							<div class="min-w-0 flex-1">
								{#if f.type === 'bool'}
									<input type="hidden" name={f.path} value={values[f.path]} />
									<Checkbox
										{id}
										aria-label={f.label}
										checked={values[f.path] === '1'}
										onCheckedChange={(c) => (values[f.path] = c ? '1' : '0')}
									/>
								{:else if f.type === 'select'}
									<NativeSelect {id} name={f.path} bind:value={values[f.path]} class="w-full">
										{#each f.options ?? [] as o (o.value)}
											<NativeSelectOption value={o.value}>{o.label || '(none)'}</NativeSelectOption>
										{/each}
									</NativeSelect>
								{:else if f.type === 'number'}
									<Input
										{id}
										name={f.path}
										type="number"
										step="1"
										min={f.min}
										bind:value={values[f.path]}
										aria-invalid={errors?.[f.path] ? true : undefined}
									/>
								{:else if f.type === 'list'}
									<Textarea {id} name={f.path} rows={3} bind:value={values[f.path]} />
								{:else}
									<Input
										{id}
										name={f.path}
										type="text"
										bind:value={values[f.path]}
										aria-invalid={errors?.[f.path] ? true : undefined}
									/>
								{/if}
							</div>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								class="shrink-0"
								title="Restore default value"
								aria-label="Restore default value of {f.label}"
								disabled={!differs(f)}
								onclick={() => (values[f.path] = f.serverDefault)}
								data-testid="restore-{f.path}"
							>
								<RotateCcw />
							</Button>
						</div>
					</div>
				{/each}
			</Card.Content>
		</Card.Root>
	{/each}

	<div
		class="sticky bottom-0 z-10 flex items-center justify-end gap-2 rounded-xl border bg-card p-3 shadow-card"
	>
		{#if dirtyCount > 0}
			<span class="mr-auto text-sm text-muted-foreground" data-testid="dirty-count">
				{dirtyCount} unsaved {dirtyCount === 1 ? 'change' : 'changes'}
			</span>
		{/if}
		<Button type="button" variant="outline" onclick={resetAll} data-testid="prefs-reset">
			Reset
		</Button>
		<Button type="submit" disabled={!hydration.ready || submitting} data-testid="prefs-apply">
			Apply
		</Button>
	</div>
</form>
