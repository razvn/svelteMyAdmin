<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { useI18n } from '#lib/i18n/index.ts';

	interface Props {
		/** Database the bookmark belongs to ('' = server level). */
		db: string;
		/** Current content of the query box. */
		sql: string;
		oncreated?: () => void;
		/** Bound so a loaded bookmark can prefill its label and "replace". */
		label?: string;
		replace?: boolean;
	}

	let { db, sql, oncreated, label = $bindable(''), replace = $bindable(false) }: Props = $props();

	const { t } = useI18n();
	let shared = $state(false);
	let busy = $state(false);

	async function save() {
		if (label.trim() === '' || sql.trim() === '') {
			toast.error(t('Enter a label and a query to bookmark.'));
			return;
		}
		busy = true;
		try {
			const res = await fetch('/api/sql/bookmarks', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'create', db, label, sql, shared, replace })
			});
			if (!res.ok) {
				toast.error(
					res.status === 409
						? t('Bookmarks need the configuration storage.')
						: t('The bookmark could not be saved.')
				);
				return;
			}
			toast.success(t('Bookmark {label} created', { label: label.trim() }));
			label = '';
			replace = false;
			oncreated?.();
		} finally {
			busy = false;
		}
	}
</script>

<div class="flex flex-wrap items-end gap-x-4 gap-y-2" data-testid="bookmark-form">
	<div class="flex min-w-48 flex-1 flex-col gap-1.5">
		<Label for="bookmark-label">{t('Label')}</Label>
		<Input
			id="bookmark-label"
			class="h-8"
			bind:value={label}
			maxlength={255}
			placeholder={t('Label')}
		/>
	</div>
	<div class="flex items-center gap-2 pb-1.5">
		<Checkbox id="bookmark-shared" bind:checked={shared} />
		<Label for="bookmark-shared">{t('Let every user access this bookmark')}</Label>
	</div>
	<div class="flex items-center gap-2 pb-1.5">
		<Checkbox id="bookmark-replace" bind:checked={replace} />
		<Label for="bookmark-replace">{t('Replace existing bookmark of same name')}</Label>
	</div>
	<Button type="button" size="sm" disabled={busy} onclick={save}
		>{t('Bookmark this SQL query')}</Button
	>
</div>
