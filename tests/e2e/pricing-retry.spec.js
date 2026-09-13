const { expect, test } = require('@playwright/test');

const BASE = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const QUOTE = '0x3333333333333333333333333333333333333333';
const makePair = (address, price) => ({
    baseToken: { address }, quoteToken: { address: QUOTE },
    priceUsd: String(price), priceNative: String(price), liquidity: { usd: 1000 }
});

test.beforeEach(async ({ page }) => {
    await page.route('**/__pricing_retry__', route => route.fulfill({
        contentType: 'text/html', body: '<!doctype html><title>Pricing retry</title>'
    }));
    await page.route('**/js/config.js', route => route.fulfill({
        contentType: 'text/javascript',
        body: 'export const getNetworkConfig = () => ({}); export const isDebugEnabled = () => false;'
    }));
    await page.route('**/js/services/ContractService.js', route => route.fulfill({
        contentType: 'text/javascript', body: 'export const contractService = {};'
    }));
    await page.goto('/__pricing_retry__');
});

test('retries a stale price after an unsuccessful fetch instead of caching the failure', async ({ page }) => {
    let calls = 0;
    await page.route('https://api.dexscreener.com/**', route => {
        calls++;
        return route.fulfill({ status: calls <= 2 ? 503 : 200,
            json: { pairs: calls <= 2 ? [] : [makePair(BASE, 20)] } });
    });
    const result = await page.evaluate(async address => {
        const { PricingService } = await import('/js/services/PricingService.js');
        const service = new PricingService();
        service.rateLimitDelay = 0;
        service.prices.set(address, 10);
        const oldTime = Date.now() - service.priceCacheExpiry - 1000;
        service.lastPriceFetch.set(address, oldTime);
        await service.fetchPricesForTokens([address]);
        const failed = { price: service.getPrice(address),
            timestamp: service.lastPriceFetch.get(address), stale: service.isPriceStale(address) };
        await service.fetchPricesForTokens([address]);
        return { failed, oldTime, recovered: service.getPrice(address), stale: service.isPriceStale(address) };
    }, BASE);
    expect(result.failed).toEqual({ price: 10, timestamp: result.oldTime, stale: true });
    expect(result.recovered).toBe(20);
    expect(result.stale).toBe(false);
    expect(calls).toBe(3);
});

test('only refreshes timestamps for prices actually returned by a partial batch', async ({ page }) => {
    let calls = 0;
    await page.route('https://api.dexscreener.com/**', route => {
        calls++;
        const pairs = calls === 1 ? [makePair(BASE, 20)] : calls === 2 ? [] : [makePair(OTHER, 30)];
        return route.fulfill({ json: { pairs } });
    });
    const result = await page.evaluate(async ({ base, other }) => {
        const { PricingService } = await import('/js/services/PricingService.js');
        const service = new PricingService();
        service.rateLimitDelay = 0;
        for (const address of [base, other]) {
            service.prices.set(address, 10);
            service.lastPriceFetch.set(address, Date.now() - service.priceCacheExpiry - 1000);
        }
        await service.fetchPricesForTokens([base, other]);
        const partial = { baseStale: service.isPriceStale(base), otherStale: service.isPriceStale(other) };
        await service.fetchPricesForTokens([base, other]);
        return { partial, other: service.getPrice(other), pending: service.pendingRequests.size };
    }, { base: BASE, other: OTHER });
    expect(result.partial).toEqual({ baseStale: false, otherStale: true });
    expect(result.other).toBe(30);
    expect(result.pending).toBe(0);
    expect(calls).toBe(3);
});

test('keeps successful prices cached within the freshness window', async ({ page }) => {
    let calls = 0;
    await page.route('https://api.dexscreener.com/**', route => {
        calls++;
        return route.fulfill({ json: { pairs: [makePair(BASE, 20)] } });
    });
    const price = await page.evaluate(async address => {
        const { PricingService } = await import('/js/services/PricingService.js');
        const service = new PricingService();
        service.rateLimitDelay = 0;
        await service.fetchPricesForTokens([address]);
        await service.fetchPricesForTokens([address]);
        return service.getPrice(address);
    }, BASE);
    expect(price).toBe(20);
    expect(calls).toBe(1);
});
