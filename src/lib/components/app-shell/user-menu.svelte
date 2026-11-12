<script lang="ts">
	import { resolve } from '$app/paths';
	import { bare } from '#lib/nav/paths.ts';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import LayoutGrid from '@lucide/svelte/icons/layout-grid';
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
		/** `signon`: the person behind the shared MySQL account `user`. */
		identity?: string | null;
		host: string;
		serverLabel: string;
		canLogout: boolean;
		canChangePassword?: boolean;
		/** Back-link to the hosting portal (svelteMultiAdmin). */
		portal?: { url: string; label: string } | null;
	}

	let {
		user,
		identity = null,
		host,
		serverLabel,
		canLogout,
		canChangePassword = false,
		portal = null
	}: Props = $props();

	async function changeLanguage(code: string) {
		if (code !== i18n.locale) await setLanguage(code);
	}

	const displayName = $derived(identity ?? user);
	const initials = $derived(displayName.slice(0, 2).toUpperCase() || '?');
	const connection = $derived(
		identity
			? t('{identity} (as {account})', { identity, account: `${user}@${host}` })
			: `${user}@${host}`
	);
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
					{connection}
				</span>
				<ChevronDown class="hidden size-4 text-muted-foreground xl:block" aria-hidden="true" />
			</button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end" class="w-64">
		<DropdownMenu.Label class="flex flex-col gap-0.5 font-normal">
			<span class="truncate text-sm font-semibold">{displayName}</span>
			<span class="truncate text-xs text-muted-foreground">{connection}</span>
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
		{#if portal}
			<DropdownMenu.Separator />
			<DropdownMenu.Item>
				{#snippet child({ props })}
					<a {...props} href={portal.url} rel="external" data-testid="back-to-portal">
						<LayoutGrid />
						{t('Back to {label}', { label: portal.label })}
					</a>
				{/snippet}
			</DropdownMenu.Item>
		{/if}
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
