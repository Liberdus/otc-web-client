# Browser Automation via Cursor MCP

This document explains how to use Cursor's built-in browser automation tools (MCP) for testing and verification.

## What is MCP?

**MCP (Model Context Protocol)** is a protocol that allows AI assistants to interact with external tools and services. Cursor includes several built-in MCP servers, including one for browser automation.

## What I Used in Phase 0

I used Cursor's browser extension MCP to:
1. Navigate to the running development server
2. Take snapshots of the page state
3. Click buttons and interact with elements
4. Verify functionality without manual clicking

### Tools Available

The MCP server is called `cursor-browser-extension` and provides these tools:

| Tool Name | Purpose | Example |
|-----------|---------|---------|
| `browser_navigate` | Navigate to a URL | Navigate to `http://localhost:8081` |
| `browser_snapshot` | Get current page state (HTML, console logs, elements) | Check what's rendered after page load |
| `browser_click` | Click an element by role, text, or ref | Click "View Orders" tab button |
| `browser_handle_dialog` | Accept/dismiss browser dialogs/alerts | Handle version update alerts |
| `browser_fill` | Fill form inputs | (Not used in Phase 0) |
| `browser_screenshot` | Take a screenshot | (Not used in Phase 0) |

### How It Works

1. **Cursor's AI agent** (when in agent mode) can call these MCP tools
2. The tools use **Playwright** under the hood to control a headless browser
3. Results are returned as structured data (page state, console logs, element references)
4. No code changes needed in your repo - it's a Cursor feature

## Example: What I Did in Phase 0

### Step 1: Navigate to the server
```javascript
// Cursor internally calls:
mcp_cursor-browser-extension_browser_navigate({
  url: "http://127.0.0.1:8081"
})
```

### Step 2: Take a snapshot to see page state
```javascript
// Returns structured page representation:
{
  consoleMessages: [...],
  pageElements: [...],
  currentURL: "http://127.0.0.1:8081/",
  pageTitle: "LiberdusOTC"
}
```

### Step 3: Click elements to test functionality
```javascript
// Click the "Intro" tab button
mcp_cursor-browser-extension_browser_click({
  element: "Intro tab button",
  ref: "e28"  // Element reference from snapshot
})
```

### Step 4: Verify changes
```javascript
// Take another snapshot to see what changed
// Compare before/after to verify tab switching worked
```

## Enabling for Other Repos

### Prerequisites

1. **Cursor version**: You need a recent version of Cursor that includes MCP support (late 2024+)
2. **Agent mode**: You must be in **agent mode** (not ask mode) for the AI to execute tool calls
3. **Browser extension enabled**: Usually enabled by default, but check:
   - Settings → Extensions → Browser Extension

### No Configuration Needed

The browser MCP is **automatically available** when:
- You're in agent mode
- Cursor is up to date
- The browser extension is enabled

**No code changes or config files needed in your repo.**

### Using It in Other Projects

When you're in agent mode and ask me to test something, I can:

```markdown
# Example requests:
"Test the login flow in my React app"
"Verify the dashboard loads after I start the dev server"
"Click through the checkout process and see if it works"
"Check if the API error messages display correctly"
```

I'll automatically:
1. Start your dev server (if needed)
2. Navigate to the app
3. Interact with elements
4. Report back what I find

### Limitations

- **Headless browser**: Uses Playwright's headless mode (no visible window)
- **No MetaMask**: Can't interact with browser extensions like MetaMask
- **Limited JavaScript**: Some browser-specific APIs may not work exactly like a real browser
- **Agent mode only**: Can't use these tools manually - only via AI agent calls

## When to Use Browser Automation

### Good For:
- Verifying page loads correctly
- Testing basic UI interactions (clicks, form fills)
- Checking console errors
- Verifying responsive design (can resize viewport)
- Quick smoke tests after refactoring

### Not Good For:
- Testing wallet connections (requires MetaMask extension)
- Testing complex user flows with external services
- Visual regression testing (use screenshots manually)
- Performance testing (use real browser DevTools)
- Testing with actual blockchain transactions

## Alternative: Manual Testing

If browser automation isn't available or doesn't fit your needs:

1. **Use the regression checklist**: `docs/regression-checklist.md`
2. **Manual testing**: Run through flows yourself
3. **Browser DevTools**: Check console, network, etc.
4. **Playwright scripts**: Write custom Playwright tests in your repo

## Troubleshooting

### "Tool not available"
- Make sure you're in **agent mode** (not ask mode)
- Check Cursor settings for browser extension
- Update Cursor to latest version

### "Can't connect to localhost"
- Make sure your dev server is running
- Check the port (I saw `8081` in Phase 0, might be different)
- Verify firewall isn't blocking connections

### "Element not found"
- Page might not be fully loaded - wait a moment
- Element might not exist in the DOM
- Element might be in an iframe (not supported)

## References

- **MCP Spec**: https://modelcontextprotocol.io/
- **Playwright**: https://playwright.dev/ (what powers the automation)
- **Cursor Docs**: Check Cursor's documentation for latest MCP features

---

## Summary

Cursor's browser MCP is a **built-in feature** that lets the AI agent control a browser for testing. It's:
- **No setup required** - works out of the box
- **Useful for quick verification** - faster than manual testing
- **Available in agent mode** - just ask me to test something
- **Not for complex flows** - wallet extensions, transactions, etc. still need manual testing

For this refactor project, it was useful to quickly verify Phase 0 worked. For wallet/testing flows, we'll still rely on the manual regression checklist.
