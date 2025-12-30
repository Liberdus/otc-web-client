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

### 2.5 `setContext(ctx)` (optional)
- Called by App to inject dependencies
- Provides access to wallet, websocket, pricing, toast services via `this.ctx`

### Initialization Flags
- `this.initialized`: true after first successful `initialize()`
- `this.initializing`: true while `initialize()` is running

For backward compatibility, `isInitialized`/`isInitializing` getters are provided in BaseComponent.

---

## AppContext (Phase 2)

The `AppContext` is a centralized dependency container that replaces scattered `window.*` globals.

### Location
- `js/services/AppContext.js`

### Creation Flow
1. App creates context: `this.ctx = createAppContext()`
2. App sets global: `setGlobalContext(this.ctx)` (exposes as `window.appContext`)
3. App populates services as they initialize:
   - `this.ctx.wallet = walletManager`
   - `this.ctx.ws = window.webSocket`
   - `this.ctx.pricing = window.pricingService`
   - `this.ctx.toast = { showError, showSuccess, ... }`
4. App passes to components: `component.setContext(this.ctx)`

### Component Access
- Via injection: `this.ctx` (set by `setContext()`)
- Via fallback: `getAppContext()` (global singleton)
- Access services: `this.ctx.getWallet()`, `this.ctx.getWebSocket()`, `this.ctx.getPricing()`
- Toast helpers: `this.ctx.showError()`, `this.ctx.showSuccess()`, etc.

### Backward Compatibility
All context methods have global fallbacks:
- `ctx.getWallet()` → returns `ctx.wallet || window.walletManager`
- `ctx.getWebSocket()` → returns `ctx.ws || window.webSocket`
- `ctx.showError()` → uses `ctx.toast.showError || window.showError`

This allows gradual migration without breaking existing code.

---

## Current State (Post Phase 6)

### Wallet / Signer / Account

| Concern | Current Location(s) | Notes |
|---------|---------------------|-------|
| Account address | `walletManager.account`, `walletManager.getAccount()` | Canonical |
| Signer | `walletManager.signer`, `walletManager.getSigner()` | Canonical |
| Provider (connected) | `walletManager.provider`, `walletManager.getProvider()` | Web3Provider from window.ethereum |
| Connection state | `walletManager.isConnected`, `walletManager.isWalletConnected()` | |
| Chain ID | `walletManager.chainId` | |

**Access patterns in components:**
- **Preferred:** `this.ctx.getWallet()` (via AppContext)
- Import: `import { walletManager } from '../config.js'`
- Global: `window.walletManager`
- Direct: `window.ethereum` (some components create their own provider)

**Resolved in Phase 4:** Components now use `this.ctx.getWallet().provider` or the `BaseComponent.provider` getter instead of creating their own providers.

---

### Contract / Provider (Read-Only)

| Concern | Current Location(s) | Notes |
|---------|---------------------|-------|
| Read-only provider | `WebSocketService.provider` | WebSocketProvider for subscriptions |
| Contract instance | `WebSocketService.contract` | Read-only, for querying |
| Contract constants | `WebSocketService.orderExpiry`, `WebSocketService.gracePeriod` | |

**Access patterns:**
- **Preferred:** `this.ctx.getWebSocket()` (via AppContext)
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
| Token cache (symbol, decimals, icon) | `WebSocketService.tokenCache` | **Canonical** ✅ |
| Get token info | `window.webSocket.getTokenInfo(address)` | Uses cache, fetches if missing |
| Via context | `this.ctx.getWebSocket().getTokenInfo(address)` | **Preferred access pattern** |

**Resolved in Phase 3:** Duplicate caches removed from `BaseComponent` and `CreateOrder`. All token lookups now use `WebSocketService.getTokenInfo()` via context.

---

### Pricing / USD Values

| Concern | Current Location(s) | Notes |
|---------|---------------------|-------|
| Price data | `PricingService` (global: `window.pricingService`) | Canonical |
| Get price | `window.pricingService.getPrice(address)` | |
| Subscribe to updates | `window.pricingService.subscribe(callback)` | |

**Access patterns:**
- **Preferred:** `this.ctx.getPricing()` (via AppContext)
- Global: `window.pricingService`

---

### Toast Notifications

| Concern | Current Location(s) | Notes |
|---------|---------------------|-------|
| Toast instance | `Toast` class, singleton via `getToast()` | |
| Show functions | `showError`, `showSuccess`, `showWarning`, `showInfo` | Exported from Toast.js |
| Global access | `window.showError`, etc. | Set in app.js |

**Access patterns:**
- **Preferred:** `this.showError()`, `this.showSuccess()`, etc. (inherited from BaseComponent, uses ctx)
- Via context: `this.ctx.showError()`, `this.ctx.showSuccess()`, etc.
- Global: `window.showError()`, etc.
- Import: `import { showError } from '../components/Toast.js'`

**Resolved in Phase 5:** BaseComponent now provides toast methods that use `this.ctx.*`. Components can override only when needed (e.g., CreateOrder overrides `showSuccess` with 3000ms duration, Cleanup adds form clearing behavior).

---

### Logging / Debug

| Concern | Current Location(s) | Notes |
|---------|---------------------|-------|
| Logger factory | `createLogger(name)` from LogService.js | Returns { debug, error, warn } |
| Debug config | `DEBUG_CONFIG` from config.js, `isDebugEnabled(name)` | |
| Storage | `localStorage.getItem('debug')` | JSON object of enabled flags |

**Resolved in Phase 6:** All components now use `createLogger()` instead of direct `console.log/error/warn` calls. `ContractParams` updated to use LogService.

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
| `js/services/AppContext.js` | Dependency injection container for services |
| `js/services/WebSocket.js` | WebSocket provider, contract, order cache, token cache |
| `js/services/ContractService.js` | Thin facade over webSocket contract (mostly unused) |
| `js/services/PricingService.js` | Token price fetching and caching |
| `js/services/LogService.js` | Logger factory |
| `js/components/Toast.js` | Toast notifications |
| `js/components/BaseComponent.js` | Base class for UI components |
