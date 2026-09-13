const { expect, test } = require('@playwright/test');

const USDC = '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359';
const ICON = 'https://example.com/usdc.png';

test.beforeEach(async ({ page }) => {
    await page.route('**/__icon_retry__', route => route.fulfill({
        contentType: 'text/html', body: '<!doctype html><title>Icon retry</title>'
    }));
    await page.route('**/js/config.js', route => route.fulfill({
        contentType: 'text/javascript', body: 'export const isDebugEnabled = () => false;'
    }));
    await page.goto('/__icon_retry__');
});

async function getIcon(page) {
    return page.evaluate(async address => {
        const { tokenIconService } = await import('/js/services/TokenIconService.js');
        return tokenIconService.getIconUrl(address, 137);
    }, USDC);
}

for (const failure of ['rate-limit', 'network', 'missing-image']) {
    test(`retries a temporary ${failure} response and retrieves the icon`, async ({ page }) => {
        let calls = 0;
        await page.route('https://api.coingecko.com/**', route => {
            calls++;
            if (calls === 1) {
                if (failure === 'network') return route.abort('failed');
                return route.fulfill({ status: failure === 'rate-limit' ? 429 : 200, json: {} });
            }
            return route.fulfill({ json: { image: { small: ICON } } });
        });
        expect(await getIcon(page)).toBe(ICON);
        expect(await getIcon(page)).toBe(ICON);
        expect(calls).toBe(2);
    });
}

test('does not persist a 24-hour unknown-token cache entry after exhausted server errors', async ({ page }) => {
    let calls = 0;
    await page.route('https://api.coingecko.com/**', route => {
        calls++;
        return route.fulfill({ status: calls <= 3 ? 503 : 200,
            json: calls <= 3 ? {} : { image: { small: ICON } } });
    });
    expect(await getIcon(page)).toBe('fallback');
    const state = await page.evaluate(async address => {
        const { tokenIconService } = await import('/js/services/TokenIconService.js');
        return { cached: tokenIconService.cache.has(`${address}-137`),
            persisted: localStorage.getItem('tokenIconCache'), pending: tokenIconService.loadingPromises.size };
    }, USDC);
    expect(state).toEqual({ cached: false, persisted: null, pending: 0 });
    expect(calls).toBe(3);
    expect(await getIcon(page)).toBe(ICON);
    expect(calls).toBe(4);
});

test('still caches a confirmed HTTP 404 as an unknown token', async ({ page }) => {
    let calls = 0;
    await page.route('https://api.coingecko.com/**', route => {
        calls++;
        return route.fulfill({ status: 404, json: { error: 'coin not found' } });
    });
    expect(await getIcon(page)).toBe('fallback');
    expect(await getIcon(page)).toBe('fallback');
    expect(calls).toBe(1);
});

test('still caches an unmapped token without making an API request', async ({ page }) => {
    let calls = 0;
    await page.route('https://api.coingecko.com/**', route => {
        calls++;
        return route.abort();
    });
    const results = await page.evaluate(async () => {
        const { tokenIconService } = await import('/js/services/TokenIconService.js');
        const address = '0x1111111111111111111111111111111111111111';
        return [await tokenIconService.getIconUrl(address, 137), await tokenIconService.getIconUrl(address, 137)];
    });
    expect(results).toEqual(['fallback', 'fallback']);
    expect(calls).toBe(0);
});
