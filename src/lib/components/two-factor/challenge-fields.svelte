<script lang="ts">
	import { tick } from 'svelte';
	import { startAuthentication } from '@simplewebauthn/browser';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import type { ChallengeView } from '#lib/two-factor/types.ts';

	/** The inputs of the second-factor step of an existing backend, to be placed inside a <form>. */
	let { view, idPrefix = '2fa' }: { view: ChallengeView; idPrefix?: string } = $props();

	let response = $state('');
	let error = $state('');
	let button = $state<HTMLButtonElement | null>(null);

	async function authenticate() {
		if (view.backend !== 'WebAuthn') return;
		error = '';
		try {
			const result = await startAuthentication({ optionsJSON: view.options });
			response = JSON.stringify(result);
			await tick();
			button?.form?.requestSubmit();
		} catch (e) {
			error = e instanceof Error ? e.message : 'The security key request failed.';
		}
	}
</script>

{#if view.backend === 'application'}
	<div class="grid gap-2">
		<Label for="{idPrefix}-code">Authentication code:</Label>
		<Input
			id="{idPrefix}-code"
			name="2fa_code"
			inputmode="numeric"
			autocomplete="one-time-code"
			autocapitalize="off"
			autofocus
		/>
		<p class="text-sm text-muted-foreground">
			Open the two-factor authentication app on your device to view your authentication code and
			verify your identity.
		</p>
	</div>
{:else if view.backend === 'simple'}
	<input type="hidden" name="2fa_confirm" value="1" />
	<p class="text-sm text-muted-foreground">Simple two-factor authentication (testing only).</p>
{:else if view.backend === 'WebAuthn'}
	<input type="hidden" name="webauthn_request_response" value={response} />
	<p class="text-sm text-muted-foreground">
		Please connect your WebAuthn/FIDO2 device. Then confirm login on the device.
	</p>
	<Button type="button" variant="secondary" bind:ref={button} onclick={authenticate}>
		<KeyRound /> Use security key
	</Button>
	{#if error}
		<p class="text-sm text-destructive" data-testid="webauthn-client-error">{error}</p>
	{/if}
{:else}
	<p class="text-sm text-destructive">
		The configured two-factor authentication method is not available. Ask an administrator to reset
		it, or log out.
	</p>
{/if}
