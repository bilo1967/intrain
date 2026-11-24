/*
 * InTrain 1.2 - shared supervisor media publishing and independent reception.
 * One PeerJS MediaConnection per participant carries mic, floor audio and video.
 * The floor is routed into a persistent Web Audio destination (silent when off).
 * Explicit WebRTC MID identities travel over the existing PeerJS data channel.
 */
const InTrainFloorMedia = (() => {
    const incoming = {connection: null, stream: null, mapping: null, state: {kind: 'speaker', mode: 'briefing'}};
    let participantSilentAudio = null;
    const published = {destination: null, source: null, sourceStream: null, connected: new WeakSet(), version: 0};
    let audioMic = null, audioFloor = null;
    let layoutTimer = null;

    function isActive(kind) {return kind === 'screen' || kind === 'file';}

    // A callee cannot answer with more audio m-lines than the caller offered.
    // Reserve a second sendrecv audio m-line in the participant's initial offer.
    // No program signal is connected: the corresponding remote uplink is silent.
    function participantOfferStream(microphoneAndCamera, context) {
        if (!participantSilentAudio || participantSilentAudio.stream.getAudioTracks()[0]?.readyState !== 'live')
            participantSilentAudio = context.createMediaStreamDestination();
        const stream = new MediaStream();
        for (const track of microphoneAndCamera.getAudioTracks()) stream.addTrack(track);
        stream.addTrack(participantSilentAudio.stream.getAudioTracks()[0]);
        for (const track of microphoneAndCamera.getVideoTracks()) stream.addTrack(track);
        return stream;
    }

    function participantPrimaryMedia(connection, stream) {
        const audio = connection?.peerConnection?.getTransceivers()
            .find(t => t.receiver.track?.kind === 'audio')?.receiver.track
            || stream.getAudioTracks()[0];
        const media = new MediaStream();
        if (audio) media.addTrack(audio);
        for (const video of stream.getVideoTracks()) media.addTrack(video);
        return media;
    }

    function outgoingStream(microphoneAndCamera, audioContext, videoOverride = null) {
        if (!published.destination) published.destination = audioContext.createMediaStreamDestination();
        const stream = new MediaStream();
        for (const track of microphoneAndCamera.getAudioTracks()) stream.addTrack(track);
        stream.addTrack(published.destination.stream.getAudioTracks()[0]);
        const video = videoOverride || microphoneAndCamera.getVideoTracks()[0];
        if (video) stream.addTrack(video);
        return stream;
    }

    function audioFrom(stream, context) {
        if (!stream || stream.getAudioTracks().length === 0) return null;
        return context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    }

    function publishFloorAudio(stream, context) {
        if (!published.destination) published.destination = context.createMediaStreamDestination();
        if (published.source) {
            published.source.disconnect();
            published.source = null;
        }
        published.sourceStream = stream || null;
        if (!stream?.getAudioTracks().length) return false;
        try {
            published.source = audioFrom(stream, context);
            published.source.connect(published.destination);
            return true;
        } catch (error) {
            console.warn('Floor audio could not be routed:', error);
            return false;
        }
    }

    function trackMids(connection) {
        const pc = connection?.peerConnection;
        if (!pc || !published.destination) return null;
        const tracks = pc.getTransceivers();
        const floorTrack = published.destination.stream.getAudioTracks()[0];
        const floor = tracks.find(t => t.sender.track === floorTrack);
        const mic = tracks.find(t => t.sender.track?.kind === 'audio' && t.sender.track !== floorTrack);
        if (!mic || !floor || mic.mid == null || floor.mid == null) return null;
        return {micMid: mic.mid, floorMid: floor.mid};
    }

    const pendingVideo = new WeakMap();
    function sendState(connection, state) {
        if (!connection?.open) return;
        const role = connection === speakerData ? RoleSpeaker :
                     connection === interpreterData ? RoleInterpreter : null;
        if (!role) return;
        const media = role === RoleSpeaker ? speakerMedia : interpreterMedia;
        const mids = trackMids(media);
        connection.send({action: 'floorstate', ...state, ...(mids || {})});
    }

    function broadcast(state) {
        sendState(speakerData, state);
        sendState(interpreterData, state);
    }

    function videoTrack(stream, fallback) {
        return stream?.getVideoTracks()[0] || fallback?.getVideoTracks()[0] || null;
    }

    async function replaceVideo(connection, track) {
        if (!connection?.open || !connection.peerConnection || !track) return;
        const sender = connection.peerConnection.getSenders()
            .find(s => s.track?.kind === 'video');
        if (!sender || sender.track === track) return;
        await sender.replaceTrack(track);
    }

    // Concurrent floor selections are serialized by epoch: an older async
    // replacement must never win after a newer selection has begun.
    async function publishVideo(stream, webcamStream) {
        const version = ++published.version;
        const target = videoTrack(stream, webcamStream);
        if (!target) return;
        const changes = [speakerMedia, interpreterMedia].map(connection => {
            if (!connection) return Promise.resolve();
            const old = pendingVideo.get(connection) || Promise.resolve();
            const next = old.catch(() => {}).then(async () => {
                if (version !== published.version) return;
                await replaceVideo(connection, target);
            });
            pendingVideo.set(connection, next);
            return next;
        });
        const results = await Promise.allSettled(changes);
        for (const result of results) {
            if (result.status === 'rejected')
                console.warn('Could not change published supervisor video:', result.reason);
        }
        if (version !== published.version) return;
    }

    function ensureAudioElements() {
        if (typeof document === 'undefined') return;
        if (!audioMic) {
            audioMic = new Audio();
            audioMic.autoplay = true;
            audioMic.playsInline = true;
            audioMic.setAttribute('aria-label', 'Supervisor microphone');
            if (typeof InTrainHeadphones !== 'undefined')
                InTrainHeadphones.registerOutput(audioMic);
        }
        if (!audioFloor) {
            audioFloor = new Audio();
            audioFloor.autoplay = true;
            audioFloor.playsInline = true;
            audioFloor.setAttribute('aria-label', 'Supervisor floor audio');
            if (typeof InTrainHeadphones !== 'undefined')
                InTrainHeadphones.registerOutput(audioFloor);
        }
    }

    function captureRemote(connection, stream) {
        // A floorstate message may arrive before the first media stream;
        // preserve its MID mapping on the initial capture.
        if (incoming.connection && incoming.connection !== connection)
            incoming.mapping = null;
        incoming.connection = connection;
        incoming.stream = stream;
        ensureAudioElements();
        routeAudio();
    }

    // MID mapping must identify the microphone and floor even if tracks arrive
    // in the opposite order. No fallback to an arbitrary received audio track.
    function byMid(mid) {
        if (mid == null) return null;
        const t = incoming.connection?.peerConnection?.getTransceivers()
            .find(t => String(t.mid) === String(mid));
        const track = t?.receiver?.track;
        return track?.kind === 'audio' && track.readyState !== 'ended' ? track : null;
    }

    function bind(element, track) {
        if (!element) return;
        if (!track) {element.pause();element.srcObject = null;return;}
        if (element.srcObject?.getAudioTracks()[0] === track) return;
        element.srcObject = new MediaStream([track]);
        const play = element.play();
        if (play?.catch) play.catch(error => {
            console.warn('Browser prevented supervisor audio autoplay:', error);
        });
    }

    function routeAudio() {
        if (!incoming.stream || !incoming.mapping) return;
        ensureAudioElements();
        bind(audioMic, byMid(incoming.mapping.micMid));
        bind(audioFloor, byMid(incoming.mapping.floorMid));
        applyVolume();
    }

    function changeAudioOutput() {
        if (typeof changeAudioDestination === 'function') {
            if (audioMic) changeAudioDestination(audioMic);
            if (audioFloor) changeAudioDestination(audioFloor);
        }
    }

    function applyVolume() {
        if (!audioMic || !audioFloor) return;
        const mode = typeof sessionMode === 'string' ? sessionMode : incoming.state.mode;
        const floorPlaying = isActive(incoming.state.kind) && mode === 'training';
        audioMic.muted = floorPlaying || !!supervisorAudioMuted;
        audioFloor.muted = !floorPlaying || incoming.state.hasAudio === false;
    }

    function syncInterpreterLayout() {
        if (myRole !== RoleInterpreter || !supervisorVideo?.classList) return;
        const floorShowing = isActive(incoming.state.kind) && sessionMode === 'training';
        const supervisorIsLarge = supervisorVideo.classList?.contains('normal-video');
        if (floorShowing === supervisorIsLarge) return;
        if (layoutTimer) return;
        if (typeof $ !== 'function') return;
        $('#swap-button').trigger('click');
        layoutTimer = setTimeout(() => {
            layoutTimer = null;
            // Correct a floor switch that occurred during the fade animation.
            syncInterpreterLayout();
        }, 620);
    }

    function receiveState(connection, state) {
        if (!connection || connection !== supervisorData || !state) return;
        if (state.micMid != null && state.floorMid != null) {
            incoming.mapping = {micMid: state.micMid, floorMid: state.floorMid};
            routeAudio();
        }
        incoming.state = {
            kind: state.kind || 'speaker',
            mode: state.mode || sessionMode,
            hasAudio: state.hasAudio !== false
        };
        applyVolume();
        syncInterpreterLayout();
        if (myRole === RoleInterpreter && sessionMode === 'training' &&
            typeof muteMicrophone === 'function' && speakerMedia?.open) {
            if (isActive(incoming.state.kind)) muteMicrophone(RoleSpeaker, true);
            else if (typeof showPlayer === 'undefined' || !showPlayer)
                muteMicrophone(RoleSpeaker, false);
        }
        if ((myRole === RoleSpeaker || myRole === RoleInterpreter) && typeof $ === 'function') {
            const notice = $('#supervisor-floor-notice');
            const kind = incoming.state.kind;
            const label = kind === 'screen' ? 'Screen share' :
                          kind === 'file' ? 'Multimedia file' :
                          kind === 'external' ? 'YouTube / Vimeo (separate player)' : '';
            notice.text(label ? 'Supervisor floor: ' + label +
                (isActive(kind) && !incoming.state.hasAudio ? ' (no audio)' : '') : '')
                .toggleClass('d-none', !label);
        }
    }

    function clear(connection = null) {
        if (connection && incoming.connection !== connection) return;
        incoming.connection = null;
        incoming.stream = null;
        incoming.mapping = null;
        incoming.state = {kind: 'speaker', mode: 'briefing'};
        bind(audioMic, null);
        bind(audioFloor, null);
        if (myRole === RoleInterpreter) syncInterpreterLayout();
    }

    return {
        participantOfferStream, participantPrimaryMedia,
        outgoingStream, publishFloorAudio, publishVideo,
        trackMids, sendState, broadcast, captureRemote,
        receiveState, applyVolume, changeAudioOutput, clear,
        syncInterpreterLayout, floorActive: () => isActive(incoming.state.kind),
        floorKind: () => incoming.state.kind
    };
})();
