<script lang="ts">
	import { useI18n } from '#lib/i18n/index.ts';
	import { tick } from 'svelte';
	import Server from '@lucide/svelte/icons/server';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.ts';

	const { t } = useI18n();

	interface ServerEntry {
		index: number;
		label: string;
		auth: string;
	}

	interface Props {
		servers: ServerEntry[];
		current: number;
	}

	let { servers, current }: Props = $props();

	let form: HTMLFormElement | undefined = $state();
	let target = $state(0);

	async function choose(index: number) {
		if (index === current) return;
		target = index;
		await tick();
		// The logout endpoint clears the session, then continues with the chosen server.
		form?.requestSubmit();
	}
</script>

<!-- Logging out first keeps one session per browser: /logout redirects to /login?server=N. -->
<form bind:this={form} method="POST" action="/logout" class="hidden">
	<input type="hidden" name="server" value={target} />
</form>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="ghost"
				size="icon"
				class="rounded-full"
				aria-label={t('Switch server')}
			>
				<Server />
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end">
		<DropdownMenu.Label>{t('Server')}</DropdownMenu.Label>
		<DropdownMenu.RadioGroup value={String(current)} onValueChange={(v) => choose(Number(v))}>
			{#each servers as s (s.index)}
				<DropdownMenu.RadioItem value={String(s.index)}>{s.label}</DropdownMenu.RadioItem>
			{/each}
		</DropdownMenu.RadioGroup>
	</DropdownMenu.Content>
</DropdownMenu.Root>
