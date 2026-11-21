var localVideo;
var localStream;
var localStreamBackup;

var screenshareMediaStreamUnmerged = null;

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


// const supervisor = new Participant(RoleSupervisor, $("#supervisorVideo").get(0));
// const interpreter = new Participant(RoleInterpreter, $("#interpreterVideo").get(0));
// const speaker = new Participant(RoleSpeaker, null);


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
    }


    
    
    $('#share-screen').on('click', function() {
        if (sharingScreen()) {
            unshareScreen();
        } else {
            navigator.mediaDevices
                .getDisplayMedia({video: true, audio: true,})
                .then(stream => {

                    shareScreen(stream);
                    
                    return stream;
                    
                }).catch(err => {
                
                    unshareScreen();
                    console.log("Error sharing screen: " + err);
                    return null; 
                });
        }
    });



    function sharingScreen() {
        return sharingScreenActive && screenshareMediaStream &&
               screenshareMediaStream.getVideoTracks().some(track => track.readyState === 'live');
    }
    
    async function unshareScreen() {
        if (!sharingScreenActive) return;
        console.log('Unsharing screen - restoring camera and microphone');
        sharingScreenActive = false;
        const shared = screenshareMediaStream;
        screenshareMediaStream = null;
        const backup = localStreamBackup;
        localStreamBackup = null;
        if (shared) {
            shared.getTracks().forEach(track => { track.onended = null; track.stop(); });
        }
        if (backup) {
            localStream = backup;
            await Promise.allSettled([supervisorMedia, interpreterMedia]
                .map(conn => replaceStreamInMediaConnection(conn, backup, false)));
            localVideo.srcObject = backup;
        }
        $('#share-screen > i').removeClass('fa-blink');
    }

    function shareScreen(stream) {
    
        if (!sharingScreen()) {

            console.log('Screen, application or browser tab has been shared');

            sharingScreenActive = true;
            
            
            $('#share-screen > i').addClass('fa-blink');
            
            const screenVideoTrack = stream.getVideoTracks()[0];
            if (screenVideoTrack) screenVideoTrack.onended = () => unshareScreen();
            
            console.log('Speaker stream must be replaced and audio mixed');


            // Get a stream with merged audio tracks  
            // from mic (localStream) and screen share (stream)
            screenshareMediaStream = mergeAudioStreams(stream, localStream);
            
            if (screenshareMediaStream == null) {
                // should never be here...
                screenshareMediaStream = stream;
            } else {
                // Add screenshare video track to this new stream with merged audio tracks
                stream.getVideoTracks().forEach(t => {
                    screenshareMediaStream.addTrack(t);
                });
            }
            
            
            localVideo.srcObject = stream;

//          screenshareMediaStream = stream;
            localStreamBackup = localStream;
            localStream = screenshareMediaStream;

            
            // Replace current stream in media connections
            replaceStreamInMediaConnection(supervisorMedia, screenshareMediaStream, false);
            replaceStreamInMediaConnection(interpreterMedia, screenshareMediaStream, false);
            
            


        }
    }

    
    


    // ondevicechange event (webcam or headset has been plugged in or out)
    navigator.mediaDevices.ondevicechange = (e) => {
        console.log("Device list change detected");
        handleDeviceListChange(e); // io-devices.js
    }
    

});


const mergeAudioStreams = (desktopStream, voiceStream) => {

  if (desktopStream.getAudioTracks().length == 0 && voiceStream.getAudioTracks().length == 0) return null;

//const context = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();

console.log('MERGEAUDIOSTREAMS');
  
  if (desktopStream.getAudioTracks().length == 0) {

      // Create just one source for voice
      const source = audioContext.createMediaStreamSource(voiceStream);
      const voiceGain = audioContext.createGain();
      source.connect(voiceGain).connect(destination);
  
  } else if (voiceStream.getAudioTracks().length == 0) {
  
      // Create just one source for desktop
      const source = audioContext.createMediaStreamSource(desktopStream);
      const desktopGain = audioContext.createGain();
      source.connect(desktopGain).connect(destination);

  } else {
  
      // Create two sources and mix them
      const source1 = audioContext.createMediaStreamSource(desktopStream);
      const source2 = audioContext.createMediaStreamSource(voiceStream);
      
      const desktopGain = audioContext.createGain();
      const voiceGain = audioContext.createGain();
        
      // desktopGain.gain.value = 0.7;
      // voiceGain.gain.value = 0.7;
       
      source1.connect(desktopGain).connect(destination);
      // Connect source2
      source2.connect(voiceGain).connect(destination);
  }
    
  // return destination.stream.getAudioTracks();
  return destination.stream;
};
