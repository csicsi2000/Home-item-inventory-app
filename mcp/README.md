# Card Collection MCP server

Gives AI agents (Claude Code, Claude Desktop, or anything MCP-compatible) direct access to
your collection: search and read items, fill in missing details, add new items and
collections, and look at item photos.

It talks straight to the app's Supabase project. Every write follows the app's sync
contract, so changes appear in the PWA on its next sync (within ~5 minutes, or instantly
after any local edit) — and everything you scan on your phone is visible to the agent.

## Setup

```sh
cd mcp
npm install
```

You need three values:

| Env var | Where to find it |
| --- | --- |
| `SUPABASE_URL` | Supabase Dashboard → Project Settings → API (same as `PUBLIC_SUPABASE_URL` in `.env.local`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page, "service_role" key — **a secret; never put it in the web app or commit it** |
| `MCP_USER_EMAIL` | The email you sign in to the app with (or set `MCP_USER_ID` to the Supabase user id directly) |

The service-role key bypasses row security, so the server scopes every query to that one
user. Only run it locally on your own machine.

## Claude Code

The repo ships a `.mcp.json` that starts the server automatically — it reads the three
variables above from your environment. Set them once (e.g. in your PowerShell profile):

```powershell
$env:SUPABASE_URL = "https://<project-ref>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<service-role-key>"
$env:MCP_USER_EMAIL = "you@example.com"
```

Or register it explicitly:

```sh
claude mcp add card-collection -e SUPABASE_URL=... -e SUPABASE_SERVICE_ROLE_KEY=... -e MCP_USER_EMAIL=... -- node <repo>/mcp/server.js
```

## Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
	"mcpServers": {
		"card-collection": {
			"command": "node",
			"args": ["<absolute path to repo>/mcp/server.js"],
			"env": {
				"SUPABASE_URL": "https://<project-ref>.supabase.co",
				"SUPABASE_SERVICE_ROLE_KEY": "<service-role-key>",
				"MCP_USER_EMAIL": "you@example.com"
			}
		}
	}
}
```

## Tools

| Tool | What it does |
| --- | --- |
| `list_collections` | All folders with ids, nesting and custom-field templates |
| `create_collection` / `update_collection` | Manage folders |
| `list_items` | Items by collection and/or status, paginated |
| `search_items` | Search names, descriptions, OCR text, barcodes, tags |
| `get_item` | One item in full, including photo ids |
| `create_item` / `update_item` / `delete_item` | Manage items (deletes are soft and sync everywhere) |
| `get_item_photo` | Returns the photo as an image, so the agent can identify the item and fill in details |
| `add_item_photo` | Upload a local image file onto an item |
| `collection_stats` | Counts and value totals per collection |

Typical prompts: *"Which of my Pokémon cards have no acquisition price? Look at their
photos and fill in names for the untitled ones."* — *"Add a wishlist item 'RTX 5090' to
Electronics."* — *"What's my whole hardware collection worth?"*

## Notes

- The server only sees the configured user's own data (not collections shared with them).
- Item photos added by agents are hydrated (downloaded + thumbnailed) by each device
  automatically on its next sync.
