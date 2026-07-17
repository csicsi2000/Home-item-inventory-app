const KEY = 'ccs-settings';

interface StoredSettings {
	/** cosine similarity at/above which an add is flagged as a likely duplicate */
	dupBlockThreshold: number;
	/** cosine similarity at/above which a "similar items" hint is shown */
	dupHintThreshold: number;
	/** max pHash Hamming distance treated as a near-exact re-scan */
	phashMaxDistance: number;
	/** run OCR automatically on new photos */
	autoOcr: boolean;
	/** run duplicate detection automatically on new photos */
	autoDuplicateCheck: boolean;
	/** use the Florence-2 VLM (WebGPU) for naming instead of Tesseract */
	smartNaming: boolean;
}

const DEFAULTS: StoredSettings = {
	dupBlockThreshold: 0.9,
	dupHintThreshold: 0.82,
	phashMaxDistance: 10,
	autoOcr: true,
	autoDuplicateCheck: true,
	smartNaming: false
};

function loadStored(): StoredSettings {
	if (typeof localStorage === 'undefined') return { ...DEFAULTS };
	try {
		return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
	} catch {
		return { ...DEFAULTS };
	}
}

class Settings implements StoredSettings {
	dupBlockThreshold = $state(DEFAULTS.dupBlockThreshold);
	dupHintThreshold = $state(DEFAULTS.dupHintThreshold);
	phashMaxDistance = $state(DEFAULTS.phashMaxDistance);
	autoOcr = $state(DEFAULTS.autoOcr);
	autoDuplicateCheck = $state(DEFAULTS.autoDuplicateCheck);
	smartNaming = $state(DEFAULTS.smartNaming);

	constructor() {
		Object.assign(this, loadStored());
	}

	save() {
		const data: StoredSettings = {
			dupBlockThreshold: this.dupBlockThreshold,
			dupHintThreshold: this.dupHintThreshold,
			phashMaxDistance: this.phashMaxDistance,
			autoOcr: this.autoOcr,
			autoDuplicateCheck: this.autoDuplicateCheck,
			smartNaming: this.smartNaming
		};
		localStorage.setItem(KEY, JSON.stringify(data));
	}

	reset() {
		Object.assign(this, DEFAULTS);
		this.save();
	}
}

export const settings = new Settings();
