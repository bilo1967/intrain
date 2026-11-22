/*
 * Original recording and WebRTC references (formerly in supervisor.html <head>):
 * https://recordrtc.org/
 * https://github.com/muaz-khan/RecordRTC
 * https://github.com/streamproc/MediaStreamRecorder
 * Solo registrazione audio da AudioContext:
 * https://github.com/cwilso/AudioRecorder
 * https://webrtc.github.io/samples/src/content/getusermedia/record/
 * https://www.webrtc-experiment.com/RecordRTC/simple-demos/
 * https://webrtc.github.io/samples/src/content/peerconnection/pc1/
 * WebRTC server: https://github.com/meetecho/janus-gateway
 * Explore HTML5 audio: https://dzone.com/articles/exploring-html5-web-audio
 */
speakerAudioMutedDefault = false;
interpreterAudioMutedDefault = false;
// supervisorAudioMutedDefault = false;

speakerAudioMuted      = speakerAudioMutedDefault;
interpreterAudioMuted  = interpreterAudioMutedDefault;
//supervisorAudioMuted = supervisorAudioMutedDefault;

myRole = RoleSupervisor;
myColor = ColorSupervisor;


// NB: speaker → 1 (L), interpreter → 2 (R)

var split1    = null; // Splitter di canali
var split2    = null; // Splitter di canali
var gain1     = null; // Volume canale 1
var gain2     = null; // Volume canale 2
var mix       = null; // Mixer di canali
var channel1  = null;
var channel2  = null;


var speakerSource = null;
var interpreterSource = null;
var mySource = null;

// AudioRecorder: the two audio sources be mixed as separate L/R
// stereo tracks, both on mix (which will be eventually connected to
// the output) and mixrec, which is connected to the audio recorder
var zeroGain      = null;
var mixrec        = null; // Mixer di canali
var audioRecorder = null;
var recIndex      = 1; 


// Canvas to draw an audio waveform for the microphone
var micGraph = null;


// Various toggles
var swapChannels = false; // swap channels toggle variable
var boostVolume = false;  // boost volume
var showPlayer = false;   // External video player is currently visible
var pendingMediaModeSwitch = null; // Action awaiting the supervisor's confirmation
var floorSelectionEpoch = 0; // Ignore obsolete screen capture picker results
var localFileFloor = null; // Owns decoder, audio nodes, canvas track and object URL
var sharedFloorKind = 'screen';
var currentVideoURL = null; // Supervisor-owned video source, for late joiners
var videoLoadGeneration = 0; // Ignore stale pending loads

/*
 * Keep the current video state together with the other session state.
 * An interpreter joining late receives this snapshot after data connects.
 */
function getCurrentVideoState() {
    let time = 0;
    let playing = false;

    if (currentVideoURL && myVideoPlayer) {
        try {
            const position = Number(myVideoPlayer.getCurrentTime());
            if (Number.isFinite(position) && position >= 0) time = position;
            playing = !myVideoPlayer.paused;
        } catch (error) {
            console.warn('Cannot read current player position', error);
        }
    }
    return {action: 'playerstate', url: currentVideoURL, visible: showPlayer, time, playing};
}

function sendCurrentVideoState(connection, forcePaused = false) {
    if (connection && connection.open) {
        const state = getCurrentVideoState();
        if (forcePaused) state.playing = false;
        connection.send(state);
    }
}

/*
 * Synchronization is deliberately supervisory: only the supervisor may seek
 * while both players are paused. During playback interpreter time reports
 * produce warnings, never automatic seeks on the interpreting workstation.
 */
var videoSyncEpoch = 0;
var videoSyncPending = null;
var videoSyncAuthorizedPlay = false;
var videoSyncLagSamples = 0;
var videoSyncRtt = 0;
var videoSyncPingSerial = 0;
var videoSyncLastPing = null;
var videoSyncCurrentPosition = null;
const VideoSyncReadyTimeout = 12000;
const VideoSyncLagThreshold = 1.0;
const VideoSyncLagSamplesNeeded = 3;

/* Report a persistent lag unobtrusively, without covering player controls. */
function showVideoSyncLag(message = '') {
    const label = $('#video-sync-status');
    label.text(message).toggleClass('d-none', !message);
}

/* Discard an obsolete preparation, timeout or connection state. */
function cancelSupervisorVideoSync() {
    if (videoSyncPending) clearTimeout(videoSyncPending.timer);
    videoSyncPending = null;
    videoSyncLagSamples = 0;
    videoSyncCurrentPosition = null;
    videoSyncLastPing = null;
    showVideoSyncLag();
}

/* Read the current player time without allowing NaN or invalid iframe values. */
function getSupervisorVideoTime() {
    if (!myVideoPlayer) return 0;
    try {
        const value = Number(myVideoPlayer.getCurrentTime());
        return Number.isFinite(value) && value >= 0 ? value : 0;
    } catch (error) {
        return 0;
    }
}

/*
 * Called when play is requested, or when an interpreter reconnects.
 * A paused interpreter is preserved on normal resume: the supervisor seeks
 * to the interpreter's position, so no part of the speech is lost.
 * Reconnection instead targets the supervisor's current paused position.
 */
function prepareSupervisorVideoSync({resume = true, reconnect = false} = {}) {
    const connection = interpreterData;
    if (!currentVideoURL || !myVideoPlayer || !connection || !connection.open) return false;

    cancelSupervisorVideoSync();
    const epoch = ++videoSyncEpoch;
    const time = getSupervisorVideoTime();
    const state = {
        epoch, connection, url: currentVideoURL, time,
        preserve: !reconnect, resume, timer: null
    };
    videoSyncPending = state;
    videoSyncAuthorizedPlay = false;

    if (!myVideoPlayer.paused) myVideoPlayer.pause();
    connection.send({action: 'pausevideo'});
    connection.send({
        action: 'syncprepare',
        epoch, url: currentVideoURL, time, preserve: state.preserve
    });

    state.timer = setTimeout(function() {
        if (videoSyncPending !== state) return;
        cancelSupervisorVideoSync();
        logToPanel('Interpreter video not ready. Both players remain paused; press Play to retry.', 'warning');
        console.warn('Video synchronization timed out', epoch);
    }, VideoSyncReadyTimeout);
    return true;
}

/*
 * Only a matching, current connection/epoch can release the two paused players.
 * For a normal resume, use the interpreter's position to avoid skipping speech.
 */
function receiveSupervisorVideoReady(data, connection) {
    const state = videoSyncPending;
    if (!state || connection !== state.connection || state.connection !== interpreterData ||
        data.epoch !== state.epoch || data.url !== state.url) return false;

    const remoteTime = Number(data.time);
    if (!Number.isFinite(remoteTime) || remoteTime < 0) return false;

    clearTimeout(state.timer);
    videoSyncPending = null;

    // After reconnect the interpreter sought to our paused position. During
    // normal resume the supervisor instead catches up with the interpreter.
    const target = state.preserve ? remoteTime : state.time;
    if (!state.preserve && Math.abs(remoteTime - target) > 0.6) {
        // A new interpreter failed to reach the requested position.
        // Do not resume two unrelated points in the video.
        logToPanel('Interpreter could not seek to the synchronization position. Press Play to retry.', 'warning');
        return false;
    }
    const difference = Math.abs(getSupervisorVideoTime() - target);
    if (difference > 0.15) {
        try { myVideoPlayer.setCurrentTime(target); }
        catch (error) { console.warn('Supervisor seek during resynchronization failed', error); }
    }

    showVideoSyncLag();
    if (!state.resume) return true;

    // Allow iframe seeks a brief settling period. This is intentionally not
    // an endless wait, as some providers never emit a reliable seeked event.
    const start = function() {
        if (state.connection !== interpreterData || !state.connection.open ||
            state.url !== currentVideoURL || videoSyncEpoch !== state.epoch ||
            videoSyncPending) return;
        state.connection.send({action: 'syncstart', epoch: state.epoch, url: state.url});
        videoSyncAuthorizedPlay = true;
        const result = myVideoPlayer.play();
        if (result && typeof result.catch === 'function') {
            result.catch(error => {
                videoSyncAuthorizedPlay = false;
                console.warn('Supervisor video could not start', error);
            });
        }
    };
    if (difference > 0.15) setTimeout(start, 300);
    else start();
    return true;
}

/* A periodic ping estimates one-way delivery delay for the lag indicator. */
function pingInterpreterVideo() {
    if (!currentVideoURL || !showPlayer || !interpreterData || !interpreterData.open ||
        !myVideoPlayer || myVideoPlayer.paused) return;

    const sentAt = Date.now();
    const seq = ++videoSyncPingSerial;
    videoSyncLastPing = {seq, sentAt, connection: interpreterData};
    interpreterData.send({action: 'videosyncping', seq});
}

function receiveVideoSyncPong(data, connection) {
    const sent = videoSyncLastPing;
    if (!sent || sent.connection !== connection || data.seq !== sent.seq) return;
    const rtt = Date.now() - sent.sentAt;
    if (rtt >= 0 && rtt < 5000) videoSyncRtt = rtt;
    videoSyncLastPing = null;
}

/* Track sustained differences, never seek or pause the interpreter here. */
function receiveInterpreterVideoStatus(data, connection) {
    if (!currentVideoURL || !showPlayer || !myVideoPlayer ||
        myVideoPlayer.paused || videoSyncPending || connection !== interpreterData ||
        data.url !== currentVideoURL) {
        videoSyncLagSamples = 0;
        return;
    }
    const remoteTime = Number(data.time);
    if (!Number.isFinite(remoteTime) || remoteTime < 0) return;

    const estimatedRemote = remoteTime + (data.playing && !data.buffering ? videoSyncRtt / 2000 : 0);
    const difference = getSupervisorVideoTime() - estimatedRemote;
    videoSyncCurrentPosition = remoteTime;
    if (Math.abs(difference) >= VideoSyncLagThreshold || data.buffering || !data.playing) {
        videoSyncLagSamples++;
        if (videoSyncLagSamples >= VideoSyncLagSamplesNeeded) {
            showVideoSyncLag(data.buffering ? 'Interpreter buffering' :
                'Lag ' + (difference > 0 ? '+' : '') + difference.toFixed(1) + ' s');
        }
    } else {
        videoSyncLagSamples = 0;
        showVideoSyncLag();
    }
}

/*
 * Size the MediaElement player to the actual speaker video, not to the iframe's
 * intrinsic ratio (which can be square). The audio/recording controls below
 * the video must remain outside the player.
 */
function getSupervisorVideoSize() {
    const video = document.getElementById('speakerVideo');
    if (!video) return null;

    const width = Math.round(video.getBoundingClientRect().width);
    const height = Math.round(video.getBoundingClientRect().height);
    if (width <= 0 || height <= 0) return null;

    return {width, height};
}

function fitSupervisorPlayerToVideo() {
    const size = getSupervisorVideoSize();
    const container = document.getElementById('player-container');
    if (!size || !container) return;

    container.style.width = size.width + 'px';
    container.style.height = size.height + 'px';

    // MediaElement 4.2.7 creates YouTube/Vimeo iframes from the original
    // <video> width/height attributes. Resizing the outer container alone
    // does not resize that iframe.
    const source = document.getElementById('myplayer');
    if (source) {
        source.width = size.width;
        source.height = size.height;
    }

    if (myVideoPlayer && typeof myVideoPlayer.setPlayerSize === 'function') {
        myVideoPlayer.setPlayerSize(size.width, size.height);
    }
    if (myVideoMediaElement && typeof myVideoMediaElement.setSize === 'function') {
        // Propagate the dimensions to the actual YouTube/Vimeo renderer.
        // The renderer becomes available asynchronously.
        myVideoMediaElement.setSize(size.width, size.height);
    }
}

/*
 * The selector is an action list rather than a persistent select value:
 * resetting it lets the teacher select YouTube/Vimeo again to change the URL.
 * The placeholder always displays the floor that is actually active.
 */
function getSupervisorFloor() {
    if (showPlayer) return 'external';
    if (sharingScreenActive && screenshareMediaStream) return sharedFloorKind;
    return 'speaker';
}

function updateSupervisorFloorSelector() {
    const labels = {speaker: 'Speaker', screen: 'Screen share', external: 'YouTube / Vimeo', file: 'Multimedia file'};
    const floor = getSupervisorFloor();
    $('#floor-select').val('');
    $('#floor-select option[value=""]').text('Select floor... (' + labels[floor] + ')');
}

/*
 * Confirm stopping a running source before the requested action begins.
 * Closing the Bootstrap dialog without Continue leaves the floor unchanged.
 */
function confirmMediaModeSwitch(target, action) {
    pendingMediaModeSwitch = action;
    const message = target === 'screen'
        ? 'Starting screen sharing will stop the current floor. Continue?'
        : 'Switching to the speaker will stop the current video source. Continue?';
    $('#media-mode-dialog-message').text(message);
    InTrainUI.showModal('#media-mode-dialog');
}

/* Stop playback and cancel stale synchronization before hiding the video. */
function stopSupervisorExternalVideo() {
    ++videoLoadGeneration; // Cancel delayed iframe creation when leaving the player.
    cancelSupervisorVideoSync();
    ++videoSyncEpoch;
    videoSyncAuthorizedPlay = false;
    if (myVideoPlayer) {
        try { myVideoPlayer.pause(); }
        catch (error) { console.warn('Cannot pause hidden video player', error); }
    }
    setSupervisorPlayerVisible(false);
}

/* Only one video source may be visible or contribute to recording at a time. */
function setSupervisorPlayerVisible(visible) {
    if (visible && sharingScreenActive && screenshareMediaStream) return false;
    showPlayer = !!visible;
    $('#player-container').toggleClass('stack-top', showPlayer)
        .toggleClass('stack-bottom hidden', !showPlayer);
    if (showPlayer) requestAnimationFrame(fitSupervisorPlayerToVideo);
    if (interpreterData && interpreterData.open)
        interpreterData.send({action: showPlayer ? 'showplayer' : 'hideplayer'});

    // The recorder taps the splitters before the listening gain controls.
    if (audioContext && split1 && split2) initCrossFader();
    updateSupervisorFloorSelector();
    return true;
}


// When the page has been loaded
$(document).ready(async function() {


    setDeviceSelector($('#select-video-source').get(0), 'videoinput');  // select box for video source devices
    setDeviceSelector($('#select-audio-source').get(0), 'audioinput');  // select box for audio source devices
    setDeviceSelector($('#select-audio-output').get(0), 'audiooutput'); // select box for audio output devices

    // Direct reference to some elements
    micGraph = $("#vumeter").get(0);
    speakerVideo = $("#speakerVideo").get(0);
    interpreterVideo = $("#interpreterVideo").get(0);
    localVideo = $("#localVideo").get(0);

    audioContext = new AudioContext();
    
    // Create a dynamic <audio> element
    audioOutputElement = new Audio();
    InTrainHeadphones.registerOutput(audioOutputElement);
    audioOutputElement.loop = false;
    //audioOutputElement.play();


    try {

        // Get infos on available device and update device lists
        const infos = await getDevices();
    
        // Helper function to validate device existence
        const validateDevice = (deviceId, kind) => {
            return deviceId && infos.some(device => device.deviceId === deviceId && device.kind === kind) ? deviceId : 'default';
        }
        
        // Load saved setting and apply, if available
        $('#select-video-source').val(validateDevice(InTrainStorage.get('supervisor-video-source'), 'videoinput' ));
        $('#select-audio-source').val(validateDevice(InTrainStorage.get('supervisor-audio-source'), 'audioinput' ));
        $('#select-audio-output').val(validateDevice(InTrainStorage.get('supervisor-audio-output'), 'audiooutput'));

        // Connect mixed audio to output element
        changeAudioDestination(audioOutputElement);
        
        await setUserMediaConstraints();
    } catch (error) {
        handleLocalMediaStreamError(error);
    }


    // Some action need a running audio context to be performed
    // An audio context can be run only after the user makes a "gesture" on the interface
    // We then create a promise that initializes audio context and main audio nodes and
    // which is fulfilled if the audiocontext state is 'running' or after the user clicks
    // anywhere on the login window
    // AudioContext related actions are performed after the promise is fulfilled

    async function initializeAudioContext() {
        try {
            const ctx = initAudioCtx();

            if (ctx.state === 'suspended') {
                await new Promise(resolve => {
                    $('body').one("click", async () => {
                        await ctx.resume();
                        resolve();
                    });
                });
            } else if (ctx.state === 'running') {
                console.log(ctx.state);
            } else {
                throw new Error(`AudioContext in unexpected state: ${ctx.state}`);
            }

            return ctx;
        } catch (error) {
            console.error('Failed to initialize audio context:', error);
            throw error;
        }
    }

    try {
        const ctx = await initializeAudioContext();
        
        initCrossFader();
        initRecorder();
        
        if (ctx.state === 'suspended') {
            await ctx.resume();
            console.log("Audio context resumed");
        }
        
        if (audioOutputElement.paused) {
            console.log("audioOutputElement is paused because audioContext was unavailable. Start it.");
            audioOutputElement.play();
        }
        
        $('#select-video-source').on('change', () => {
            InTrainStorage.set('supervisor-video-source', $('#select-video-source').val());
            setUserMediaConstraints();
        });
        $('#select-audio-source').on('change', () => {
            InTrainStorage.set('supervisor-audio-source', $('#select-audio-source').val());
            setUserMediaConstraints();
        });
        $('#select-audio-output').on('change', () => {
            InTrainStorage.set('supervisor-audio-output', $('#select-audio-output').val());
            changeAudioDestination(audioOutputElement);
        });

    } catch (error) {
        console.error('Audio setup failed:', error);
    }


    // Init tooltips
    $(function () {
        InTrainUI.initTooltips()
    })
    
    // clear button in inputs
    $(function() {
      $('.clearer').clearer();
    });    
    
    initMuted(); // Mute/unmute partners (set defaults)
    loadClock(); // Start clock


    // check for notifications support
    // you can omit the 'window' keyword
    if (window.Notification) {
        console.log("Requesting permission to notify incoming connections.");
        window.Notification.requestPermission();
    } else {
        console.warn("Notifications are not supported for this Browser/OS version yet.");
    }


    // Set numeric dimensions before MediaElement creates a YouTube/Vimeo iframe.
    // The renderer reads the native <video> attributes, not just CSS sizes.
    const initialVideoSize = getSupervisorVideoSize() || {width: 480, height: 300};
    const originalVideo = document.getElementById('myplayer');
    originalVideo.width = initialVideoSize.width;
    originalVideo.height = initialVideoSize.height;

    // init player
	$('#myplayer').mediaelementplayer({
        startVolume: InTrainHeadphones.getVolume(),
        // End the video normally; do not loop or rewind to its beginning.
        loop: false,
        autoRewind: false,
        // The video panel has a fixed height (set by responsive CSS variables).
        // Responsive stretching otherwise lets iframe renderers grow past it.
        stretching: 'none',
        videoWidth: initialVideoSize.width,
        videoHeight: initialVideoSize.height,
        controls: true,
        alwaysShowControls: true,
        features: ["playpause", "progress", "current", "duration", "tracks", "fullscreen"],
        success: function(mediaElement, originalNode, instance) {
        
            myVideoPlayer = instance; 
            myVideoMediaElement = mediaElement;
            InTrainHeadphones.setPlayer(instance);
            fitSupervisorPlayerToVideo();
            // Async renderers initialize their iframe only after rendererready.
            mediaElement.addEventListener('rendererready', fitSupervisorPlayerToVideo, false);
            mediaElement.addEventListener('rendererready', InTrainHeadphones.applyPlayerVolume, false);
            mediaElement.addEventListener('loadedmetadata', fitSupervisorPlayerToVideo, false);
            mediaElement.addEventListener('loadedmetadata', InTrainHeadphones.applyPlayerVolume, false);

            mediaElement.addEventListener('progress', function() { 
                console.log('progress', myVideoPlayer.currentTime);  
            }, false);
            
            mediaElement.addEventListener('pause', function() {
                console.log('pause', myVideoPlayer.currentTime);
                videoSyncAuthorizedPlay = false;
                if (videoSyncPending) return; // Forced pause during preparation.
                // An explicit pause cancels any queued, not-yet-started resume.
                ++videoSyncEpoch;
                videoSyncLagSamples = 0;
                showVideoSyncLag();
                if (interpreterData && interpreterData.open)
                    interpreterData.send({action: 'pausevideo'});
            }, false);

            mediaElement.addEventListener('play', function() {
                console.log('play from', myVideoPlayer.currentTime);
                if (videoSyncAuthorizedPlay) {
                    videoSyncAuthorizedPlay = false;
                    return; // This start has already been sent as syncstart.
                }
                if (videoSyncPending) {
                    myVideoPlayer.pause();
                    return;
                }
                // Stop the local player until the interpreter confirms ready.
                if (interpreterData && interpreterData.open && currentVideoURL)
                    prepareSupervisorVideoSync({resume: true, reconnect: false});
            }, false);
            mediaElement.addEventListener('error', function(error) {
                if (!currentVideoURL) return;
                console.warn('Video renderer reported an error', error);
                logToPanel('This video cannot be loaded. It may be unavailable, private or restricted.', 'warning');
            }, false);
            
            
            instance.prepare = function() {
                cancelSupervisorVideoSync();
                ++videoSyncEpoch;
                if (interpreterData && interpreterData.open)
                    interpreterData.send({action: 'seekvideo', time: 0.0, pause: true});
                myVideoPlayer.pause();
                myVideoPlayer.setCurrentTime(0.0);
            };


            // Explicit supervisor seeks still reach the interpreter. Unlike
            // monitoring, this action is deliberately initiated by the teacher.
            var pfx = '.' + this.classPrefix;

            $(pfx + 'time-slider').on('click', function() {
                var w = myVideoPlayer.total.offsetWidth;
                var p = $(pfx + 'time-slider ' + pfx + 'time-hovered').attr("pos");
                var d = myVideoPlayer.getDuration();
                
                var percentage = p/w;
                var t = (percentage <= 0.02 ? 0 : percentage * d) + 0.25;
                
                if  (t > d) t = d;                
                
                if (interpreterData && interpreterData.open)
                    interpreterData.send({action: "seekvideo", time: t.toFixed(4)});
                
                console.log("seek video to", t.toFixed(4));
                
            });             
	    },
        error: function(error) {
            if (!currentVideoURL) return;
            console.error('Cannot initialize video renderer', error);
            logToPanel('Unable to load the selected video. Verify that it exists and can be embedded.', 'warning');
        }
	});
       
    
    InTrainUI.showModal('#login-dialog', {keyboard: false, backdrop: 'static'});
    $('#cancel-button').attr("disabled", true);


    /* Connect/disconnect button clicked */
    $('#join-button').on("click", function(e){

        console.log("Connect/disconnect button pressed");
        e.preventDefault();
        
        // Toggle connect/disconnect
        if (peerConnected) {
            console.log("Closing...");
            ++floorSelectionEpoch;
            if (sharingScreen()) unshareScreen();

            $("#login-info").html("You're disconnected");
            InTrainUI.showModal('#login-dialog');
            $('#cancel-button').attr("disabled", true);

            if (speakerData && speakerData.open) {
                speakerData.send({action: "leaving", message: "bye"});
            }
            if (interpreterData && interpreterData.open) {
                interpreterData.send({action: "leaving", message: "bye"});
            }
            
            setTimeout(function() { 
                //supervisorData.close(); 
                myPeer.destroy()
            }, WaitBeforeClose);
            
            
            return true;
        }
        
        // Enable cancel button in login form
        $('#cancel-button').attr("disabled", false);

                
        // Get username
        userName = $("#username").val().trim();
        
        if (userName == "") {
            logToPanel("User name is empty", "info");
            return false;
        }
        
        userID = userName.toLowerCase().hash64(); // userName.replace('@', "_AT_").replace('.', "_DOT_");
        
        console.log("Peer: trying to create peer using supplied userID");
        myPeer = new Peer(userID, PeerJSConfig, SupervisorPeerOptions);
        
        // Handle incoming call calls
        myPeer.on('call', function(c) {

            var role = c.options?.metadata?.role; // Who's connecting
            
            if (! verifyMediaConnection(c, role)) {
                var dt = getDateTime();
                var m = dt.hms + " - Incoming call from another " + role + " rejected because we're busy.";
                
                console.warn("Peer: reject call from", role);
                
                logToPanel(m, "danger");
                logToChat(m);
                c.close();
                return false;
            }
            
            console.log("Peer: call from", role);

            if (role == "speaker" || role == "interpreter") {
            
                if (role == "speaker") {
                    speakerMedia = c;
                } else {
                    interpreterMedia = c;
                }
            
                c.answer(localStream);
                
                c.on('stream', function(mediaStream) {
                
                    if (role == "speaker") {
                        speakerMediaStream = mediaStream;
                        refreshSpeakerVideoSource();
                        speakerVideo.onloadedmetadata = function(e) {
                            speakerVideo.play();
                            refreshSpeakerVideoSource();
                        }
                    } else {
                        interpreterVideo.srcObject = mediaStream;
                        interpreterMediaStream = mediaStream;
                        
                        interpreterVideo.onloadedmetadata = function(e) {
                            interpreterVideo.play();
                            interpreterVideo.muted = true;
                        }

                    }
                    
                    if (role === RoleInterpreter && sharingScreen()) {
                        console.log("Screen share is active, sending it to interpreter");
                        if (!screenshareConnection || screenshareConnection.peer !== c.peer) {
                            closePeerConnection(screenshareConnection);
                            screenshareConnection = myPeer.call(
                                c.peer, screenshareMediaStream, { metadata: {role: RoleScreenShare} }
                            );
                        }
                    }

                  
                    initCrossFader();
                });
                c.on('close', function() {
                    // Ignore stale calls closing after a participant reconnects.
                    if (role === RoleInterpreter && interpreterMedia !== c) return;
                    if (role === RoleSpeaker && speakerMedia !== c) return;
                    if (role === RoleInterpreter && screenshareConnection) {
                        closePeerConnection(screenshareConnection);
                        screenshareConnection = null;
                    }
                    resetConnection(role);
                    logToPanel("<b>" + role + "</b> media connection closed", "danger");
                    logToChat("<b>" + role + "</b> media connection closed");
                    console.log(role + " media connection closed");
                    initCrossFader();

                });
            }

        });


        // Handle incoming data
        myPeer.on('connection', function(c) { 
        
            console.log("Incoming connection");
            
            var role = c.options?.metadata?.role; // Who's connecting
            
            console.log("Peer: data connection from", role);


            // Data connection ready
            c.on('open', function() {
            
                console.log("A data connection is ready");


                if (setupDataConnection(c, role)) {
                    console.log("Connection handle has been set for", role);
                    
                    // Bring a late joiner up to date with session mode and recording.
                    c.send({action: 'setaudiomode', mode: sessionMode});
                    c.send({action: 'recording', mode: recording ? 'on' : 'off'});
                    // A new interpreter receives the CURRENT playback position.
                    // Pause the supervisor first if playback was in progress,
                    // then run the initial handshake again before resuming.
                    if (role === RoleInterpreter) {
                        const resume = !!(currentVideoURL && showPlayer &&
                            myVideoPlayer && !myVideoPlayer.paused);
                        // Send a paused snapshot even if the local player was
                        // playing; syncprepare will pause it before any start.
                        sendCurrentVideoState(c, true);
                        if (currentVideoURL && showPlayer) {
                            if (resume)
                                logToPanel('Interpreter connected: pausing for video synchronization.', 'info');
                            prepareSupervisorVideoSync({resume, reconnect: true});
                        }
                    }


                    // Push a notification if permission is granted and 
                    // only if the browser window is not focused
                    if (Notification.permission === "granted" && !document.hasFocus()) {
                    
                        
                        var notification = new Notification(
                            'Incoming connection from ' + role,
                            {
                                "icon": '/images/icons/favicon-16x16.png' 
                            }
                        );
                        
                        // Show browser window and close notification on user click
                        notification.onclick = function(e) {
                            e.preventDefault();
                            window.focus();
                            notification.close();
                        }
                    }                
                    
                    
                    console.log(
                        "call from:" + role + "; " +
                        "speaker status:" + (speakerData ? (speakerData.open?"open":"closed") : "none") + "; " +
                        "interpreter status:" + (interpreterData ? (interpreterData.open?"open":"closed") : "none")
                    );

                    // if intepreter is connecting and speaker is already connected
                    // tell the speaker to call the intepreter
                    if (role == RoleInterpreter && speakerData && speakerData.open) {
                        console.log("Asking the speaker to call the intepreter (" + c.peer + ")");
                        speakerData.send({action: 'dial', peerid: c.peer, role: role});
                    }

                    // if speaker is connecting and intepreter is already connected
                    // tell the intepreter to call the speaker
                    if (role == RoleSpeaker && interpreterData && interpreterData.open) {
                        console.log("Asking the interpreter to call the speaker (" + c.peer + ")");
                        interpreterData.send({action: 'dial', peerid: c.peer, role: role});
                    }

                    
                    // Handle data connections
                    switch (role) {
                    case RoleInterpreter:
                    case RoleSpeaker:
                        c.on('data', function(data) {
                            var act = (typeof data === "object") ? data.action : "chat";

                            console.log("received:", data);

                            switch (act) {
                            case 'syncready':
                                if (role === RoleInterpreter) receiveSupervisorVideoReady(data, c);
                                break;
                            case 'videostatus':
                                if (role === RoleInterpreter) receiveInterpreterVideoStatus(data, c);
                                break;
                            case 'videosyncpong':
                                if (role === RoleInterpreter) receiveVideoSyncPong(data, c);
                                break;
                            case 'chat':
                                logToChat(escapeHTML(data.message), role, role == RoleSpeaker ? ColorSpeaker : ColorInterpreter);
                                break;
                            case 'leaving':
                                resetConnection(role);
                                logToPanel("<b>" + role + "</b> has logged out", "danger");
                                logToChat("<b>" + role + "</b> has logged out");
                                console.log(role + " has logged out");
                                initCrossFader();
                                break;
                            case 'sendfile':
                                var link = getFileDownloadLinkFromData(data);
                                if (link !== null) {
                                    console.log("Received file '" + data.filename + "' of type '" + data.filetype + "' from " + role);
                                    logToChat("The " + role + " has sent you a file: " + link);
                                } else {
                                    console.warn("Invalid file transfer from", role);
                                    logToChat("Invalid file transfer from", role);
                                }
                                break;                             
                            }
                        });

                        if (role === RoleInterpreter) {
                            c.on('close', function() {
                                if (interpreterData !== c) return; // Stale connection.
                                cancelSupervisorVideoSync();
                                ++videoSyncEpoch;
                                videoSyncAuthorizedPlay = false;
                            });
                        }

                        break;
                    case RoleSupervisor:
                        break;
                    }
                    
                } else {
                    console.log("Rejecting connection");
                    //c.send({action: "reject", message: "This training session is busy"});
                    setTimeout(function() { c.close(); }, WaitBeforeClose);
                    //c.close()
                    return false;
                }
            
            });

        });

        // Session created on peerjs server
        myPeer.on('open', function(){
            console.log("Peer: open");
            // here you have myPeer.id
            peerConnected = true;
            peerError = false;

            logToPanel("Connection successful. You're now logged on as <strong>" + userName + "</strong> [id=" + myPeer.id + "]. Your couterparts can now call you using the username you provided.", "success");
            logToChat("InTrain is ready");

            $("#username").prop("disabled", true);
            $("#join-button").text("Disconnect");
            $("#join-button").removeClass("btn-primary").addClass("btn-warning");
            $('#login-status').html('');
            InTrainUI.hideModal('#login-dialog');

            $("#login-info").html("You've started the training session as <strong>" + escapeHTML(userName) + "</strong>. You are the <strong>" + myRole + "</strong>.");

            loadAndPlay("sounds/whistle.mp3", $('#select-audio-output').val());
            
            setSessionMode(sessionMode);

        });
        
        myPeer.on('close', function() {

          peerConnected = false;
          
          console.log("Peer: close");          
          
          logToPanel("Connection closed", "success");
	      logToChat("Training session closed");
          $("#username").prop("disabled", false);
          
          $("#join-button").text("Connect");
          $("#join-button").removeClass("btn-warning").addClass("btn-primary");
        });
        
        myPeer.on('disconnected', function(){
          // myPeer.reconnect();
        });
        
        myPeer.on('error', peerErrors);
       
        return false;
    });

    loadCommonHandlers();
    
    $('#swap-channels').on('click', function(){
        swapChannels = !swapChannels;
        $("label[for='swap-channels']").text(swapChannels ? "Swap R/L:" : "Swap L/R:" );
        initCrossFader();
    });
    $('#boost-volume').on('click', function(){
        boostVolume = !boostVolume;
        $('#boost-volume > i').toggleClass("fa-volume-up fa-volume-down");
        $('#cross-fader').trigger('input');
    });
    
    $('#cross-fader').on('input', function(){
    
        var val = $(this).val();
        var min = $(this).attr('min');
        var max = $(this).attr('max');
        
        var m1 = speakerAudioMuted ? 0.0001 : 1;
        var m2 = interpreterAudioMuted ? 0.0001 : 1;
        
        var b = parseInt(val) / (parseInt(max) - parseInt(min));
        var v = boostVolume ? 8 : 2 ; //1.5*parseInt(volume.value) / (parseInt(volume.max) - parseInt(volume.min));

        
        var vol1 = m1 * v * Math.cos((1.0 - b) * 0.5 * Math.PI);
        var vol2 = m2 * v * Math.cos(b * 0.5 * Math.PI)
        
        // exponentialRampToValueAtTime does not allow to set volume to 0
        if (showPlayer && myVideoPlayer && !myVideoPlayer.paused) {
            myVideoPlayer.setVolume(Math.cos((1.0 - b) * 0.5 * Math.PI));
            gain1.gain.setValueAtTime(0, audioContext.currentTime);
        } else {
            if (vol1 == 0) {
                gain1.gain.setValueAtTime(0, audioContext.currentTime);
            } else {
                gain1.gain.exponentialRampToValueAtTime(vol1, audioContext.currentTime);
            }
        }
        if (vol2 == 0) {
            gain2.gain.setValueAtTime(0, audioContext.currentTime);
        } else {
            gain2.gain.exponentialRampToValueAtTime(vol2, audioContext.currentTime);
        }
        
    });      

  
    /*
     * A single floor entry point owns all transitions. Modal/capture dialogs
     * only collect input; the active floor changes after a successful action.
     */
    function selectSupervisorFloor(floor, options = {}) {
        ++floorSelectionEpoch;
        if (floor === 'speaker') {
            if (getSupervisorFloor() === 'speaker') return true;
            const activateSpeaker = function() {
                ++floorSelectionEpoch;
                if (sharingScreen()) unshareScreen();
                if (showPlayer) stopSupervisorExternalVideo();
                updateSupervisorFloorSelector();
            };
            confirmMediaModeSwitch('speaker', activateSpeaker);
            return true;
        }

        if (floor === 'screen') {
            if (getSupervisorFloor() === 'screen') return true;

            const startScreenCapture = function() {
                // This call must happen within a user gesture, including the
                // confirmation modal's Continue click when switching players.
                const token = ++floorSelectionEpoch;
                navigator.mediaDevices.getDisplayMedia({video: true, audio: true})
                    .then(stream => {
                        if (token !== floorSelectionEpoch) {
                            stream.getTracks().forEach(track => track.stop());
                            return;
                        }
                        if (showPlayer) stopSupervisorExternalVideo();
                        if (sharingScreen()) unshareScreen();
                        shareScreen(stream);
                        updateSupervisorFloorSelector();
                    }).catch(error => {
                        // Canceling the capture picker never stops the old floor.
                        if (error.name !== 'NotAllowedError' && error.name !== 'AbortError')
                            console.error('Error sharing screen:', error);
                        updateSupervisorFloorSelector();
                    });
            };
            if (showPlayer || getSupervisorFloor() === 'file') confirmMediaModeSwitch('screen', startScreenCapture);
            else startScreenCapture();
            return true;
        }

        if (floor === 'file') {
            // Selecting a file is reversible; the current floor runs until decoding succeeds.
            ++floorSelectionEpoch;
            const input = document.getElementById('floor-file');
            input.value = '';
            input.click();
            return true;
        }

        if (floor === 'external') {
            if (!options.url) {
                $('#video-url').removeClass('is-invalid').val(currentVideoURL || '');
                $('#video-floor-dialog-note').text(sharingScreen()
                    ? 'Loading the video will stop the current floor.'
                    : 'The supervisor controls playback for the interpreter.');
                InTrainUI.showModal('#video-floor-dialog');
                return true;
            }

            const result = validateVideoURL(options.url);
            if (!result.valid || !myVideoPlayer) return false;

            ++floorSelectionEpoch;
            if (sharingScreen()) unshareScreen();
            cancelSupervisorVideoSync();
            ++videoSyncEpoch;
            videoSyncAuthorizedPlay = false;
            if (!showPlayer) setSupervisorPlayerVisible(true);

            // YouTube/Vimeo iframe renderers need a visible container first.
            const generation = ++videoLoadGeneration;
            requestAnimationFrame(function() {
                if (generation !== videoLoadGeneration || getSupervisorFloor() !== 'external') return;
                try {
                    if (!myVideoPlayer.paused) myVideoPlayer.pause();
                    myVideoPlayer.setSrc(result.url);
                    currentVideoURL = result.url;
                    if (interpreterData && interpreterData.open)
                        interpreterData.send({action: 'loadvideo', url: result.url, time: 0, pause: true});
                    console.log('Video loaded:', result.url);
                } catch (error) {
                    console.error('Video player rejected the selected source', error);
                    logToPanel('Could not load the video. Verify the URL and embedding permissions.', 'warning');
                }
            });
            return true;
        }

        return false;
    }

    $('#floor-file').on('change', async function() {
        const file = this.files && this.files[0];
        if (!file) return;
        const token = ++floorSelectionEpoch;
        let candidate;
        try {
            candidate = await createLocalFileFloor(file, audioContext);
            if (token !== floorSelectionEpoch) {
                candidate.dispose();
                return;
            }
            if (showPlayer) stopSupervisorExternalVideo();
            if (sharingScreen()) unshareScreen();
            localFileFloor = candidate;
            document.getElementById('local-floor-container').replaceChildren(candidate.media);
            $('#local-floor-container').removeClass('d-none');
            shareScreen(candidate.stream, 'file');
            candidate.media.onerror = () => {
                if (localFileFloor !== candidate) return;
                logToPanel('The local file could not be played. Returning to Speaker.', 'warning');
                unshareScreen();
            };
        } catch (error) {
            if (candidate) candidate.dispose();
            if (token === floorSelectionEpoch)
                logToPanel('Could not open the local file. ' + escapeHTML(error.message), 'warning');
        }
        updateSupervisorFloorSelector();
    });

    window.addEventListener('pagehide', () => {
        ++floorSelectionEpoch;
        if (localFileFloor) localFileFloor.dispose();
    });

    // Reset to the informative placeholder so the same floor can be selected again.
    $('#floor-select').on('change', function() {
        const floor = $(this).val();
        selectSupervisorFloor(floor);
        updateSupervisorFloorSelector();
    });
    updateSupervisorFloorSelector();

    $('#video-url').on('input change', function() {
        $(this).removeClass('is-invalid');
    });
    $('#video-url-form').on('submit', function(event) {
        event.preventDefault();
        const result = validateVideoURL($('#video-url').val());
        if (!result.valid) {
            $('#video-url').addClass('is-invalid').focus();
            logToPanel(result.error, 'warning');
            return;
        }
        if (!myVideoPlayer) {
            logToPanel('Video player is not ready yet. Please try again.', 'warning');
            return;
        }
        if (selectSupervisorFloor('external', {url: result.url}))
            InTrainUI.hideModal('#video-floor-dialog');
    });

    // Closing a warning or pressing Escape does not execute its pending action.
    $('#media-mode-dialog').on('hidden.bs.modal', function() {
        pendingMediaModeSwitch = null;
        updateSupervisorFloorSelector();
    });
    $('#media-mode-confirm').on('click', function() {
        const action = pendingMediaModeSwitch;
        pendingMediaModeSwitch = null;
        InTrainUI.hideModal('#media-mode-dialog');
        if (action) action();
    });

    $('#briefing-mode').on('click', function() {

        console.log("Setup audio for breafing");
        // Enable local microphone, if disabled
        if (!isMicEnabled())
            $('#toggle-microphone').trigger('click');

        animateCSS('#toggle-microphone', 'heartBeat');
        
        setSessionMode('briefing');
    });

    $('#training-mode').on('click', function() {
        // Disable local microphone, if enabled
        console.log("Setup audio for training session");
        
        if (isMicEnabled()) {
            $('#toggle-microphone').trigger('click');
        }
        animateCSS('#toggle-microphone', 'heartBeat');
        
        setSessionMode('training');
    });


    $('#switch-roles-confirm').on('click', function() {
        performRoleSwitch();
        InTrainUI.hideModal('#switch-roles-dialog');
    });


    // Handle switch role button
    $('#switch-roles').on('click', function() {
        if (sessionMode !== 'briefing') {
            logToPanel("Role switching is only available in briefing mode", "warning");
            return;
        }
        if (!speakerData || !speakerData.open || !interpreterData || !interpreterData.open) {
            logToPanel("Both speaker and interpreter must be connected for role switching", "warning");
            return;
        }
        InTrainUI.showModal('#switch-roles-dialog', {keyboard: false, backdrop: 'static'});
    });


    $("input[data-bs-toggle='tooltip']").mouseout(function(){
      InTrainUI.hideTooltip(this);
    });


    var recording = false;
    $('#record-audio').on('click', function(e) {
    
        if (!audioRecorder) return;
        
        console.log("Record clicked");
        
        if ( recording) {
        
            console.log("Stop recording");

            $("#record-audio > i").removeClass("fa-square").addClass("fa-circle");
            
            audioRecorder.stop();
            recording = false;
            audioRecorder.getBuffers( saveAudio );
             
            $("#save-audio").removeClass("disabled");
            $("#save-audio > i").removeClass('fa-cog fa-spin').addClass('fa-save');
            $("label[for='save-audio']").html('File ready').removeClass('fa-blink');
            animateCSS('#save-audio', 'heartBeat');
            
            if (speakerData && speakerData.open) {
                speakerData.send({action: "recording", mode: "off"});
            }
            if (interpreterData && interpreterData.open) {
                interpreterData.send({action: "recording", mode: "off"});
            }            
            
        } else {
        
            console.log("Restart recording");

            $("#record-audio > i").removeClass("fa-circle").addClass("fa-square");
            
            audioRecorder.clear();
            audioRecorder.record();
            recording = true;

            $("#save-audio").addClass("disabled");
            $("#save-audio > i").removeClass('fa-save').addClass('fa-cog fa-spin');
            $("label[for='save-audio']").html('Recording' ).addClass('fa-blink');
            
            if (speakerData && speakerData.open) {
                speakerData.send({action: "recording", mode: "on"});
            }
            if (interpreterData && interpreterData.open) {
                interpreterData.send({action: "recording", mode: "on"});
            }     
            
        }
    });
    
    $('#save-audio').on('click', function(e) {
        if ($(this).hasClass('disabled')) {
            e.preventDefault();
        } else {
            console.log("Save audio file");
        }
    });
    
    
    function sharingScreen() {
        return sharingScreenActive && screenshareMediaStream &&
               screenshareMediaStream.getTracks().some(track => track.readyState === 'live');
    }
    
    function unshareScreen() {
        if (!sharingScreenActive) return;
        console.log('Unsharing screen');
        sharingScreenActive = false;
        const stream = screenshareMediaStream;
        screenshareMediaStream = null;
        if (localFileFloor) {
            localFileFloor.dispose();
            localFileFloor = null;
        }
        sharedFloorKind = 'screen';
        $('#local-floor-container').addClass('d-none').empty();
        if (stream) stream.getTracks().forEach(track => {
            track.onended = null;
            track.stop();
        });
        closePeerConnection(screenshareConnection);
        screenshareConnection = null;
        refreshSpeakerVideoSource();
        updateSupervisorFloorSelector();
        initCrossFader();
    }

    function shareScreen(stream, kind = 'screen') {
    
        console.log("interpreterPeer: " + interpreterPeer);
        console.log("sharing screen: " + sharingScreen());
        
        if (!sharingScreen()) {

            console.log('Screen, application or browser tab has been shared');


            sharingScreenActive = true;
            sharedFloorKind = kind;
            screenshareMediaStream = stream;
            refreshSpeakerVideoSource();
            updateSupervisorFloorSelector();

            const videoTrack = stream.getVideoTracks()[0];
            if (videoTrack && kind === 'screen') videoTrack.onended = () => unshareScreen();
            
            if (interpreterPeer != null) {
                
                console.log("Now calling the interpreter");
                screenshareConnection = myPeer.call(
                    interpreterPeer, stream, { metadata: {role: RoleScreenShare}  } 
                );
                

            }
            
            initCrossFader();
        
        }
    }


    // Keep the data traffic small; send one RTT probe every five seconds.
    setInterval(pingInterpreterVideo, 5000);

    // ondevicechange event (webcam or headset has been plugged in or out)
    navigator.mediaDevices.ondevicechange = (e) => {
        console.log("Device list change detected");
        handleDeviceListChange(e); // io-devices.js
    }
});

// Refit the embedded player when responsive breakpoints change the video size.
window.addEventListener('resize', function() {
    if (showPlayer) requestAnimationFrame(fitSupervisorPlayerToVideo);
});

// Start/stop decalage timer when pressing space bar
$(document).keypress(function(e) {
  if (!$(e.target).closest('video,audio,input,textarea,select,button,[contenteditable]').length && e.which == 32) {
    $("#timer-startstop").trigger("click");
    e.preventDefault();
  }
});


function brownianNoise(g) {
    var lastOut = 0.0;
    var node = audioContext.createScriptProcessor(1024, 2, 2);
    node.onaudioprocess = function(e) {
        var output = e.outputBuffer.getChannelData(0);
        for (var i = 0; i < 1024; i++) {
            var white = Math.random() * 2 - 1;
            output[i] = (lastOut + (0.02 * white)) / 1.02;
            lastOut = output[i];
            output[i] *= g; 
        }
    }
    return node;
}

function brownianNoise2(g) {

    var lastOut = 0.0;
    
    var node = audioContext.createBufferSource(),
        buffer = audioContext.createBuffer(1, 8192, audioContext.sampleRate),
        data = buffer.getChannelData(0);
    
    for (var i = 0; i < 8192; i++) {
        var white = Math.random() * 2 - 1;
        data[i] = (lastOut + (0.03 * white)) / 1.02;
        lastOut = data[i];
        data[i] *= g; 
    }
    
    node.buffer = buffer;
    node.loop = true;
    
    node.start(0);
    
    return node;
}

function silence() {

    var node = audioContext.createBufferSource(),
        buffer = audioContext.createBuffer(1, 512, audioContext.sampleRate),
        data = buffer.getChannelData(0);
    
    for (var i = 0; i < 512; i++) {
        data[i] = 0; 
    }
    node.buffer = buffer;
    node.loop = true;
    node.start(0);
    
    return node;
}

function oscillator(freq = 11, vol = 0.01) {
    var o = audioContext.createOscillator();
    o.type = "sine";
    o.frequency = freq;
    var  g = audioContext.createGain()
    o.connect(g);
    g.gain.exponentialRampToValueAtTime(vol, audioContext.currentTime);
    o.start();
    return g;
}

function reconnectChannel(channel, stream) {
    if (stream) {
    } else {
    }
}


/*
    This is our web audio graph:

        (channel1)  ⇴  (split1)  →  (gain1) 
                          ↓                 ↘	 
         (zeroGain) ←  (mixrec) ⇒ recorder    (mix) → (ctxDest) ⇒ speaker
                          ↑                 ↗   
        (channel2)  ⇴  (split2)  →  (gain2) 

    The two audio input streams are redirected to channel1 and channel2
    Channels are conencted to channel splitter nodes, making them two
    mono tracks. 
    Each splitter node is connected to a gain node to change its volume
    and implement cross fading.
    These two gain nodes are combined by mixer node to become L/R channels.
    The mixer node is connected to a stream destination node whose audio can then
    be redirected to a specific audio device
    The two split nodes are also directly combined into L/R tracks by
    connecting them to another mixer node (mixrec) which is used to record audio
    Since the mixrec node must be connected to and audio context destination (to
    make audio flow) and we don't want to hear that audio, we silence it by
    connecting to a zero gain node, which is then connected to the standard 
    destination.
    
    channel1 and channel2 are replaced when the iterpreter or the speaker 
    connect, disconnect, reconnect.
*/
function initAudioCtx() {

//  audioContext = new AudioContext();

    console.log("Initializing audio context");

    split1   = audioContext.createChannelSplitter(2);  // Splitter di canali
    split2   = audioContext.createChannelSplitter(2);  // Splitter di canali
    gain1    = audioContext.createGain();              // Volume canale 1
    gain2    = audioContext.createGain();              // Volume canale 2
    mix      = audioContext.createChannelMerger(2, 2); // Mixer di canali
    channel1 = null;
    channel2 = null;

    split1.connect(gain1);
    split2.connect(gain2);
    
    gain1.connect(mix, 0, 1);
    gain2.connect(mix, 0, 0);


    // Since the Web Audio API does not allow to set a specific audio device
    // as a destination, we first create a destination node that we will use
    // it as a source for a dynamic audio element, for which we can set the
    // sinkId to any device we wish.
    ctxDest  = audioContext.createMediaStreamDestination();    

            
    // Our audio stream becomes the audioOutputElement srcObject
    audioOutputElement.srcObject = ctxDest.stream;
    
    // Try to play output element if audio context is available
    if (audioContext.state !== 'suspended') {

    }

    mix.connect(ctxDest);
    
    
    return audioContext;
}

function initCrossFader() {

    if (typeof channel1 === "object" && channel1 != null) {
        console.log("Disconnecting audio channel 1");
        channel1.disconnect();
        // End any synthetic silence buffer; WebRTC sources have no stop().
        if (typeof channel1.stop === 'function') channel1.stop();
    }
    if (typeof channel2 === "object" && channel2 != null) {
        console.log("Disconnecting audio channel 2");
        channel2.disconnect();
        if (typeof channel2.stop === 'function') channel2.stop();
    }
    
    // The recorder taps the splitters before the listening gain nodes.
    // Select the recording source explicitly: muting gain1 does not mute
    // the recording. A shared screen without audio also needs a silent track.
    if (showPlayer) {
        console.log("External video player: record interpreter only...");
        channel1 = silence();
    } else if (sharingScreenActive && screenshareMediaStream) {
        if (screenshareMediaStream.getAudioTracks().length) {
            console.log("Adding screen share audio to crossfader...");
            channel1 = audioContext.createMediaStreamSource(screenshareMediaStream);
        } else {
            console.log("Screen share has no audio track; recording silence...");
            channel1 = silence();
        }
    } else if (speakerMedia && speakerMedia.open && speakerMediaStream) {
        console.log("Adding speaker audio to crossfader...");
        channel1 = audioContext.createMediaStreamSource(speakerMediaStream);
    } else {
        console.log("Replacing missing speaker audio with brownian noise...");
        channel1 = brownianNoise(0.0025);
    }
    
    if (interpreterMedia && interpreterMedia && interpreterMediaStream) {
        console.log("Adding interpreter audio to crossfader...");    
        channel2 = audioContext.createMediaStreamSource(interpreterMediaStream);
    } else {
        console.log("Replacing interpreter audio with brownian noise in the crossfader...");
        channel2 = brownianNoise(0.0025);
    }
    
    if (swapChannels) {
        var tmp = channel1;
        channel1 = channel2;
        channel2 = tmp;
    }
    
    channel1.connect(split1, 0, 0);
    channel2.connect(split2, 0, 0);

}


function initRecorder() {
    
    mixrec        = audioContext.createChannelMerger(2, 2); // Channel mixer for the recorder
    audioRecorder = new Recorder( mixrec );
    zeroGain      = audioContext.createGain();

    split1.connect(mixrec, 0, 1);
    split2.connect(mixrec, 0, 0);

    // Connect to a gain node with gain value = 0 (so it will be
    // silent) and then to destination to activate the audio flow
    zeroGain.gain.value = 0.0;
    mixrec.connect( zeroGain );
    
    zeroGain.connect( audioContext.destination );
    
}


// the ONLY time saveAudio is called is right after a 
// new recording is completed, so here's where we should
// set up the download.
function saveAudio( buffers ) {
console.log('SAVE AUDIO');
    audioRecorder.exportWAV( doneEncoding );
}

function doneEncoding( blob ) {
console.log('DONE ENCODING');
    var filename = appName + "-mixed-audio-file-" + ((recIndex<10)?"0":"") + recIndex + ".wav"
    var url = Recorder.setupDownload( blob, filename, "save-audio");
    
    console.log("Audio file created from blob:", url);
    
    $("#recordings").append(
        "<li class='list-group-item'><a href='" + url + "' download='" + filename + "'>" +
        "record n. " + (recIndex) + " (" + blob.size + " bytes)</a></li>"
    );
    
    recIndex++;
}


/**
 * Invia comando di switch ruoli a speaker e interpreter
 */
function performRoleSwitch() {


    logToPanel("Initiating role switch...", "info");
    logToChat("Role switch initiated - participants will reconnect shortly");
    
    // Disabilita il bottone durante lo switch
    $('#switch-roles').prop('disabled', true);
    
    // Invia messaggio di switch a entrambi i partecipanti
    if (speakerData && speakerData.open) {
        speakerData.send({
            action: "switch-role", 
            newRole: "interpreter",
            supervisor: userName
        });
    }
    if (interpreterData && interpreterData.open) {
        interpreterData.send({
            action: "switch-role", 
            newRole: "speaker", 
            supervisor: userName
        });
    }
    
    // Chiudi connessioni dopo breve delay
    setTimeout(() => {
        resetConnection(RoleSpeaker);
        resetConnection(RoleInterpreter);
        logToPanel("Waiting for participants to reconnect with swapped roles...", "success");
        
        // Riabilita il bottone dopo un po'
        setTimeout(() => {
            $('#switch-roles').prop('disabled', false);
        }, 10000);
    }, 1000);
}
