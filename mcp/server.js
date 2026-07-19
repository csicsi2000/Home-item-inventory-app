// MCP server for the Card Collection Scanner.
//
// Talks directly to the app's Supabase project, so anything an agent writes
// shows up in the PWA on its next sync (and vice versa). Rows follow the
// app's sync contract: client-side `updated_at` for last-write-wins, soft
// deletes via `deleted_at`, and the server trigger bumps `server_updated_at`
// so devices pull the change.
//
// Required environment:
//   SUPABASE_URL                your project URL
//   SUPABASE_SERVICE_ROLE_KEY   service-role key (server-side secret!)
//   MCP_USER_EMAIL or MCP_USER_ID   which account owns the data

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { z } from 'zod';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
	console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see mcp/README.md).');
	process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

/** The service role bypasses RLS, so every query is scoped to this user. */
async function resolveUserId() {
	if (process.env.MCP_USER_ID) return process.env.MCP_USER_ID;
	const email = process.env.MCP_USER_EMAIL?.toLowerCase();
	if (!email) {
		console.error('Set MCP_USER_EMAIL (or MCP_USER_ID) to pick the account.');
		process.exit(1);
	}
	const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
	if (error) {
		console.error('Could not list users:', error.message);
		process.exit(1);
	}
	const user = data.users.find((u) => u.email?.toLowerCase() === email);
	if (!user) {
		console.error(`No Supabase user with email ${email}.`);
		process.exit(1);
	}
	return user.id;
}

const userId = await resolveUserId();
const nowIso = () => new Date().toISOString();

const ok = (payload) => ({
	content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
});
const fail = (message) => ({
	content: [{ type: 'text', text: `Error: ${message}` }],
	isError: true
});
const throwIf = (error, what) => {
	if (error) throw new Error(`${what}: ${error.message}`);
};

/** Timestamps every write needs so the PWA's sync engine accepts the row. */
const writeStamp = () => ({ updated_at: nowIso() });
const createStamp = () => ({ created_at: nowIso(), updated_at: nowIso(), user_id: userId });

const server = new McpServer({ name: 'card-collection', version: '1.0.0' });

// ---------- collections ----------

server.registerTool(
	'list_collections',
	{
		description:
			'List all collections (folders) with their ids, names, parent folder and custom field templates.'
	},
	async () => {
		const { data, error } = await supabase
			.from('collections')
			.select('id, name, parent_id, icon, description, fields, created_at')
			.eq('user_id', userId)
			.is('deleted_at', null)
			.order('created_at');
		throwIf(error, 'list_collections');
		return ok(data);
	}
);

server.registerTool(
	'create_collection',
	{
		description: 'Create a new collection (optionally nested inside a parent collection).',
		inputSchema: {
			name: z.string().min(1),
			parentId: z.string().uuid().optional().describe('Parent collection id for nesting'),
			icon: z.string().optional().describe('An emoji shown on the dashboard card'),
			description: z.string().optional()
		}
	},
	async ({ name, parentId, icon, description }) => {
		const row = {
			id: randomUUID(),
			name,
			parent_id: parentId ?? null,
			icon: icon ?? null,
			description: description ?? null,
			fields: [],
			...createStamp()
		};
		const { error } = await supabase.from('collections').insert(row);
		throwIf(error, 'create_collection');
		return ok({ created: row.id, name });
	}
);

server.registerTool(
	'update_collection',
	{
		description: 'Rename or edit a collection (name, icon, description, parent folder).',
		inputSchema: {
			id: z.string().uuid(),
			name: z.string().optional(),
			icon: z.string().optional(),
			description: z.string().optional(),
			parentId: z.string().uuid().nullable().optional()
		}
	},
	async ({ id, name, icon, description, parentId }) => {
		const patch = { ...writeStamp() };
		if (name !== undefined) patch.name = name;
		if (icon !== undefined) patch.icon = icon;
		if (description !== undefined) patch.description = description;
		if (parentId !== undefined) patch.parent_id = parentId;
		const { error } = await supabase
			.from('collections')
			.update(patch)
			.eq('id', id)
			.eq('user_id', userId);
		throwIf(error, 'update_collection');
		return ok({ updated: id });
	}
);

// ---------- items ----------

const ITEM_COLUMNS =
	'id, collection_id, name, description, quantity, status, condition, tags, barcode, ocr_text, acquisition_price, acquisition_date, sold_price, sold_date, currency, custom_fields, created_at, updated_at';

const itemFieldSchema = {
	name: z.string().optional(),
	description: z.string().nullable().optional(),
	quantity: z.number().int().min(1).optional(),
	status: z.enum(['owned', 'sold', 'wishlist']).optional(),
	condition: z.string().nullable().optional().describe('Free text: "mint", "used", …'),
	tags: z.array(z.string()).optional(),
	barcode: z.string().nullable().optional(),
	acquisitionPrice: z.number().nullable().optional(),
	acquisitionDate: z.string().nullable().optional().describe('YYYY-MM-DD'),
	soldPrice: z.number().nullable().optional(),
	soldDate: z.string().nullable().optional().describe('YYYY-MM-DD'),
	currency: z.string().nullable().optional().describe('ISO 4217, e.g. CHF'),
	customFields: z
		.record(z.string())
		.optional()
		.describe('Values for the collection\'s custom field template, keyed by field id')
};

function itemPatch(args) {
	const map = {
		name: 'name',
		description: 'description',
		quantity: 'quantity',
		status: 'status',
		condition: 'condition',
		tags: 'tags',
		barcode: 'barcode',
		acquisitionPrice: 'acquisition_price',
		acquisitionDate: 'acquisition_date',
		soldPrice: 'sold_price',
		soldDate: 'sold_date',
		currency: 'currency',
		customFields: 'custom_fields'
	};
	const patch = {};
	for (const [camel, snake] of Object.entries(map)) {
		if (args[camel] !== undefined) patch[snake] = args[camel];
	}
	return patch;
}

server.registerTool(
	'list_items',
	{
		description: 'List items, optionally filtered by collection and/or status.',
		inputSchema: {
			collectionId: z.string().uuid().optional(),
			status: z.enum(['owned', 'sold', 'wishlist']).optional(),
			limit: z.number().int().min(1).max(200).default(50),
			offset: z.number().int().min(0).default(0)
		}
	},
	async ({ collectionId, status, limit, offset }) => {
		let query = supabase
			.from('items')
			.select(ITEM_COLUMNS)
			.eq('user_id', userId)
			.is('deleted_at', null)
			.order('created_at', { ascending: false })
			.range(offset, offset + limit - 1);
		if (collectionId) query = query.eq('collection_id', collectionId);
		if (status) query = query.eq('status', status);
		const { data, error } = await query;
		throwIf(error, 'list_items');
		return ok(data);
	}
);

server.registerTool(
	'search_items',
	{
		description:
			'Full-text-ish search across item names, descriptions, OCR text, barcodes and tags.',
		inputSchema: {
			query: z.string().min(1),
			collectionId: z.string().uuid().optional(),
			limit: z.number().int().min(1).max(100).default(25)
		}
	},
	async ({ query: q, collectionId, limit }) => {
		// commas/parens are PostgREST or() syntax — strip them from user input
		const term = q.replace(/[,()]/g, ' ').trim();
		let query = supabase
			.from('items')
			.select(ITEM_COLUMNS)
			.eq('user_id', userId)
			.is('deleted_at', null)
			.or(
				`name.ilike.%${term}%,description.ilike.%${term}%,ocr_text.ilike.%${term}%,barcode.ilike.%${term}%,tags.cs.{"${term}"}`
			)
			.limit(limit);
		if (collectionId) query = query.eq('collection_id', collectionId);
		const { data, error } = await query;
		throwIf(error, 'search_items');
		return ok(data);
	}
);

server.registerTool(
	'get_item',
	{
		description: 'Get one item in full, including its photo ids.',
		inputSchema: { id: z.string().uuid() }
	},
	async ({ id }) => {
		const { data: item, error } = await supabase
			.from('items')
			.select(ITEM_COLUMNS)
			.eq('id', id)
			.eq('user_id', userId)
			.maybeSingle();
		throwIf(error, 'get_item');
		if (!item) return fail(`No item ${id}`);
		const { data: photos } = await supabase
			.from('item_photos')
			.select('id, is_primary, width, height')
			.eq('item_id', id)
			.is('deleted_at', null);
		return ok({ ...item, photos: photos ?? [] });
	}
);

server.registerTool(
	'create_item',
	{
		description: 'Add a new item to a collection.',
		inputSchema: { collectionId: z.string().uuid(), ...itemFieldSchema }
	},
	async (args) => {
		const row = {
			id: randomUUID(),
			collection_id: args.collectionId,
			name: '',
			quantity: 1,
			status: 'owned',
			tags: [],
			custom_fields: {},
			...itemPatch(args),
			...createStamp()
		};
		const { error } = await supabase.from('items').insert(row);
		throwIf(error, 'create_item');
		return ok({ created: row.id, name: row.name });
	}
);

server.registerTool(
	'update_item',
	{
		description: 'Update fields on an existing item. Only the fields you pass are changed.',
		inputSchema: { id: z.string().uuid(), ...itemFieldSchema }
	},
	async (args) => {
		const patch = { ...itemPatch(args), ...writeStamp() };
		const { error } = await supabase
			.from('items')
			.update(patch)
			.eq('id', args.id)
			.eq('user_id', userId);
		throwIf(error, 'update_item');
		return ok({ updated: args.id, fields: Object.keys(patch) });
	}
);

server.registerTool(
	'delete_item',
	{
		description: 'Delete an item (soft delete — syncs as a removal to every device).',
		inputSchema: { id: z.string().uuid() }
	},
	async ({ id }) => {
		const t = nowIso();
		const { error } = await supabase
			.from('items')
			.update({ deleted_at: t, updated_at: t })
			.eq('id', id)
			.eq('user_id', userId);
		throwIf(error, 'delete_item');
		await supabase
			.from('item_photos')
			.update({ deleted_at: t, updated_at: t })
			.eq('item_id', id);
		return ok({ deleted: id });
	}
);

// ---------- photos ----------

server.registerTool(
	'get_item_photo',
	{
		description:
			'Fetch an item photo as an image so you can look at it (e.g. to fill in item details). Use get_item to find photo ids.',
		inputSchema: { photoId: z.string().uuid() }
	},
	async ({ photoId }) => {
		const { data: photo, error } = await supabase
			.from('item_photos')
			.select('storage_path')
			.eq('id', photoId)
			.maybeSingle();
		throwIf(error, 'get_item_photo');
		if (!photo?.storage_path) return fail(`Photo ${photoId} has no uploaded image yet`);
		const { data: blob, error: dlError } = await supabase.storage
			.from('item-photos')
			.download(photo.storage_path);
		throwIf(dlError, 'download');
		const buffer = Buffer.from(await blob.arrayBuffer());
		return {
			content: [
				{
					type: 'image',
					data: buffer.toString('base64'),
					mimeType: blob.type || 'image/webp'
				}
			]
		};
	}
);

const MIME_BY_EXT = {
	'.webp': 'image/webp',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg'
};

server.registerTool(
	'add_item_photo',
	{
		description: 'Attach a local image file to an item (uploads it to the collection storage).',
		inputSchema: {
			itemId: z.string().uuid(),
			filePath: z.string().describe('Absolute path to a .webp/.png/.jpg image on disk')
		}
	},
	async ({ itemId, filePath }) => {
		const mime = MIME_BY_EXT[extname(filePath).toLowerCase()];
		if (!mime) return fail('Only .webp, .png and .jpg images are supported');
		const bytes = await readFile(filePath);
		const photoId = randomUUID();
		const ext = mime === 'image/webp' ? 'webp' : mime === 'image/png' ? 'png' : 'jpg';
		const storagePath = `${userId}/${photoId}.${ext}`;
		const { error: upError } = await supabase.storage
			.from('item-photos')
			.upload(storagePath, bytes, { contentType: mime });
		throwIf(upError, 'upload');
		const { count } = await supabase
			.from('item_photos')
			.select('id', { count: 'exact', head: true })
			.eq('item_id', itemId)
			.is('deleted_at', null);
		const { error } = await supabase.from('item_photos').insert({
			id: photoId,
			item_id: itemId,
			storage_path: storagePath,
			is_primary: (count ?? 0) === 0,
			...createStamp()
		});
		throwIf(error, 'add_item_photo');
		return ok({ created: photoId, storagePath });
	}
);

// ---------- stats ----------

server.registerTool(
	'collection_stats',
	{
		description:
			'Counts and total acquisition/sold value per collection — useful for overview questions.'
	},
	async () => {
		const { data, error } = await supabase
			.from('items')
			.select('collection_id, status, quantity, acquisition_price, sold_price, currency')
			.eq('user_id', userId)
			.is('deleted_at', null);
		throwIf(error, 'collection_stats');
		const stats = {};
		for (const item of data ?? []) {
			const s = (stats[item.collection_id] ??= {
				items: 0,
				pieces: 0,
				owned: 0,
				sold: 0,
				wishlist: 0,
				acquisitionTotal: 0,
				soldTotal: 0
			});
			s.items += 1;
			s.pieces += item.quantity ?? 1;
			s[item.status] += 1;
			s.acquisitionTotal += Number(item.acquisition_price ?? 0);
			s.soldTotal += Number(item.sold_price ?? 0);
		}
		return ok(stats);
	}
);

await server.connect(new StdioServerTransport());
console.error(`card-collection MCP server ready (user ${userId})`);
