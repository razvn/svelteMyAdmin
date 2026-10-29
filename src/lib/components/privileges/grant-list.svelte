<script module lang="ts">
	export interface GrantRow {
		/** First column (database / table / routine). */
		name: string;
		/** Second column, optional (table or routine type). */
		detail?: string;
		summary: string;
		grantOption: boolean;
		editHref: string;
		/** Hidden fields posted to `?/revoke`. */
		fields: Record<string, string>;
	}
</script>

<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- hrefs carry the account query string */
	import { enhance } from '$app/forms';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';

	interface Props {
		title: string;
		/** Column headings: [name, detail?]. */
		headings: [string, string?];
		rows: GrantRow[];
		canEdit: boolean;
		empty: string;
		testid: string;
	}

	let { title, headings, rows, canEdit, empty, testid }: Props = $props();
</script>

<Card.Root class="gap-0 py-0">
	<Card.Header class="border-b py-5"><Card.Title>{title}</Card.Title></Card.Header>
	<Card.Content class="px-0">
		<Table.Root data-testid={testid}>
			<Table.Header>
				<Table.Row>
					<Table.Head>{headings[0]}</Table.Head>
					{#if headings[1]}<Table.Head>{headings[1]}</Table.Head>{/if}
					<Table.Head>Privileges</Table.Head>
					<Table.Head>Grant</Table.Head>
					<Table.Head class="text-end">Action</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each rows as row (row.name + '|' + (row.detail ?? ''))}
					<Table.Row data-testid="grant-row" data-name={row.name}>
						<Table.Cell class="font-mono text-[13px] font-medium">{row.name}</Table.Cell>
						{#if headings[1]}<Table.Cell class="font-mono text-[13px]">{row.detail}</Table.Cell>{/if}
						<Table.Cell class="max-w-md whitespace-normal">
							<code class="font-mono text-xs break-words">{row.summary}</code>
						</Table.Cell>
						<Table.Cell>
							<Badge variant={row.grantOption ? 'success' : 'muted'}>
								{row.grantOption ? 'Yes' : 'No'}
							</Badge>
						</Table.Cell>
						<Table.Cell class="text-end">
							<form method="POST" action="?/revoke" class="contents" use:enhance>
								{#each Object.entries(row.fields) as [name, value] (name)}
									<input type="hidden" {name} {value} />
								{/each}
								<div class="flex justify-end gap-1">
									{#if canEdit}
										<Button
											variant="ghost"
											size="sm"
											href={row.editHref}
											aria-label="Edit privileges on {row.name}"
										>
											<Pencil /> Edit
										</Button>
										<Button
											variant="ghost"
											size="sm"
											type="submit"
											aria-label="Revoke privileges on {row.name}"
										>
											<Undo2 /> Revoke
										</Button>
									{/if}
								</div>
							</form>
						</Table.Cell>
					</Table.Row>
				{:else}
					<Table.Row>
						<Table.Cell colspan={5} class="py-8 text-center text-muted-foreground">
							{empty}
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</Card.Content>
</Card.Root>
