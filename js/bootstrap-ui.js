/*
 * Bootstrap 5 component helpers.
 *
 * Use the native Bootstrap API explicitly. The rest of InTrain still uses
 * jQuery for its own DOM and event handling, but must not rely on Bootstrap 4
 * registering jQuery plugins.
 */
const InTrainUI = Object.freeze({
    showModal(selector, options = {}) {
        const element = document.querySelector(selector);
        if (!element) return;
        const instance = bootstrap.Modal.getOrCreateInstance(element, options);
        instance.show();
    },

    hideModal(selector) {
        const element = document.querySelector(selector);
        if (!element) return;
        bootstrap.Modal.getInstance(element)?.hide();
    },

    initTooltips(selector = '[data-bs-toggle="tooltip"]') {
        document.querySelectorAll(selector).forEach(element => {
            bootstrap.Tooltip.getOrCreateInstance(element);
        });
    },

    hideTooltip(element) {
        bootstrap.Tooltip.getInstance(element)?.hide();
    },

    initPopovers(selector, options = {}) {
        document.querySelectorAll(selector).forEach(element => {
            bootstrap.Popover.getOrCreateInstance(element, options);
        });
    }
});
