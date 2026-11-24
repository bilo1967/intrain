var localVideo;
var localStream;
var localStreamBackup;

// Only outgoing tracks change: the speaker keeps the existing WebRTC calls.
var speakerShareSession = null;
var speakerShareBusy = false;
var speakerShareEpoch = 0;

myRole = RoleSpeaker;
myColor = ColorSpeaker;


//speakerAudioMutedDefault = false;
interpreterAudioMutedDefault = false;
supervisorAudioMutedDefault = false;

//speakerAudioMuted      = speakerAudioMutedDefault;
interpreterAudioMuted  = interpreterAudioMutedDefault;
supervisorAudioMuted   = supervisorAudioMutedDefault;


// Canvas to draw an audio waveform for the microphone
var micGraph = null;


$(document).ready(async function() {

    micGraph = $("#vumeter").get(0);

    $(function () {
        InTrainUI.initTooltips()
    })
    
    initMuted();
    loadClock();


    resetIndicators();

    $('#cancel-button').attr("disabled", true);
    
    supervisorVideo = $("#supervisorVideo").get(0);
    interpreterVideo = $("#interpreterVideo").get(0);
    localVideo = $("#localVideo").get(0);

    audioContext = new AudioContext();
    
    setDeviceSelector($('#select-video-source').get(0), 'videoinput');  // select box for video source devices
    setDeviceSelector($('#select-audio-source').get(0), 'audioinput');  // select box for audio source devices
    setDeviceSelector($('#select-audio-output').get(0), 'audiooutput'); // select box for audio output devices

    $('#select-video-source').on('change', async () => {
        InTrainStorage.set('speaker-video-source', $('#select-video-source').val());
        await setUserMediaConstraints();
    });
    $('#select-audio-source').on('change', async () => {
        InTrainStorage.set('speaker-audio-source', $('#select-audio-source').val());
        await setUserMediaConstraints();
    });
    $('#select-audio-output').on('change', () => {
        InTrainStorage.set('speaker-audio-output', $('#select-audio-output').val());
        
        changeAudioDestination(interpreterVideo);
        changeAudioDestination(supervisorVideo);
        changeAudioDestination(audioOutputElement);
        InTrainFloorMedia.changeAudioOutput();
    });
    
    // Wait for local devices to be ready
    try {
        // Get infos on available device and update device lists
        const infos = await getDevices();
    
        // Helper function to validate device existence
        const validateDevice = (deviceId, kind) => {
            return deviceId && infos.some(device => device.deviceId === deviceId && device.kind === kind) ? deviceId : 'default';
        }

        $('#select-video-source').val(validateDevice(InTrainStorage.get('speaker-video-source'), 'videoinput' ));
        $('#select-audio-source').val(validateDevice(InTrainStorage.get('speaker-audio-source'), 'audioinput' ));
        $('#select-audio-output').val(validateDevice(InTrainStorage.get('speaker-audio-output'), 'audiooutput'));

        changeAudioDestination(interpreterVideo);
        changeAudioDestination(supervisorVideo);
        changeAudioDestination(audioOutputElement);
        InTrainFloorMedia.changeAudioOutput();

        await setUserMediaConstraints(); 

    } catch (error) {
        handleLocalMediaStreamError(error);
    }


    $("#join-button").on("click", (e) => joinSupervisor(e, SpeakerPeerOptions, setAudioMode) );

    // Auto-join with URL params or login
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('supervisor')) {
        $("#username").val(urlParams.get('supervisor'));
        if (urlParams.get('action') === 'switching') {
            logToPanel("The supervisor has switched your role from interpreter to speaker", "danger");
        }
        setTimeout(() => {
            joinSupervisor(null, SpeakerPeerOptions, setAudioMode);
        }, 500);
    } else {
        InTrainUI.showModal('#login-dialog', {keyboard: false, backdrop: 'static'});    
    }
    loadCommonHandlers();    
    
    function setAudioMode(mode = sessionMode) {
        if (mode == "training") {
            if (!isMicEnabled()) {
                animateCSS('#toggle-microphone', 'shake');
                loadAndPlay("sounds/boing.wav", $('#select-audio-output').val());
            }
            if (!interpreterAudioMuted && interpreterMedia && interpreterMedia.open) {
                muteMicrophone(RoleSupervisor, false);
                animateCSS('#supervisor-audio-toggle', 'heartBeat');
                muteMicrophone(RoleInterpreter, true);
                animateCSS('#interpreter-audio-toggle', 'heartBeat');
            }
        } else if (mode == "briefing") {
            if (!isMicEnabled()) {
                animateCSS('#toggle-microphone', 'shake');
                loadAndPlay("sounds/boing.wav", $('#select-audio-output').val());
            }
            if (interpreterAudioMuted && interpreterMedia && interpreterMedia.open) {
                muteMicrophone(RoleSupervisor, false);
                animateCSS('#supervisor-audio-toggle', 'heartBeat');
                muteMicrophone(RoleInterpreter, false);
                animateCSS('#interpreter-audio-toggle', 'heartBeat');
            }
        } else {
        }
        InTrainFloorMedia.applyVolume();
    }


    // getDisplayMedia must be initiated directly by the user click.
    $('#share-screen').on('click', async function() {
        if (speakerShareBusy) return;
        if (sharingScreenActive) {
            await stopSpeakerScreenShare();
            return;
        }
        const epoch = ++speakerShareEpoch;
        speakerShareBusy = true;
        $('#share-screen').prop('disabled', true);
        try {
            // Resume Web Audio without awaiting before the native capture picker.
            if (audioContext && audioContext.state === 'suspended') {
                void audioContext.resume().catch(error => console.warn('Audio resume failed', error));
            }
            const display = await navigator.mediaDevices.getDisplayMedia({video: true, audio: true});
            if (epoch !== speakerShareEpoch) {
                display.getTracks().forEach(track => track.stop());
                return;
            }
            await startSpeakerScreenShare(display, epoch);
        } catch (error) {
            // Canceling the picker must not terminate a working webcam stream.
            if (!['NotAllowedError', 'AbortError'].includes(error.name)) {
                console.warn('Cannot share screen', error);
                logToPanel('Cannot share screen: ' + escapeHTML(error.message || String(error)), 'warning');
            }
        } finally {
            speakerShareBusy = false;
            $('#share-screen').prop('disabled', false);
        }
    });

    window.addEventListener('pagehide', () => { void stopSpeakerScreenShare(false); });

    // ondevicechange event (webcam or headset has been plugged in or out)
    navigator.mediaDevices.ondevicechange = (e) => {
        console.log("Device list change detected");
        handleDeviceListChange(e); // io-devices.js
    }
    

});


/*
 * Publish a single screen video track and a single Web Audio audio track.
 * The latter mixes any captured desktop audio with the original microphone.
 * All original webcam/microphone tracks stay alive for restoration.
 */
function createSpeakerScreenShare(display, microphone, context) {
    const video = display.getVideoTracks()[0];
    if (!video || video.readyState === 'ended') throw new Error('Screen video is unavailable.');

    const sources = [];
    let destination = null;
    try {
        const stream = new MediaStream();
        const tracks = [...display.getAudioTracks(),
            ...(microphone ? microphone.getAudioTracks() : [])]
            .filter(track => track.readyState !== 'ended');
        if (tracks.length) {
            destination = context.createMediaStreamDestination();
            for (const track of tracks) {
                const source = context.createMediaStreamSource(new MediaStream([track]));
                sources.push(source);
                source.connect(destination);
            }
            destination.stream.getAudioTracks().forEach(track => stream.addTrack(track));
        }
        stream.addTrack(video);

        return {stream, video, display, dispose() {
            video.onended = null;
            sources.forEach(source => source.disconnect());
            if (destination) destination.stream.getTracks().forEach(track => track.stop());
            display.getTracks().forEach(track => track.stop());
        }};
    } catch (error) {
        sources.forEach(source => source.disconnect());
        if (destination) destination.stream.getTracks().forEach(track => track.stop());
        display.getTracks().forEach(track => track.stop());
        throw error;
    }
}

function speakerMediaConnections() {
    return [supervisorMedia, interpreterMedia];
}

// Wait for ALL track replacements before deciding whether to commit or roll back.
async function startSpeakerScreenShare(display, epoch = speakerShareEpoch) {
    const webcam = micStream || localStream;
    let candidate = null;
    try {
        if (!webcam || !audioContext) throw new Error('Microphone and camera are not ready.');
        if (epoch !== speakerShareEpoch || sharingScreenActive) {
            display.getTracks().forEach(track => track.stop());
            return false;
        }
        await audioContext.resume();
        if (epoch !== speakerShareEpoch) {
            display.getTracks().forEach(track => track.stop());
            return false;
        }
        candidate = createSpeakerScreenShare(display, micStream, audioContext);
        const changes = await Promise.allSettled(speakerMediaConnections().map(conn =>
            replaceStreamInMediaConnection(conn, candidate.stream, false)));
        if (changes.some(change => change.status === 'rejected')) {
            throw new Error('Could not replace a remote media track.');
        }
        if (epoch !== speakerShareEpoch || candidate.video.readyState === 'ended') {
            throw new Error('Screen capture ended before publication.');
        }

        // After successful replacement, publish the stream for late peer calls.
        candidate.wasMirrored = localVideo.classList.contains('mirrored');
        localVideo.classList.remove('mirrored');
        localVideo.srcObject = display;
        localVideo.muted = true;
        if (typeof localVideo.play === 'function') {
            const result = localVideo.play();
            if (result && typeof result.catch === 'function') void result.catch(() => {});
        }

        localStreamBackup = webcam;
        speakerShareSession = candidate;
        screenshareMediaStream = candidate.stream;
        sharingScreenActive = true;
        localStream = candidate.stream;
        candidate.video.onended = () => { void stopSpeakerScreenShare(); };
        $('#share-screen > i').addClass('fa-blink');
        console.log('Speaker screen share published with mixed audio');
        return true;
    } catch (error) {
        // Some peers may already be using the candidate. Restore both calls.
        if (epoch === speakerShareEpoch && webcam) {
            await Promise.allSettled(speakerMediaConnections().map(conn =>
                replaceStreamInMediaConnection(conn, webcam, false)));
            console.warn('Screen share publication failed', error);
            logToPanel('Could not share screen: ' + escapeHTML(error.message || String(error)), 'warning');
        }
        if (candidate) candidate.dispose();
        else display.getTracks().forEach(track => track.stop());
        return false;
    }
}

// Restores the webcam and releases screen tracks and Web Audio graph.
async function stopSpeakerScreenShare(restorePeers = true) {
    ++speakerShareEpoch; // Invalidates a picker or an unfinished publication.
    const session = speakerShareSession;
    if (!session) return false;

    speakerShareSession = null;
    speakerShareBusy = true; // Ignore clicks until camera tracks have been restored.
    $('#share-screen').prop('disabled', true);
    sharingScreenActive = false;
    screenshareMediaStream = null;
    const webcam = localStreamBackup || micStream;
    localStreamBackup = null;
    localStream = webcam;
    session.video.onended = null;
    if (localVideo) {
        localVideo.srcObject = webcam;
        localVideo.classList.toggle('mirrored', session.wasMirrored);
        if (typeof localVideo.play === 'function') {
            const result = localVideo.play();
            if (result && typeof result.catch === 'function') void result.catch(() => {});
        }
    }
    $('#share-screen > i').removeClass('fa-blink');
    try {
        if (restorePeers && webcam) {
            await Promise.allSettled(speakerMediaConnections().map(conn =>
                replaceStreamInMediaConnection(conn, webcam, false)));
        }
    } finally {
        session.dispose();
        speakerShareBusy = false;
        $('#share-screen').prop('disabled', false);
    }
    console.log('Speaker camera/microphone restored');
    return true;
}
