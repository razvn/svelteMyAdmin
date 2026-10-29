<script lang="ts">
	import { enhance } from '$app/forms';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Alert, AlertDescription } from '#lib/components/ui/alert/index.ts';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import { hydration } from '#lib/hooks/hydration.svelte.ts';
	import { useI18n } from '#lib/i18n/index.ts';
	import { accountQuery } from '#lib/nav/account-tabs.ts';

	interface Props {
		roles: { name: string; host: string; members: number }[];
		canManage: boolean;
		result?: { ok: boolean; error?: string; created: string | null } | null;
	}

	let { roles, canManage, result = null }: Props = $props();
	const { t } = useI18n();
	let name = $state('');
	let toDrop = $state<{ name: string; host: string } | null>(null);
	let dropForm = $state<HTMLFormElement>();
</script>

<Card.Root class="gap-0 py-0" data-testid="roles-section">
	<Card.Header class="border-b py-5">
		<Card.Title>{t('Roles')}</Card.Title>
		<Card.Description>
			{t(
				'Roles bundle privileges that can be granted to user accounts. Edit a role to set its own privileges.'
			)}
		</Card.Description>
	</Card.Header>
	<Card.Content class="grid gap-4 px-0 pb-5">
		{#if result?.error}
			<Alert variant="destructive" role="alert" class="mx-5 w-auto"
				><AlertDescription>{result.error}</AlertDescription></Alert
			>
		{:else if result?.created}
			<Alert variant="success" role="status" class="mx-5 w-auto" data-testid="role-created">
				<AlertDescription
					>{t('The role {name} was created.', { name: result.created })}</AlertDescription
				>
			</Alert>
		{/if}
		<Table.Root data-testid="roles-table">
			<Table.Header>
				<Table.Row>
					<Table.Head>{t('Role')}</Table.Head>
					<Table.Head>{t('Host name')}</Table.Head>
					<Table.Head class="text-end">{t('Members')}</Table.Head>
					<Table.Head class="text-end">{t('Action')}</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each roles as r (r.name + '@' + r.host)}
					<Table.Row data-testid="role-row" data-role={r.name}>
						<Table.Cell class="font-mono text-[13px] font-medium">
							{r.name}
							<Badge variant="muted">{t('role')}</Badge>
						</Table.Cell>
						<Table.Cell class="font-mono text-[13px]">{r.host || '-'}</Table.Cell>
						<Table.Cell class="text-end tabular-nums">{r.members}</Table.Cell>
						<Table.Cell class="text-end">
							<div class="flex justify-end gap-1">
								<Button
									variant="ghost"
									size="icon-sm"
									href="/server/privileges/edit?{accountQuery({ user: r.name, host: r.host })}"
									aria-label={t('Edit privileges of role {name}', { name: r.name })}
									title={t('Edit privileges')}
								>
									<Pencil />
								</Button>
								{#if canManage}
									<Button
										variant="ghost"
										size="icon-sm"
										disabled={!hydration.ready}
										onclick={() => (toDrop = { name: r.name, host: r.host })}
										aria-label={t('Drop role {name}', { name: r.name })}
										title={t('Drop role')}
									>
										<Trash2 />
									</Button>
								{/if}
							</div>
						</Table.Cell>
					</Table.Row>
				{:else}
					<Table.Row>
						<Table.Cell colspan={4} class="py-6 text-center text-muted-foreground">
							{t('No roles.')}
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
		{#if canManage}
			<form
				method="POST"
				action="?/createRole"
				class="flex flex-wrap items-center gap-2 px-5"
				use:enhance={() =>
					async ({ update }) => {
						await update({ reset: true });
						name = '';
					}}
			>
				<Input
					name="role_name"
					aria-label={t('Role name')}
					placeholder={t('Role name')}
					spellcheck={false}
					class="max-w-xs"
					bind:value={name}
				/>
				<Button type="submit" variant="outline" data-testid="create-role">
					<Plus />
					{t('Create role')}
				</Button>
			</form>
		{/if}
	</Card.Content>
</Card.Root>

<form
	bind:this={dropForm}
	method="POST"
	action="?/dropRole"
	use:enhance={() =>
		async ({ update }) => {
			await update({ reset: false });
			toDrop = null;
		}}
>
	{#if toDrop}<input type="hidden" name="role" value="{toDrop.name}|{toDrop.host}" />{/if}
</form>

<AlertDialog.Root open={toDrop !== null} onOpenChange={(o) => !o && (toDrop = null)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{t('Drop role')}</AlertDialog.Title>
			<AlertDialog.Description>
				{t('The role {name} is removed from every account it was granted to.', {
					name: toDrop?.name ?? ''
				})}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>{t('Cancel')}</AlertDialog.Cancel>
			<AlertDialog.Action
				variant="destructive"
				onclick={(e: MouseEvent) => {
					e.preventDefault();
					dropForm?.requestSubmit();
				}}
			>
				{t('Drop')}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
