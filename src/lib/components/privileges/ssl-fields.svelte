<script lang="ts">
	import { Input } from '#lib/components/ui/input/index.ts';
	import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.ts';
	import type { SslRequirement, SslType } from '#lib/sql/privileges/index.ts';

	interface Props {
		ssl: SslRequirement;
		disabled?: boolean;
	}

	let { ssl = $bindable(), disabled = false }: Props = $props();

	const TYPES: { value: SslType; label: string; help: string }[] = [
		{ value: 'NONE', label: 'REQUIRE NONE', help: 'Does not require SSL-encrypted connections.' },
		{ value: 'ANY', label: 'REQUIRE SSL', help: 'Requires SSL-encrypted connections.' },
		{ value: 'X509', label: 'REQUIRE X509', help: 'Requires a valid X509 certificate.' },
		{ value: 'SPECIFIED', label: 'SPECIFIED', help: 'Requires specific cipher, issuer or subject.' }
	];
	const help = $derived(TYPES.find((t) => t.value === ssl.type)?.help ?? '');
</script>

<div class="grid gap-4" data-testid="ssl-fields">
	<div class="grid gap-1.5">
		<label for="ssl-type" class="text-sm font-medium">SSL requirement</label>
		<NativeSelect id="ssl-type" name="ssl_type" {disabled} bind:value={ssl.type} class="w-64">
			{#each TYPES as t (t.value)}
				<NativeSelectOption value={t.value}>{t.label}</NativeSelectOption>
			{/each}
		</NativeSelect>
		<p class="text-xs text-muted-foreground">{help}</p>
	</div>
	{#if ssl.type === 'SPECIFIED'}
		<div class="grid gap-4">
			<div class="grid gap-1.5">
				<label for="ssl-cipher" class="text-sm"
					><code class="font-mono text-[13px]">REQUIRE CIPHER</code></label
				>
				<Input
					id="ssl-cipher"
					name="ssl_cipher"
					{disabled}
					title="Requires that a specific cipher method be used for a connection."
					bind:value={ssl.cipher}
				/>
			</div>
			<div class="grid gap-1.5">
				<label for="ssl-issuer" class="text-sm"
					><code class="font-mono text-[13px]">REQUIRE ISSUER</code></label
				>
				<Input
					id="ssl-issuer"
					name="x509_issuer"
					{disabled}
					title="Requires that a valid X509 certificate issued by this CA be presented."
					bind:value={ssl.issuer}
				/>
			</div>
			<div class="grid gap-1.5">
				<label for="ssl-subject" class="text-sm"
					><code class="font-mono text-[13px]">REQUIRE SUBJECT</code></label
				>
				<Input
					id="ssl-subject"
					name="x509_subject"
					{disabled}
					title="Requires that a valid X509 certificate with this subject be presented."
					bind:value={ssl.subject}
				/>
			</div>
		</div>
	{/if}
</div>
