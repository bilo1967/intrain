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
        window: {addEventListener() {}},
    });
    for (const file of ['js/common.js', 'js/intrain.js', 'js/peercommon.js', 'js/floor-media.js']) {
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

test('chat colors are readable on light panels without changing layout classes', () => {
    const root = path.resolve(__dirname, '..');
    const css = fs.readFileSync(path.join(root, 'css/intrain-responsive.css'), 'utf8');
    const common = fs.readFileSync(path.join(root, 'js/common.js'), 'utf8');
    const chat = fs.readFileSync(path.join(root, 'js/intrain.js'), 'utf8');

    assert.ok(css.includes('background-color: #EDF2EF;'));
    assert.ok(css.includes('#chatboard, input.bg-chat {'));
    assert.ok(css.includes('color: #26343C;'));
    assert.ok(common.includes('const ColorInterpreter = "#2459A2";'));
    assert.ok(common.includes('const ColorSpeaker     = "#176C46";'));
    assert.ok(common.includes('const ColorSupervisor  = "#475569";'));
    const chatRenderer = chat.slice(chat.indexOf('function logToChat'), chat.indexOf('let hideLogPanelTimeout'));
    assert.ok(chatRenderer.includes("<strong style='color: "));
    assert.ok(!chatRenderer.includes("<span style='color: "));
    for (const page of ['supervisor.html', 'speaker.html', 'interpreter.html']) {
        const html = fs.readFileSync(path.join(root, page), 'utf8');
        assert.ok(html.includes('id="chatboard" class="selectable-text align-self-stretch bg-chat border rounded p-1 mb-1 h-100"'));
        assert.ok(html.includes('id="chattext" class="bg-chat align-self-stretch border rounded mt-auto p-1 w-100"'));
    }
});

// Speaker share tests exercise real code with mock streams, nodes and senders.
function loadSpeakerShareFixture(withDesktopAudio = true) {
    const c = loadApp();
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../js/role-speaker.js'), 'utf8'), c);
    class Stream {
        constructor(tracks = []) {this.tracks = [...tracks];}
        getTracks() {return [...this.tracks];}
        getAudioTracks() {return this.tracks.filter(t => t.kind === 'audio');}
        getVideoTracks() {return this.tracks.filter(t => t.kind === 'video');}
        addTrack(t) {this.tracks.push(t);}
    }
    c.MediaStream = Stream;
    const track = (kind, enabled = true) => ({
        kind, enabled, readyState: 'live', stopped: 0, onended: null,
        stop() {this.stopped++;this.readyState = 'ended';}
    });
    const camera = track('video', false), mic = track('audio', false);
    const video = track('video'), desktopAudio = track('audio');
    const webcam = new Stream([camera, mic]);
    const display = new Stream(withDesktopAudio ? [video, desktopAudio] : [video]);
    const nodes = [], destinations = [];
    c.audioContext = {
        state: 'running', async resume() {},
        createMediaStreamSource(source) {
            const node = {source, disconnected: false, connect() {return this;},
                disconnect() {this.disconnected = true;}};
            nodes.push(node);
            return node;
        },
        createMediaStreamDestination() {
            const dest = {stream: new Stream([track('audio')])};
            destinations.push(dest);
            return dest;
        }
    };
    let mirrored = true;
    c.localVideo = {
        srcObject: webcam, muted: true, play() {return Promise.resolve();},
        classList: {
            contains(k) {return k === 'mirrored' && mirrored;},
            remove(k) {if (k === 'mirrored') mirrored = false;},
            toggle(k, active) {if (k === 'mirrored') mirrored = active;}
        }
    };
    function connection() {
        const sender = kind => ({
            track: kind === 'video' ? camera : mic, history: [],
            async replaceTrack(newTrack) {this.history.push(newTrack);this.track = newTrack;}
        });
        const senders = [sender('video'), sender('audio')];
        return {open: true, peerConnection: {getSenders: () => senders},
            senders, close() {this.open = false;}};
    }
    c.micStream = webcam;
    c.localStream = webcam;
    c.supervisorMedia = connection();
    c.interpreterMedia = connection();
    return {c, camera, mic, webcam, video, desktopAudio, display, nodes, destinations};
}

test('speaker shares screen with microphone and desktop audio, restoring camera and releasing resources', async () => {
    const f = loadSpeakerShareFixture();
    assert.equal(await f.c.startSpeakerScreenShare(f.display), true);
    assert.equal(f.c.sharingScreenActive, true);
    assert.equal(f.c.localStream.getVideoTracks()[0], f.video);
    assert.equal(f.c.localStream.getAudioTracks().length, 1);
    assert.equal(f.nodes.length, 2); // Both microphone and desktop contribute.
    assert.equal(f.nodes[0].source.getAudioTracks()[0], f.desktopAudio);
    assert.equal(f.nodes[1].source.getAudioTracks()[0], f.mic);
    assert.equal(f.c.localVideo.srcObject, f.display);
    assert.equal(f.c.isCamEnabled(), false);
    assert.equal(f.c.toggleCam(), true); // Webcam changes, screen keeps running.
    assert.equal(f.video.enabled, true);
    assert.equal(f.c.supervisorMedia.senders[0].track, f.video);
    assert.equal(f.c.interpreterMedia.senders[0].track, f.video);
    assert.equal(f.c.supervisorMedia.senders[1].track, f.destinations[0].stream.getAudioTracks()[0]);
    assert.equal(await f.c.stopSpeakerScreenShare(), true);
    assert.equal(f.c.localStream, f.webcam);
    assert.equal(f.c.localVideo.srcObject, f.webcam);
    assert.equal(f.c.localVideo.classList.contains('mirrored'), true);
    assert.equal(f.c.supervisorMedia.senders[0].track, f.camera);
    assert.equal(f.c.interpreterMedia.senders[1].track, f.mic);
    assert.equal(f.video.stopped, 1);
    assert.equal(f.desktopAudio.stopped, 1);
    assert.equal(f.destinations[0].stream.getAudioTracks()[0].stopped, 1);
    assert.ok(f.nodes.every(node => node.disconnected));
    assert.equal(f.camera.stopped, 0);
    assert.equal(f.mic.stopped, 0);
});

test('speaker screen share falls back to microphone when desktop audio is absent', async () => {
    const f = loadSpeakerShareFixture(false);
    assert.equal(await f.c.startSpeakerScreenShare(f.display), true);
    assert.equal(f.nodes.length, 1);
    assert.equal(f.nodes[0].source.getAudioTracks()[0], f.mic);
    await f.c.stopSpeakerScreenShare();
});

test('failed speaker track replacement rolls back both peers and keeps camera running', async () => {
    const f = loadSpeakerShareFixture();
    const fail = f.c.interpreterMedia.senders[0];
    fail.replaceTrack = async function(t) {
        if (t === f.video) throw new Error('replaceTrack failed');
        this.track = t;
    };
    assert.equal(await f.c.startSpeakerScreenShare(f.display), false);
    assert.equal(f.c.sharingScreenActive, false);
    assert.equal(f.c.localStream, f.webcam);
    assert.equal(f.c.supervisorMedia.senders[0].track, f.camera);
    assert.equal(f.c.interpreterMedia.senders[0].track, f.camera);
    assert.equal(f.video.stopped, 1);
    assert.equal(f.desktopAudio.stopped, 1);
    assert.ok(f.nodes.every(node => node.disconnected));
    assert.equal(f.camera.stopped, 0);
    assert.equal(f.mic.stopped, 0);
});

test('disconnecting the speaker also stops native desktop capture', async () => {
    const f = loadSpeakerShareFixture();
    assert.equal(await f.c.startSpeakerScreenShare(f.display), true);
    await f.c.closeAllConnections();
    assert.equal(f.c.sharingScreenActive, false);
    assert.equal(f.video.stopped, 1);
    assert.equal(f.desktopAudio.stopped, 1);
    assert.equal(f.c.localStream, f.webcam);
});

test('isolated multitrack experiment is independent of the three role pages', () => {
    const root = path.resolve(__dirname, '..');
    const html = fs.readFileSync(path.join(root, 'tests/peerjs-multitrack.html'), 'utf8');
    assert.ok(html.includes('src="../js/peerjs.min.js"'));
    assert.ok(html.includes('src="../config/config.js"'));
    assert.ok(html.includes('new MediaStream([mic.track, floor.track, video.track])'));
    assert.ok(html.includes('connection.answer()'));
    assert.ok(html.includes('sender.replaceTrack(replacement.track)'));
    assert.ok(html.includes('getAudioTracks().length'));
    assert.ok(!html.includes('js/intrain.js'));
    assert.ok(!html.includes('role-supervisor.js'));
});

test('file transfers stream bounded binary chunks and wait for receipt confirmations', async () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../js/file-transfer.js'), 'utf8');
    const completed = [], sentMessages = [], senderLog = [], recipientLog = [];
    function makeTransfer(log) {
        const c = vm.createContext({
            Blob, ArrayBuffer, Uint8Array, Promise, Map, WeakMap, WeakSet,
            setTimeout, clearTimeout,
            window: {addEventListener() {}},
            URL: {createObjectURL(blob) {
                completed.push(blob);
                return 'blob:received-file';
            }, revokeObjectURL() {}},
            console: {warn() {}},
            escapeHTML(value) {return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');},
            logToChat(message) {log.push(message);},
            logToPanel(message) {log.push(message);}
        });
        vm.runInContext(source, c, {filename: 'js/file-transfer.js'});
        return vm.runInContext('InTrainFileTransfer', c);
    }
    const sender = makeTransfer(senderLog), recipient = makeTransfer(recipientLog);
    const one = {
        open: true, dataChannel: {bufferedAmount: 0}, bufferSize: 0,
        on() {},
        send(data) {
            sentMessages.push(data);
            queueMicrotask(() => recipient.receive(two, data, 'speaker'));
        }
    };
    const two = {
        open: true, dataChannel: {bufferedAmount: 0}, bufferSize: 0,
        on() {},
        send(data) {queueMicrotask(() => sender.receive(one, data, 'supervisor'));}
    };
    const data = new Uint8Array(1024 * 1024);
    for (let i = 0; i < data.length; i++) data[i] = (i * 17) % 251;
    const first = new Blob([data], {type: 'application/octet-stream'});
    Object.defineProperty(first, 'name', {value: 'test & data.bin'});
    const empty = new Blob([]);
    Object.defineProperty(empty, 'name', {value: 'empty.bin'});

    await sender.sendFiles(one, [first, empty]);
    assert.equal(completed.length, 2);
    assert.deepEqual(new Uint8Array(await completed[0].arrayBuffer()), data);
    assert.equal(completed[1].size, 0);
    assert.ok(recipientLog[0].includes('test &amp; data.bin'));
    assert.equal(senderLog.filter(message => message.includes('File delivered')).length, 2);
    const chunks = sentMessages.filter(message => message.action === 'file-part');
    assert.ok(chunks.length >= 80); // One-megabyte file, not one giant message.
    assert.ok(chunks.every(chunk => chunk.bytes.byteLength <= 12 * 1024));
    assert.ok(sentMessages.some(message => message.action === 'file-finish'));
    assert.ok(sentMessages.every(message => message.action !== 'sendfile'));
});

test('direct speaker/interpreter file transfers complete both ways regardless of dial order', async () => {
    const root = path.resolve(__dirname, '..');
    const transferSource = fs.readFileSync(path.join(root, 'js/file-transfer.js'), 'utf8');

    for (const initiatingRole of ['speaker', 'interpreter']) {
        const receivingRole = initiatingRole === 'speaker' ? 'interpreter' : 'speaker';
        const initiating = loadApp();
        const receiving = loadApp();
        const logs = {speaker: [], interpreter: []};

        for (const [context, role] of [[initiating, initiatingRole], [receiving, receivingRole]]) {
            context.myRole = role;
            context.logToPanel = () => {};
            context.logToChat = message => logs[role].push(message);
            vm.runInContext(transferSource, context, {filename: 'js/file-transfer.js'});
            context.fileTransfer = vm.runInContext('InTrainFileTransfer', context);
        }

        const callbacks = {};
        receiving.myPeer = {on(event, handler) {callbacks[event] = handler;}};
        receiving.loadPeerHandlers(() => {});

        function endpoint(peer, role) {
            const listeners = {};
            return {
                peer, options: {metadata: {role}}, open: true,
                dataChannel: {bufferedAmount: 0}, bufferSize: 0,
                on(event, handler) {(listeners[event] ||= []).push(handler);return this;},
                emit(event, payload) {for (const fn of listeners[event] || []) fn(payload);},
                send(data) {queueMicrotask(() => this.other.emit('data', data));},
                close() {
                    if (!this.open) return;
                    this.open = false;
                    this.emit('close');
                }
            };
        }

        const outgoing = endpoint('incoming-peer', initiatingRole);
        const incoming = endpoint('outgoing-peer', initiatingRole);
        outgoing.other = incoming;
        incoming.other = outgoing;
        initiating.myPeer = {
            connect() {return outgoing;},
            call() {return {on() {return this;},close() {}};}
        };

        // The later joiner receives the connection; the earlier peer dials.
        callbacks.connection(incoming);
        initiating.dialPeer('incoming-peer', initiatingRole, receivingRole);
        outgoing.emit('open');
        incoming.emit('open');

        const forward = new Blob([new Uint8Array(48000).fill(7)]);
        const backward = new Blob([new Uint8Array(64000).fill(9)]);
        Object.defineProperty(forward, 'name', {value: 'forward.bin'});
        Object.defineProperty(backward, 'name', {value: 'backward.bin'});

        // Close a stalled connection rather than leave a 120s timer in CI.
        const watchdog = setTimeout(() => {outgoing.close(); incoming.close();}, 1500);
        try {
            await Promise.all([
                initiating.fileTransfer.sendFiles(outgoing, [forward]),
                receiving.fileTransfer.sendFiles(incoming, [backward])
            ]);
        } finally {
            clearTimeout(watchdog);
        }

        assert.ok(logs[receivingRole].some(s => s.includes('sent you a file:') && s.includes('forward.bin')),
            initiatingRole + ' -> ' + receivingRole + ' must arrive');
        assert.ok(logs[initiatingRole].some(s => s.includes('sent you a file:') && s.includes('backward.bin')),
            receivingRole + ' -> ' + initiatingRole + ' must arrive');
        assert.ok(logs[initiatingRole].some(s => s.includes('File delivered') && s.includes('forward.bin')),
            initiatingRole + ' must receive acknowledgement');
        assert.ok(logs[receivingRole].some(s => s.includes('File delivered') && s.includes('backward.bin')),
            receivingRole + ' must receive acknowledgement');
    }
});

test('invalid file chunks are rejected without offering a partial download', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../js/file-transfer.js'), 'utf8');
    const delivered = [], replies = [];
    const context = vm.createContext({
        Blob, ArrayBuffer, Uint8Array, Promise, Map, WeakMap, WeakSet,
        setTimeout, clearTimeout, window: {addEventListener() {}},
        URL: {createObjectURL() {delivered.push('download');return 'blob:fake';}, revokeObjectURL() {}},
        console: {warn() {}},
        escapeHTML: String, logToChat(message) {delivered.push(message);}, logToPanel() {}
    });
    vm.runInContext(source, context);
    const transfer = vm.runInContext('InTrainFileTransfer', context);
    const channel = {open: true, on() {}, send(message) {replies.push(message);}};
    assert.equal(transfer.receive(channel, {action: 'file-begin', id: 'x', name: 'file', type: '',
        size: 32, total: 1}, 'speaker'), true);
    transfer.receive(channel, {action: 'file-part', id: 'x', index: 0, bytes: new Uint8Array(4).buffer}, 'speaker');
    transfer.receive(channel, {action: 'file-finish', id: 'x'}, 'speaker');
    assert.equal(delivered.length, 0);
    assert.equal(replies[0].action, 'file-result');
    assert.equal(replies[0].ok, false);
});

test('all roles load the shared transfer protocol and do not log raw peer payloads', () => {
    const root = path.resolve(__dirname, '..');
    for (const role of ['supervisor', 'speaker', 'interpreter']) {
        const markup = fs.readFileSync(path.join(root, role + '.html'), 'utf8');
        assert.ok(markup.includes('src="js/file-transfer.js?v=1.0.1"'));
        assert.ok(markup.indexOf('js/file-transfer.js') > markup.indexOf('js/intrain.js'));
    }
    const intrain = fs.readFileSync(path.join(root, 'js/intrain.js'), 'utf8');
    const peer = fs.readFileSync(path.join(root, 'js/peercommon.js'), 'utf8');
    const supervisor = fs.readFileSync(path.join(root, 'js/role-supervisor.js'), 'utf8');
    assert.ok(!intrain.includes('console.log("Data received: ", data)'));
    assert.ok(!peer.includes('JSON.stringify(data)'));
    assert.ok(!supervisor.includes('console.log("received:", data)'));
    assert.ok(intrain.includes('InTrainFileTransfer.sendFiles'));
    assert.ok(peer.includes('InTrainFileTransfer.receive'));
    assert.ok(supervisor.includes('InTrainFileTransfer.receive'));
});

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

test('1.2 training does not allow participant mutes to reactivate inactive floor microphones', () => {
    const interpreter = loadApp();
    const receiveInterpreter = vm.runInContext('InTrainFloorMedia', interpreter);
    interpreter.myRole = 'interpreter';
    interpreter.sessionMode = 'training';
    interpreter.speakerMedia = {open:true};
    interpreter.speakerVideo = {muted:false};
    interpreter.supervisorData = {open:true};
    receiveInterpreter.receiveState(interpreter.supervisorData,
        {kind:'screen',mode:'training',hasAudio:true});
    assert.equal(interpreter.speakerVideo.muted,true);
    interpreter.muteMicrophone('speaker',false);
    assert.equal(interpreter.speakerVideo.muted,true);
    receiveInterpreter.receiveState(interpreter.supervisorData,
        {kind:'speaker',mode:'training',hasAudio:false});
    assert.equal(interpreter.speakerVideo.muted,false);

    const speaker = loadApp();
    const receiveSpeaker = vm.runInContext('InTrainFloorMedia', speaker);
    speaker.myRole = 'speaker';
    speaker.sessionMode = 'training';
    speaker.interpreterVideo = {muted:false};
    speaker.supervisorData = {open:true};
    receiveSpeaker.receiveState(speaker.supervisorData,
        {kind:'file',mode:'training',hasAudio:true});
    speaker.muteMicrophone('interpreter',false);
    assert.equal(speaker.interpreterVideo.muted,true);
    speaker.sessionMode = 'briefing';
    speaker.muteMicrophone('interpreter',false);
    assert.equal(speaker.interpreterVideo.muted,false);
});

test('1.2 remote media can refresh on late video track arrival', () => {
    const peer = fs.readFileSync(path.resolve(__dirname, '../js/peercommon.js'), 'utf8');
    const common = fs.readFileSync(path.resolve(__dirname, '../js/intrain.js'), 'utf8');
    assert.ok(peer.includes("mediaStream.addEventListener?.('addtrack', updateRemoteMedia)"));
    assert.ok(peer.includes('supervisorVideo.srcObject = new MediaStream([picture])'));
    assert.ok(common.includes('const publishedStream = floorPicture ?'));
    assert.ok(common.includes('new MediaStream([...mediaStream.getAudioTracks(), floorPicture])'));
});

test('1.2 publishes separate supervisor mic/floor audio tracks and replaces video in existing calls', async () => {
    const c = loadApp();
    const floorMedia = vm.runInContext('InTrainFloorMedia', c);
    c.MediaStream = class {
        constructor(tracks = []) {this.tracks = tracks.slice();}
        addTrack(t) {this.tracks.push(t);}
        getTracks() {return this.tracks;}
        getAudioTracks() {return this.tracks.filter(t => t.kind === 'audio');}
        getVideoTracks() {return this.tracks.filter(t => t.kind === 'video');}
    };
    const mic = {id: 'mic', kind: 'audio', readyState: 'live'};
    const cam = {id: 'cam', kind: 'video', readyState: 'live'};
    const floor = {id: 'floor', kind: 'audio', readyState: 'live'};
    const screen = {id: 'screen', kind: 'video', readyState: 'live'};
    const baseline = new c.MediaStream([mic,cam]);
    const dest = {stream: new c.MediaStream([floor])};
    const sources = [];
    const context = {
        createMediaStreamDestination() {return dest;},
        createMediaStreamSource(stream) {
            const source = {
                stream, links: [], disconnected: false,
                connect(target) {this.links.push(target);},
                disconnect() {this.disconnected = true;}
            };
            sources.push(source);return source;
        }
    };
    const offered = floorMedia.outgoingStream(baseline,context);
    assert.deepEqual(offered.getAudioTracks(), [mic,floor]);
    assert.deepEqual(offered.getVideoTracks(), [cam]);

    function connection() {
        const cameraSender = {track: cam, calls: [], async replaceTrack(track) {
            this.calls.push(track); this.track = track;
        }};
        const audioSenders = [{track: mic},{track: floor}];
        return {
            open: true, cameraSender,
            peerConnection: {
                getSenders() {return [cameraSender, ...audioSenders];},
                getTransceivers() {return [
                    {mid:'0',sender:audioSenders[0]},
                    {mid:'1',sender:audioSenders[1]}
                ];}
            }
        };
    }
    const speakerCall = connection(), interpreterCall = connection();
    c.speakerMedia = speakerCall;
    c.interpreterMedia = interpreterCall;
    const sharedStream = new c.MediaStream([floor, screen]);
    assert.equal(floorMedia.publishFloorAudio(sharedStream,context), true);
    assert.equal(sources[0].links[0],dest);
    await floorMedia.publishVideo(sharedStream,baseline);
    assert.equal(speakerCall.cameraSender.track,screen);
    assert.equal(interpreterCall.cameraSender.track,screen);
    await floorMedia.publishVideo(null,baseline);
    assert.equal(speakerCall.cameraSender.track,cam);
    assert.equal(interpreterCall.cameraSender.track,cam);
    assert.equal(floorMedia.publishFloorAudio(new c.MediaStream(),context), false);
    assert.equal(sources[0].disconnected,true);

    const messages = [];
    c.speakerData = {open: true, send(m) {messages.push(m);}};
    floorMedia.sendState(c.speakerData,{kind:'speaker',hasAudio:false,mode:'training'});
    assert.equal(messages[0].micMid,'0');
    assert.equal(messages[0].floorMid,'1');
});

test('1.2 receiver routes supervisor audio by MID, not stream order', () => {
    const c = loadApp(), players = [];
    const floorMedia = vm.runInContext('InTrainFloorMedia', c);
    c.MediaStream = class {
        constructor(tracks = []) {this.tracks = tracks;}
        getAudioTracks() {return this.tracks.filter(t => t.kind === 'audio');}
        getVideoTracks() {return this.tracks.filter(t => t.kind === 'video');}
    };
    c.Audio = class {
        constructor() {players.push(this);this.muted=false;}
        setAttribute() {}
        play() {return Promise.resolve();}
        pause() {}
    };
    c.myRole = 'speaker';
    c.sessionMode = 'training';
    const mic = {id:'microphone',kind:'audio',readyState:'live'};
    const floor = {id:'shared-floor',kind:'audio',readyState:'live'};
    const media = {peerConnection:{getTransceivers() {return [
        {mid:'7',receiver:{track: floor}},
        {mid:'2',receiver:{track: mic}}
    ];}}};
    const data = {open:true};
    c.supervisorMedia = media;
    c.supervisorData = data;
    floorMedia.captureRemote(media,new c.MediaStream([floor,mic]));
    floorMedia.receiveState(data,{
        action:'floorstate',kind:'screen',mode:'training',hasAudio:true,micMid:'2',floorMid:'7'
    });
    assert.equal(players.length,2);
    assert.equal(players[0].srcObject.getAudioTracks()[0],mic);
    assert.equal(players[1].srcObject.getAudioTracks()[0],floor);
    assert.equal(players[0].muted,true);
    assert.equal(players[1].muted,false);
    floorMedia.receiveState(data,{action:'floorstate',kind:'speaker',mode:'training',hasAudio:false});
    assert.equal(players[0].muted,false);
    assert.equal(players[1].muted,true);
    floorMedia.clear(media);
    assert.equal(players[0].srcObject,null);
    assert.equal(players[1].srcObject,null);
});

test('the interpreter no longer accepts an additional supervisor screenshare media call', () => {
    const c = loadApp(), handlers = {};
    c.myRole = 'interpreter';
    c.userID = 'supervisor-id';
    c.myPeer = {on(event, fn) {handlers[event] = fn;}};
    c.loadPeerHandlers();
    const additional = fakeIncomingCall('screenshare', 'supervisor-id');
    handlers.call(additional);
    assert.equal(additional.open, false);
    assert.equal(c.screenshareConnection, null);
});

test('both supervisor floor sources publish on existing media senders', () => {
    const sup = fs.readFileSync(path.resolve(__dirname, '../js/role-supervisor.js'), 'utf8');
    const peer = fs.readFileSync(path.resolve(__dirname, '../js/peercommon.js'), 'utf8');
    const media = fs.readFileSync(path.resolve(__dirname, '../js/floor-media.js'), 'utf8');
    assert.ok(sup.includes('InTrainFloorMedia.outgoingStream(localStream, audioContext,'));
    assert.ok(sup.includes('updatePublishedSupervisorFloor();'));
    assert.ok(!sup.includes('myPeer.call(\n                    interpreterPeer, stream'));
    assert.ok(peer.includes('InTrainFloorMedia.participantOfferStream(localStream, audioContext)'));
    assert.ok(peer.includes('InTrainFloorMedia.captureRemote(currentCall, mediaStream)'));
    assert.ok(media.includes('sender.replaceTrack(track)'));
    assert.ok(media.includes('floorMid: floor.mid'));
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

test('supervisor floor selector tracks speaker availability without disabling it', () => {
    const root = path.resolve(__dirname, '..');
    const source = fs.readFileSync(path.join(root, 'js/role-supervisor.js'), 'utf8');
    const markup = fs.readFileSync(path.join(root, 'supervisor.html'), 'utf8');
    assert.ok(source.includes("speakerConnected ? 'Speaker' : 'Speaker (not connected)'"));
    assert.ok(source.includes("if (role === RoleSpeaker) updateSupervisorFloorSelector()"));
    assert.ok(source.includes("if (speakerData !== c) return; // Stale connection."));
    assert.ok(markup.includes('<option value="speaker">Speaker</option>'));
    assert.ok(!markup.includes('<option value="speaker" disabled'));
});

test('supervisor floor selector retains original Material Symbols styling', () => {
    const root = path.resolve(__dirname, '..');
    const css = fs.readFileSync(path.join(root, 'css/intrain-responsive.css'), 'utf8');
    const supervisor = fs.readFileSync(path.join(root, 'supervisor.html'), 'utf8');

    assert.ok(!css.includes('Material+Symbols+Outlined'));
    assert.ok(supervisor.includes('fonts.googleapis.com/css2?family=Material+Symbols+Outlined'));
    assert.ok(supervisor.includes("font-family: 'Material Symbols Outlined'"));
    assert.match(supervisor, /id="floor-select"/);
    assert.match(supervisor, /value="speaker">Speaker/);
    assert.match(supervisor, /value="screen">Screen share/);
    assert.match(supervisor, /value="external">YouTube \/ Vimeo/);
    assert.doesNotMatch(css, /#floor-input-group\s*\{[^}]*\bheight\s*:/);
    assert.doesNotMatch(supervisor, /id="share-screen"|id="load-player"|id="player-panel"/);
    assert.match(supervisor, /css\/intrain-responsive\.css\?v=1\.0\.\d+/);
    for (const page of ['speaker.html', 'interpreter.html']) {
        const html = fs.readFileSync(path.join(root, page), 'utf8');
        assert.match(html, /css\/intrain-responsive\.css\?v=1\.0\.\d+/);
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

test('external video URL uses a modal rather than toolbar controls', () => {
    const root = path.resolve(__dirname, '..');
    const markup = fs.readFileSync(path.join(root, 'supervisor.html'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css/intrain-responsive.css'), 'utf8');
    assert.match(markup, /id="floor-select"/);
    assert.match(markup, /id="video-floor-dialog"/);
    assert.match(markup, /id="video-url-form"/);
    assert.match(markup, /id="video-url"/);
    assert.match(markup, /id="run-player"/);
    assert.match(markup, /id="video-floor-dialog-note"/);
    assert.match(css, /#video-floor-dialog \.input-clearer-wrapper\s*\{[^}]*position:\s*relative/);
    assert.doesNotMatch(markup, /class="[^"]*video-player-controls/);
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
    assert.match(supervisor, /sendCurrentVideoState\(c, true\)/);
    assert.match(supervisor, /prepareSupervisorVideoSync\(\{resume, reconnect: true\}\)/);
    assert.match(peer, /case 'playerstate':/);
    assert.match(peer, /applyRemoteVideoState\(data\)/);
});

test('supervisor validates URL and loads once after floor switch', () => {
    const js = fs.readFileSync(path.resolve(__dirname, '../js/role-supervisor.js'), 'utf8');
    const loadBlock = js.slice(js.indexOf("if (floor === 'external')"),
        js.indexOf("return false; // 'file' becomes available"));
    assert.match(loadBlock, /validateVideoURL\(options\.url\)/);
    assert.match(loadBlock, /requestAnimationFrame\(/);
    assert.equal((loadBlock.match(/myVideoPlayer\.setSrc\(/g) || []).length, 1);
    assert.match(js, /\$\('#video-url-form'\)\.on\('submit'/);
    assert.match(js, /addClass\('is-invalid'\)/);
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
    assert.match(markup, /src="js\/role-supervisor\.js\?v=1\.2\.\d+"/);
});

test('interpreter video renderer fits the central speaker video, not the mini videos', () => {
    const root = path.resolve(__dirname, '..');
    const script = fs.readFileSync(path.join(root, 'js/role-interpreter.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css/intrain-responsive.css'), 'utf8');
    const html = fs.readFileSync(path.join(root, 'interpreter.html'), 'utf8');
    const c = loadApp();

    // Evaluate declarations without the browser-only startup handler.
    vm.runInContext(script.slice(0, script.indexOf('$(document).ready(')), c);

    const overlay = {style: {}};
    const video = {width: 0, height: 0};
    let rect = {width: 480, height: 300};
    const speaker = {getBoundingClientRect: () => rect};
    const mini = {getBoundingClientRect: () => ({width: 120, height: 75})};
    c.document.getElementById = id => ({
        speakerVideo: speaker,
        'player-container': overlay,
        myplayer: video,
        interpreterVideo: mini
    })[id] ?? null;

    const playerSizes = [], rendererSizes = [];
    c.myVideoPlayer = {setPlayerSize(w, h) {playerSizes.push([w, h]);}};
    c.myVideoMediaElement = {setSize(w, h) {rendererSizes.push([w, h]);}};

    c.fitInterpreterPlayerToVideo();
    assert.deepEqual(playerSizes[0], [480, 300]);
    assert.deepEqual(rendererSizes[0], [480, 300]);
    assert.equal(video.width, 480);
    assert.equal(video.height, 300);
    assert.equal(overlay.style.height, '300px');

    rect = {width: 368, height: 230};
    c.fitInterpreterPlayerToVideo();
    assert.deepEqual(playerSizes[1], [368, 230]);
    assert.deepEqual(rendererSizes[1], [368, 230]);

    assert.match(script, /stretching:\s*'none'/);
    assert.match(script, /videoWidth:\s*initialVideoSize\.width/);
    assert.match(script, /videoHeight:\s*initialVideoSize\.height/);
    assert.match(script, /addEventListener\('rendererready', fitInterpreterPlayerToVideo/);
    assert.match(script, /window\.addEventListener\('resize'/);
    assert.match(css, /#player-container\.interpreter-video-player\s*\{\s*overflow:\s*hidden;/);
    assert.match(css, /#player-container\.interpreter-video-player \.mejs__mediaelement iframe\s*\{[^}]*width:\s*100% !important;[^}]*height:\s*100% !important;/);
    assert.match(html, /<video id="myplayer" width="480" height="300"/);
    assert.match(html, /class="video-player-interaction-shield"/);
    assert.match(html, /src="js\/role-interpreter\.js\?v=1\.2\.\d+"/);
});


test('headphone level covers native outputs and iframe players without touching the floor decoder', () => {
    const c = loadApp();
    const slider = {value: 100, setAttribute() {}, addEventListener(event, handler) {this.input = handler;}};
    const speaker = {volume: 1, muted: true}, supervisor = {volume: 1};
    const decoder = {volume: 1};
    c.document.getElementById = () => slider;
    c.document.querySelectorAll = () => [speaker, supervisor];
    const stored = [];
    c.InTrainStorage = {get: () => '60', set: (key, value) => stored.push([key, value])};
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../js/headphones.js'), 'utf8'), c);
    c.InTrainHeadphones.init();
    assert.equal(speaker.volume, 0.6);
    assert.equal(speaker.muted, true);
    const volumes = [];
    c.InTrainHeadphones.setPlayer({setVolume: value => volumes.push(value)});
    assert.equal(volumes.at(-1), 0.6);
    const mixedOutput = {volume: 1};
    c.InTrainHeadphones.registerOutput(mixedOutput);
    slider.value = '0'; slider.input.call(slider);
    assert.equal(mixedOutput.volume, 0);
    assert.equal(supervisor.volume, 0);
    assert.equal(volumes.at(-1), 0);
    assert.equal(decoder.volume, 1);
    assert.equal(stored[0][0], 'headphone-volume');
    c.InTrainHeadphones.setVolume(45);
    c.InTrainHeadphones.applyPlayerVolume(); // rendererready/loadedmetadata
    assert.equal(volumes.at(-1), 0.45);
    assert.equal(mixedOutput.volume, 0.45);
    assert.equal(c.InTrainHeadphones.setVolume('invalid'), false);
    c.InTrainHeadphones.setVolume(200); assert.equal(mixedOutput.volume, 1);
    c.InTrainHeadphones.setVolume(-1); assert.equal(mixedOutput.volume, 0);
});

test('supervisor balance preserves headphone mute and participant mutes after swapping sides', () => {
    const c = loadApp();
    const role = fs.readFileSync(path.resolve(__dirname, '../js/role-supervisor.js'), 'utf8');
    vm.runInContext(role.slice(0, role.indexOf('$(document).ready(')), c);
    const balance = {min: '0', max: '100', value: '50'};
    c.document.getElementById = id => id === 'cross-fader' ? balance : null;
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../js/headphones.js'), 'utf8'), c);
    let right, left, iframe;
    c.audioContext = {currentTime: 0};
    c.gain1 = {gain: {setValueAtTime(value) {right = value;}}};
    c.gain2 = {gain: {setValueAtTime(value) {left = value;}}};
    c.InTrainHeadphones.setPlayer({setVolume(value) {iframe = value;}});
    c.InTrainHeadphones.setVolume(0);
    c.updateSupervisorMonitor();
    assert.equal(iframe, 0); // The crossfader must never bypass headphone mute.
    c.InTrainHeadphones.setVolume(20);
    assert.ok(Math.abs(iframe - 0.2 * Math.SQRT1_2) < 1e-10);
    balance.value = '100'; c.updateSupervisorMonitor();
    assert.equal(right, 2);
    assert.equal(iframe, 0.2);
    c.swapChannels = true; c.speakerAudioMuted = true; c.updateSupervisorMonitor();
    assert.equal(left, 0); // Floor moved to L; its mute must move with it.
    assert.equal(right, 2);
    assert.equal(iframe, 0);
    c.speakerAudioMuted = false; c.interpreterAudioMuted = true;
    balance.value = '0'; c.updateSupervisorMonitor();
    assert.equal(right, 0);
    assert.equal(left, 2);
    assert.equal(iframe, 0.2); // Swapped floor is now on the left side of balance.
    c.boostVolume = true; c.updateSupervisorMonitor();
    assert.equal(left, 4); // The Boost button promises 2x, not 4x.
    assert.equal(iframe, 0.2); // Iframe API can attenuate but cannot amplify above unity.
});

test('an embedded interpreter floor cannot leak live speaker audio after a mode change', () => {
    const c = loadApp();
    c.myRole = 'interpreter'; c.showPlayer = true; c.speakerVideo = {muted: true};
    c.muteMicrophone('speaker', false);
    assert.equal(c.speakerVideo.muted, true);
    assert.equal(c.speakerAudioMuted, true);
    c.showPlayer = false; c.muteMicrophone('speaker', false);
    assert.equal(c.speakerVideo.muted, false);
});

test('recording cannot restart or download an old take while its WAV is being encoded', () => {
    const c = loadApp();
    const role = fs.readFileSync(path.resolve(__dirname, '../js/role-supervisor.js'), 'utf8');
    vm.runInContext(role.slice(0, role.indexOf('$(document).ready(')), c);
    const state = {}, handlers = {};
    c.$ = selector => {
        state[selector] ||= {classes: new Set(), disabled: false};
        const item = state[selector];
        const chain = new Proxy({}, {get: (_, key) => (...args) => {
            if (key === 'on') handlers[selector] = args[1];
            if (key === 'prop') item[args[0]] = args[1];
            if (key === 'addClass') item.classes.add(args[0]);
            if (key === 'removeClass') item.classes.delete(args[0]);
            return chain;
        }});
        return chain;
    };
    c.animateCSS = () => {};
    let cleared = 0, exported, download = 0;
    c.audioRecorder = {clear() {cleared++;}, record() {}, stop() {}, exportWAV(callback) {exported = callback;}};
    c.Recorder = {setupDownload() {download++; return 'blob:take';}};
    const encoding = role.indexOf('function saveAudio(');
    vm.runInContext(role.slice(encoding, role.indexOf('/**', encoding)), c);
    const start = role.indexOf('    var recording = false;');
    vm.runInContext(role.slice(start, role.indexOf("    $('#save-audio').on", start)), c);
    const click = handlers['#record-audio'];
    click(); click(); // Start, then stop/export.
    assert.equal(c.recordingExportPending, true);
    assert.equal(state['#record-audio'].disabled, true);
    assert.ok(state['#save-audio'].classes.has('disabled'));
    click(); assert.equal(cleared, 1); // Do not clear the previous take yet.
    exported({size: 1024});
    assert.equal(download, 1);
    assert.equal(c.recordingExportPending, false);
    assert.equal(state['#record-audio'].disabled, false);
    assert.ok(!state['#save-audio'].classes.has('disabled'));
    click(); assert.equal(cleared, 2);
});

test('all role headers have one headphone slider before setup and iframe volume remains local', () => {
    const root = path.resolve(__dirname, '..');
    for (const name of ['speaker', 'interpreter', 'supervisor']) {
        const html = fs.readFileSync(path.join(root, name + '.html'), 'utf8');
        assert.equal((html.match(/id="headphone-volume"/g) || []).length, 1);
        assert.ok(html.indexOf('id="headphone-volume"') < html.indexOf('id="config-button"'));
        assert.match(html, /src="js\/headphones.js/);
        assert.doesNotMatch(html, /id="interpreter-(?:player-volume|video-volume)"/);
    }
    for (const name of ['interpreter', 'supervisor']) {
        const role = fs.readFileSync(path.join(root, 'js/role-' + name + '.js'), 'utf8');
        assert.match(role, /startVolume:\s*InTrainHeadphones.getVolume\(\)/);
        assert.match(role, /addEventListener\('rendererready', InTrainHeadphones.applyPlayerVolume/);
        assert.match(role, /addEventListener\('loadedmetadata', InTrainHeadphones.applyPlayerVolume/);
        assert.match(role, /InTrainHeadphones.registerOutput\(audioOutputElement\)/);
    }
    const role = fs.readFileSync(path.join(root, 'js/role-interpreter.js'), 'utf8');
    assert.match(role, /clickToPlayPause:\s*false/);
    assert.match(role, /enableKeyboard:\s*false/);
    assert.match(role, /features:\s*\[\]/);
});

test('supervisor starts only after matching ready and preserves interpreter position', () => {
    const c = loadApp();
    const source = fs.readFileSync(path.resolve(__dirname, '../js/role-supervisor.js'), 'utf8');
    vm.runInContext(source.slice(0, source.indexOf('$(document).ready(')), c);
    const timers = new Map();
    let nextTimer = 0;
    c.setTimeout = callback => {const id = ++nextTimer; timers.set(id, callback); return id;};
    c.clearTimeout = id => timers.delete(id);
    const connection = {open: true, sent: [], send(data) {this.sent.push(data);}};
    c.interpreterData = connection;
    c.currentVideoURL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    let time = 40, paused = false, played = 0, seekCount = 0;
    c.myVideoPlayer = {
        get paused() {return paused;},
        getCurrentTime() {return time;},
        pause() {paused = true;},
        play() {paused = false; played++;},
        setCurrentTime(value) {time = value; seekCount++;}
    };

    assert.equal(c.prepareSupervisorVideoSync({resume: true, reconnect: false}), true);
    assert.equal(paused, true);
    assert.equal(played, 0);
    const message = connection.sent.find(data => data.action === 'syncprepare');
    assert.equal(message.preserve, true);
    assert.equal(message.time, 40);
    assert.equal(c.receiveSupervisorVideoReady({
        action: 'syncready', epoch: message.epoch - 1, url: message.url, time: 38
    }, connection), false);
    assert.equal(c.receiveSupervisorVideoReady({
        action: 'syncready', epoch: message.epoch, url: message.url, time: 38
    }, {open: true}), false);
    assert.equal(played, 0);

    assert.equal(c.receiveSupervisorVideoReady({
        action: 'syncready', epoch: message.epoch, url: message.url, time: 38
    }, connection), true);
    assert.equal(time, 38); // Supervisor rewinds, not the interpreter.
    assert.equal(seekCount, 1);
    assert.equal(played, 0);
    for (const [id, callback] of Array.from(timers)) {timers.delete(id); callback();}
    assert.equal(played, 1);
    assert.equal(connection.sent.filter(data => data.action === 'syncstart').length, 1);
    assert.equal(c.receiveSupervisorVideoReady({
        action: 'syncready', epoch: message.epoch, url: message.url, time: 38
    }, connection), false);
});

test('supervisor reconnect targets its own position and rejects unsuccessful seeks', () => {
    const c = loadApp();
    const source = fs.readFileSync(path.resolve(__dirname, '../js/role-supervisor.js'), 'utf8');
    vm.runInContext(source.slice(0, source.indexOf('$(document).ready(')), c);
    c.setTimeout = () => 1;
    c.clearTimeout = () => {};
    const connection = {open: true, sent: [], send(data) {this.sent.push(data);}};
    c.interpreterData = connection;
    c.currentVideoURL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    let paused = false, time = 74, starts = 0;
    c.myVideoPlayer = {
        get paused() {return paused;},
        getCurrentTime: () => time,
        pause() {paused = true;},
        play() {starts++;},
        setCurrentTime(value) {time = value;}
    };
    c.prepareSupervisorVideoSync({resume: true, reconnect: true});
    const request = connection.sent.find(data => data.action === 'syncprepare');
    assert.equal(request.preserve, false);
    assert.equal(request.time, 74);
    assert.equal(c.receiveSupervisorVideoReady({
        epoch: request.epoch, url: request.url, time: 0
    }, connection), false);
    assert.equal(starts, 0); // Do not restart if new iframe could not seek.
    c.prepareSupervisorVideoSync({resume: true, reconnect: true});
    const retry = connection.sent.filter(data => data.action === 'syncprepare').at(-1);
    assert.ok(retry.epoch > request.epoch);
    assert.equal(c.receiveSupervisorVideoReady({
        epoch: retry.epoch, url: retry.url, time: 74
    }, connection), true);
    assert.equal(starts, 1);
});

test('lag samples never seek or pause the interpreter automatically', () => {
    const c = loadApp();
    const source = fs.readFileSync(path.resolve(__dirname, '../js/role-supervisor.js'), 'utf8');
    vm.runInContext(source.slice(0, source.indexOf('$(document).ready(')), c);
    const connection = {open: true};
    c.interpreterData = connection;
    c.currentVideoURL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    c.showPlayer = true;
    let seeks = 0, pauses = 0;
    c.myVideoPlayer = {
        paused: false,
        getCurrentTime: () => 50,
        setCurrentTime() {seeks++;},
        pause() {pauses++;}
    };
    const status = {url: c.currentVideoURL, time: 48, playing: true, buffering: false};
    for (let i = 0; i < 3; i++) c.receiveInterpreterVideoStatus(status, connection);
    assert.equal(c.videoSyncLagSamples, 3);
    assert.equal(seeks, 0);
    assert.equal(pauses, 0);
    c.receiveInterpreterVideoStatus({...status, time: 50}, connection);
    assert.equal(c.videoSyncLagSamples, 0);
});

test('interpreter only seeks while paused for forced reconnection, not normal resume', () => {
    const c = loadApp();
    const source = fs.readFileSync(path.resolve(__dirname, '../js/role-interpreter.js'), 'utf8');
    vm.runInContext(source.slice(0, source.indexOf('$(document).ready(')), c);
    const tasks = [];
    c.setTimeout = callback => {tasks.push(callback); return tasks.length;};
    c.clearTimeout = () => {};
    c.requestAnimationFrame = () => {};
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const connection = {open: true, sent: [], send(data) {this.sent.push(data);}};
    c.supervisorData = connection;
    c.remoteVideoURL = url;
    c.interpreterReadyURL = url;
    let time = 18.5, paused = false, seeks = 0, plays = 0;
    c.myVideoPlayer = {
        get paused() {return paused;},
        getCurrentTime: () => time,
        setCurrentTime(value) {time = value; seeks++;},
        pause() {paused = true;},
        play() {paused = false; plays++;}
    };

    c.prepareInterpreterVideoSync({epoch: 10, url, time: 20, preserve: true});
    assert.equal(paused, true);
    assert.equal(seeks, 0);
    tasks.shift()();
    const ready = connection.sent.at(-1);
    assert.equal(ready.action, 'syncready');
    assert.equal(ready.time, 18.5);
    assert.equal(c.startInterpreterSynchronizedVideo({epoch: 9, url}), false);
    c.pendingRemoteVideoState = {time: 0, playing: false}; // Stale load.
    assert.equal(c.startInterpreterSynchronizedVideo({epoch: 10, url}), true);
    assert.equal(c.pendingRemoteVideoState, null);
    assert.equal(plays, 1);
    assert.equal(seeks, 0);

    c.prepareInterpreterVideoSync({epoch: 11, url, time: 33, preserve: false});
    assert.equal(seeks, 1);
    assert.equal(time, 33);
    tasks.shift()();
    assert.equal(connection.sent.at(-1).epoch, 11);
    assert.equal(c.startInterpreterSynchronizedVideo({epoch: 10, url}), false);
    assert.equal(c.startInterpreterSynchronizedVideo({epoch: 11, url}), true);
    assert.equal(plays, 2);
});

test('external video stops at its natural end on supervisor and interpreter', () => {
    const root = path.resolve(__dirname, '..');
    const pages = ['supervisor', 'interpreter'];
    for (const role of pages) {
        const script = fs.readFileSync(path.join(root, 'js/role-' + role + '.js'), 'utf8');
        const html = fs.readFileSync(path.join(root, role + '.html'), 'utf8');
        const playerOptions = script.slice(script.indexOf("$('#myplayer').mediaelementplayer({"));
        assert.match(playerOptions, /loop:\s*false/);
        assert.match(playerOptions, /autoRewind:\s*false/);
        assert.match(html, /<video id="myplayer"[^>]*>/);
        assert.doesNotMatch(html.match(/<video id="myplayer"[^>]*>/)[0], /\sloop(?:\s|=|>)/);
        assert.match(html, new RegExp('src="js/role-' + role + '\\.js\\?v=1\\.2\\.\\d+"'));
    }
});

test('supervisor cannot reveal the embedded player while screen sharing is live', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../js/role-supervisor.js'), 'utf8');
    const c = loadApp();
    vm.runInContext(source.slice(0, source.indexOf('$(document).ready(')), c);
    c.requestAnimationFrame = callback => callback();
    c.document.getElementById = () => null;

    c.sharingScreenActive = true;
    c.screenshareMediaStream = {getVideoTracks: () => [{readyState: 'live'}]};
    c.showPlayer = false;
    assert.equal(c.setSupervisorPlayerVisible(true), false);
    assert.equal(c.showPlayer, false);

    c.sharingScreenActive = false;
    assert.equal(c.setSupervisorPlayerVisible(true), true);
    assert.equal(c.showPlayer, true);
});

test('confirming the switch is mandatory and canceling it retains the current mode', () => {
    const role = fs.readFileSync(path.resolve(__dirname, '../js/role-supervisor.js'), 'utf8');
    const markup = fs.readFileSync(path.resolve(__dirname, '../supervisor.html'), 'utf8');
    const c = loadApp();
    vm.runInContext(role.slice(0, role.indexOf('$(document).ready(')), c);
    const shown = [];
    c.InTrainUI = {showModal: selector => shown.push(selector)};
    let changes = 0;

    c.confirmMediaModeSwitch('screen', () => {changes++;});
    assert.deepEqual(shown, ['#media-mode-dialog']);
    assert.equal(changes, 0); // Not switched simply by opening the dialog.
    assert.equal(typeof c.pendingMediaModeSwitch, 'function');
    c.pendingMediaModeSwitch = null; // The modal's hidden handler.
    assert.equal(changes, 0);

    assert.match(markup, /id="media-mode-dialog"/);
    assert.match(markup, /id="media-mode-dialog-message"/);
    assert.match(markup, /id="media-mode-confirm"/);
    assert.match(markup, /data-bs-dismiss="modal">Cancel/);
    assert.match(role, /'hidden\.bs\.modal', function\(\) \{\s*pendingMediaModeSwitch = null/);
    assert.match(role, /confirmMediaModeSwitch\('screen', startScreenCapture\)/);
    assert.match(role, /confirmMediaModeSwitch\('speaker', activateSpeaker\)/);
    assert.match(role, /InTrainUI\.showModal\('#video-floor-dialog'\)/);
});

test('screen picker preserves previous floor until capture succeeds', () => {
    const role = fs.readFileSync(path.resolve(__dirname, '../js/role-supervisor.js'), 'utf8');
    const start = role.slice(role.indexOf("if (floor === 'screen')"),
        role.indexOf("if (floor === 'external')"));
    assert.match(start, /getDisplayMedia\(\{video: true, audio: true\}\)/);
    assert.match(start, /\.then\(stream => \{/);
    assert.match(start, /stopSupervisorExternalVideo\(\);/);
    assert.ok(start.indexOf('getDisplayMedia(') < start.indexOf('stopSupervisorExternalVideo()'));
    assert.ok(start.indexOf('stopSupervisorExternalVideo()') < start.indexOf('shareScreen(stream)'));
    assert.doesNotMatch(start, /\.catch\([\s\S]*unshareScreen\(\)/);
});

test('switching from the player pauses both supervisor and interpreter', () => {
    const c = loadApp();
    const role = fs.readFileSync(path.resolve(__dirname, '../js/role-supervisor.js'), 'utf8');
    vm.runInContext(role.slice(0, role.indexOf('$(document).ready(')), c);
    c.requestAnimationFrame = callback => callback();
    const messages = [];
    c.interpreterData = {open: true, send: message => messages.push(message)};
    c.myVideoPlayer = {paused: false, pause() {this.paused = true;}};
    c.showPlayer = true;
    c.stopSupervisorExternalVideo();
    assert.equal(c.myVideoPlayer.paused, true);
    assert.equal(c.showPlayer, false);
    assert.ok(messages.some(m => m.action === 'hideplayer'));

    const roleInterpreter = fs.readFileSync(path.resolve(__dirname, '../js/role-interpreter.js'), 'utf8');
    const ci = loadApp();
    vm.runInContext(roleInterpreter.slice(0, roleInterpreter.indexOf('$(document).ready(')), ci);
    ci.showPlayer = true;
    let pauseCalls = 0;
    ci.myVideoPlayer = {pause() {pauseCalls++;}};
    ci.interpreterSyncRequest = {epoch: 15};
    ci.pendingRemoteVideoState = {playing: true};
    ci.setInterpreterPlayerVisible(false);
    assert.equal(pauseCalls, 1);
    assert.equal(ci.interpreterSyncRequest, null);
    assert.equal(ci.pendingRemoteVideoState, null);
});

test('recording routes speaker, shared audio, or silence without contaminating interpreter', () => {
    const role = fs.readFileSync(path.resolve(__dirname, '../js/role-supervisor.js'), 'utf8');
    const c = loadApp();
    vm.runInContext(role.slice(0, role.indexOf('$(document).ready(')), c);
    // The audio graph is declared after DOM startup; evaluate it separately.
    vm.runInContext(role.slice(role.indexOf('function initCrossFader()'),
        role.indexOf('function initRecorder()')), c);

    const connected = [];
    function audioSource(label) {
        return {
            label,
            connect(target) {connected.push([label, target]);},
            disconnect() {},
            stop() {}
        };
    }
    c.audioContext = {createMediaStreamSource(stream) {return audioSource(stream.label);}};
    c.silence = () => audioSource('silence');
    c.brownianNoise = () => audioSource('noise');
    c.split1 = {id: 'split1'};
    c.split2 = {id: 'split2'};
    c.speakerMedia = {open: true};
    c.speakerMediaStream = {label: 'speaker'};
    c.interpreterMedia = {open: true};
    c.interpreterMediaStream = {label: 'interpreter'};
    c.swapChannels = false;

    function expectSources(expectedLeft) {
        c.initCrossFader();
        assert.equal(c.channel1.label, expectedLeft);
        assert.equal(c.channel2.label, 'interpreter');
        assert.deepEqual(connected.slice(-2).map(([source, target]) => [source, target.id]),
            [[expectedLeft, 'split1'], ['interpreter', 'split2']]);
    }

    c.showPlayer = false;
    c.sharingScreenActive = false;
    c.screenshareMediaStream = null;
    expectSources('speaker');

    c.sharingScreenActive = true;
    c.screenshareMediaStream = {
        label: 'screen', getAudioTracks: () => [{kind: 'audio'}]
    };
    expectSources('screen');

    c.screenshareMediaStream = {
        label: 'silent-screen', getAudioTracks: () => []
    };
    expectSources('silence'); // Never substitute speaker if capture lacks audio.

    c.showPlayer = true;
    expectSources('silence'); // External video is never recorded.
    c.showPlayer = false;
    c.sharingScreenActive = false;
    c.screenshareMediaStream = null;
    expectSources('speaker');

    assert.match(role, /split1\.connect\(mixrec, 0, 1\)/);
    assert.match(role, /split2\.connect\(mixrec, 0, 0\)/);
});

test('changing supervisor player visibility rebuilds the recording audio source', () => {
    const role = fs.readFileSync(path.resolve(__dirname, '../js/role-supervisor.js'), 'utf8');
    const c = loadApp();
    vm.runInContext(role.slice(0, role.indexOf('$(document).ready(')), c);
    let rerouted = 0;
    c.audioContext = {};
    c.split1 = {};
    c.split2 = {};
    c.initCrossFader = () => rerouted++;
    c.requestAnimationFrame = () => {};
    c.showPlayer = false;
    c.setSupervisorPlayerVisible(true);
    c.setSupervisorPlayerVisible(false);
    assert.equal(rerouted, 2);
});

test('floor selection is centralized and canceling the video dialog keeps the old floor', () => {
    const role = fs.readFileSync(path.resolve(__dirname, '../js/role-supervisor.js'), 'utf8');
    const start = role.indexOf('    function selectSupervisorFloor(floor, options = {})');
    const end = role.indexOf('    // Reset to the informative placeholder', start);
    const c = loadApp();
    vm.runInContext(role.slice(0, role.indexOf('$(document).ready(')), c);
    vm.runInContext(role.slice(start, end), c);
    const dialogs = [];
    c.InTrainUI = {showModal(name) {dialogs.push(name);}};
    c.sharingScreen = () => false;
    c.showPlayer = false;
    assert.equal(c.selectSupervisorFloor('unknown'), false);
    assert.equal(c.selectSupervisorFloor('external'), true);
    assert.equal(c.getSupervisorFloor(), 'speaker');
    assert.deepEqual(dialogs, ['#video-floor-dialog']);
    assert.equal(c.selectSupervisorFloor('external', {url: 'invalid'}), false);
    assert.equal(c.showPlayer, false);
});

test('floor switch to speaker stops the previous source after confirmation', () => {
    const role = fs.readFileSync(path.resolve(__dirname, '../js/role-supervisor.js'), 'utf8');
    const start = role.indexOf('    function selectSupervisorFloor(floor, options = {})');
    const end = role.indexOf('    // Reset to the informative placeholder', start);
    const c = loadApp();
    vm.runInContext(role.slice(0, role.indexOf('$(document).ready(')), c);
    vm.runInContext(role.slice(start, end), c);
    c.sharingScreen = () => false;
    c.requestAnimationFrame = () => {};
    c.showPlayer = true;
    let paused = 0, waiting = null;
    c.myVideoPlayer = {pause() {paused++;}};
    c.confirmMediaModeSwitch = (target, action) => {waiting = action;};
    c.selectSupervisorFloor('speaker');
    assert.equal(paused, 0);
    assert.equal(c.showPlayer, true);
    assert.equal(typeof waiting, 'function');
    waiting();
    assert.equal(c.getSupervisorFloor(), 'speaker');
    assert.equal(paused, 1);
});

test('screen capture only takes over the previous floor when the picker succeeds', async () => {
    const role = fs.readFileSync(path.resolve(__dirname, '../js/role-supervisor.js'), 'utf8');
    const start = role.indexOf('    function selectSupervisorFloor(floor, options = {})');
    const end = role.indexOf('    // Reset to the informative placeholder', start);
    const c = loadApp();
    vm.runInContext(role.slice(0, role.indexOf('$(document).ready(')), c);
    vm.runInContext(role.slice(start, end), c);
    c.sharingScreen = () => false;
    c.requestAnimationFrame = () => {};
    c.showPlayer = true;
    let paused = 0, switched = 0, confirmAction;
    c.myVideoPlayer = {pause() {paused++;}};
    c.confirmMediaModeSwitch = (target, action) => {confirmAction = action;};
    c.shareScreen = stream => {switched++;c.sharingScreenActive = true;c.screenshareMediaStream = stream;};
    const stream = {getTracks: () => []};
    c.navigator.mediaDevices.getDisplayMedia = () => Promise.reject({name: 'NotAllowedError'});
    c.selectSupervisorFloor('screen');
    confirmAction();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(paused, 0);
    assert.equal(c.showPlayer, true);
    assert.equal(switched, 0);

    c.navigator.mediaDevices.getDisplayMedia = () => Promise.resolve(stream);
    c.selectSupervisorFloor('screen');
    confirmAction();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(paused, 1);
    assert.equal(c.showPlayer, false);
    assert.equal(switched, 1);
    assert.equal(c.getSupervisorFloor(), 'screen');
});

function loadSupervisorFloor() {
    const role = fs.readFileSync(path.resolve(__dirname, '../js/role-supervisor.js'), 'utf8');
    const c = loadApp(), handlers = {};
    vm.runInContext(role.slice(0, role.indexOf('$(document).ready(')), c);
    const chain = new Proxy({}, {get: (_, key) => key === 'on'
        ? (event, handler) => {handlers[event] = handler; return chain;}
        : () => chain});
    c.$ = selector => selector === '#floor-file' ? chain : new Proxy({}, {get: () => () => chain});
    const elements = {
        'floor-file': {value: '', clicks: 0, click() {this.clicks++;}},
        'local-floor-container': {replaceChildren(media) {this.media = media;}}
    };
    c.document.getElementById = id => elements[id];
    c.initCrossFader = () => {};
    c.logToPanel = () => {};
    c.escapeHTML = text => text;
    c.InTrainUI = {showModal() {}};
    c.myPeer = {call(peer, stream) {return {peer, stream, close() {}};}};
    c.updatePublishedSupervisorFloor = () => {};
    c.broadcastSupervisorFloorState = () => {};
    const start = role.indexOf('    function selectSupervisorFloor(floor, options = {})');
    vm.runInContext(role.slice(start, role.indexOf('    // Reset to the informative placeholder', start)), c);
    const sharing = role.indexOf('    function sharingScreen()');
    vm.runInContext(role.slice(sharing, role.indexOf('    // Keep the data traffic small', sharing)), c);
    return {c, handlers, elements};
}

function floorStream(video = false) {
    const tracks = [{kind: 'audio', readyState: 'live', stop() {this.readyState = 'ended';}}];
    if (video) tracks.push({kind: 'video', readyState: 'live', stop() {this.readyState = 'ended';}});
    return {getTracks: () => tracks, getAudioTracks: () => tracks.filter(t => t.kind === 'audio'),
        getVideoTracks: () => tracks.filter(t => t.kind === 'video')};
}

test('file picker cancellation and failed decoding preserve the current floor', async () => {
    const {c, handlers, elements} = loadSupervisorFloor();
    const old = floorStream(true);
    c.sharingScreenActive = true; c.screenshareMediaStream = old;
    assert.equal(c.selectSupervisorFloor('file'), true);
    assert.equal(elements['floor-file'].clicks, 1);
    assert.equal(c.getSupervisorFloor(), 'screen');
    await handlers.change.call({files: []});
    c.createLocalFileFloor = async () => {throw new Error('invalid file');};
    await handlers.change.call({files: [{}]});
    assert.equal(c.screenshareMediaStream, old);
    assert.ok(old.getTracks().every(t => t.readyState === 'live'));
});

test('audio-only file becomes the shared floor and returning to speaker disposes it', async () => {
    const {c, handlers, elements} = loadSupervisorFloor();
    const old = floorStream(true), stream = floorStream();
    c.sharingScreenActive = true; c.screenshareMediaStream = old;
    c.interpreterPeer = 'interpreter';
    let disposed = 0;
    const candidate = {media: {}, stream, dispose() {disposed++; stream.getTracks().forEach(t => t.stop());}};
    c.createLocalFileFloor = async () => candidate;
    await handlers.change.call({files: [{}]});
    assert.equal(c.getSupervisorFloor(), 'file');
    assert.equal(c.sharingScreen(), true); // Also covers late-join eligibility for audio-only files.
    assert.equal(c.screenshareConnection, null); // No extra WebRTC media call.
    assert.equal(elements['local-floor-container'].media, candidate.media);
    assert.ok(old.getTracks().every(t => t.readyState === 'ended'));
    c.confirmMediaModeSwitch = (_, action) => action();
    c.selectSupervisorFloor('speaker');
    assert.equal(disposed, 1);
    assert.equal(c.localFileFloor, null);
    assert.equal(c.getSupervisorFloor(), 'speaker');
});

test('a stale file decoder cannot take over a more recent floor selection', async () => {
    const {c, handlers} = loadSupervisorFloor();
    let resolve, disposed = 0;
    c.createLocalFileFloor = () => new Promise(done => {resolve = done;});
    const pending = handlers.change.call({files: [{}]});
    c.selectSupervisorFloor('speaker');
    resolve({dispose() {disposed++;}});
    await pending;
    assert.equal(disposed, 1);
    assert.equal(c.getSupervisorFloor(), 'speaker');
});
