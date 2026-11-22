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

function setInterpreterPlayerVisible(visible) {
    showPlayer = !!visible;
    $('#load-player i').toggleClass('fab fa-youtube', !showPlayer)
        .toggleClass('fas fa-times-circle', showPlayer);
    $('#player-container').toggleClass('stack-top', showPlayer)
        .toggleClass('stack-bottom hidden', !showPlayer);

    if (showPlayer && myVideoPlayer && typeof myVideoPlayer.setPlayerSize === 'function') {
        requestAnimationFrame(function() {
            if (showPlayer) myVideoPlayer.setPlayerSize(
                $('#player-container').width(), $('#player-container').height()
            );
        });
    }
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

    // init player
	$('#myplayer').mediaelementplayer({
        startVolume: 1,
        stretching: 'responsive',
        controls: false,
        clickToPlayPause: false,
        enableKeyboard: false,
        alwaysShowControls: false,
        features: [],
        success: function(mediaElement, originalNode, instance) {
            myVideoPlayer = instance;
            myVideoMediaElement = mediaElement;
            mediaElement.addEventListener('loadedmetadata', applyPendingRemoteVideoState, false);
            mediaElement.addEventListener('canplay', applyPendingRemoteVideoState, false);
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


    // ondevicechange event (webcam or headset has been plugged in or out)
    navigator.mediaDevices.ondevicechange = (e) => {
        console.log("Device list change detected");
        handleDeviceListChange(e); // io-devices.js
    }


});
