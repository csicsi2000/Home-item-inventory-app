# Roadmap to a real-world-ready release

A review of the codebase as it stands on `fix/ml-durable-queue` (the current tip
of the unmerged work stack), split into defects that need fixing and features
that are missing before the app is something you'd hand to someone who isn't
you.

Ordered by what blocks a release, not by effort.

---

## 0. Release blocker: the work stack isn't on `main`

`main` is nine commits behind the actual state of the project. These branches
are finished locally and never merged or pushed:

| Branch | Ahead of `main` | What it carries |
| --- | --- | --- |
| `fix/supabase-schema-end-state` | 1 | `schema.sql` as the true end state |
| `chore/dexie-v3-schema` | 2 | Dexie v3: tombstone indexes, queue stores |
| `fix/sync-pull-pagination` | 3 | keyset paging so no row is skipped |
| `fix/sync-push-quarantine` | 4 | rejected rows no longer wedge sync |
| `fix/sync-account-boundary` | 5 | account isolation on a shared device |
| `fix/image-queue-integrity` | 6 | tombstone-before-delete for cloud photos |
| `fix/ml-durable-queue` | 7 | durable recognition queue |
| `feat/navigation-view-transitions` | 2 | view transitions |
| `feat/collection-header-mobile` | 1 | (10 behind — needs a rebase) |

They form one stack, so `fix/ml-durable-queue` contains all the sync fixes.
Nothing else on this list matters until that stack lands: every fix below is
built on top of it.

**Action:** open the PRs in stack order, or merge the stack tip as one PR.

---

## 1. Defects

### Fixed on this branch

- **`queue.spec.ts` didn't run.** A missing `afterEach` import made the whole
  suite fail to load, and two tests deadlocked awaiting `processQueue.drain()`,
  which only settles once the test itself resolves the mocked pipeline. `pnpm
  test` was red.
- **Full-table photo scan on every collection view.**
  `src/routes/collections/[id]/+page.svelte` built its thumbnail map from an
  unfiltered `db.photos.filter(...)`, deserializing every thumbnail Blob in the
  database — every other collection included — on first paint and again after
  every photo write. Now scoped to the collection's own items via the `itemId`
  index.
- **Search index listener leak.** Each `build()` registered an `onItemsChanged`
  listener that `resetIndex()` never removed, so every account switch left
  another listener behind doing a Dexie read per changed item to maintain an
  index nothing could reach. A rejected build was also cached forever, so one
  transient failure broke search for the rest of the session.
- **Full page reload from the OCR toast.** The "named from photo text" toast
  navigated with `location.href`, rebooting the SPA — discarding the running
  recognition queue and every live query — instead of `goto`.
- **No error boundary.** A static SPA has no server to fall back on; any
  unexpected error in a route left the framework's bare error screen with no way
  back. Added `src/routes/+error.svelte`.
- **Unvalidated backup import.** Records went into Dexie verbatim, so one
  malformed field from a hand-edited or foreign file (`tags` as a string, say)
  made every screen doing `item.tags.some(...)` throw — an unopenable collection
  with no way back short of clearing site data. Each record is now coerced to the
  shape the app guarantees, and records too broken to place are counted as
  skipped.

### Still open

- **No favicon.** `static/` has PWA icons but no `favicon.ico` / `icon.svg`; the
  dev server 404s on every load and browser tabs show a blank page icon.
- **`purgeTombstones` doesn't reach derived tables.** `embeddings` rows are
  deleted with their item, but `mlJobs` for a purged photo are only dropped when
  the queue next tries to run them. Harmless today, worth a sweep.
- **Import doesn't reconcile parents.** An imported item whose `collectionId`
  doesn't exist locally is written and then invisible — it belongs to no
  collection on any screen. Either import it into a recovery collection or report
  the count.

---

## 2. Missing features, by priority

### P0 — needed before anyone else uses it

1. **Recently deleted / undo.** Deletes are tombstones kept for 30 days, and the
   confirmation dialog says "this can't be undone" — which isn't true, but the
   data is unreachable. A trash view with restore turns an accidental bulk delete
   from a disaster into a non-event. The storage cost is already being paid.
2. **CSV import.** Export exists both ways (JSON and CSV), import only accepts
   the app's own JSON. Anyone with an existing spreadsheet inventory can't get in
   the door — the single biggest adoption barrier for an inventory app.
3. **Onboarding for the camera flow.** The scan screen assumes you know that the
   shutter saves immediately, that recognition happens afterwards, and what
   multi-photo mode does. First run should say so once.
4. **Storage-pressure handling that reaches the user.** `quota.svelte.ts` guards
   writes and Settings shows a percentage, but a phone that fills up mid-scan
   just starts failing. Needs a blocking, actionable warning on the capture
   screen and a "free up space" path (drop full-res blobs for synced photos,
   keeping thumbnails).

### P1 — expected of a finished app

5. **Item history / audit.** No record of what changed when. With
   last-write-wins sync across devices, a surprising overwrite is currently
   unexplainable and unrecoverable.
6. **Offline-explicit UI.** The sync badge covers the signed-in case; there's no
   app-wide "you're offline, changes are queued" affordance, and the queued count
   isn't visible outside Settings.
7. **Search result quality.** MiniSearch is wired up with no result grouping, no
   recent searches, no filters carried over from the collection view, and no
   empty-state guidance.
8. **Print / label export.** Physical inventory work wants a printable list or
   QR labels per item. Nothing today.
9. **Item-level sharing / public read-only link.** Sharing is per collection and
   requires the recipient to have an account.
10. **Bulk photo import from the gallery.** `handleFiles` processes a file list
    serially through the full capture path; there's no progress UI, no
    cancellation, and no way to review before committing 200 items.

### P2 — polish and durability

11. **Lint and format tooling.** No ESLint, no Prettier, no config, no scripts —
    CI runs `check`, `test`, `build` only. Style drift and a whole class of bugs
    (unused vars, floating promises, `svelte/no-reactive-reassign`) go uncaught.
12. **Component and end-to-end tests.** `vite.config.ts` defines a single `server`
    (node) project and explicitly excludes `*.svelte.spec.ts`; there is no browser
    project. Every route, dialog and camera interaction is untested. At minimum:
    a browser vitest project for components, plus a Playwright smoke test of
    create → scan → edit → delete.
13. **Crash reporting.** No way to learn that the app broke on someone's phone.
    A local ring buffer of recent errors, viewable and exportable from Settings,
    fits the no-server constraint.
14. **Accessibility pass beyond svelte-check.** Type checking reports zero a11y
    errors, but nothing has been tested with a screen reader, and the bulk-action
    bar, filter popover and camera overlay are the likely problem areas.
15. **Internationalization.** Every string is inline English. Worth doing only if
    the app is going past its author — but retrofitting later is far more work.

---

## 3. Suggested sequence

1. Land the stack on `main` (§0). Nothing is real until this happens.
2. Merge this branch's defect fixes (§1).
3. P0 features, in order — each is independently shippable.
4. Add lint + a browser test project (§2.11–12) before the P1 work, so the
   larger features land on a net that can catch regressions.
