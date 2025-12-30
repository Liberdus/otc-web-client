# Architecture: Sources of Truth

This document maps where key state/data lives in the codebase. Use this as a reference during refactoring to ensure we converge on single sources of truth.

---

## Component Lifecycle Contract

All components extending `BaseComponent` follow this lifecycle:

### 1. `constructor(containerId)`
- **MUST be side-effect free** (no network calls, no event subscriptions, no DOM modifications beyond container lookup)
- Sets up container reference and default state
- Initializes logger

### 2. `initialize(readOnlyMode = true)`
- Called by App when component should set up
- Handles rendering, event subscriptions, data loading
- `readOnlyMode=true` means no wallet connected
- Should be **idempotent** (safe to call multiple times)
- Protected by `initializing` flag to prevent concurrent calls

### 3. `cleanup()`
- Called by App before switching away from component
- Removes event listeners, clears timers, unsubscribes from services
- Should NOT clear rendered content (preserve for quick tab switches)
- Must be reversible (component can be re-initialized after cleanup)

### Initialization Flags
- `this.initialized`: true after first successful `initialize()`
- `this.initializing`: true while `initialize()` is running

For backward compatibility, `isInitialized`/`isInitializing` getters are provided in BaseComponent.

---

## Current State (Post Phase 1)

### Wallet / Signer / Account

| Concern | Current Location(s) | Notes |
|---------|---------------------|-------|
| Account address | `walletManager.account`, `walletManager.getAccount()` | Canonical |
| Signer | `walletManager.signer`, `walletManager.getSigner()` | Canonical |
| Provider (connected) | `walletManager.provider`, `walletManager.getProvider()` | Web3Provider from window.ethereum |
| Connection state | `walletManager.isConnected`, `walletManager.isWalletConnected()` | |
| Chain ID | `walletManager.chainId` | |

**Access patterns in components:**
- Import: `import { walletManager } from '../config.js'`
- Global: `window.walletManager`
- Direct: `window.ethereum` (some components create their own provider)

**Issue:** Some components (e.g., `ViewOrders`) create `new Web3Provider(window.ethereum)` instead of using walletManager.

---

### Contract / Provider (Read-Only)

| Concern | Current Location(s) | Notes |
|---------|---------------------|-------|
| Read-only provider | `WebSocketService.provider` | WebSocketProvider for subscriptions |
| Contract instance | `WebSocketService.contract` | Read-only, for querying |
| Contract constants | `WebSocketService.orderExpiry`, `WebSocketService.gracePeriod` | |

**Access patterns:**
- Global: `window.webSocket.contract`, `window.webSocket.provider`
- Via service: `contractService.getContract()` (thin wrapper over webSocket)

**Issue:** Components sometimes use `walletManager.getContract()` (connected signer) vs `webSocket.contract` (read-only) inconsistently.

---

### Order Cache

| Concern | Current Location(s) | Notes |
|---------|---------------------|-------|
| All orders | `WebSocketService.orderCache` (Map) | Canonical |
| Get orders | `window.webSocket.getOrders()`, `window.webSocket.orderCache.values()` | |

**Access patterns:**
- `Array.from(window.webSocket.orderCache.values())`
- `window.webSocket.orderCache.get(orderId)`

---

### Token Info / Metadata

| Concern | Current Location(s) | Notes |
|---------|---------------------|-------|
| Token cache (symbol, decimals, icon) | `WebSocketService.tokenCache` | **Recommended canonical** |
| Get token info | `window.webSocket.getTokenInfo(address)` | Uses cache, fetches if missing |
| Duplicate cache | `BaseComponent.tokenCache` | Unused by most components |
| Duplicate cache | `CreateOrder.tokenCache` | Used for decimals lookup |

**Issue:** Three separate token caches exist. Should consolidate to `WebSocketService.tokenCache`.

---

### Pricing / USD Values

| Concern | Current Location(s) | Notes |
|---------|---------------------|-------|
| Price data | `PricingService` (global: `window.pricingService`) | Canonical |
| Get price | `window.pricingService.getPrice(address)` | |
| Subscribe to updates | `window.pricingService.subscribe(callback)` | |

---

### Toast Notifications

| Concern | Current Location(s) | Notes |
|---------|---------------------|-------|
| Toast instance | `Toast` class, singleton via `getToast()` | |
| Show functions | `showError`, `showSuccess`, `showWarning`, `showInfo` | Exported from Toast.js |
| Global access | `window.showError`, etc. | Set in app.js |

**Issue:** Some components override toast methods (CreateOrder, Cleanup) with slightly different implementations.

---

### Logging / Debug

| Concern | Current Location(s) | Notes |
|---------|---------------------|-------|
| Logger factory | `createLogger(name)` from LogService.js | Returns { debug, error, warn } |
| Debug config | `DEBUG_CONFIG` from config.js, `isDebugEnabled(name)` | |
| Storage | `localStorage.getItem('debug')` | JSON object of enabled flags |

**Issue:** `ContractParams` uses `isDebugEnabled()` + `console.log` instead of `createLogger()`.

---

## Target State (Post-Refactor)

### Single Sources of Truth

| Concern | Canonical Location | Access Pattern |
|---------|-------------------|----------------|
| Wallet/signer/account | `walletManager` | `ctx.wallet` or import |
| Read-only contract/provider | `WebSocketService` | `ctx.ws` |
| Order cache | `WebSocketService.orderCache` | `ctx.ws.getOrders()` |
| Token info | `WebSocketService.getTokenInfo()` | `ctx.ws.getTokenInfo()` |
| Pricing | `PricingService` | `ctx.pricing` |
| Toasts | Toast singleton | `ctx.toast` or base class methods |

### Component Rules

1. **Never create providers directly** (`new Web3Provider(...)`) — use walletManager or webSocket.
2. **Never maintain local token caches** — use webSocket.getTokenInfo().
3. **Never access `window.ethereum` directly** — go through walletManager.
4. **Use base class toast methods** — don't override unless adding extra behavior.

---

## File Quick Reference

| File | Primary Responsibility |
|------|----------------------|
| `js/config.js` | Network config, WalletManager class |
| `js/app.js` | App orchestration, component lifecycle, global setup |
| `js/services/WebSocket.js` | WebSocket provider, contract, order cache, token cache |
| `js/services/ContractService.js` | Thin facade over webSocket contract (mostly unused) |
| `js/services/PricingService.js` | Token price fetching and caching |
| `js/services/LogService.js` | Logger factory |
| `js/components/Toast.js` | Toast notifications |
| `js/components/BaseComponent.js` | Base class for UI components |
