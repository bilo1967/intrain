// Regression tests for the existing PeerJS connection and device lifecycle.
// Run with: node --test tests/smoke.test.js
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadApp() {
    const root = path.resolve(__dirname, '..');
    const chain = new Proxy({}, {get: (_, key) => key === 'val' ? () => 'default' : () => chain});
    const context = vm.createContext({
        console, setTimeout, clearTimeout, Promise,
        document: {},
        $: () => chain,
        navigator: {mediaDevices: {}},
        MediaStream: class MediaStream {},
        HTMLCanvasElement: class HTMLCanvasElement {},
        URL: class extends URL {
            static createObjectURL() {return 'blob:test';}
        },
        Blob, ArrayBuffer,
        window: {},
    });
    for (const file of ['js/common.js', 'js/intrain.js', 'js/peercommon.js']) {
        vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, {filename: file});
    }
    return context;
}

function fakeConnection() {
    const listeners = [];
    const connection = {
        _open: true, closed: 0,
        get open() {return this._open;},
        on(event, handler) {if (event === 'close') listeners.push(handler);},
        close() {this.closed++;this._open = false;for (const cb of listeners) cb();}
    };
    return connection;
}

test('closing peer connections works when open is an inherited getter', async () => {
    const c = loadApp();
    const data = fakeConnection();
    const media = fakeConnection();
    c.speakerData = data;
    c.speakerMedia = media;
    c.myRole = 'supervisor';
    await c.resetConnection('speaker');
    assert.equal(data.closed, 1);
    assert.equal(media.closed, 1);
    assert.equal(c.speakerData, null);
    assert.equal(c.speakerMedia, null);
});

test('reset does not recurse when media close emits close synchronously', async () => {
    const c = loadApp();
    const media = fakeConnection();
    c.speakerMedia = media;
    media.on('close', () => {void c.resetConnection('speaker');});
    await c.resetConnection('speaker');
    assert.equal(media.closed, 1);
});

test('all peer connections are closed before destroying signaling peer', async () => {
    const c = loadApp();
    c.myRole = 'supervisor';
    const sp = fakeConnection(), inr = fakeConnection(), shared = fakeConnection();
    c.speakerData = sp;
    c.interpreterMedia = inr;
    c.screenshareConnection = shared;
    let destroyed = 0;
    c.myPeer = {destroyed: false, destroy() {destroyed++;}};
    await c.closeAllConnections();
    assert.deepEqual([sp.closed, inr.closed, shared.closed, destroyed], [1, 1, 1, 1]);
});

test('replacing outgoing tracks retains the mute state and awaits the sender', async () => {
    const c = loadApp();
    const audio = {kind: 'audio', enabled: true};
    const video = {kind: 'video', enabled: true};
    const sentAudio = {track: {kind: 'audio', enabled: false}, replaceTrack: async t => {assert.equal(t.enabled, false);sentAudio.track = t;}};
    const sentVideo = {track: {kind: 'video', enabled: true}, replaceTrack: async t => {sentVideo.track = t;}};
    const conn = {open: true, peerConnection: {getSenders: () => [sentAudio,sentVideo]}};
    await c.replaceStreamInMediaConnection(conn, {getTracks: () => [audio,video]});
    assert.equal(audio.enabled, false);
    assert.equal(sentAudio.track, audio);
    assert.equal(sentVideo.track, video);
});

test('failed capture does not stop the existing microphone or camera', async () => {
    const c = loadApp();
    c.myRole = 'interpreter';
    const track = {stop() {throw new Error('Old media stopped unexpectedly');}};
    c.micStream = {getTracks: () => [track]};
    c.navigator.mediaDevices.getUserMedia = async () => {throw new Error('NotFoundError');};
    c.getDevices = async () => [];
    c.handleLocalMediaStreamError = () => {};
    assert.equal(await c.setUserMediaConstraints(), false);
});

test('received text is escaped before inserting into chat HTML', () => {
    const c = loadApp();
    assert.equal(c.escapeHTML('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
});

test('sharing the screen does not inherit a disabled camera track', async () => {
    const c = loadApp();
    const video = {kind: 'video', enabled: true};
    const sender = {track: {kind: 'video', enabled: false}, replaceTrack: async track => {sender.track = track;}};
    const conn = {open: true, peerConnection: {getSenders: () => [sender]}};
    await c.replaceStreamInMediaConnection(conn, {getTracks: () => [video]}, false);
    assert.equal(video.enabled, true);
});

function fakeIncomingCall(role, peer) {
    const callbacks = {};
    return {
        peer, options: {metadata: {role}}, open: true,
        on(event, fn) { callbacks[event] = fn; },
        answer() {},
        emit(event, payload) { callbacks[event]?.(payload); },
        close() { this.open = false; this.emit('close'); }
    };
}

test('supervisor keeps screen sharing visible when a speaker disconnects', async () => {
    const c = loadApp();
    const share = {id: 'screen'}, speaker = {id: 'camera'};
    c.myRole = 'supervisor';
    c.screenshareMediaStream = share;
    c.sharingScreenActive = true;
    c.speakerMediaStream = speaker;
    c.speakerVideo = {srcObject: share, muted: false};
    c.refreshSpeakerVideoSource();
    assert.equal(c.speakerVideo.srcObject, share);
    assert.equal(c.speakerVideo.muted, true);

    c.speakerMedia = fakeConnection();
    await c.resetConnection('speaker');
    assert.equal(c.speakerVideo.srcObject, share);

    c.sharingScreenActive = false;
    c.screenshareMediaStream = null;
    c.speakerMediaStream = speaker;
    c.refreshSpeakerVideoSource();
    assert.equal(c.speakerVideo.srcObject, speaker);
});

test('late speaker media cannot replace an active screen share on the interpreter', () => {
    const c = loadApp(), handlers = {};
    c.myRole = 'interpreter';
    c.userID = 'supervisor-id';
    c.speakerVideo = {srcObject: null, muted: true, play() {return Promise.resolve();}};
    c.myPeer = {on(event, fn) {handlers[event] = fn;}};
    c.loadPeerHandlers();

    const share = fakeIncomingCall('screenshare', 'supervisor-id');
    const sharedStream = {id: 'shared', getTracks: () => [{onended: null}]};
    handlers.call(share);
    share.emit('stream', sharedStream);
    assert.equal(c.speakerVideo.srcObject, sharedStream);

    const speaker = fakeIncomingCall('speaker', 'speaker-id');
    const camera1 = {id: 'camera1'}, camera2 = {id: 'camera2'};
    handlers.call(speaker);
    speaker.emit('stream', camera1);
    assert.equal(c.speakerVideo.srcObject, sharedStream);

    speaker.emit('stream', camera2);
    assert.equal(c.speakerVideo.srcObject, sharedStream);

    share.close();
    assert.equal(c.speakerVideo.srcObject, camera2);
    assert.equal(c.speakerVideo.muted, c.speakerAudioMuted);
});

test('speaker-first arrival and stale screen share closure retain current screen', () => {
    const c = loadApp(), handlers = {};
    c.myRole = 'interpreter';
    c.userID = 'supervisor-id';
    c.speakerVideo = {srcObject: null, muted: true, play() {return Promise.resolve();}};
    c.myPeer = {on(event, fn) {handlers[event] = fn;}};
    c.loadPeerHandlers();

    const speaker = fakeIncomingCall('speaker', 'speaker-id');
    const camera = {id: 'camera'};
    handlers.call(speaker);
    speaker.emit('stream', camera);
    assert.equal(c.speakerVideo.srcObject, camera);

    const oldShare = fakeIncomingCall('screenshare', 'supervisor-id');
    const firstStream = {id: 'share1', getTracks: () => [{onended: null}]};
    handlers.call(oldShare);
    oldShare.emit('stream', firstStream);
    assert.equal(c.speakerVideo.srcObject, firstStream);

    const newShare = fakeIncomingCall('screenshare', 'supervisor-id');
    const secondStream = {id: 'share2', getTracks: () => [{onended: null}]};
    handlers.call(newShare);
    newShare.emit('stream', secondStream);

    oldShare.close();
    assert.equal(c.speakerVideo.srcObject, secondStream);
    newShare.close();
    assert.equal(c.speakerVideo.srcObject, camera);
});

test('interpreter outgoing dial to a rejoining speaker preserves the active screen', () => {
    const c = loadApp();
    const share = {id: 'share'}, camera = {id: 'camera'};
    c.myRole = 'interpreter';
    c.screenshareMediaStream = share;
    c.speakerVideo = {srcObject: share, muted: false, play() {return Promise.resolve();}};
    const media = fakeIncomingCall('speaker', 'speaker-id');
    c.myPeer = {
        connect() {return fakeIncomingCall('interpreter', 'speaker-id');},
        call() {return media;}
    };
    c.dialPeer('speaker-id', 'interpreter', 'speaker');
    media.emit('stream', camera);
    assert.equal(c.speakerVideo.srcObject, share);
    c.screenshareMediaStream = null;
    c.refreshSpeakerVideoSource();
    assert.equal(c.speakerVideo.srcObject, camera);
});

test('supervisor resends an active screen only to the incoming interpreter', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../js/role-supervisor.js'), 'utf8');
    assert.match(html, /role === RoleInterpreter && sharingScreen\(\)/);
    assert.match(html, /c\.peer, screenshareMediaStream/);
});


test('role pages load Bootstrap 5 and external, unminified application scripts', () => {
    const root = path.resolve(__dirname, '..');
    for (const page of ['index.html', 'supervisor.html', 'speaker.html', 'interpreter.html']) {
        const html = fs.readFileSync(path.join(root, page), 'utf8');
        assert.match(html, /bootstrap@5\.3\.9\/dist\/css\/bootstrap\.min\.css/);
        assert.match(html, /bootstrap@5\.3\.9\/dist\/js\/bootstrap\.bundle\.min\.js/);
        assert.doesNotMatch(html, /bootstrap@4|data-toggle=|data-target=|data-dismiss=/);
        assert.doesNotMatch(html, /<script(?:\s[^>]*)?>(?:\s*[^<\s][\s\S]*?)<\/script>/i);
        const role = page.replace('.html', '');
        assert.ok(html.includes('src="js/bootstrap-ui.js"'));
        assert.ok(html.includes('src="js/storage.js"'));
        assert.ok(html.includes(`src="js/role-${role}.js`));
        assert.ok(html.indexOf('src="js/bootstrap-ui.js"') < html.indexOf(`src="js/role-${role}.js`));
    }
});

test('browser storage migrates legacy cookie and persists device choice', () => {
    const code = fs.readFileSync(path.resolve(__dirname, '../js/storage.js'), 'utf8');
    const memory = new Map();
    const settings = {
        getItem(key) {return memory.has(key) ? memory.get(key) : null;},
        setItem(key, value) {memory.set(key, value);},
        removeItem(key) {memory.delete(key);}
    };
    const cookies = [];
    const document = {
        get cookie() {return cookies.length ? cookies[cookies.length - 1] : 'speaker-video-source=old-camera';},
        set cookie(v) {cookies.push(v);}
    };
    const context = vm.createContext({document, localStorage: settings, console, Map, Object});
    vm.runInContext(code, context);
    assert.equal(vm.runInContext("InTrainStorage.get('speaker-video-source')", context), 'old-camera');
    assert.equal(settings.getItem('intrain.speaker-video-source'), 'old-camera');
    vm.runInContext("InTrainStorage.set('speaker-video-source', 'new-camera')", context);
    assert.equal(vm.runInContext("InTrainStorage.get('speaker-video-source')", context), 'new-camera');
});

test('a session starts with briefing mode; browser preferences cannot restore training', () => {
    const root = path.resolve(__dirname, '..');
    const common = fs.readFileSync(path.join(root, 'js/common.js'), 'utf8');
    assert.match(common, /var sessionMode\s*=\s*['"]briefing['"]/);
    const storage = fs.readFileSync(path.join(root, 'js/storage.js'), 'utf8');
    assert.doesNotMatch(storage, /sessionStorage\.setItem\([^)]*sessionMode/);
});

test('camera enable/disable checks video tracks rather than audio availability', () => {
    const c = loadApp();
    const video = {enabled: true};
    c.micStream = {getVideoTracks: () => [video]};
    assert.equal(c.enableCam(false), false);
    assert.equal(video.enabled, false);
});


test('session-mode icon and label share a centered flex line box', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../css/intrain-responsive.css'), 'utf8');
    assert.match(css, /#session-mode \.session-mode-icon,\s*#session-mode > span:not\(\.session-mode-icon\)\s*\{/);
    assert.match(css, /display: inline-flex;\s*align-items: center;\s*height: 1\.5rem;\s*line-height: 1;/);
});

test('session mode shows the selected icon with spacing and valid HTML', () => {
    const c = loadApp();
    let rendered = '';
    c.myRole = 'interpreter';
    c.logToChat = () => {};
    c.$ = selector => ({
        html(value) {
            if (selector === '#session-mode' && value !== undefined) rendered = value;
            return this;
        },
        removeClass() { return this; },
        addClass() { return this; }
    });

    c.setSessionMode('briefing', false);
    assert.match(rendered, /fa-bullhorn session-mode-icon me-2/);
    assert.match(rendered, /BRIEFING MODE/);
    assert.doesNotMatch(rendered, /<\/div>/);

    c.setSessionMode('training', false);
    assert.match(rendered, /material-font session-mode-icon me-2/);
    assert.match(rendered, />record_voice_over<\/span>/);
    assert.match(rendered, /TRAINING MODE/);
    assert.doesNotMatch(rendered, /<\/div>/);
});

test('supervisor video player is shown above the speaker and hidden again', () => {
    const root = path.resolve(__dirname, '..');
    const supervisor = fs.readFileSync(path.join(root, 'js/role-supervisor.js'), 'utf8');
    const markup = fs.readFileSync(path.join(root, 'supervisor.html'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css/intrain-responsive.css'), 'utf8');

    assert.match(supervisor, /function setSupervisorPlayerVisible\(visible\)/);
    assert.match(supervisor, /toggleClass\('stack-top', showPlayer\)/);
    assert.match(supervisor, /toggleClass\('stack-bottom hidden', !showPlayer\)/);
    assert.match(markup, /id="player-container"/);
    assert.match(markup, /id="speakerVideo"/);
    assert.match(css, /\.player-container\s*\{[^}]*position:\s*absolute;[^}]*top:\s*0;[^}]*left:\s*0;/);
});

test('URL panel and supervisor original Material Symbols styling', () => {
    const root = path.resolve(__dirname, '..');
    const css = fs.readFileSync(path.join(root, 'css/intrain-responsive.css'), 'utf8');
    const supervisor = fs.readFileSync(path.join(root, 'supervisor.html'), 'utf8');

    assert.ok(!css.includes('Material+Symbols+Outlined'));
    assert.ok(supervisor.includes('fonts.googleapis.com/css2?family=Material+Symbols+Outlined'));
    assert.ok(supervisor.includes("font-family: 'Material Symbols Outlined'"));
    assert.match(css, /#player-panel\s*\{[^}]*overflow:\s*hidden;[^}]*white-space:\s*nowrap;/);
    assert.match(supervisor, /id="player-panel"/);
    assert.match(supervisor, /class="me-1 flex-grow-1"/);
    assert.match(supervisor, /css\/intrain-responsive\.css\?v=1\.0\.7/);
    for (const page of ['speaker.html', 'interpreter.html']) {
        const html = fs.readFileSync(path.join(root, page), 'utf8');
        assert.match(html, /css\/intrain-responsive\.css\?v=1\.0\.6/);
    }
});

test('interpreter synchronizes seeks using the MediaElement player API', () => {
    const peer = fs.readFileSync(path.resolve(__dirname, '../js/peercommon.js'), 'utf8');
    const interpreter = fs.readFileSync(path.resolve(__dirname, '../js/role-interpreter.js'), 'utf8');
    assert.match(peer, /seekRemoteVideo\(data.time, data.pause\)/);
    assert.match(interpreter, /myVideoPlayer\.setCurrentTime\(position\)/);
    assert.doesNotMatch(peer, /myVideoMediaElement\.setCurrentTime/);
});


test('mode indicator retains centered layout without imposing optical offsets', () => {
    const root = path.resolve(__dirname, '..');
    const css = fs.readFileSync(path.join(root, 'css/intrain-responsive.css'), 'utf8');
    assert.match(css, /#session-mode \.session-mode-icon\s*\{/);
    // Pixel-level optical adjustments are intentionally left to the layout CSS.
    for (const page of ['supervisor.html', 'speaker.html', 'interpreter.html']) {
        const html = fs.readFileSync(path.join(root, page), 'utf8');
        assert.doesNotMatch(html, /align-items-middle/);
        assert.match(html, /class="[^"]*align-items-center[^"]*" id="session-mode"/);
    }
});

test('Material Symbols are loaded and configured for all three roles', () => {
    const root = path.resolve(__dirname, '..');
    for (const page of ['supervisor.html', 'speaker.html', 'interpreter.html']) {
        const html = fs.readFileSync(path.join(root, page), 'utf8');
        assert.ok(html.includes('fonts.googleapis.com/css2?family=Material+Symbols+Outlined'), page);
        assert.match(html, /\.material-font\s*\{[^}]*font-family:\s*'Material Symbols Outlined'/);
    }
});

test('video URL toolbar has stable height and the clear button cannot cause wrapping', () => {
    const root = path.resolve(__dirname, '..');
    const markup = fs.readFileSync(path.join(root, 'supervisor.html'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css/intrain-responsive.css'), 'utf8');
    const clearer = fs.readFileSync(path.join(root, 'js/input-clearer.js'), 'utf8');

    assert.match(markup, /class="d-inline-flex flex-nowrap align-items-center video-player-controls"/);
    assert.match(markup, /id="video-url"/);
    assert.match(markup, /class="form-control form-control-sm clearer"/);
    assert.match(css, /\.video-player-controls\s*\{[^}]*height:\s*var\(--normal-button-height\)/);
    assert.match(css, /#player-panel \.input-clearer-wrapper\s*\{[^}]*position:\s*relative/);
    assert.match(css, /#player-panel \.input-clearer\s*\{[^}]*position:\s*absolute/);
    assert.match(clearer, /input\.wrap\('<div class="input-clearer-wrapper"><\/div>'\)/);
    assert.doesNotMatch(clearer, /input\.wrap\('<div class="input-group"><\/div>'\)/);
});

test('all role pages load only the Git-ignored runtime configuration', () => {
    const root = path.resolve(__dirname, '..');
    for (const page of ['index.html', 'supervisor.html', 'speaker.html', 'interpreter.html']) {
        const html = fs.readFileSync(path.join(root, page), 'utf8');
        assert.match(html, /<script src="config\/config\.js"><\/script>/);
        assert.doesNotMatch(html, /<script src="js\/config\.js/);
    }

    const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    assert.match(ignore, /^config\.js$/m);
    assert.equal(fs.existsSync(path.join(root, 'js/config.js')), false);
    assert.equal(fs.existsSync(path.join(root, 'config/config.js')), false);

    const template = fs.readFileSync(path.join(root, 'config/config.js.dist'), 'utf8');
    const config = vm.runInNewContext(template + '\n({ PeerJSConfig, WaitBeforeClose })');
    assert.ok(config.PeerJSConfig.host);
    assert.ok(config.PeerJSConfig.config.iceServers.length >= 1);
    assert.equal(config.WaitBeforeClose, 500);
    assert.doesNotMatch(template, /ditlab\.it/);
    assert.match(template, /REPLACE_ME/);
});


test('video URL validation accepts complete provider links but rejects bare IDs and invalid URLs', () => {
    const c = loadApp();
    for (const input of [
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://youtu.be/dQw4w9WgXcQ?t=45',
        'https://youtube.com/shorts/dQw4w9WgXcQ',
        'https://player.vimeo.com/video/12345678',
        'https://vimeo.com/12345678',
        'https://www.facebook.com/watch/?v=12345678'
    ]) {
        assert.equal(c.validateVideoURL(input).valid, true, input);
    }
    for (const input of [
        '',
        'dQw4w9WgXcQ',
        '12345678',
        'youtube.com/watch?v=dQw4w9WgXcQ',
        'https://www.youtube.com/',
        'https://www.youtube.com/watch?v=wrong',
        'https://www.youtube.com/playlist?list=PLTEST',
        'https://evil.youtube.com/watch?v=dQw4w9WgXcQ',
        'javascript:alert(1)',
        'http://youtu.be/dQw4w9WgXcQ',
        'https://vimeo.com/channels/example',
        'https://example.org/video/12345678'
    ]) {
        const result = c.validateVideoURL(input);
        assert.equal(result.valid, false, input);
        assert.ok(result.error, input);
    }
    assert.equal(
        c.validateVideoURL('https://youtu.be/dQw4w9WgXcQ?si=abc').url,
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    );
});

test('supervisor state snapshot includes video URL, visibility, position and playback', () => {
    const c = loadApp();
    const source = fs.readFileSync(path.resolve(__dirname, '../js/role-supervisor.js'), 'utf8');
    // Only evaluate the declarations; the DOM-ready handler needs a real browser.
    vm.runInContext(
        source.slice(0, source.indexOf('$(document).ready(')),
        c,
        {filename: 'role-supervisor.js'}
    );

    const sent = [];
    c.currentVideoURL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    c.showPlayer = true;
    c.myVideoPlayer = {paused: false, getCurrentTime: () => 37.5};
    c.sendCurrentVideoState({open: true, send: data => sent.push(data)});

    assert.equal(sent.length, 1);
    assert.equal(sent[0].action, 'playerstate');
    assert.equal(sent[0].visible, true);
    assert.equal(sent[0].time, 37.5);
    assert.equal(sent[0].playing, true);
    assert.equal(sent[0].url, c.currentVideoURL);
    c.sendCurrentVideoState({open: false, send: () => assert.fail('Sent to closed connection')});
});

test('interpreter cannot click or use keyboard controls and late join restores the video', () => {
    const root = path.resolve(__dirname, '..');
    const role = fs.readFileSync(path.join(root, 'js/role-interpreter.js'), 'utf8');
    const peer = fs.readFileSync(path.join(root, 'js/peercommon.js'), 'utf8');
    const supervisor = fs.readFileSync(path.join(root, 'js/role-supervisor.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css/intrain-responsive.css'), 'utf8');
    const html = fs.readFileSync(path.join(root, 'interpreter.html'), 'utf8');

    assert.match(role, /clickToPlayPause:\s*false/);
    assert.match(role, /enableKeyboard:\s*false/);
    assert.match(role, /features:\s*\[\]/);
    assert.match(html, /class="video-player-interaction-shield"/);
    assert.match(css, /\.interpreter-video-player \.mejs__container\s*\{[^}]*pointer-events:\s*none/);
    assert.match(css, /\.interpreter-video-player \.video-player-interaction-shield\s*\{[^}]*z-index:\s*100/);
    assert.match(supervisor, /role === RoleInterpreter\) sendCurrentVideoState\(c\)/);
    assert.match(peer, /case 'playerstate':/);
    assert.match(peer, /applyRemoteVideoState\(data\)/);
});

test('supervisor validates URL and loads source once after overlay is shown', () => {
    const js = fs.readFileSync(path.resolve(__dirname, '../js/role-supervisor.js'), 'utf8');
    const loadBlock = js.slice(js.indexOf("$('#run-player').on('click'"), js.indexOf("$('#load-player').on('click'"));
    assert.match(loadBlock, /validateVideoURL\(/);
    assert.match(loadBlock, /result\.valid/);
    assert.match(loadBlock, /requestAnimationFrame\(/);
    assert.equal((loadBlock.match(/myVideoPlayer\.setSrc\(/g) || []).length, 1);
    assert.match(loadBlock, /addClass\('is-invalid'\)/);
    assert.match(js, /addEventListener\('error'/);
});


test('supervisor MediaElement remains within the central speaker video area', () => {
    const root = path.resolve(__dirname, '..');
    const script = fs.readFileSync(path.join(root, 'js/role-supervisor.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css/intrain-responsive.css'), 'utf8');
    const markup = fs.readFileSync(path.join(root, 'supervisor.html'), 'utf8');
    const c = loadApp();

    // Load declarations without executing browser-only startup.
    vm.runInContext(script.slice(0, script.indexOf('$(document).ready(')), c);

    const overlay = {style: {}};
    const sourceVideo = {width: 0, height: 0};
    let size = {width: 480, height: 300};
    const speaker = {getBoundingClientRect: () => size};
    c.document.getElementById = id =>
        id === 'speakerVideo' ? speaker :
        id === 'player-container' ? overlay :
        id === 'myplayer' ? sourceVideo : null;

    const playerSizes = [], rendererSizes = [];
    c.myVideoPlayer = {
        setPlayerSize(width, height) {playerSizes.push([width, height]);}
    };
    c.myVideoMediaElement = {
        setSize(width, height) {rendererSizes.push([width, height]);}
    };

    c.fitSupervisorPlayerToVideo();
    assert.deepEqual(playerSizes[0], [480, 300]);
    assert.deepEqual(rendererSizes[0], [480, 300]);
    assert.equal(sourceVideo.width, 480);
    assert.equal(sourceVideo.height, 300);
    assert.equal(overlay.style.width, '480px');
    assert.equal(overlay.style.height, '300px');

    size = {width: 368, height: 230};
    c.fitSupervisorPlayerToVideo();
    assert.deepEqual(playerSizes[1], [368, 230]);
    assert.deepEqual(rendererSizes[1], [368, 230]);
    assert.equal(sourceVideo.width, 368);
    assert.equal(sourceVideo.height, 230);
    assert.equal(overlay.style.width, '368px');
    assert.equal(overlay.style.height, '230px');

    assert.match(script, /stretching:\s*'none'/);
    assert.match(script, /videoWidth:\s*initialVideoSize\.width/);
    assert.match(script, /videoHeight:\s*initialVideoSize\.height/);
    assert.match(script, /originalVideo\.width = initialVideoSize\.width;/);
    assert.match(script, /originalVideo\.height = initialVideoSize\.height;/);
    assert.match(script, /addEventListener\('rendererready', fitSupervisorPlayerToVideo/);
    assert.match(script, /addEventListener\('resize'/);
    assert.match(css, /#player-container:not\(\.interpreter-video-player\)\s*\{\s*overflow:\s*hidden;/);
    assert.match(css, /\.mejs__container:not\(\.mejs__container-fullscreen\)\s*\{[^}]*width:\s*100% !important;[^}]*height:\s*100% !important;/);
    assert.match(css, /\.mejs__mediaelement iframe\s*\{[^}]*width:\s*100% !important;[^}]*height:\s*100% !important;/);
    assert.match(markup, /<video id="myplayer" width="480" height="300"/);
    assert.match(markup, /src="js\/role-supervisor\.js\?v=1\.0\.4"/);
});
