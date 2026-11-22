// Real browser/media/WebRTC regression test, with no npm dependencies.
// Run: node tests/local-floor-browser.cjs (set CHROME_PATH if needed).
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const http = require('node:http');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function browserChecks() {
    const check = (condition, message) => {if (!condition) throw new Error(message);};
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const context = new AudioContext();
    const sessions = [];
    const peers = [];
    try {
        // Stereo WAV: only the RIGHT side has a tone. Verify mono downmix.
        const count = 48000;
        const buffer = new ArrayBuffer(44 + count * 4), view = new DataView(buffer);
        const string = (offset, text) => [...text].forEach((s, i) => view.setUint8(offset + i, s.charCodeAt(0)));
        string(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true);
        string(8, 'WAVEfmt '); view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); view.setUint16(22, 2, true);
        view.setUint32(24, 48000, true); view.setUint32(28, 192000, true);
        view.setUint16(32, 4, true); view.setUint16(34, 16, true);
        string(36, 'data'); view.setUint32(40, count * 4, true);
        for (let i = 0; i < count; i++) view.setInt16(46 + i * 4, 24000 * Math.sin(i * 2 * Math.PI * 440 / 48000), true);
        const audioNotices = [];
        const audio = await createLocalFileFloor(new File([buffer], 'right-only.wav', {type: 'audio/wav'}), context, status => audioNotices.push(status));
        sessions.push(audio);
        document.body.append(audio.media);
        check(audio.media.paused, 'File must open paused');
        check(audio.stream.getAudioTracks().length === 1 && !audio.stream.getVideoTracks().length, 'Audio-only tracks');
        const analyser = context.createAnalyser();
        context.createMediaStreamSource(audio.stream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const level = () => {analyser.getFloatTimeDomainData(samples); return Math.max(...samples.map(Math.abs));};
        await audio.media.play(); await wait(200);
        check(level() > 0.1, 'Right stereo channel must reach floor audio');
        audio.media.pause(); await wait(150);
        check(level() < 0.001, 'Pause produces silence');
        audio.media.currentTime = 0.9;
        await audio.media.play(); await wait(300);
        check(audio.media.ended && audio.stream.getAudioTracks()[0].readyState === 'live', 'EOF retains audio track');
        check(!audioNotices.length, 'Decodable audio must not trigger an unsupported-audio warning');
        audio.media.currentTime = 0; await audio.media.play(); await wait(150);
        check(level() > 0.1, 'Replay restores audio');
        audio.media.pause();

        // Use InTrain's real crossfader and WAV encoder, with an 880 Hz interpreter.
        window.audioContext = context;
        window.channel1 = window.channel2 = null;
        const balance = document.createElement('input'); balance.id = 'cross-fader';
        balance.type = 'range'; balance.min = 0; balance.max = 100; balance.value = 50;
        document.body.append(balance);
        window.speakerAudioMuted = window.interpreterAudioMuted = window.boostVolume = false;
        window.audioOutputElement = new Audio();
        InTrainHeadphones.registerOutput(audioOutputElement);
        initAudioCtx();
        window.showPlayer = false; window.swapChannels = false;
        window.sharingScreenActive = true; window.screenshareMediaStream = audio.stream;
        const headphones = document.createElement('audio');
        headphones.srcObject = audio.stream;
        InTrainHeadphones.registerOutput(headphones);
        await headphones.play();
        // Muting the final headphone output must not mute the recorded floor.
        InTrainHeadphones.setVolume(0);
        check(headphones.volume === 0 && audio.media.volume === 1, 'Headphone mute leaves source level intact');
        const interpreter = context.createOscillator(); interpreter.frequency.value = 880;
        const interpretation = context.createMediaStreamDestination(); interpreter.connect(interpretation); interpreter.start();
        window.interpreterMedia = {open: true}; window.interpreterMediaStream = interpretation.stream;
        initCrossFader(); initRecorder();
        audio.media.currentTime = 0; await audio.media.play(); audioRecorder.record(); await wait(350);
        audioRecorder.stop(); audio.media.pause();
        const wav = await new Promise(resolve => audioRecorder.exportWAV(resolve));
        const decoded = await context.decodeAudioData(await wav.arrayBuffer());
        check(decoded.numberOfChannels === 2, 'Recording is stereo WAV');
        const power = (samples, hz) => {
            let re = 0, im = 0;
            for (let i = 0; i < samples.length; i++) {
                const angle = i * 2 * Math.PI * hz / decoded.sampleRate;
                re += samples[i] * Math.cos(angle); im += samples[i] * Math.sin(angle);
            }
            return Math.hypot(re, im) / samples.length;
        };
        check(power(decoded.getChannelData(0), 880) > 0.1 && power(decoded.getChannelData(0), 440) < 0.01, 'WAV left contains interpreter only');
        check(power(decoded.getChannelData(1), 440) > 0.03 && power(decoded.getChannelData(1), 880) < 0.01, 'WAV right contains file only');

        // A shared screen can be stereo. Its right channel must not be discarded.
        const screen = context.createMediaStreamDestination();
        const screenStereo = context.createChannelMerger(2);
        const screenTone = context.createOscillator(); screenTone.frequency.value = 660;
        screenTone.connect(screenStereo, 0, 1); screenStereo.connect(screen); screenTone.start();
        window.screenshareMediaStream = screen.stream; initCrossFader();
        audioRecorder.clear(); audioRecorder.record(); await wait(350); audioRecorder.stop();
        const screenWav = await new Promise(resolve => audioRecorder.exportWAV(resolve));
        const screenDecoded = await context.decodeAudioData(await screenWav.arrayBuffer());
        check(power(screenDecoded.getChannelData(1), 660) > 0.03, 'Right-only stereo screen audio reaches WAV floor channel');
        check(power(screenDecoded.getChannelData(0), 880) > 0.1, 'Screen floor retains interpreter channel');
        window.swapChannels = true; initCrossFader();
        audioRecorder.clear(); audioRecorder.record(); await wait(350); audioRecorder.stop();
        const swappedWav = await new Promise(resolve => audioRecorder.exportWAV(resolve));
        const swapped = await context.decodeAudioData(await swappedWav.arrayBuffer());
        check(power(swapped.getChannelData(0), 660) > 0.03 && power(swapped.getChannelData(1), 880) > 0.1, 'Swap exchanges the two recorded channels');
        screenTone.stop(); window.swapChannels = false;
        interpreter.stop();
        headphones.pause(); InTrainHeadphones.unregisterOutput(headphones);

        // Local notification audio must use the same control and release its sink.
        let notification;
        const register = InTrainHeadphones.registerOutput;
        InTrainHeadphones.registerOutput = element => {notification = element; register(element);};
        const notificationURL = URL.createObjectURL(new Blob([buffer], {type: 'audio/wav'}));
        loadAndPlay(notificationURL);
        await wait(250);
        check(notification && notification.volume === 0 && !notification.paused, 'Notification obeys headphone mute');
        await wait(1100);
        check(notification.srcObject === null, 'Notification output is cleaned up');
        URL.revokeObjectURL(notificationURL);
        InTrainHeadphones.registerOutput = register;
        InTrainHeadphones.setVolume(100);

        // Build a real local WebM fixture entirely inside the browser.
        const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
        const drawing = canvas.getContext('2d');
        const fixture = canvas.captureStream(15);
        const recorder = new MediaRecorder(fixture, {mimeType: 'video/webm'}), chunks = [];
        recorder.ondataavailable = event => chunks.push(event.data);
        const stopped = new Promise(resolve => recorder.onstop = resolve);
        recorder.start();
        const timer = setInterval(() => {drawing.fillStyle = 'red'; drawing.fillRect(0, 0, 160, 90);}, 50);
        await wait(600); recorder.stop(); await stopped; clearInterval(timer);
        fixture.getTracks().forEach(track => track.stop());
        const videoNotices = [];
        const video = await createLocalFileFloor(new File(chunks, 'floor.webm', {type: 'video/webm'}), context, status => videoNotices.push(status));
        sessions.push(video); document.body.append(video.media);
        check(video.stream.getVideoTracks().length === 1, 'Video file has outgoing picture');

        // Feed the actual output to another WebRTC peer, as PeerJS would.
        const sender = new RTCPeerConnection(), receiver = new RTCPeerConnection(); peers.push(sender, receiver);
        sender.onicecandidate = e => {if (e.candidate) receiver.addIceCandidate(e.candidate);};
        receiver.onicecandidate = e => {if (e.candidate) sender.addIceCandidate(e.candidate);};
        const received = new MediaStream(); receiver.ontrack = e => received.addTrack(e.track);
        video.stream.getTracks().forEach(track => sender.addTrack(track, video.stream));
        await sender.setLocalDescription(await sender.createOffer());
        await receiver.setRemoteDescription(sender.localDescription);
        await receiver.setLocalDescription(await receiver.createAnswer());
        await sender.setRemoteDescription(receiver.localDescription);
        const remote = document.createElement('video'); remote.muted = true; remote.autoplay = true;
        document.body.append(remote); remote.srcObject = received;
        await wait(1400);
        check(video.media.paused && remote.videoWidth === 160, 'Late join receives paused picture');
        check(!videoNotices.length, 'A paused video must not trigger an audio warning');
        await video.media.play(); await wait(1200);
        check(remote.videoWidth === 160 && remote.videoHeight === 90, 'Video reaches remote peer: ' + JSON.stringify({width: remote.videoWidth, height: remote.videoHeight, state: sender.connectionState, tracks: received.getTracks().map(t => ({kind: t.kind, muted: t.muted})), localTime: video.media.currentTime, videoWidth: video.media.videoWidth}));
        check(video.media.ended, 'Fixture reached EOF');
        check(videoNotices.length === 1 && videoNotices[0] === 'unavailable', 'Video without decoded audio produces one warning');
        check(video.stream.getVideoTracks()[0].readyState === 'live', 'EOF retains canvas track');
        video.media.currentTime = 0; await video.media.play(); await wait(200);
        check(sender.connectionState === 'connected', 'Replay keeps same WebRTC connection');
        video.media.pause();
        check(video.stream.getVideoTracks()[0].readyState === 'live', 'Pause retains picture');
        let rejected = false;
        try {await createLocalFileFloor(new File(['bad'], 'broken.mp4', {type: 'video/mp4'}), context);}
        catch {rejected = true;}
        check(rejected, 'Undecodable file is rejected');
        check(audio.stream.getAudioTracks()[0].readyState === 'live', 'Failed load leaves existing floor live');
        for (const session of sessions) {
            session.dispose(); session.dispose();
            check(session.stream.getTracks().every(track => track.readyState === 'ended'), 'Cleanup stops every track');
        }
        return 'Passed: audio-only, stereo downmix, pause, EOF, replay, stereo WAV channel separation, video over WebRTC, invalid file, cleanup';
    } finally {
        sessions.forEach(session => session.dispose()); peers.forEach(peer => peer.close()); await context.close();
    }
}

(async () => {
    const server = http.createServer((req, res) => {
        if (req.url === '/js/recorderjs/recorderWorker.js') {
            res.setHeader('Content-Type', 'application/javascript');
            res.end(fs.readFileSync(path.join(__dirname, '../js/recorderjs/recorderWorker.js')));
        } else {res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>InTrain media tests</title><body></body>');}
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'intrain-browser-'));
    const chrome = process.env.CHROME_PATH || (process.platform === 'win32'
        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome');
    const processHandle = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu',
        '--allow-loopback-in-peer-connection', '--disable-features=WebRtcHideLocalIpsWithMdns',
        '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=0',
        '--user-data-dir=' + profile, 'http://127.0.0.1:' + server.address().port], {stdio: 'ignore', windowsHide: true});
    let socket;
    try {
        let port;
        for (let i = 0; i < 100; i++) {
            try {port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; break;} catch {}
            await pause(100);
        }
        assert.ok(port, 'Chrome started');
        const tabs = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
        socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {socket.onopen = resolve; socket.onerror = reject;});
        let id = 0; const pending = new Map();
        socket.onmessage = event => {const message = JSON.parse(event.data); if (pending.has(message.id)) {pending.get(message.id)(message); pending.delete(message.id);}};
        const send = (method, params) => new Promise(resolve => {pending.set(++id, resolve); socket.send(JSON.stringify({id, method, params}));});
        for (let i = 0; i < 50; i++) {
            const ready = await send('Runtime.evaluate', {expression: "document.readyState === 'complete' && location.hostname === '127.0.0.1'", returnByValue: true});
            if (ready.result?.result?.value === true) break;
            await pause(100);
        }
        const role = fs.readFileSync(path.join(__dirname, '../js/role-supervisor.js'), 'utf8');
        const recording = role.slice(role.indexOf('function initAudioCtx()'), role.indexOf('// Called after stopping the recorder'));
        const monitor = role.slice(role.indexOf('function updateSupervisorMonitor()'), role.indexOf('// When the page has been loaded'));
        const common = fs.readFileSync(path.join(__dirname, '../js/intrain.js'), 'utf8');
        const notifications = common.slice(common.indexOf('function loadAndPlay('), common.indexOf('async function setUserMediaConstraints()'));
        const source = 'window.$ = () => ({ready() {}});\n' +
            fs.readFileSync(path.join(__dirname, '../js/headphones.js'), 'utf8') + '\n' +
            fs.readFileSync(path.join(__dirname, '../js/local-floor.js'), 'utf8') + '\n' +
            fs.readFileSync(path.join(__dirname, '../js/recorderjs/recorder.js'), 'utf8') + '\n' + monitor + '\n' + recording + '\n' + notifications;
        const result = await send('Runtime.evaluate', {expression: source + '\n(' + browserChecks.toString() + ')()', awaitPromise: true, returnByValue: true, timeout: 25000});
        assert.ok(result.result && !result.result.exceptionDetails, JSON.stringify(result));
        console.log(result.result.result.value);
    } finally {
        socket?.close(); processHandle.kill();
        server.close();
        if (processHandle.exitCode === null) await new Promise(resolve => processHandle.once('exit', resolve));
        // The browser may briefly retain files on Windows; only this generated temp directory is removed.
        assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(profile).startsWith('intrain-browser-'));
        try {fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});} catch {}
    }
})().catch(error => {console.error(error); process.exitCode = 1;});
