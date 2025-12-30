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
				this.setupEventListeners();
			}
			return true;
		} catch (error) {
			this.error('[Intro] Initialization error:', error);
			return false;
		}
	}

	setupEventListeners() {
		const faqToggle = this.container.querySelector('.faq-toggle');
		const faqContent = this.container.querySelector('.faq-content');
		const faqText = this.container.querySelector('.faq-text');
		
		if (faqToggle && faqContent && faqText) {
			faqToggle.addEventListener('click', () => {
				const isExpanded = faqContent.classList.contains('expanded');
				faqContent.classList.toggle('expanded');
				faqToggle.classList.toggle('expanded');
				faqText.textContent = isExpanded ? '📋 Show Detailed FAQ' : '📋 Hide Detailed FAQ';
			});
		}
	}

	render() {
		if (!this.container) return;
		this.container.innerHTML = `
			<div class="tab-content-wrapper">
				<h2>Welcome to LiberdusOTC</h2>
				<p class="intro-lead">Create orders by depositing tokens into escrow and setting the buy price, or fill existing orders to buy tokens at the set buy price set by the seller</p>
				
				<div class="intro-content">
					<h3 class="intro-subtitle">How to Use This Service</h3>
					
					<div class="intro-sections-grid">
						<div class="intro-section">
							<h4>📱 1. Connect Wallet</h4>
							<ul>
								<li>Click "Connect Wallet" in top right</li>
								<li>Pick allowed wallets</li>
								<li>Have POLYGON for gas fees</li>
								<li>Have USDC for order creation fee</li>
							</ul>
						</div>

						<div class="intro-section">
							<h4>🔍 2. Find Orders</h4>
							<ul>
								<li>Browse "View Orders", all orders </li>
								<li>"My Orders", orders you created</li>
								<li>"Invited Orders", orders made to you</li>
								<li>Filter by token pairs and newest/best deal</li>
							</ul>
						</div>

						<div class="intro-section">
							<h4>⚡ 3. Fill Order</h4>
							<ul>
								<li>Click order to fill</li>
								<li>Review details carefully</li>
								<li>Confirm in wallet</li>
								<li>Tokens swap automatically</li>
							</ul>
						</div>

						<div class="intro-section">
							<h4>💱 4. Create Order</h4>
							<ul>
								<li>Go to "Create Order" tab</li>
								<li>Select tokens to swap</li>
								<li>Set exchange rate</li>
								<li>Order submission will deposit tokens to escrow</li>
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
							<h4>💰 Fees & Cancellation</h4>
							<ul>
								<li>$1 USDC non-refundable fee</li>
								<li>Orders expire after 7 days</li>
								<li>Cancel before expiration</li>
								<li>Cleanup after 14 days</li>
							</ul>
						</div>
					</div>

					<div class="faq-section">
						<button class="faq-toggle">
							<span class="faq-text">📋 Show Detailed FAQ</span>
							<svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<polyline points="6,9 12,15 18,9"></polyline>
							</svg>
						</button>
						<div class="faq-content">
							<div class="faq-item">
								<h4>💰 Order Creation Fee</h4>
								<p>There is a non-refundable order creation fee of $1 USDC that must be paid when creating any order. This fee is to insure quality of orders placed.</p>
							</div>
							
							<div class="faq-item">
								<h4>⏰ Order Expiration</h4>
								<p>All orders automatically expire after 7 days from creation. Once expired, orders can no longer be filled by other users.</p>
							</div>
							
							<div class="faq-item">
								<h4>❌ Cancelling Orders</h4>
								<p>You can cancel your orders at any time before or after it expires. When you cancel an order, your deposited tokens are returned to your wallet, but the $1 USDC creation fee is not refunded. Cancelled orders cannot be filled.</p>
							</div>
							
							<div class="faq-item">
								<h4>🧹 Order Cleanup</h4>
								<p>Unfilled or cancelled orders can be cleaned up after 14 days from their creation date to free up contract storage. Anyone can initiate cleanup for eligible orders. The person who cleans up the order receives the $1 USDC creation fee but must pay the network transaction fee for the cleanup transaction. Only one order is cleaned up with each cleanup transaction. Any tokens escrowed in the orders are returned to the original creator.</p>
							</div>
							
							<div class="faq-item">
								<h4>♻️ Order Recycling</h4>
								<p>If during order cleanup, the tokens could not be returned and the order has not been cancelled. The order is recycled and becomes fillable again.</p>
							</div>
							
							<div class="faq-item">
								<h4>📊 Order Status</h4>
								<p>Orders can have different statuses: Active (can be filled), Cancelled (tokens returned, cannot be filled), and Expired (past 7 days, cannot be filled).</p>
							</div>
						</div>
					</div>
				</div>
			</div>
		`;
	}
}
