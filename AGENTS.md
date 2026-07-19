# AGENTS.md

Guidance for AI agents working in this repository.

## Git workflow — required

**Never commit fixes or features directly to `main`.** For any change:

1. **Create a new branch off `main`** before making edits. Use a descriptive
   name: `fix/<slug>`, `feat/<slug>`, or `chore/<slug>`
   (e.g. `fix/collection-loading-flash`, `feat/collection-sharing`).
2. Make the change on that branch, keeping commits focused and well-described.
3. **Open a pull request targeting `main`.** Do not merge it yourself — leave it
   for the maintainer to review and merge.

```sh
git checkout main && git pull
git checkout -b fix/<slug>
# …make changes, then…
git add -A && git commit -m "fix: <what changed>"
git push -u origin fix/<slug>
gh pr create --base main --fill
```

- Use the `gh` CLI for PRs. Fill in a clear title and a body that states what
  changed and why, plus any manual steps the maintainer must take (e.g. applying
  a Supabase migration).
- Only push or open a PR when the user has asked you to. If you're on `main`
  when starting work, branch first.

## Before opening a PR

This repo uses **pnpm** (see the `packageManager` field in `package.json`).
Install deps with `pnpm install`. Run and pass both of these — the CI and the
maintainer expect a green tree:

```sh
pnpm run check     # svelte-check (type + a11y); must report 0 errors
pnpm test          # vitest unit tests
```

If a change is observable in the browser, verify it with the dev server
(`pnpm dev`) rather than asking the maintainer to check manually.

## Project overview

SvelteKit 2 + Svelte 5 (runes), TypeScript, Tailwind 4, shadcn-svelte. It's a
**local-first PWA**: the source of truth is IndexedDB (Dexie); Supabase is an
optional sync backend (auth, Postgres, Storage) called directly from the
browser. The app runs fully offline when Supabase isn't configured. Deployed as
a static SPA to GitHub Pages. All ML (OCR, VLM, embeddings, barcodes) runs
on-device — no images are sent to a server.

Key directories under `src/lib/`: `db/` (Dexie schema, repo, types),
`sync/` (Supabase client, auth, sync engine, sharing), `state/` (reactive
live-query stores), `ml/`, `scan/`, `components/` (+ `components/ui/` shadcn
primitives). Routes live in `src/routes/`.

## Conventions

- **Match the surrounding code.** Follow existing naming, comment density, and
  Svelte 5 rune idioms (`$state`, `$derived`, `$effect`). Reactive stores use the
  `Live` / `live()` wrappers in `src/lib/state/live.svelte.ts`.
- **Reads go through Dexie live queries, not the network.** The sync engine
  populates IndexedDB in the background; UI reacts to local changes.
- **Distinguish "loading" from "empty."** `Live`/`live()` expose a `loaded`
  flag — gate empty states on it so cached data or a skeleton shows first,
  never a misleading "nothing here" flash.

## Changing a synced field (important)

The `collections` / `items` / `item_photos` tables sync to Supabase. Adding or
changing a synced column requires **all** of:

1. A new `supabase/migrations/NNN_*.sql` file (next number in sequence).
2. Updating `supabase/schema.sql` to match the end state (for fresh installs).
3. Updating the push **and** pull mapping in
   `src/lib/sync/engine.svelte.ts`.
4. If it needs a local index, bump the Dexie version in
   `src/lib/db/schema.ts`.

Migrations are **applied manually by the maintainer** in the Supabase SQL
editor. Call this out in the PR body. Until the column exists remotely, pushing
dirty rows fails the upsert and sync breaks — so never assume a migration has
been run.

## Sharing & access

Collections can be shared by email with read / write / owner roles (see
`supabase/migrations/005_sharing.sql` and `src/lib/sync/shares.ts`). Access is
enforced by Postgres RLS server-side and mirrored client-side via
`src/lib/state/access.svelte.ts` (`collectionRole`, `canWrite`) for offline
gating. When adding write actions to the UI, gate them on the effective role.

## MCP server

`mcp/` contains a standalone MCP server that exposes the collection to AI agents
via Supabase. It follows the same sync contract (client `updated_at`, soft
deletes). See `mcp/README.md`.
