/*
 * Simple jQuery input clear control compatible with Bootstrap 5 input groups.
 * Replaces the old Bootstrap 4 input-group-append plugin.
 */
(function($) {
    'use strict';

    $.fn.clearer = function() {
        return this.each(function() {
            const input = $(this);
            if (input.data('intrain-clearer')) return;

            const wrapper = input.closest('.input-group');
            if (!wrapper.length) input.wrap('<div class="input-group"></div>');

            const button = $('<button/>', {
                type: 'button',
                class: 'btn btn-outline-secondary input-clearer',
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
