/*
 * Clear control for URL/text inputs.
 * The clear button overlays the input, so its appearance cannot change the
 * input width or the height of its parent toolbar. No Bootstrap input group
 * is created, avoiding wrapping during the player panel animation.
 */
(function($) {
    'use strict';

    $.fn.clearer = function() {
        return this.each(function() {
            const input = $(this);
            if (input.data('intrain-clearer')) return;

            // The wrapper is positioned, not an extra flex item beside the input.
            const wrapper = input.closest('.input-clearer-wrapper');
            if (!wrapper.length) {
                input.wrap('<div class="input-clearer-wrapper"></div>');
            }

            const button = $('<button/>', {
                type: 'button',
                class: 'input-clearer',
                'aria-label': 'Clear input',
                text: '×'
            });

            input.after(button);

            function refresh() {
                button.toggle(String(input.val() || '').length > 0);
            }

            button.on('click', function() {
                input.val('').trigger('change').focus();
                refresh();
            });
            input.on('input change keyup', refresh);
            input.data('intrain-clearer', button);
            refresh();
        });
    };
})(jQuery);
