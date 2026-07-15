import { db } from '$lib/db/schema';
import type { Item, ItemEmbedding, UUID } from '$lib/db/types';
import { hammingDistance } from './phash';
import { cosine } from './embeddings';
import { settings } from '$lib/state/settings.svelte';

export interface DuplicateMatch {
	item: Item;
	kind: 'barcode' | 'phash' | 'embedding' | 'ocr';
	/** 0..1, higher = more certain */
	score: number;
	detail: string;
}

export interface DuplicateReport {
	/** strong match that deserves the blocking "is this a duplicate?" sheet */
	block: DuplicateMatch | null;
	/** weaker "similar items" hints */
	hints: DuplicateMatch[];
}

function ocrTokens(text: string | null): Set<string> {
	if (!text) return new Set();
	return new Set(
		text
			.toLowerCase()
			.split(/[^\p{L}\p{N}]+/u)
			.filter((t) => t.length >= 3)
	);
}

function overlap(a: Set<string>, b: Set<string>): number {
	if (a.size < 4 || b.size < 4) return 0;
	let common = 0;
	for (const t of a) if (b.has(t)) common++;
	return common / Math.min(a.size, b.size);
}

/** Compare one item against everything else in its collection. */
export async function findDuplicates(itemId: UUID): Promise<DuplicateReport> {
	const item = await db.items.get(itemId);
	if (!item || item.deletedAt) return { block: null, hints: [] };

	const mine = await db.embeddings.get(itemId);
	const candidates = await db.items
		.where('collectionId')
		.equals(item.collectionId)
		.filter((i) => !i.deletedAt && i.id !== itemId)
		.toArray();
	if (!candidates.length) return { block: null, hints: [] };

	const embeddings = new Map<UUID, ItemEmbedding>();
	await db.embeddings.each((e) => {
		embeddings.set(e.itemId, e);
	});

	const myTokens = ocrTokens(item.ocrText);
	let block: DuplicateMatch | null = null;
	const hints: DuplicateMatch[] = [];
	const take = (match: DuplicateMatch, blocking: boolean) => {
		if (blocking) {
			if (!block || match.score > block.score) block = match;
		} else {
			hints.push(match);
		}
	};

	for (const candidate of candidates) {
		if (item.barcode && candidate.barcode === item.barcode) {
			take({ item: candidate, kind: 'barcode', score: 1, detail: 'Same barcode' }, true);
			continue;
		}
		const theirs = embeddings.get(candidate.id);
		if (mine && theirs) {
			const distance = hammingDistance(mine.phash, theirs.phash);
			if (distance <= settings.phashMaxDistance) {
				take(
					{
						item: candidate,
						kind: 'phash',
						score: 1 - distance / 64,
						detail: 'Near-identical photo'
					},
					true
				);
				continue;
			}
			const similarity = cosine(mine.vector, theirs.vector);
			if (similarity >= settings.dupBlockThreshold) {
				take(
					{
						item: candidate,
						kind: 'embedding',
						score: similarity,
						detail: `${Math.round(similarity * 100)}% visual match`
					},
					true
				);
				continue;
			}
			if (similarity >= settings.dupHintThreshold) {
				take(
					{
						item: candidate,
						kind: 'embedding',
						score: similarity,
						detail: `${Math.round(similarity * 100)}% visual match`
					},
					false
				);
				continue;
			}
		}
		const textOverlap = overlap(myTokens, ocrTokens(candidate.ocrText));
		if (textOverlap >= 0.6) {
			take(
				{
					item: candidate,
					kind: 'ocr',
					score: textOverlap,
					detail: 'Very similar printed text'
				},
				false
			);
		}
	}

	hints.sort((a, b) => b.score - a.score);
	return { block, hints: hints.slice(0, 3) };
}
