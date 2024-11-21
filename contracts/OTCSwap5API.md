# OTCSwap Contract

## Constants
- ORDER_EXPIRY (7 days)
- GRACE_PERIOD (7 days)
- MAX_CLEANUP_BATCH (10)
- FEE_DAMPENING_FACTOR (9)
- MIN_FEE_PERCENTAGE (90)
- MAX_FEE_PERCENTAGE (150)
- MAX_RETRY_ATTEMPTS (10)

## State Variables
- orderCreationFee
- accumulatedFees
- firstOrderId
- nextOrderId
- orders: mapping(uint256 => Order)

## Data Structures
### OrderStatus Enum
Values (uint8):
- Active (0)
- Filled (1)
- Canceled (2)

### Order Struct
Object with properties:
- maker: address
- taker: address
- sellToken: address
- sellAmount: uint256
- buyToken: address
- buyAmount: uint256
- timestamp: uint256
- status: OrderStatus
- orderCreationFee: uint256
- tries: uint256

## Core Functions
### createOrder()
Payable: yes
Inputs:
- taker: address
- sellToken: address
- sellAmount: uint256
- buyToken: address
- buyAmount: uint256
Returns:
- orderId: uint256
Reverts if: [...]

### fillOrder()
Payable: no
Inputs:
- orderId: uint256
Returns:
- void
View Order: returns Order struct
Reverts if: [...]

### cancelOrder()
Payable: no
Inputs:
- orderId: uint256
Returns:
- void
View Order: returns Order struct
Reverts if: [...]

### cleanupExpiredOrders()
Payable: no
Inputs:
- none
Returns:
- void
Side effects:
- Updates firstOrderId
- Modifies accumulatedFees
Reverts if: [...]

## Public Views
### orders(uint256 orderId)
Returns: Order struct {
    maker: address
    taker: address
    sellToken: address
    sellAmount: uint256
    buyToken: address
    buyAmount: uint256
    timestamp: uint256
    status: OrderStatus
    orderCreationFee: uint256
    tries: uint256
}

## Helper Functions
### _handleFailedCleanup()
- Manages retry attempts up to MAX_RETRY_ATTEMPTS
- Creates new retry orders with incremented tries
- Preserves order details but resets timestamp
- Returns fees for distribution on max retries
- Emits RetryOrder or CleanupError events

## Events
- OrderCreated(orderId, maker, taker, sellToken, sellAmount, buyToken, buyAmount, timestamp, orderCreationFee)
- OrderFilled(orderId, maker, taker, sellToken, sellAmount, buyToken, buyAmount, timestamp)
- OrderCanceled(orderId, maker, timestamp)
- OrderCleanedUp(orderId, maker, timestamp)
- RetryOrder(oldOrderId, newOrderId, maker, tries, timestamp)
- CleanupFeesDistributed(recipient, amount, timestamp)
- CleanupError(orderId, reason, timestamp)

## Security Features
- ReentrancyGuard for all external functions
- Ownable for potential future admin functions
- SafeERC20 for token transfers
- Validation modifiers for order status
- Dynamic fee mechanism with bounds
- Retry mechanism for failed cleanups