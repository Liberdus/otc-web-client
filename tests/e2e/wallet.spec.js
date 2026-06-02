const { expect, test } = require('@playwright/test');

const TEST_ACCOUNT = '0x1234567890abcdef1234567890abcdef12345678';
const AMOY_CHAIN_ID = '0x13882';
const FAKE_SIGNATURE = `0x${'11'.repeat(65)}`;

test.beforeEach(async ({ page }) => {
    await page.addInitScript(({ account, chainId, signature }) => {
        const listeners = new Map();
        const requests = [];
        let currentChainId = chainId;
        let connected = false;

        function emit(event, payload) {
            for (const handler of listeners.get(event) || []) {
                handler(payload);
            }
        }

        const provider = {
            isMetaMask: true,
            request: async ({ method, params = [] }) => {
                requests.push({ method, params });
                if (method === 'eth_chainId') {
                    return currentChainId;
                }
                if (method === 'eth_accounts') {
                    return connected ? [account] : [];
                }
                if (method === 'eth_requestAccounts') {
                    connected = true;
                    emit('accountsChanged', [account]);
                    return [account];
                }
                if (method === 'wallet_revokePermissions') {
                    connected = false;
                    emit('accountsChanged', []);
                    return null;
                }
                if (method === 'wallet_switchEthereumChain') {
                    currentChainId = params[0]?.chainId || currentChainId;
                    emit('chainChanged', currentChainId);
                    return null;
                }
                if (method === 'wallet_addEthereumChain') {
                    currentChainId = params[0]?.chainId || currentChainId;
                    return null;
                }
                if (method === 'personal_sign' || method === 'eth_sign') {
                    return signature;
                }
                if (method === 'net_version') {
                    return String(parseInt(currentChainId, 16));
                }
                throw new Error(`Unsupported wallet method in e2e: ${method}`);
            },
            on: (event, handler) => {
                if (!listeners.has(event)) {
                    listeners.set(event, new Set());
                }
                listeners.get(event).add(handler);
            },
            removeListener: (event, handler) => {
                listeners.get(event)?.delete(handler);
            }
        };

        window.__walletRequests = requests;
        window.ethereum = provider;
    }, {
        account: TEST_ACCOUNT,
        chainId: AMOY_CHAIN_ID,
        signature: FAKE_SIGNATURE
    });
});

test('connects and signs through the wallet module provider', async ({ page }) => {
    await page.goto('/');

    await page.waitForFunction(() => (
        window.walletManager?.isWalletInitialized?.() &&
        window.app?.walletUI?.initialized
    ));
    await expect(page.locator('.liberdus-wallet-connect__button')).toBeVisible();
    await page.locator('.liberdus-wallet-connect__button').click();

    await expect(page.locator('.liberdus-wallet-connect__menu')).toBeVisible();
    await expect(page.locator('.liberdus-wallet-connect__wallet')).toContainText('MetaMask');
    const menuBackground = await page.locator('.liberdus-wallet-connect__menu').evaluate((element) => {
        return window.getComputedStyle(element).backgroundColor;
    });
    expect(menuBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(menuBackground).not.toBe('transparent');

    let methods = await page.evaluate(() => window.__walletRequests.map(request => request.method));
    expect(methods).not.toContain('eth_requestAccounts');

    await page.locator('.liberdus-wallet-connect__wallet').click();

    await expect(page.locator('#accountAddress')).toHaveText('0x1234...5678');

    const signature = await page.evaluate(async () => {
        const signer = window.walletManager.getSigner();
        return signer.signMessage('otc e2e signing');
    });

    expect(signature).toBe(FAKE_SIGNATURE);

    methods = await page.evaluate(() => window.__walletRequests.map(request => request.method));
    expect(methods).toContain('eth_requestAccounts');
    expect(methods).toContain('personal_sign');

    await page.locator('#walletDisconnect').click();
    await expect(page.locator('#walletInfo')).toBeHidden();
    await expect(page.locator('.liberdus-wallet-connect__button')).toBeVisible();

    await page.locator('.liberdus-wallet-connect__button').click();
    await page.locator('.liberdus-wallet-connect__wallet').click();
    await expect(page.locator('#accountAddress')).toHaveText('0x1234...5678');
});
