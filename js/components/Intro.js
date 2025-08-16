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
				<p class="text-secondary">Create orders by depositing tokens into escrow and setting the buy price, or fill existing orders to buy tokens at the set buy price set by the seller</p>
				
				<div class="intro-content">
					<h3>How to Use This Service</h3>
					
					<div class="intro-sections-grid">
						<div class="intro-section">
							<h4>📱 Connect Wallet</h4>
							<ul>
								<li>Click "Connect Wallet" in top right</li>
								<li>Switch to Polygon network</li>
								<li>Have POLYGON for gas fees</li>
							</ul>
						</div>

						<div class="intro-section">
							<h4>💱 Create Order</h4>
							<ul>
								<li>Go to "Create Order" tab</li>
								<li>Select tokens to swap</li>
								<li>Set exchange rate</li>
								<li>Deposit tokens to escrow</li>
							</ul>
						</div>

						<div class="intro-section">
							<h4>🔍 Find Orders</h4>
							<ul>
								<li>Browse "View Orders"</li>
								<li>Sort by newest or best deal</li>
								<li>Filter by token pairs</li>
								<li>Check "My Orders"</li>
							</ul>
						</div>

						<div class="intro-section">
							<h4>⚡ Fill Order</h4>
							<ul>
								<li>Click order to fill</li>
								<li>Review details carefully</li>
								<li>Confirm in wallet</li>
								<li>Tokens swap automatically</li>
							</ul>
						</div>

						<div class="intro-section">
							<h4>🛡️ Security Tips</h4>
							<ul>
								<li>Verify token addresses</li>
								<li>Review order details</li>
								<li>Check exchange rates</li>
								<li>Confirm before filling</li>
							</ul>
						</div>

						<div class="intro-section">
							<h4>🚀 Get Started</h4>
							<ul>
								<li>Connect your wallet</li>
								<li>Create your first order</li>
								<li>Or fill existing orders</li>
								<li>Start swapping!</li>
							</ul>
						</div>

						<div class="intro-note">
							<p><strong>Ready to start?</strong> Connect your wallet and head to "Create Order" to make your first swap!</p>
						</div>
					</div>
				</div>
			</div>
		`;
	}
}
