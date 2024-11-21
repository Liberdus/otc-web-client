# OTCSwap Flow

## Order Creation
- Maker initiates order
  - Pays dynamic creation fee in native coin (bounded by MIN_FEE_PERCENTAGE and MAX_FEE_PERCENTAGE)
  - Transfers sell tokens to contract
  - Order stored with Active status
  - Fee dampening mechanism adjusts orderCreationFee based on gas usage
  - → Order awaits filling or expiration

## Order Lifecycle
### Successful Path
- Order Filling
  - Taker finds active order
  - Transfers buy tokens to maker
  - Receives sell tokens from contract
  - Order status → Filled
  
### Cancellation Path
- Order Cancellation
  - Maker cancels before expiry + grace period
  - Receives sell tokens back
  - Order status → Canceled

### Expiration Path
- Order Expires
  - No action for ORDER_EXPIRY (7 days)
  - Grace period starts (7 days)
  - After grace period → Eligible for cleanup

## Cleanup Process
### Normal Cleanup
- Check expired orders
  - Process up to MAX_CLEANUP_BATCH orders
  - Dynamic gas buffer based on current fee
  - Return tokens to maker
  - Distribute fees to cleaner
  - Delete order

### Failed Cleanup
- Transfer Failure
  - Increment tries counter
  - If tries < MAX_RETRY_ATTEMPTS (10)
    - Create new retry order with reset timestamp
    - Delete old order
    - Emit RetryOrder event
  - If tries >= MAX_RETRY_ATTEMPTS
    - Distribute fees
    - Delete order permanently
    - Emit CleanupError event

## Fee Management
### Collection
- Fees paid during order creation
- Must be within bounds:
  - Minimum: 90% of current orderCreationFee
  - Maximum: 150% of current orderCreationFee
- Added to accumulatedFees

### Distribution
- During cleanup operations
- Paid to cleanup initiator
- Deducted from accumulatedFees
- Requires successful transfer

## State Updates
### Order IDs
- nextOrderId
  - Increments with each new order
  - Includes retry orders
- firstOrderId
  - Tracks oldest potential active order
  - Updated during cleanup
  - Used for batch processing

### Fee Adjustment
- Dynamic fee calculation
  - Based on actual gas usage
  - Uses dampening factor (9)
  - Formula: fee = 100 * (9 * currentFee + gasUsed) / 10
  - Bounded by 90% to 150% range