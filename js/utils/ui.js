export function setVisibility(element, isVisible) {
    if (!element) return;
    element.classList.toggle('is-hidden', !isVisible);
    element.setAttribute('aria-hidden', String(!isVisible));
}

/**
 * Check if an error represents a user rejection of a transaction
 * @param {Error} error - The error object to check
 * @returns {boolean} - True if the error is a user rejection
 */
export function isUserRejection(error) {
    return error.code === 4001 || 
           error.code === 'ACTION_REJECTED' ||
           error.message?.includes('user rejected') ||
           error.message?.includes('User denied transaction signature') ||
           error.reason === 'user rejected transaction';
}

/**
 * Handle transaction errors with silent user rejection handling
 * @param {Error} error - The error object
 * @param {Object} component - The component instance with debug and showError methods
 * @param {string} action - Description of the action being performed (e.g., 'cleanup', 'order creation')
 * @returns {boolean} - True if the error was a user rejection (handled silently), false otherwise
 */
export function handleTransactionError(error, component, action = 'transaction') {
    if (isUserRejection(error)) {
        // Silently handle user rejection - no error toast needed
        component.debug(`User rejected ${action}`);
        return true; // Indicates user rejection was handled
    } else {
        // Show error for actual failures
        component.error(`${action} failed:`, {
            message: error.message,
            code: error.code,
            error: error.error,
            reason: error.reason,
            transaction: error.transaction
        });
        component.showError(`${action} failed: ${error.message}`);
        return false; // Indicates error was shown to user
    }
}


