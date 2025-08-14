import { createLogger } from '../services/LogService.js';

export class Toast {
    constructor() {
        // Initialize logger
        const logger = createLogger('TOAST');
        this.debug = logger.debug.bind(logger);
        this.error = logger.error.bind(logger);
        this.warn = logger.warn.bind(logger);
        
        this.toastQueue = [];
        this.isProcessing = false;
        this.maxToasts = 3; // Maximum number of toasts visible at once
        this.container = null;
        
        this.debug('Toast component initialized');
        this.initialize();
    }

    initialize() {
        // Create toast container if it doesn't exist
        this.createToastContainer();
        this.debug('Toast container ready');
    }

    createToastContainer() {
        // Create a fixed position container for toasts
        const toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        toastContainer.className = 'toast-container';
        document.body.appendChild(toastContainer);
        this.container = toastContainer;
        
        this.debug('Toast container created with debug styling');
    }

    /**
     * Show a toast notification
     * @param {string} message - The message to display
     * @param {string} type - The type of toast (error, success, warning, info)
     * @param {number} duration - Duration in milliseconds (default: 5000)
     */
    showToast(message, type = 'info', duration = 5000) {
        this.debug(`Showing toast: ${type} - ${message}`);
        
        const toast = this.createToastElement(message, type);
        this.addToastToQueue(toast, duration);
        
        return toast;
    }

    /**
     * Create a toast element
     * @param {string} message - The message to display
     * @param {string} type - The type of toast
     * @returns {HTMLElement} The toast element
     */
    createToastElement(message, type) {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        // Create toast content
        const content = document.createElement('div');
        content.className = 'toast-content';
        
        // Add icon based on type
        const icon = this.createIcon(type);
        content.appendChild(icon);
        
        // Add message
        const messageElement = document.createElement('span');
        messageElement.className = 'toast-message';
        messageElement.textContent = message;
        content.appendChild(messageElement);
        
        // Add close button
        const closeButton = this.createCloseButton();
        content.appendChild(closeButton);
        
        toast.appendChild(content);
        
        // Add click handler for close button
        closeButton.addEventListener('click', () => {
            this.removeToast(toast);
        });
        
        this.debug('Toast element created with debug styling');
        return toast;
    }

    /**
     * Create an icon for the toast type
     * @param {string} type - The type of toast
     * @returns {HTMLElement} The icon element
     */
    createIcon(type) {
        const icon = document.createElement('span');
        icon.className = 'toast-icon';
        
        // Set icon content based on type
        switch (type) {
            case 'error':
                icon.innerHTML = '&#9888;'; // Warning emoji
                break;
            case 'success':
                icon.innerHTML = '&#10004;'; // Checkmark
                break;
            case 'warning':
                icon.innerHTML = '&#9888;'; // Warning emoji
                break;
            case 'info':
            default:
                icon.innerHTML = '&#8505;'; // Info emoji
                break;
        }
        
        return icon;
    }

    /**
     * Create a close button for the toast
     * @returns {HTMLElement} The close button element
     */
    createCloseButton() {
        const closeButton = document.createElement('button');
        closeButton.className = 'toast-close';
        closeButton.innerHTML = '&times;';
        closeButton.setAttribute('aria-label', 'Close notification');
        closeButton.type = 'button';
        
        return closeButton;
    }

    /**
     * Add toast to queue and process
     * @param {HTMLElement} toast - The toast element
     * @param {number} duration - Duration in milliseconds
     */
    addToastToQueue(toast, duration) {
        this.toastQueue.push({ toast, duration });
        
        if (!this.isProcessing) {
            this.processQueue();
        }
    }

    /**
     * Process the toast queue
     */
    processQueue() {
        if (this.toastQueue.length === 0) {
            this.isProcessing = false;
            return;
        }
        
        this.isProcessing = true;
        
        // Remove excess toasts if we have too many
        while (this.container.children.length >= this.maxToasts) {
            const oldestToast = this.container.firstChild;
            if (oldestToast) {
                this.removeToast(oldestToast);
            }
        }
        
        const { toast, duration } = this.toastQueue.shift();
        this.showToastElement(toast, duration);
    }

    /**
     * Show a toast element
     * @param {HTMLElement} toast - The toast element
     * @param {number} duration - Duration in milliseconds
     */
    showToastElement(toast, duration) {
        // Add toast to container
        this.container.appendChild(toast);
        
        // Trigger animation
        requestAnimationFrame(() => {
            toast.classList.add('toast-show');
        });
        
        // Set up auto-remove
        const timeoutId = setTimeout(() => {
            this.removeToast(toast);
        }, duration);
        
        // Store timeout ID for potential early removal
        toast.dataset.timeoutId = timeoutId;
        
        // Process next toast
        setTimeout(() => {
            this.processQueue();
        }, 100);
    }

    /**
     * Remove a toast element
     * @param {HTMLElement} toast - The toast element to remove
     */
    removeToast(toast) {
        // Clear timeout if it exists
        if (toast.dataset.timeoutId) {
            clearTimeout(parseInt(toast.dataset.timeoutId));
        }
        
        // Add removal animation
        toast.classList.add('toast-hide');
        
        // Remove after animation completes
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }

    /**
     * Clear all toasts
     */
    clearAll() {
        this.debug('Clearing all toasts');
        this.toastQueue = [];
        
        // Remove all toast elements
        while (this.container.firstChild) {
            this.container.removeChild(this.container.firstChild);
        }
        
        this.isProcessing = false;
    }

    // Convenience methods for different toast types
    showError(message, duration = 5000) {
        return this.showToast(message, 'error', duration);
    }

    showSuccess(message, duration = 5000) {
        return this.showToast(message, 'success', duration);
    }

    showWarning(message, duration = 5000) {
        return this.showToast(message, 'warning', duration);
    }

    showInfo(message, duration = 5000) {
        return this.showToast(message, 'info', duration);
    }
}

// Create a global toast instance
let globalToast = null;

/**
 * Get or create the global toast instance
 * @returns {Toast} The global toast instance
 */
export function getToast() {
    if (!globalToast) {
        globalToast = new Toast();
    }
    return globalToast;
}

/**
 * Show a toast notification globally
 * @param {string} message - The message to display
 * @param {string} type - The type of toast
 * @param {number} duration - Duration in milliseconds
 */
export function showToast(message, type = 'info', duration = 5000) {
    const toast = getToast();
    return toast.showToast(message, type, duration);
}

// Convenience functions for different toast types
export function showError(message, duration = 5000) {
    return showToast(message, 'error', duration);
}

export function showSuccess(message, duration = 5000) {
    return showToast(message, 'success', duration);
}

export function showWarning(message, duration = 5000) {
    return showToast(message, 'warning', duration);
}

export function showInfo(message, duration = 5000) {
    return showToast(message, 'info', duration);
}
