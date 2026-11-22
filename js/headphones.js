/* One local listening level, applied at playback outputs only. Never register
 * capture/decoder elements: their volume would alter outgoing or recorded audio.
 * Cross-origin iframe players have their own output and need their volume API.
 */
var InTrainHeadphones = (function() {
    const outputs = new Set();
    let percent = 100;
    let player = null;

    function applyPlayerVolume() {
        if (!player || typeof player.setVolume !== 'function') return;
        try { player.setVolume(percent / 100); }
        catch (error) { console.warn('Video volume will be applied when its renderer is ready', error); }
    }

    function registerOutput(element) {
        if (!element) return;
        outputs.add(element);
        element.volume = percent / 100;
    }

    function setVolume(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return false;
        percent = Math.max(0, Math.min(100, Math.round(numeric)));
        outputs.forEach(element => {element.volume = percent / 100;});
        applyPlayerVolume();
        const slider = document.getElementById('headphone-volume');
        if (slider) {
            slider.value = percent;
            slider.setAttribute('aria-valuetext', percent + '%');
        }
        return true;
    }

    function init() {
        const saved = InTrainStorage.get('headphone-volume');
        setVolume(saved === null ? 100 : saved);
        document.querySelectorAll('#speakerVideo, #interpreterVideo, #supervisorVideo').forEach(registerOutput);
        const slider = document.getElementById('headphone-volume');
        if (slider) slider.addEventListener('input', function() {
            if (setVolume(this.value)) InTrainStorage.set('headphone-volume', percent);
        });
    }

    return {init, registerOutput, unregisterOutput: element => outputs.delete(element),
        setVolume, getVolume: () => percent / 100, applyPlayerVolume,
        setPlayer(value) {player = value; applyPlayerVolume();}};
})();

$(document).ready(InTrainHeadphones.init);
