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
        URL: {createObjectURL: () => 'blob:test'},
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
    const html = fs.readFileSync(path.resolve(__dirname, '../supervisor.html'), 'utf8');
    assert.match(html, /role === RoleInterpreter && sharingScreen\(\)/);
    assert.match(html, /c\.peer, screenshareMediaStream/);
});
