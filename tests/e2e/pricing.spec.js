const { expect, test } = require('@playwright/test');

const BASE = '0x1111111111111111111111111111111111111111';
const QUOTE_A = '0x2222222222222222222222222222222222222222';
const QUOTE_B = '0x3333333333333333333333333333333333333333';

function pair(quote, priceUsd, priceNative, liquidity) {
    return {
        baseToken: { address: BASE },
        quoteToken: { address: quote },
        priceUsd: String(priceUsd),
        priceNative: String(priceNative),
        liquidity: { usd: liquidity }
    };
}

test.beforeEach(async ({ page }) => {
    // Exercise the real pricing module without wallets, RPCs or external APIs.
    await page.route('**/__pricing_fixture__', route => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Pricing fixture</title>'
    }));
    await page.route('**/js/config.js', route => route.fulfill({
        contentType: 'text/javascript',
        body: 'export const getNetworkConfig = () => ({}); export const isDebugEnabled = () => false;'
    }));
    await page.route('**/js/services/ContractService.js', route => route.fulfill({
        contentType: 'text/javascript',
        body: 'export const contractService = {};'
    }));
    await page.goto('/__pricing_fixture__');
});

async function processPairs(page, pairs, initialPrices = []) {
    return page.evaluate(async ({ pairs, initialPrices }) => {
        const { PricingService } = await import('/js/services/PricingService.js');
        const service = new PricingService();
        const prices = new Map(initialPrices);
        service.processTokenPairs(pairs, prices);
        return Object.fromEntries(prices);
    }, { pairs, initialPrices });
}

test('derives each quote price from that pair while retaining the most liquid base price', async ({ page }) => {
    // The less liquid pool prices BASE at $20 and at 4 QUOTE_B, so QUOTE_B is $5.
    // Using the $10 BASE price selected from another pool would incorrectly give $2.50.
    const prices = await processPairs(page, [
        pair(QUOTE_B, 20, 4, 100),
        pair(QUOTE_A, 10, 2, 1000)
    ]);

    expect(prices[BASE]).toEqual({ price: 10, liquidity: 1000 });
    expect(prices[QUOTE_A]).toEqual({ price: 5, liquidity: 1000 });
    expect(prices[QUOTE_B]).toEqual({ price: 5, liquidity: 100 });
});

test('does not mix a previously fetched base price with a new pair ratio', async ({ page }) => {
    const prices = await processPairs(page, [pair(QUOTE_B, 20, 4, 100)], [
        [BASE, { price: 10, liquidity: 1000 }]
    ]);

    expect(prices[BASE]).toEqual({ price: 10, liquidity: 1000 });
    expect(prices[QUOTE_B]).toEqual({ price: 5, liquidity: 100 });
});

test('preserves existing quote prices', async ({ page }) => {
    const prices = await processPairs(page, [pair(QUOTE_A, 20, 4, 100)], [
        [QUOTE_A, { price: 7, liquidity: 1000 }]
    ]);

    expect(prices[QUOTE_A]).toEqual({ price: 7, liquidity: 1000 });
});

test('does not derive quote prices from invalid or zero native ratios', async ({ page }) => {
    for (const priceNative of ['invalid', '0', '-2']) {
        const prices = await processPairs(page, [pair(QUOTE_A, 20, priceNative, 100)]);
        expect(prices[BASE]).toEqual({ price: 20, liquidity: 100 });
        expect(prices[QUOTE_A]).toBeUndefined();
    }
});
