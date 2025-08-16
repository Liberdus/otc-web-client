import { BaseComponent } from './BaseComponent.js';

export class Intro extends BaseComponent {
	constructor() {
		super('intro');
		this.initialized = false;
	}

	async initialize(readOnly = true) {
		try {
			if (!this.initialized) {
				this.render();
				this.initialized = true;
			}
			return true;
		} catch (error) {
			this.error('[Intro] Initialization error:', error);
			return false;
		}
	}

	render() {
		if (!this.container) return;
		this.container.innerHTML = `
			<div class="tab-content-wrapper">
				<h2>Welcome to LiberdusOTC</h2>
				<p class="text-secondary">Intro content will be provided later. This tab does not require a wallet connection.</p>
			</div>
		`;
	}
}
