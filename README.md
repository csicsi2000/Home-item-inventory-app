https://csicsi2000.github.io/Home-item-inventory-app/

# Card Collection Scanner

A local-first PWA for organizing and inventorying anything you collect — trading cards, electronics, hardware parts, whatever. Scan items with your phone camera; they're saved instantly, named automatically from the text printed on them, checked for duplicates, searchable, and (optionally) synced across your devices.

Built with SvelteKit 2 + Svelte 5, Tailwind CSS v4 + shadcn-svelte, Dexie (IndexedDB), and on-device ML — no photo ever leaves your device for recognition.

## Features

- **Collections** — group items (🃏 cards, 🔌 electronics, 🔩 parts…), with icons, counts and descriptions
- **Quick-add camera flow** — one tap saves the item with its photo; keep snapping
- **Barcode / QR scanning** — native `BarcodeDetector` on Android Chrome, zxing-wasm everywhere else; scanning a barcode you already own offers "bump quantity" instead
- **On-device OCR** (Tesseract.js, offline after first use) — reads card titles, part numbers and labels; auto-names new items and makes every item findable by its printed text
- **Duplicate detection** (on-device) — perceptual hash + MobileNet embeddings; re-scanning the same card raises a "Looks like a duplicate" sheet with *bump quantity / keep both*; near-misses show as "similar items" hints; thresholds tunable in Settings
- **Item management** — quantity, status (owned / sold with price & date / wishlist), condition, tags, notes, purchase info, custom key-value fields, multiple photos, move between collections
- **Fuzzy search** (MiniSearch) — across names, tags, barcodes, OCR text and custom fields, typo-tolerant
- **Local-first + cloud sync** — everything works offline in IndexedDB; sign in (Google or email magic link) to sync via your own free Supabase project, photos included
- **Installable PWA** — offline app shell, home-screen install, update prompts, dark mode, JSON export

## Development

This project uses [pnpm](https://pnpm.io) (`corepack enable` gives you the
version pinned in `package.json`).

```bash
pnpm install
pnpm dev           # http://localhost:5173
pnpm test          # unit tests (Vitest + fake-indexeddb)
pnpm run check     # svelte-check
BASE_PATH=/card_collection_scanner pnpm run build && pnpm run preview
```

The app runs fully **local-only** with no configuration. Cloud sync needs the two env vars below.

## One-time setup

### 1. Supabase (optional — enables sync)

1. Create a free project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run the whole of [`supabase/schema.sql`](supabase/schema.sql) (tables, RLS policies, storage bucket).
3. In **Authentication → Providers**, enable **Google** (and Email, which is on by default).
4. In **Authentication → URL Configuration**:
   - Site URL: `https://<your-user>.github.io/card_collection_scanner/`
   - Additional redirect URLs: `https://<your-user>.github.io/card_collection_scanner/auth/callback` and `http://localhost:5173/auth/callback`
5. Copy the project URL + anon key (**Settings → API**) into `.env.local` for dev (see `.env.example`).

The anon key is public by design — row-level security is the boundary; every user sees only their own rows and photos.

> Free-tier note: Supabase pauses projects after ~7 days without traffic. The app keeps working locally and shows a sync error until you resume the project from the dashboard.

### 2. GitHub Pages deploy

1. Push this repo to GitHub (default branch `main`).
2. **Settings → Pages** → Source: **GitHub Actions**.
3. **Settings → Secrets and variables → Actions → Variables**: add `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` (skip for local-only builds).
4. Push to `main` — [`deploy.yml`](.github/workflows/deploy.yml) builds and publishes to `https://<your-user>.github.io/card_collection_scanner/`.

If you rename the repo, the base path follows the repo name automatically in CI; for local prod builds set `BASE_PATH=/<repo-name>`.

### 3. Install on your phone

Open the deployed URL in Chrome on Android → Settings page → **Install** (or browser menu → *Add to Home screen*). HTTPS is required for both camera access and installation, which GitHub Pages provides.

## On-device verification checklist

- [ ] Android Chrome: rear camera opens on the scan page; shutter saves an item in under a second
- [ ] Scan a retail barcode → value chip appears and attaches to the next photo; re-scanning an owned barcode offers "bump quantity"
- [ ] Photograph a card → item auto-names itself from the card title within a few seconds
- [ ] Photograph the same card again → "Looks like a duplicate" sheet; *bump quantity* merges
- [ ] iOS Safari: camera preview is inline (not fullscreen); gallery fallback works when permission is denied
- [ ] Airplane mode: browsing, adding, editing and searching all work; changes sync when back online
- [ ] Two devices, same account: items + photos propagate both ways; deleting on one removes on the other
- [ ] Lighthouse PWA audit passes on the deployed URL

## Architecture notes

- `src/lib/db` — Dexie schema + repository; every write stamps `updatedAt` + `dirty`, deletes are tombstones
- `src/lib/sync` — push/pull engine over Supabase PostgREST: pushes dirty rows (chunked upserts), pulls by `server_updated_at` cursor, last-write-wins on the client timestamp; photo blobs upload to Storage and hydrate lazily on other devices
- `src/lib/ml` — post-save pipeline (never blocks the shutter): OCR stage → embedding stage → duplicate check; models are lazy-loaded and service-worker cached (`ml-assets` cache)
- `src/lib/scan` — camera, image compression (WebP 1600px + 300px thumb), barcode facade
- Embeddings/pHashes are **derived data** and are not synced; each device recomputes them in the background
- Static SPA (`adapter-static`, `404.html` fallback) so deep links survive GitHub Pages
