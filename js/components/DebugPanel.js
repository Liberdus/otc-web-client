export class DebugPanel {
    constructor() {
        this.panel = document.querySelector('.debug-panel');
        this.selectAllBtn = document.getElementById('selectAllDebug');
        this.applyBtn = document.getElementById('applyDebug');
        this.checkboxes = document.querySelectorAll('.debug-option input[type="checkbox"]');
        this.closeBtn = document.getElementById('closeDebug');
        
        this.init();
    }

    init() {
        // Load saved debug settings
        this.loadDebugSettings();
        
        // Event listeners
        this.selectAllBtn.addEventListener('click', () => this.toggleAll());
        this.applyBtn.addEventListener('click', () => this.applySettings());
        
        // Add keyboard shortcut (Ctrl/Cmd + Shift + D) to toggle panel
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') {
                e.preventDefault();
                this.togglePanel();
            }
        });
        
        // Add close button handler
        this.closeBtn.addEventListener('click', () => this.togglePanel());
        
        // Add escape key handler
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.panel.style.display !== 'none') {
                this.togglePanel();
            }
        });
    }

    loadDebugSettings() {
        const savedSettings = localStorage.getItem('debug');
        if (savedSettings) {
            const settings = JSON.parse(savedSettings);
            this.checkboxes.forEach(checkbox => {
                const debugKey = checkbox.getAttribute('data-debug');
                checkbox.checked = settings[debugKey] || false;
            });
        }
    }

    toggleAll() {
        const shouldCheck = !Array.from(this.checkboxes).every(cb => cb.checked);
        this.checkboxes.forEach(checkbox => {
            checkbox.checked = shouldCheck;
        });
    }

    applySettings() {
        const settings = {};
        this.checkboxes.forEach(checkbox => {
            const debugKey = checkbox.getAttribute('data-debug');
            settings[debugKey] = checkbox.checked;
        });
        
        localStorage.setItem('debug', JSON.stringify(settings));
        location.reload(); // Reload to apply new debug settings
    }

    togglePanel() {
        this.panel.style.display = this.panel.style.display === 'none' ? 'block' : 'none';
    }
} 