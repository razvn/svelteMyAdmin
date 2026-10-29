<script lang="ts">
	import { resolve } from '$app/paths';
	import { bare } from '#lib/nav/paths.ts';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Languages from '@lucide/svelte/icons/languages';
	import LogOut from '@lucide/svelte/icons/log-out';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { languageLabel, useI18n } from '#lib/i18n/index.ts';
	import { setLanguage } from '#lib/i18n/switch.ts';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.ts';

	const i18n = useI18n();
	const { t } = i18n;

	interface Props {
		user: string;
		host: string;
		serverLabel: string;
		canLogout: boolean;
		canChangePassword?: boolean;
	}

	let { user, host, serverLabel, canLogout, canChangePassword = false }: Props = $props();

	async function changeLanguage(code: string) {
		if (code !== i18n.locale) await setLanguage(code);
	}

	const initials = $derived(user.slice(0, 2).toUpperCase() || '?');
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<button
				{...props}
				type="button"
				aria-label={t('User menu')}
				class="flex h-10 items-center gap-2.5 rounded-full py-1 ps-1 pe-1 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 xl:pe-3"
			>
				<span
					aria-hidden="true"
					class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
				>
					{initials}
				</span>
				<span
					class="hidden max-w-48 truncate text-sm font-medium xl:block"
					data-testid="connection-info"
				>
					{user}@{host}
				</span>
				<ChevronDown class="hidden size-4 text-muted-foreground xl:block" aria-hidden="true" />
			</button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end" class="w-64">
		<DropdownMenu.Label class="flex flex-col gap-0.5 font-normal">
			<span class="truncate text-sm font-semibold">{user}</span>
			<span class="truncate text-xs text-muted-foreground">{user}@{host}</span>
			<span class="truncate text-xs text-muted-foreground">{serverLabel}</span>
		</DropdownMenu.Label>
		{#if canChangePassword}
			<DropdownMenu.Separator />
			<DropdownMenu.Item>
				{#snippet child({ props })}
					<a {...props} href={resolve(bare('/server/user-password'))}>
						<KeyRound />
						{t('Change password')}
					</a>
				{/snippet}
			</DropdownMenu.Item>
		{/if}
		<DropdownMenu.Separator />
		<DropdownMenu.Sub>
			<DropdownMenu.SubTrigger data-testid="user-menu-language">
				<Languages />
				{t('Language')}
			</DropdownMenu.SubTrigger>
			<DropdownMenu.SubContent class="max-h-80 overflow-y-auto">
				<DropdownMenu.RadioGroup value={i18n.locale} onValueChange={changeLanguage}>
					{#each i18n.languages as l (l.code)}
						<DropdownMenu.RadioItem value={l.code}>{languageLabel(l)}</DropdownMenu.RadioItem>
					{/each}
				</DropdownMenu.RadioGroup>
			</DropdownMenu.SubContent>
		</DropdownMenu.Sub>
		{#if canLogout}
			<DropdownMenu.Separator />
			<form method="POST" action="/logout" class="contents">
				<DropdownMenu.Item>
					{#snippet child({ props })}
						<button {...props} type="submit" class="{props.class} w-full">
							<LogOut />
							{t('Log out')}
						</button>
					{/snippet}
				</DropdownMenu.Item>
			</form>
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>
