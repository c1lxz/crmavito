# CRM Avito — UI system

## Product direction

An operations CRM used for long sessions. The interface must feel calm, predictable,
and low-glare. Prioritize scanning and task completion over decorative density.

## Foundations

### Color tokens

| Token | Dark | Light | Purpose |
|---|---:|---:|---|
| `--background` | `#06111F` | `#F4F7FA` | App canvas |
| `--sidebar` | `#081727` | `#FFFFFF` | Navigation |
| `--surface-1` | `#0D1C2F` | `#FFFFFF` | Main cards |
| `--surface-2` | `#10243A` | `#EDF3F8` | Controls, hover |
| `--border` | `#20354A` | `#D9E2EA` | Quiet separators |
| `--text-primary` | `#EDF5FC` | `#122033` | Headings and values |
| `--text-secondary` | `#91A5B8` | `#526579` | Body copy |
| `--text-muted` | `#647B91` | `#75879A` | Metadata |
| `--primary` | `#568AFF` | `#3567E8` | Primary action |
| `--success` | `#59C99A` | `#158A5B` | Complete, positive |
| `--warning` | `#E6B86C` | `#A66712` | Attention |
| `--danger` | `#DD7D86` | `#B53A48` | Error, destructive |

Never use status color without a text label or icon. Avoid large saturated fills.

### Typography

- Font: Inter, then system sans-serif.
- Scale: 12 / 14 / 16 / 20 / 24 / 32.
- Body: 14px / 1.5. Tables may use 13px, never below 12px.
- Headings: 600–650. Avoid all-caps except 11px navigation group captions.
- Monetary values use tabular figures.

### Spacing and shape

- Base unit: 4px. Main rhythm: 8 / 12 / 16 / 24 / 32.
- Desktop content gutter: 32px; tablet: 24px; mobile: 16px.
- Control height: 40–44px. Touch target: at least 44×44px.
- Radius: controls 10px, cards 16px, modal 20px.
- One subtle shadow level for floating surfaces only.

## Layout

- Desktop: 72px utility rail + 208px labelled navigation + fluid content.
- Collapse labelled navigation under 1180px.
- Mobile: top bar + bottom navigation with at most five primary items; secondary
  sections open from “Ещё”.
- Each screen has one `<h1>`, a short contextual subtitle, and at most one primary CTA.
- Tables use a sticky header, quiet row separators, row hover, and a dedicated bulk bar
  that appears only after selection.

## Component rules

- Buttons: primary, secondary, ghost, destructive. Never show two primary buttons together.
- Cards: group related content; do not wrap every metric in a separate card.
- Filters: keep 2–3 common filters visible; move advanced filters into a side sheet.
- Forms: visible labels, helper text for non-obvious fields, validation on blur, errors next
  to the field. Long forms autosave drafts.
- Modals: use for focused creation/confirmation. Use a right drawer for filters and quick
  previews. Use a full page for order details and multi-section editing.
- Notifications: show only action-worthy items on the dashboard.
- Empty states: state why the list is empty and provide one relevant action.
- Loading: skeleton after 300ms; preserve layout dimensions.
- Destructive action: confirmation plus undo toast where recovery is possible.

## Motion

- Hover/focus: 150ms.
- Modal/drawer enter: 220ms ease-out; exit: 150ms ease-in.
- Page content crossfade: 160ms. Do not animate layout dimensions.
- Respect `prefers-reduced-motion`.

## Accessibility

- Body text contrast ≥ 4.5:1; large text and icons ≥ 3:1.
- Visible 2px focus ring with 2px offset.
- Keyboard order follows layout; Escape closes overlays; focus returns to trigger.
- Icon-only buttons require accessible names and tooltips.
- Charts include legends, values, and a table alternative.

## Screen-specific hierarchy

1. Dashboard: weekly sales is the hero; today and attention are secondary.
2. Orders: list and search dominate; metrics are one compact summary strip.
3. Order detail: status/timeline first, finances second, metadata last.
4. Notebook/tasks: split board/list with due dates and assignees.
5. Returns: decision deadline and reason are visually prominent.
6. Warehouse/products: quantity and replenishment state dominate.
7. Expenses/counterparties: stable data-entry patterns and clear totals.
8. Reports: one chart per analytical question; comparison controls stay in the header.
9. Content machine/market analysis: step-based workflow with explicit progress and results.
10. Settings/audit: low density, clear sections, destructive actions separated.

