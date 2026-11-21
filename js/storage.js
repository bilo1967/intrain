/*
 * Browser storage for persistent inTrain preferences.
 *
 * Preferences belong to the browser and are never sent to the web server.
 * Session status (briefing/training, connections and recording) remains managed
 * by the active supervisor rather than being restored from an old browser tab.
 *
 * Read each legacy cookie once so that users keep their existing device choices.
 * No new cookies are written. Storage exceptions (private mode or disabled
 * storage) are handled by a temporary in-memory fallback.
 */
const InTrainStorage = (() => {
    const prefix = 'intrain.';
    const memory = new Map();

    function legacyCookie(name) {
        const item = document.cookie.split(';').map(value => value.trim())
            .find(value => value.startsWith(encodeURIComponent(name) + '='));
        if (!item) return null;
        try {
            return decodeURIComponent(item.slice(item.indexOf('=') + 1));
        } catch (error) {
            console.warn('Could not decode an old preference cookie', name, error);
            return null;
        }
    }

    function expireCookie(name) {
        const expired = encodeURIComponent(name) +
            '=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
        document.cookie = expired + '; path=/';
        document.cookie = expired;
    }

    function get(name) {
        const key = prefix + name;
        try {
            const value = localStorage.getItem(key);
            if (value !== null) return value;
        } catch (error) {
            // Keep working in restricted browser environments.
            if (memory.has(key)) return memory.get(key);
        }
        if (memory.has(key)) return memory.get(key);

        const previous = legacyCookie(name);
        if (previous !== null) {
            set(name, previous);
            expireCookie(name);
            return previous;
        }
        return null;
    }

    function set(name, value) {
        const key = prefix + name;
        const text = String(value);
        memory.set(key, text);
        try {
            localStorage.setItem(key, text);
        } catch (error) {
            // Only the current tab will remember it when storage is disabled.
        }
    }

    function remove(name) {
        const key = prefix + name;
        memory.delete(key);
        try {
            localStorage.removeItem(key);
        } catch (error) {
            // Nothing to remove in a restricted browser.
        }
    }

    return Object.freeze({get, set, remove});
})();
