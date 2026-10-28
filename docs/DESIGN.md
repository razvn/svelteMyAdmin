# UI design

svelteMyAdmin looks like a modern admin dashboard (inspired by the design language of NextAdmin), not like
phpMyAdmin: grey canvas, white rounded cards, indigo brand colour, soft status pills. Everything is built from
shadcn-svelte components and the CSS variables in `src/app.css`. Screenshots: `docs/screenshots/`.

## Tokens (`src/app.css`, light in `:root`, dark in `.dark`)

All colours are CSS variables mapped to Tailwind utilities in `@theme inline`. **Never use raw colours**
(`#fff`, `bg-gray-100`, `text-green-600`, ...) in components.

| Token                                        | Light                         | Dark                       | Use                                              |
| -------------------------------------------- | ----------------------------- | -------------------------- | ------------------------------------------------ |
| `background`                                 | gray-100 (`#F3F4F6`)          | slate near-black (`~#0B0F19`) | the app canvas behind cards                   |
| `card` / `popover` / `sidebar`               | white                         | slate (`~#111827`)         | every surface that sits on the canvas            |
| `foreground` / `muted-foreground`            | gray-900 / gray-600 (AA)      | near-white / slate-300     | text, secondary text                             |
| `muted` / `secondary` / `accent`             | gray-50..100                  | slate (`~#1F2937`)         | table header, hover, neutral pills, inputs       |
| `primary` (+ `primary-foreground`)           | indigo `oklch(0.55 0.22 275)` (`~#5750F1`) | lighter indigo | buttons, active nav/tab, links, focus ring, chart-1 |
| `primary-soft`                               | indigo-50                     | indigo at 16 %             | active tab/nav background, icon squares          |
| `success` / `success-soft`                   | green text / green-50         | light green / green at 15 % | OK / YES / ACTIVE                               |
| `warning` / `warning-soft`                   | amber text / amber-50         | light amber / amber at 15 % | attention, INACTIVE                             |
| `info` / `info-soft`                         | blue text / blue-50           | light blue / blue at 16 %  | neutral information                              |
| `destructive` / `destructive-soft`           | red text / red-50             | light red / red at 16 %    | errors, DISABLED, alerts, kill/drop              |
| `chart-1..5`                                 | indigo, sky, green, amber, pink | same hues, a bit lighter | chart series (cycle with `var(--chart-N)`)       |
| `border` / `input` / `ring`                  | gray-200 / gray-300 / indigo  | white 9 % / 14 % / indigo  | 1 px borders, focus ring (`ring-ring/50`)        |

Semantic pairs: `text-success` is already AA on `bg-success-soft` and on white, so a pill is just
`bg-success-soft text-success` (use `<Badge variant="success">`). `shadow-card` is the only shadow cards use.

Radius: `--radius` is `0.55rem`; `rounded-lg` (~9px) for controls (buttons, inputs, nav items, tabs),
`rounded-xl` (~12px) for cards and bars, `rounded-full` for pills, avatars and the search trigger.

## Layout

- **Canvas** `bg-background`; content padding `p-4 md:p-6`, vertical rhythm `gap-6` between blocks, `gap-4`
  between KPI cards.
- **Sidebar** (white, `border-e`): brand (`BrandMark` + wordmark), uppercase muted group labels (`SERVER`,
  `DATABASES`), 36 px nav rows `rounded-lg`, active = `bg-sidebar-accent` (soft indigo) with primary text and icon,
  hover = `bg-muted`. DB tree children are indented under a `border-l` guide line; counts are small muted pills.
- **Top bar** (`app-shell/top-bar.svelte`): sticky white `rounded-xl` bar with the sidebar trigger, a pill
  search trigger (opens the command palette, shows the shortcut), theme toggle, optional server switcher and the user
  menu (`user-menu.svelte`: initials avatar, `user@host`, log out). Breadcrumbs live at the top of the content area.
- **Tab strips** (`tab-bar.svelte`, status sub navigation): white rounded bar (`TAB_STRIP`), tabs from `tabLinkClass()`
  in `app-shell/tab-styles.ts` (active = `bg-primary-soft text-primary`). The "More" overflow logic stays in `tab-bar.svelte`.

## Components

| Component                                 | Purpose                                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| `app-shell/page-header.svelte`            | **Every page starts with it**: `title` (h1, `text-2xl font-semibold`), `description`, optional `icon`, `actions` snippet |
| `app-shell/stat-card.svelte`              | KPI card: label, big value, tinted icon square (`tone`: primary, success, warning, info, destructive), optional `hint` |
| `app-shell/brand-mark.svelte`             | logo mark (indigo rounded square with a database glyph)                                   |
| `ui/badge` variants                       | `primary`, `success`, `warning`, `info`, `muted`, `destructive` (soft pills), plus shadcn `default/secondary/outline/ghost/link` |
| `admin/badges.ts`                         | maps server values to badge variants (`engineSupportVariant`, `pluginStatusVariant`, `yesNoVariant`) |
| `ui/alert` variants                       | `default`, `destructive`, `success`, `warning`, `info` (soft tinted)                      |
| `app-shell/not-implemented.svelte`        | friendly "Coming soon" empty state (icon, text, phase badge)                              |
| `app-shell/error-card.svelte`             | error state (icon, status, message, back button)                                          |

### Cards

`Card.Root` = `rounded-xl border bg-card shadow-card`, padding 24 px. Dashboard blocks use the default padding;
KPI cards use `StatCard` (`p-5`). Never nest a card in a card.

### Tables

Tables live in a card without padding so the header bar spans the full width:

```svelte
<Card.Root class="gap-0 py-0">
	<Card.Header class="border-b py-5"><Card.Title>Traffic</Card.Title></Card.Header>
	<Card.Content class="px-0">
		<Table.Root>…</Table.Root>
	</Card.Content>
</Card.Root>
```

`Table.*` already provides the look: muted header row with small semibold muted text, 12 px vertical cell padding,
subtle dividers, hover background. Conventions: numeric columns `text-end tabular-nums` (no `font-mono`), identifiers and
SQL in `font-mono`, status values as `<Badge>` soft pills, long text `whitespace-normal`, toolbar (filter, bulk actions)
above the table in the same card with `border-b p-5`.

### Charts

Use `var(--chart-N)` for fills, `stroke="var(--card)"` between segments, a legend of coloured dots with percentages,
and an `aria-label` on the `<svg role="img">` (see `status/queries/+page.svelte`, donut from `donutSlices`).

## Do / don't

- Do use tokens and component variants; add a new token (light + dark + `@theme inline`) if you need a colour.
- Do start every page with `PageHeader`; keep one `h1` per page.
- Do keep text at `text-sm` for body, `font-semibold` for headings and `text-muted-foreground` for secondary text.
- Do keep focus rings visible (`focus-visible:ring-3 ring-ring/50`) and contrast AA in both themes.
- Do check light and dark at 1440 px and 800 px before you finish (screenshots in `docs/screenshots/`).
- Don't use raw hex/`gray-*`/`green-*` classes, inline colours or per-page shadows.
- Don't hand-roll buttons, badges, inputs or tables: extend the shadcn components.
- Don't put cards inside cards or use more than one primary (solid indigo) button per view area.
- Don't change aria labels or landmarks (`breadcrumb`, `Server`/`Database`/`Table` tab navs, `svelteMyAdmin home`)
  without updating the e2e tests.
