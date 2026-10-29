<script lang="ts">
	import Dices from '@lucide/svelte/icons/dices';
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Progress } from '#lib/components/ui/progress/index.ts';
	import { STRENGTH_LABELS, generatePassword, passwordStrength } from '#lib/password.ts';

	interface Props {
		password: string;
		confirm: string;
		disabled?: boolean;
		/** Used by the strength meter to punish passwords that contain the name. */
		userName?: string;
		idPrefix?: string;
		/** Label of the first field. */
		label?: string;
	}

	let {
		password = $bindable(''),
		confirm = $bindable(''),
		disabled = false,
		userName = '',
		idPrefix = 'pw',
		label = 'Password'
	}: Props = $props();

	let reveal = $state(false);
	const strength = $derived(passwordStrength(password, userName));

	function generate() {
		const pw = generatePassword(16);
		password = pw;
		confirm = pw;
		reveal = true;
	}
</script>

<div class="grid gap-3">
	<div class="grid gap-1.5">
		<label for="{idPrefix}-new" class="text-sm font-medium">{label}</label>
		<div class="flex flex-wrap items-center gap-2">
			<Input
				id="{idPrefix}-new"
				name="pma_pw"
				type={reveal ? 'text' : 'password'}
				autocomplete="new-password"
				spellcheck={false}
				{disabled}
				class="max-w-xs min-w-48 flex-1"
				bind:value={password}
			/>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				{disabled}
				aria-label={reveal ? 'Hide password' : 'Show password'}
				aria-pressed={reveal}
				onclick={() => (reveal = !reveal)}
			>
				{#if reveal}<EyeOff />{:else}<Eye />{/if}
			</Button>
			<Button type="button" variant="outline" {disabled} onclick={generate}>
				<Dices /> Generate
			</Button>
		</div>
	</div>
	<div class="grid gap-1.5">
		<label for="{idPrefix}-confirm" class="text-sm font-medium">Re-type</label>
		<Input
			id="{idPrefix}-confirm"
			name="pma_pw2"
			type={reveal ? 'text' : 'password'}
			autocomplete="new-password"
			spellcheck={false}
			{disabled}
			class="max-w-xs"
			bind:value={confirm}
		/>
	</div>
	<div class="flex max-w-xs items-center gap-3" data-testid="password-strength">
		<span class="text-xs text-muted-foreground">Strength:</span>
		<Progress
			value={password === '' ? 0 : (strength + 1) * 20}
			class="max-w-32"
			aria-label="Password strength"
		/>
		<span class="text-xs font-medium" data-testid="password-strength-label">
			{password === '' ? '' : STRENGTH_LABELS[strength]}
		</span>
	</div>
</div>
