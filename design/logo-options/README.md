# Logo options

Design source for the app mark. These are not shipped or served — the live
assets are generated from the chosen option (see below).

| File | Concept | Notes |
|------|---------|-------|
| `option-a-viewfinder.svg` | **Scan viewfinder framing an item** | **Currently active.** Emphasizes the scanning workflow. |
| `option-b-grid.svg` | Collection grid of varied item tiles | Reads as "a collection of any items"; strongest at tiny sizes. |
| `option-c-stack.svg` | Layered stack of tiles | A growing pile / collection. |

Accent colour is teal `#14b8a6`; background is `#0a0a0a` (matches the PWA
`theme_color` / `background_color`).

## Active mark

Option A is the active mark. It is the source for:

- `src/lib/assets/favicon.svg` — browser-tab icon (identical geometry).
- `static/icons/icon-192.png`, `icon-512.png` — PWA icons (rounded).
- `static/icons/icon-512-maskable.png` — Android adaptive icon (full-bleed
  background, content inset into the ~80% safe zone).

To switch options or regenerate the PNGs, re-render from the chosen SVG (e.g.
with `sharp`) at 192/512, and produce a maskable variant with the content
scaled to ~0.82 about centre on a full-bleed square background.
