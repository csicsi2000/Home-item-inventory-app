import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';

const base = process.env.BASE_PATH ?? '';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		SvelteKitPWA({
			registerType: 'prompt',
			manifest: {
				id: `${base}/`,
				name: 'Card Collection Scanner',
				short_name: 'Collections',
				description: 'Scan, organize and sync your collections',
				start_url: `${base}/`,
				scope: `${base}/`,
				display: 'standalone',
				background_color: '#09090b',
				theme_color: '#09090b',
				icons: [
					{ src: `${base}/icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
					{ src: `${base}/icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
					{
						src: `${base}/icons/icon-512-maskable.png`,
						sizes: '512x512',
						type: 'image/png',
						purpose: 'maskable'
					}
				]
			},
			workbox: {
				globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2,webmanifest}'],
				// ML assets are big — runtime-cached on first use instead of precached
				globIgnores: ['**/models/**', '**/*.wasm', '**/tesseract/**'],
				maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
				navigateFallback: `${base}/404.html`,
				runtimeCaching: [
					{
						// MobileNet weights, zxing + tesseract wasm/traineddata
						urlPattern: ({ url }) =>
							url.pathname.includes('/models/') ||
							url.pathname.endsWith('.wasm') ||
							url.pathname.includes('/tesseract/') ||
							url.pathname.endsWith('.traineddata.gz'),
						handler: 'CacheFirst',
						options: {
							cacheName: 'ml-assets',
							expiration: { maxEntries: 40 },
							cacheableResponse: { statuses: [0, 200] }
						}
					},
					{
						// Florence-2 (transformers.js) weights + config from the HF CDN —
						// cache the one-time download so smart naming works offline afterwards
						urlPattern: ({ url }) =>
							url.hostname === 'huggingface.co' || url.hostname.endsWith('.hf.co'),
						handler: 'CacheFirst',
						options: {
							cacheName: 'hf-models',
							expiration: { maxEntries: 60 },
							rangeRequests: true,
							cacheableResponse: { statuses: [0, 200] }
						}
					},
					{
						urlPattern: ({ url }) =>
							url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/storage'),
						handler: 'StaleWhileRevalidate',
						options: {
							cacheName: 'remote-images',
							expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 }
						}
					}
				]
			}
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
