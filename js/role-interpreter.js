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
        controls: true,
        alwaysShowControls: false,
        features: [
        //  "playpause",
        //  "progress",
            "current",
            "duration",
        //  "tracks",
            "volume",
            "fullscreen"
        ],
        success: function(mediaElement, originalNode, instance) {
            myVideoPlayer = instance;
            myVideoMediaElement = mediaElement;            
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





    $('#load-player').on('click', function() {
        showPlayer = !showPlayer;
        
        if (showPlayer) {
            $('#load-player i').removeClass('fab fa-youtube').addClass('fas fa-times-circle');
            $('#player-container').removeClass('stack-bottom hidden').addClass('stack-top');
        } else {
            $('#load-player i').removeClass('fas fa-times-circle').addClass('fab fa-youtube');
            $('#player-container').removeClass('stack-top').addClass('stack-bottom hidden');
        }
    });


    // ondevicechange event (webcam or headset has been plugged in or out)
    navigator.mediaDevices.ondevicechange = (e) => {
        console.log("Device list change detected");
        handleDeviceListChange(e); // io-devices.js
    }


});
