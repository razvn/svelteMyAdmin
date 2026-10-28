<script lang="ts">
	import { resetMode, setMode, mode, userPrefersMode } from 'mode-watcher';
	import SunIcon from '@lucide/svelte/icons/sun';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.ts';
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="ghost" size="icon" class="rounded-full" aria-label="Toggle theme">
				{#if mode.current === 'dark'}
					<MoonIcon />
				{:else}
					<SunIcon />
				{/if}
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end">
		<DropdownMenu.RadioGroup
			value={userPrefersMode.current}
			onValueChange={(value) => {
				if (value === 'system') resetMode();
				else setMode(value === 'dark' ? 'dark' : 'light');
			}}
		>
			<DropdownMenu.RadioItem value="light">Light</DropdownMenu.RadioItem>
			<DropdownMenu.RadioItem value="dark">Dark</DropdownMenu.RadioItem>
			<DropdownMenu.RadioItem value="system">System</DropdownMenu.RadioItem>
		</DropdownMenu.RadioGroup>
	</DropdownMenu.Content>
</DropdownMenu.Root>
