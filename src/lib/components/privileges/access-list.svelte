<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import Pencil from '@lucide/svelte/icons/pencil';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import { Alert, AlertDescription } from '#lib/components/ui/alert/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';

	interface Row {
		user: string;
		host: string;
		value: string;
		type: string;
		routine?: string;
		privileges: string;
		grantOption: boolean;
		editHref: string;
	}

	interface Props {
		/** Heading text: `Users having access to "db"` (or `db.table`). */
		title: string;
		db: string;
		state: 'ok' | 'denied';
		isGrantUser: boolean;
		rows: Row[];
	}

	let { title, db, state, isGrantUser, rows }: Props = $props();
	const typeLabel = (r: Row) => (r.type === 'routine' ? `routine ${r.routine}` : r.type);
</script>

<div class="flex flex-col gap-6">
	<PageHeader icon={ShieldCheck} {title}>
		{#snippet actions()}
			{#if isGrantUser}
				<Button
					href="/server/privileges/add?dbname={encodeURIComponent(db)}"
					data-testid="add-user"
				>
					<UserPlus /> Add user account
				</Button>
			{/if}
		{/snippet}
	</PageHeader>

	{#if state === 'denied'}
		<Alert variant="destructive" role="alert">
			<AlertDescription>
				You do not have the privileges to view the users having access to this page.
			</AlertDescription>
		</Alert>
	{:else}
		<Card.Root class="gap-0 py-0">
			<Card.Content class="px-0">
				<Table.Root data-testid="access-table">
					<Table.Header>
						<Table.Row>
							<Table.Head>User name</Table.Head>
							<Table.Head>Host name</Table.Head>
							<Table.Head>Type</Table.Head>
							<Table.Head>Privileges</Table.Head>
							<Table.Head>Grant</Table.Head>
							<Table.Head class="text-end">Action</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each rows as r, i (i)}
							<Table.Row data-testid="access-row" data-user={r.user} data-type={r.type}>
								<Table.Cell class="font-medium">
									{#if r.user === ''}<span class="text-destructive">Any</span>{:else}{r.user}{/if}
								</Table.Cell>
								<Table.Cell class="font-mono text-[13px]">{r.host}</Table.Cell>
								<Table.Cell><Badge variant="info">{typeLabel(r)}</Badge></Table.Cell>
								<Table.Cell class="max-w-md whitespace-normal">
									<code class="font-mono text-xs break-words">{r.privileges}</code>
								</Table.Cell>
								<Table.Cell>{r.grantOption ? 'Yes' : 'No'}</Table.Cell>
								<Table.Cell class="text-end">
									<div class="flex justify-end gap-1">
										{#if isGrantUser}
											<Button
												variant="ghost"
												size="icon-sm"
												href={r.editHref}
												aria-label="Edit privileges of {r.user || 'Any'}@{r.host}"
												title="Edit privileges"
											>
												<Pencil />
											</Button>
										{/if}
										<form method="POST" action="/server/privileges?/export" class="contents">
											<input type="hidden" name="only" value={r.value} />
											<Button
												variant="ghost"
												size="icon-sm"
												type="submit"
												aria-label="Export {r.user || 'Any'}@{r.host}"
												title="Export"
											>
												<Download />
											</Button>
										</form>
									</div>
								</Table.Cell>
							</Table.Row>
						{:else}
							<Table.Row>
								<Table.Cell colspan={6} class="py-8 text-center text-muted-foreground">
									No user found.
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>
	{/if}
</div>
