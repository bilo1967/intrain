var localVideo;
var localStream;

myRole = RoleInterpreter;
myColor = ColorInterpreter;

speakerAudioMutedDefault = false;
//interpreterAudioDefault = false;
supervisorAudioMutedDefault = false;

speakerAudioMuted      = speakerAudioMutedDefault;
//interpreterAudioMuted  = interpreterAudioDefault;
supervisorAudioMuted = supervisorAudioMutedDefault;


// Video player
var showPlayer = false;

/*
 * The interpreter is a read-only viewer of the supervisor's synchronized video.
 * Playback commands arrive through the PeerJS data channel; this page never
 * starts playback in response to a local mouse or keyboard event.
 */
var remoteVideoURL = null;
var pendingRemoteVideoState = null;

// The interpreter controls only local playback loudness, never playback position.
var interpreterVideoVolume = 100;

function applyInterpreterVideoVolume() {
    if (myVideoPlayer && typeof myVideoPlayer.setVolume === 'function') {
        // MediaElement accepts 0..1 and forwards it to YouTube/Vimeo renderers.
        myVideoPlayer.setVolume(interpreterVideoVolume / 100);
    }
}

function setInterpreterVideoVolume(percent) {
    const value = Number(percent);
    if (!Number.isFinite(value)) return false;
    interpreterVideoVolume = Math.max(0, Math.min(100, Math.round(value)));
    applyInterpreterVideoVolume();
    return true;
}

/*
 * MediaElement 4.2.7 uses the native <video> dimensions when it creates a
 * YouTube or Vimeo iframe. Fit both the wrapper and the underlying renderer
 * to the central speaker video, not the mini videos in the left column.
 */
function getInterpreterVideoSize() {
    const video = document.getElementById('speakerVideo');
    if (!video) return null;

    const rect = video.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width <= 0 || height <= 0) return null;

    return {width, height};
}

function fitInterpreterPlayerToVideo() {
    const size = getInterpreterVideoSize();
    const overlay = document.getElementById('player-container');
    if (!size || !overlay) return;

    overlay.style.width = size.width + 'px';
    overlay.style.height = size.height + 'px';

    const source = document.getElementById('myplayer');
    if (source) {
        source.width = size.width;
        source.height = size.height;
    }

    if (myVideoPlayer && typeof myVideoPlayer.setPlayerSize === 'function') {
        myVideoPlayer.setPlayerSize(size.width, size.height);
    }
    if (myVideoMediaElement && typeof myVideoMediaElement.setSize === 'function') {
        // Resize the embedded YouTube/Vimeo iframe, not just its outer box.
        myVideoMediaElement.setSize(size.width, size.height);
    }
}

/*
 * A new sync request pauses this renderer and waits until the remote iframe
 * reports that it can play. Only this paused preparation can perform a seek.
 * During normal playback we merely send position reports to the supervisor.
 */
var interpreterSyncRequest = null;
var interpreterReadyURL = null;
var interpreterBuffering = false;
var interpreterSyncPoll = null;

function reportInterpreterVideoStatus() {
    if (!showPlayer || !remoteVideoURL || !myVideoPlayer ||
        !supervisorData || !supervisorData.open) return;

    let time;
    try { time = Number(myVideoPlayer.getCurrentTime()); }
    catch (error) { return; }
    if (!Number.isFinite(time) || time < 0) return;

    supervisorData.send({
        action: 'videostatus',
        url: remoteVideoURL,
        time,
        playing: !myVideoPlayer.paused,
        buffering: interpreterBuffering
    });
}

/* Never acknowledge a video that has not reached the renderer's canplay state. */
function sendInterpreterSyncReady() {
    const request = interpreterSyncRequest;
    if (!request || request.ready || remoteVideoURL !== request.url ||
        interpreterReadyURL !== request.url || !myVideoPlayer ||
        !supervisorData || !supervisorData.open) return;

    let position;
    try {
        myVideoPlayer.pause();
        position = Number(myVideoPlayer.getCurrentTime());
        if (!Number.isFinite(position) || position < 0) return;
        if (!request.preserve && !request.seekIssued &&
            Math.abs(position - request.time) > 0.2) {
            myVideoPlayer.setCurrentTime(request.time);
            request.seekIssued = true;
            request.attempts++;
            interpreterSyncPoll = setTimeout(sendInterpreterSyncReady, 200);
            return;
        }
    } catch (error) {
        console.warn('Unable to prepare interpreter video', error);
        return;
    }

    // Some iframe APIs report the previous position briefly after seek().
    if (!request.preserve && Math.abs(position - request.time) > 0.6 &&
        request.attempts < 12) {
        request.attempts++;
        interpreterSyncPoll = setTimeout(sendInterpreterSyncReady, 200);
        return;
    }
    request.ready = true;
    supervisorData.send({
        action: 'syncready', epoch: request.epoch, url: request.url, time: position
    });
}

function interpreterVideoCanPlay() {
    interpreterReadyURL = remoteVideoURL;
    interpreterBuffering = false;
    sendInterpreterSyncReady();
}

/* Handle a new supervisor preparation, including reconnection at mid-video. */
function prepareInterpreterVideoSync(data) {
    const parsed = validateVideoURL(data && data.url);
    const time = Number(data && data.time);
    if (!parsed.valid || !Number.isSafeInteger(data.epoch) || data.epoch < 1 ||
        !Number.isFinite(time) || time < 0 || !myVideoPlayer) return;

    clearTimeout(interpreterSyncPoll);
    const sameSource = parsed.url === remoteVideoURL;
    interpreterSyncRequest = {
        epoch: data.epoch, url: parsed.url, time,
        preserve: data.preserve === true && sameSource,
        ready: false, seekIssued: false, attempts: 0
    };
    if (!sameSource) interpreterReadyURL = null;
    setInterpreterPlayerVisible(true);
    try { myVideoPlayer.pause(); }
    catch (error) { console.warn('Unable to pause interpreter player for sync', error); }

    if (!sameSource) {
        applyRemoteVideoState({url: parsed.url, time, playing: false});
    } else {
        // Existing source: no seek for normal pause/resume. The supervisor will
        // seek to the position reported by this interpreter.
        if (!interpreterSyncRequest.preserve) {
            try { myVideoPlayer.setCurrentTime(time); interpreterSyncRequest.seekIssued = true; }
            catch (error) { console.warn('Unable to seek for reconnection', error); }
        }
        interpreterSyncPoll = setTimeout(sendInterpreterSyncReady, 150);
    }
}

/* A stale start never overrides a newer pause or synchronization cycle. */
function startInterpreterSynchronizedVideo(data) {
    const request = interpreterSyncRequest;
    if (!request || !request.ready || request.epoch !== data.epoch ||
        request.url !== data.url) return false;

    clearTimeout(interpreterSyncPoll);
    interpreterSyncRequest = null;
    interpreterBuffering = false;
    // Older playerstate/loadvideo seeks must never run after synchronized play.
    pendingRemoteVideoState = null;
    setRemoteVideoPlaying(true);
    return true;
}

/* Echo only a short token; the supervisor owns RTT estimation. */
function answerInterpreterVideoPing(data) {
    if (supervisorData && supervisorData.open && Number.isSafeInteger(data.seq)) {
        supervisorData.send({action: 'videosyncpong', seq: data.seq});
    }
}

function setInterpreterPlayerVisible(visible) {
    showPlayer = !!visible;
    $('#load-player i').toggleClass('fab fa-youtube', !showPlayer)
        .toggleClass('fas fa-times-circle', showPlayer);
    $('#player-container').toggleClass('stack-top', showPlayer)
        .toggleClass('stack-bottom hidden', !showPlayer);
    $('#interpreter-player-volume').toggleClass('hidden', !showPlayer);

    if (showPlayer) requestAnimationFrame(fitInterpreterPlayerToVideo);
}

/* Try to seek/play after the iframe renderer reports loaded metadata. */
function applyPendingRemoteVideoState() {
    if (!pendingRemoteVideoState || !myVideoPlayer) return;
    const state = pendingRemoteVideoState;
    try {
        if (state.time > 0) myVideoPlayer.setCurrentTime(state.time);
        if (state.playing) {
            const result = myVideoPlayer.play();
            if (result && typeof result.catch === 'function') {
                result.catch(error => console.warn('Browser blocked remote video autoplay', error));
            }
        } else {
            myVideoPlayer.pause();
        }
        if (pendingRemoteVideoState === state) pendingRemoteVideoState = null;
    } catch (error) {
        // Some iframe renderers reject seeks until they finish initialization.
        console.warn('Remote player is not ready for synchronized commands yet', error);
    }
}

function applyRemoteVideoState(data) {
    const parsed = validateVideoURL(data && data.url);
    if (!parsed.valid) {
        console.warn('Ignoring invalid remote video URL:', parsed.error);
        return;
    }
    if (!myVideoPlayer) return;

    const time = Number(data.time);
    pendingRemoteVideoState = {
        time: Number.isFinite(time) && time >= 0 ? time : 0,
        playing: data.playing === true
    };

    if (remoteVideoURL !== parsed.url) {
        remoteVideoURL = parsed.url;
        interpreterReadyURL = null;
        // Give MediaElement's embedded iframe a frame with a visible container.
        requestAnimationFrame(function() {
            if (remoteVideoURL !== parsed.url || !myVideoPlayer) return;
            try {
                myVideoPlayer.setSrc(parsed.url);
            } catch (error) {
                pendingRemoteVideoState = null;
                remoteVideoURL = null;
                logToPanel('The video sent by the supervisor could not be loaded.', 'warning');
                console.error('Video source rejected', error);
            }
        });
    } else {
        applyPendingRemoteVideoState();
    }
}

function setRemoteVideoPlaying(playing) {
    if (pendingRemoteVideoState) {
        pendingRemoteVideoState.playing = !!playing;
        // A pause still needs to reach an already playing old renderer.
        if (!playing && myVideoPlayer) {
            try { myVideoPlayer.pause(); } catch (error) { console.warn(error); }
        }
        return;
    }
    if (!myVideoPlayer) return;
    try {
        if (playing) {
            const result = myVideoPlayer.play();
            if (result && typeof result.catch === 'function') {
                result.catch(error => console.warn('Browser blocked synchronized playback', error));
            }
        } else {
            myVideoPlayer.pause();
        }
    } catch (error) {
        console.warn('Video player not yet ready for playback', error);
    }
}

function seekRemoteVideo(time, pause) {
    const position = Number(time);
    if (!Number.isFinite(position) || position < 0) return;
    if (pendingRemoteVideoState) {
        pendingRemoteVideoState.time = position;
        if (pause === true) pendingRemoteVideoState.playing = false;
        return;
    }
    if (!myVideoPlayer) return;
    try {
        myVideoPlayer.setCurrentTime(position);
        if (pause === true) myVideoPlayer.pause();
    } catch (error) {
        pendingRemoteVideoState = {time: position, playing: pause !== true};
    }
}

// Canvas to draw an audio waveform for the microphone
var micGraph = null;



$(document).ready(async function() {

    micGraph = $("#vumeter").get(0);
    
    // Create a dynamic <audio> element
    audioOutputElement = new Audio();
    audioOutputElement.loop = false;
    audioOutputElement.play();

    $(function () {
        InTrainUI.initTooltips()
    })

    initMuted();
    loadClock();
    
    resetIndicators();

    $('#cancel-button').attr("disabled", true);

    supervisorVideo = $("#supervisorVideo").get(0);
    speakerVideo = $("#speakerVideo").get(0);
    localVideo = $("#localVideo").get(0);

    audioContext = new AudioContext();

    setDeviceSelector($('#select-video-source').get(0), 'videoinput');  // select box for video source devices
    setDeviceSelector($('#select-audio-source').get(0), 'audioinput');  // select box for audio source devices
    setDeviceSelector($('#select-audio-output').get(0), 'audiooutput'); // select box for audio output devices

    $('#select-video-source').on('change', async () => {
        InTrainStorage.set('interpreter-video-source', $('#select-video-source').val());
        await setUserMediaConstraints();
    });
    $('#select-audio-source').on('change', async () => {
        InTrainStorage.set('interpreter-audio-source', $('#select-audio-source').val());
        await setUserMediaConstraints();
    });
    $('#select-audio-output').on('change', () => {
        InTrainStorage.set('interpreter-audio-output', $('#select-audio-output').val());
        changeAudioDestination(speakerVideo);
        changeAudioDestination(supervisorVideo);
        changeAudioDestination(audioOutputElement);
    });
    
    // Wait for local devices to be ready
    try {
        // Get infos on available device and update device lists
        const infos = await getDevices();
    
        // Helper function to validate device existence
        const validateDevice = (deviceId, kind) => {
            return deviceId && infos.some(device => device.deviceId === deviceId && device.kind === kind) ? deviceId : 'default';
        }

        $('#select-video-source').val(validateDevice(InTrainStorage.get('interpreter-video-source'), 'videoinput' ));
        $('#select-audio-source').val(validateDevice(InTrainStorage.get('interpreter-audio-source'), 'audioinput' ));
        $('#select-audio-output').val(validateDevice(InTrainStorage.get('interpreter-audio-output'), 'audiooutput'));

        changeAudioDestination(speakerVideo);
        changeAudioDestination(supervisorVideo);
        changeAudioDestination(audioOutputElement);

        await setUserMediaConstraints(); 

    } catch (error) {
        handleLocalMediaStreamError(error);
    }

    // Restore this viewer's preferred volume; it is not part of the session
    // snapshot and is never transmitted to the supervisor.
    const storedVideoVolume = InTrainStorage.get('interpreter-video-volume');
    setInterpreterVideoVolume(storedVideoVolume === null ? 100 : storedVideoVolume);
    $('#interpreter-video-volume').val(interpreterVideoVolume).on('input change', function() {
        if (setInterpreterVideoVolume(this.value)) {
            InTrainStorage.set('interpreter-video-volume', interpreterVideoVolume);
        }
    });

    // Give the native <video> real dimensions before the iframe renderer is
    // created. CSS dimensions alone are not used by YouTube/Vimeo.
    const initialVideoSize = getInterpreterVideoSize() || {width: 480, height: 300};
    const originalVideo = document.getElementById('myplayer');
    originalVideo.width = initialVideoSize.width;
    originalVideo.height = initialVideoSize.height;

    // init player
	$('#myplayer').mediaelementplayer({
        startVolume: interpreterVideoVolume / 100,
        // End the video normally; do not loop or rewind to its beginning.
        loop: false,
        autoRewind: false,
        stretching: 'none',
        videoWidth: initialVideoSize.width,
        videoHeight: initialVideoSize.height,
        controls: false,
        clickToPlayPause: false,
        enableKeyboard: false,
        alwaysShowControls: false,
        features: [],
        success: function(mediaElement, originalNode, instance) {
            myVideoPlayer = instance;
            myVideoMediaElement = mediaElement;
            fitInterpreterPlayerToVideo();
            applyInterpreterVideoVolume();
            // External iframe renderers become available asynchronously.
            mediaElement.addEventListener('rendererready', fitInterpreterPlayerToVideo, false);
            mediaElement.addEventListener('rendererready', applyInterpreterVideoVolume, false);
            mediaElement.addEventListener('loadedmetadata', fitInterpreterPlayerToVideo, false);
            mediaElement.addEventListener('loadedmetadata', applyInterpreterVideoVolume, false);
            mediaElement.addEventListener('loadedmetadata', applyPendingRemoteVideoState, false);
            mediaElement.addEventListener('canplay', applyPendingRemoteVideoState, false);
            mediaElement.addEventListener('canplay', interpreterVideoCanPlay, false);
            mediaElement.addEventListener('pause', reportInterpreterVideoStatus, false);
            mediaElement.addEventListener('playing', function() {
                interpreterBuffering = false;
                reportInterpreterVideoStatus();
            }, false);
            mediaElement.addEventListener('waiting', function() { interpreterBuffering = true; }, false);
            mediaElement.addEventListener('stalled', function() { interpreterBuffering = true; }, false);
            mediaElement.addEventListener('seeked', sendInterpreterSyncReady, false);
            mediaElement.addEventListener('error', function(error) {
                console.warn('Cannot load the synchronized video', error);
                logToPanel('This video is unavailable or cannot be embedded.', 'warning');
            }, false);
        }
        
	});


    $("#join-button").on("click", (e) => joinSupervisor(e, InterpreterPeerOptions, setAudioMode) );

    // Auto-join with URL params or login
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('supervisor')) {
        $("#username").val(urlParams.get('supervisor'));
        if (urlParams.get('action') === 'switching') {
            logToPanel("The supervisor has switched your role from speaker to interpreter", "danger");
        }
        setTimeout(() => {
            joinSupervisor(null, InterpreterPeerOptions, setAudioMode);
        }, 500);
    } else {
        InTrainUI.showModal('#login-dialog', {keyboard: false, backdrop: 'static'});    
    }
    
    loadCommonHandlers();
    
    function setAudioMode(mode = sessionMode) {
        if (mode == "training") {
            if (!isMicEnabled()) {
                animateCSS('#toggle-microphone', 'rubberBand');
                loadAndPlay("sounds/boing.wav", $('#select-audio-output').val());
            }
            if (showPlayer) {
                if (!speakerAudioMuted && speakerMedia && speakerMedia.open) {
                    muteMicrophone(RoleSpeaker, true);
                    animateCSS('#speaker-audio-toggle', 'heartBeat');
                }
            } else {
                if (speakerAudioMuted && speakerMedia && speakerMedia.open) {
                    muteMicrophone(RoleSpeaker, false);
                    animateCSS('#speaker-audio-toggle', 'heartBeat');
                }
            }
        } else if (mode == "briefing") {
            if (!isMicEnabled()) {
                animateCSS('#toggle-microphone', 'rubberBand');
                loadAndPlay("sounds/boing.wav", $('#select-audio-output').val());
            }                        
            if (supervisorAudioMuted) {
                muteMicrophone(RoleSupervisor, false);
                animateCSS('#supervisor-audio-toggle', 'heartBeat');
            }
            if (speakerAudioMuted && speakerMedia && speakerMedia.open) {
                muteMicrophone(RoleSpeaker, false);
                animateCSS('#speaker-audio-toggle', 'heartBeat');
            }
        } else {
            // ... error ?
        }
    }





    // Viewing the video is controlled by the supervisor. No local toggle.
    $('#load-player').prop('disabled', true);


    // Responsive breakpoints may change the speaker video dimensions.
    window.addEventListener('resize', function() {
        if (showPlayer) requestAnimationFrame(fitInterpreterPlayerToVideo);
    });

    // Small status report (one per second), never an automatic playback seek.
    setInterval(reportInterpreterVideoStatus, 1000);

    // ondevicechange event (webcam or headset has been plugged in or out)
    navigator.mediaDevices.ondevicechange = (e) => {
        console.log("Device list change detected");
        handleDeviceListChange(e); // io-devices.js
    }


});
