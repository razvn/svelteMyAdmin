<script lang="ts">
	import { tick } from 'svelte';
	import { startRegistration } from '@simplewebauthn/browser';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import type { SetupView } from '#lib/two-factor/types.ts';

	/** The inputs of the configure step of a backend, to be placed inside a <form>. */
	let { view }: { view: SetupView } = $props();

	let response = $state('');
	let error = $state('');
	let button = $state<HTMLButtonElement | null>(null);

	async function register() {
		if (view.backend !== 'WebAuthn') return;
		error = '';
		try {
			const result = await startRegistration({ optionsJSON: view.options });
			response = JSON.stringify(result);
			await tick();
			button?.form?.requestSubmit();
		} catch (e) {
			error = e instanceof Error ? e.message : 'The security key request failed.';
		}
	}
</script>

{#if view.backend === 'application'}
	<p class="text-sm">
		Please scan following QR code into the two-factor authentication app on your device and enter
		authentication code it generates.
	</p>
	<div
		class="size-48 rounded-md border bg-white p-1 [&_svg]:size-full"
		data-testid="2fa-qr"
		role="img"
		aria-label="QR code"
	>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- server generated SVG of a QR code -->
		{@html view.qrSvg}
	</div>
	<p class="text-sm">
		Secret/key: <strong class="font-mono break-all" data-testid="2fa-secret">{view.secret}</strong>
	</p>
	<div class="grid gap-2">
		<Label for="setup-2fa-code">Authentication code:</Label>
		<Input
			id="setup-2fa-code"
			name="2fa_code"
			inputmode="numeric"
			autocomplete="off"
			autocapitalize="off"
		/>
	</div>
{:else if view.backend === 'simple'}
	<input type="hidden" name="2fa_confirm" value="1" />
	<p class="text-sm text-muted-foreground">For testing purposes only!</p>
{:else}
	<input type="hidden" name="webauthn_creation_response" value={response} />
	<p class="text-sm">
		Please connect your WebAuthn/FIDO2 device. Then confirm registration on the device.
	</p>
	<Button type="button" variant="secondary" bind:ref={button} onclick={register}>
		<KeyRound /> Register security key
	</Button>
	{#if error}
		<p class="text-sm text-destructive" data-testid="webauthn-client-error">{error}</p>
	{/if}
{/if}
