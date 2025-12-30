# Regression Checklist

Run this checklist after every refactor phase to verify nothing is broken.

## Setup
```bash
npm run start
# Open http://localhost:8080 in browser with MetaMask installed
```

---

## 1. Read-Only First Load (No Wallet Connected)

- [ ] Page loads without console errors
- [ ] **Intro tab**: renders welcome content and FAQ toggle works
- [ ] **View Orders tab**: loads and displays orders from chain
- [ ] **Cleanup tab**: shows "Connect Wallet to Clean Orders" prompt
- [ ] **Contract Params tab**: loads and displays contract parameters
- [ ] Connected-only tabs (Create Order, My Orders, Invited Orders) are hidden

---

## 2. Tab Switching

- [ ] Switch through all visible tabs multiple times
- [ ] No duplicate toasts appear
- [ ] No console errors on repeated switches
- [ ] Loading spinners appear and disappear correctly
- [ ] Previous tab content is cleaned up (no stale intervals/listeners)

---

## 3. Connect Wallet

- [ ] Click "Connect Wallet" button
- [ ] MetaMask popup appears
- [ ] After approval, wallet address appears in header
- [ ] Network badge shows correct network (Polygon/Amoy)
- [ ] Connected-only tabs become visible (Create Order, My Orders, Invited Orders)
- [ ] Current tab reinitializes in connected mode
- [ ] No duplicate connect prompts or toasts

---

## 4. Create Order Flow

- [ ] Navigate to Create Order tab
- [ ] Order creation fee loads and displays
- [ ] Token selectors populate with allowed tokens
- [ ] Selecting a sell token shows balance
- [ ] Selecting a buy token shows balance
- [ ] USD values update when amounts change
- [ ] Form validation works (insufficient balance, same tokens, etc.)
- [ ] Token approval flow works when needed
- [ ] Order creation transaction succeeds
- [ ] Success toast appears
- [ ] Order appears in View Orders / My Orders

---

## 5. View Orders / Fill Order

- [ ] View Orders tab shows all active orders
- [ ] Filters work (token filters, fillable toggle)
- [ ] Pagination works
- [ ] User's own orders show "Mine" label instead of Fill button
- [ ] Click Fill on another user's order
- [ ] Approval prompt appears if needed
- [ ] Fill transaction succeeds
- [ ] Order updates to Filled status in UI
- [ ] Success toast appears

---

## 6. My Orders

- [ ] Shows only orders created by connected wallet
- [ ] Cancel button appears for cancellable orders
- [ ] Cancel flow works (transaction + UI update)
- [ ] "Show only cancellable" filter works

---

## 7. Invited Orders (Taker Orders)

- [ ] Shows only orders where connected wallet is the designated taker
- [ ] Fill flow works for taker-specific orders

---

## 8. Cleanup Tab (Connected)

- [ ] Shows cleanup opportunities with reward info
- [ ] Cleanup button enabled when eligible orders exist
- [ ] Cleanup transaction flow works
- [ ] Order removed from cache after cleanup

---

## 9. Disconnect Wallet

- [ ] Click disconnect button in header
- [ ] Wallet info disappears, Connect button reappears
- [ ] Connected-only tabs hide
- [ ] Current tab switches to View Orders if needed
- [ ] Success toast: "Wallet disconnected from site"
- [ ] No console errors or stuck state

---

## 10. Account Switch (in MetaMask)

- [ ] Switch to different account in MetaMask
- [ ] App detects change and reinitializes
- [ ] Info toast shows new account
- [ ] My Orders updates to show new account's orders
- [ ] No stale data from previous account

---

## 11. Chain Switch

- [ ] Switch to wrong network in MetaMask
- [ ] Warning toast appears
- [ ] Switch back to correct network
- [ ] App reinitializes correctly
- [ ] Orders load for correct network

---

## 12. Reload / Persistence

- [ ] Reload the page
- [ ] Theme setting persists (dark/light)
- [ ] Debug settings persist (Ctrl+Shift+D to check)
- [ ] If previously connected and not manually disconnected, auto-reconnects
- [ ] If manually disconnected, stays disconnected

---

## 13. Debug Panel

- [ ] Ctrl+Shift+D opens debug panel
- [ ] Checkboxes reflect saved state
- [ ] Select All / Apply works
- [ ] Escape or X closes panel

---

## Notes

Record any failures here with date and phase:

| Date | Phase | Test | Issue |
|------|-------|------|-------|
|      |       |      |       |
