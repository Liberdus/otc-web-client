const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests/e2e',
    timeout: 30000,
    expect: {
        timeout: 10000
    },
    use: {
        baseURL: 'http://127.0.0.1:8091',
        trace: 'on-first-retry'
    },
    webServer: {
        command: 'PORT=8091 node scripts/serve-static.mjs',
        url: 'http://127.0.0.1:8091',
        reuseExistingServer: !process.env.CI,
        timeout: 10000
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] }
        }
    ]
});
