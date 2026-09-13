const { expect, test } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
    await page.route('**/__version_response__', route => route.fulfill({
        contentType: 'text/html', body: '<!doctype html><title>Version response</title>'
    }));
    await page.route('**/js/config.js', route => route.fulfill({
        contentType: 'text/javascript', body: 'export const isDebugEnabled = () => false;'
    }));
    await page.goto('/__version_response__');
});

async function checkTwice(page, storedVersion) {
    return page.evaluate(async stored => {
        if (stored !== null) localStorage.setItem('app_version', stored);
        const { VersionService } = await import('/js/services/VersionService.js');
        const service = new VersionService();
        const updates = [];
        // Observe the update boundary without reloading the test page.
        service.performUpdate = async version => {
            updates.push(version);
            localStorage.setItem('app_version', version);
        };
        const results = [await service.checkVersion(), await service.checkVersion()];
        return { results, updates, stored: localStorage.getItem('app_version') };
    }, storedVersion);
}

for (const response of ['', '   ', '<!doctype html><title>Maintenance 503</title>', 'Service unavailable']) {
    test(`ignores invalid successful response ${JSON.stringify(response)}`, async ({ page }) => {
        await page.route('**/version.html', route => route.fulfill({ status: 200, body: response }));
        expect(await checkTwice(page, '2025.08.18.15.40')).toEqual({
            results: [false, false], updates: [], stored: '2025.08.18.15.40'
        });
    });
}

test('does not record an empty version on a first visit', async ({ page }) => {
    await page.route('**/version.html', route => route.fulfill({ status: 200, body: '' }));
    expect(await checkTwice(page, null)).toEqual({ results: [false, false], updates: [], stored: null });
});

test('updates once for a new valid version and trims surrounding whitespace', async ({ page }) => {
    await page.route('**/version.html', route => route.fulfill({ body: ' 2026.09.13.10.00\n' }));
    expect(await checkTwice(page, '2025.08.18.15.40')).toEqual({
        results: [true, false], updates: ['2026.09.13.10.00'], stored: '2026.09.13.10.00'
    });
});

test('preserves the cached version on an HTTP error', async ({ page }) => {
    await page.route('**/version.html', route => route.fulfill({ status: 503, body: 'Unavailable' }));
    expect(await checkTwice(page, '2025.08.18.15.40')).toEqual({
        results: [false, false], updates: [], stored: '2025.08.18.15.40'
    });
});
