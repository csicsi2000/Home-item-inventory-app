/**
 * Coordinates the shared-element "grow into view" page transition.
 *
 * `id` holds the id of the card the user just tapped. That card and its detail
 * page both render matching `view-transition-name`s on the elements that should
 * morph — the whole box (`card-hero`), the title (`card-title`), a collection's
 * emoji (`card-icon`) and an item's photo (`card-thumb`) — so the View
 * Transitions API tweens one into the other.
 *
 * The detail pages load their data asynchronously, so at the moment the browser
 * snapshots the new page the real content usually isn't there yet. To keep the
 * morph targets present we also stash the tapped card's `label`/`icon`/`thumb`
 * here; the detail page renders those instantly until its own data arrives.
 *
 * Everything is cleared once the transition finishes so nothing lingers.
 */
class Morph {
	id = $state<string | null>(null);
	label = $state('');
	icon = $state<string | null>(null);
	thumb = $state<Blob | null>(null);

	set(id: string, label: string, icon: string | null = null, thumb: Blob | null = null) {
		this.id = id;
		this.label = label;
		this.icon = icon;
		this.thumb = thumb;
	}

	clear() {
		this.id = null;
		this.label = '';
		this.icon = null;
		this.thumb = null;
	}
}

export const morph = new Morph();
