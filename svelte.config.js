import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Deployed under https://<user>.github.io/card_collection_scanner/ — dev runs at '/'
const base = process.env.BASE_PATH ?? '';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({ fallback: '404.html' }),
		paths: { base },
		alias: {
			'$lib': 'src/lib',
			'$lib/*': 'src/lib/*'
		}
	}
};

export default config;
