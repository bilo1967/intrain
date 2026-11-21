speakerAudioMutedDefault = false;
interpreterAudioMutedDefault = false;
// supervisorAudioMutedDefault = false;

speakerAudioMuted      = speakerAudioMutedDefault;
interpreterAudioMuted  = interpreterAudioMutedDefault;
//supervisorAudioMuted = supervisorAudioMutedDefault;

myRole = RoleSupervisor;
myColor = ColorSupervisor;


// NB: speaker → 1 (L), interpreter → 2 (R)
//var audioContext  = null;
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
var showPlayer = false;   // show player and load controls






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
    audioOutputElement.loop = false;
    //audioOutputElement.play();

/*
    getDevices().then(() => {
        
        $('#select-video-source').val(InTrainStorage.get('supervisor-video-source') || 'default');
        $('#select-audio-source').val(InTrainStorage.get('supervisor-audio-source') || 'default');
        $('#select-audio-output').val(InTrainStorage.get('supervisor-audio-output') || 'default');
        
        changeAudioDestination(audioOutputElement);
        
        setUserMediaConstraints();
            
    }).catch(handleLocalMediaStreamError);    
*/

   
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

/*        
    var waitAudioCtxAvailable = new Promise( (res, rej) => {
        
        var ctx = initAudioCtx();

        if (ctx.state === 'suspended') {
            $('body').one("click", () => {
                ctx.resume();
                res(ctx);
            });
        } else if (ctx.state === 'running') {
            console.log(ctx.state);
            res(ctx);
        } else {
            rej();
        }
    });

    waitAudioCtxAvailable.then((ctx) => {
        
        initCrossFader(); // Crossfade implementation
        initRecorder();  
        
        if (audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
                console.log("Audio context resumed");
            });
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


    });        
*/

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

        

    // init player
	$('#myplayer').mediaelementplayer({
        startVolume: 1,
        stretching: 'responsive',
        controls: true,
        alwaysShowControls: true,
        features: ["playpause", "progress", "current", "duration", "tracks", "volume", "fullscreen"],
        success: function(mediaElement, originalNode, instance) {
        
            myVideoPlayer = instance; 
            myVideoMediaElement = mediaElement;
/*
            mediaElement.addEventListener('loadstart',      function() { console.log('loadstart'); }, false);
            mediaElement.addEventListener('durationchange', function() { console.log('durationchange'); }, false);
            mediaElement.addEventListener('loadedmetadata', function() { console.log('loadedmetadata'); }, false);
            mediaElement.addEventListener('loadeddata',     function() { console.log('loadeddata'); }, false);
            mediaElement.addEventListener('canplay',        function() { console.log('canplay'); }, false);
            mediaElement.addEventListener('canplaythrough', function() { console.log('canplaythrough'); }, false);
            mediaElement.addEventListener('suspend',        function() { console.log('suspend'); }, false);
            mediaElement.addEventListener('abort',          function() { console.log('abort'); }, false);
            mediaElement.addEventListener('error',          function() { console.log('error'); }, false);
            mediaElement.addEventListener('emptied',        function() { console.log('emptied'); }, false);
            mediaElement.addEventListener('stalled',        function() { console.log('stalled'); }, false);
            mediaElement.addEventListener('playing',        function() { console.log('playing'); }, false);
            mediaElement.addEventListener('waiting',        function() { console.log('waiting'); }, false);
            mediaElement.addEventListener('seeking',        function() { console.log('seeking'); }, false);
            mediaElement.addEventListener('seeked',         function() { console.log('seeked'); }, false);
            //mediaElement.addEventListener('timeupdate',     function() { console.log('timeupdate'); }, false);
            mediaElement.addEventListener('ended',          function() { console.log('ended'); }, false);
            mediaElement.addEventListener('ratechange',     function() { console.log('ratechange'); }, false);
            mediaElement.addEventListener('volumechange',   function() { console.log('volumechange'  ); }, false);
*/
            mediaElement.addEventListener('progress', function() { 
                console.log('progress', myVideoPlayer.currentTime);  
            }, false);
            
            mediaElement.addEventListener('pause', function() { 
                console.log('pause', myVideoPlayer.currentTime); 
                if (interpreterData && interpreterData.open)
                    interpreterData.send({action: "pausevideo"});
                
            }, false);
            
            mediaElement.addEventListener('play', function() {
                console.log("play from", myVideoPlayer.currentTime);
                if (interpreterData && interpreterData.open)
                    interpreterData.send({action: "playvideo"});
            }, false);
            
            
            instance.prepare = function() {
                if (interpreterData && interpreterData.open)
                    interpreterData.send({action: "seekvideo", time: 0.0, pause: true});
                myVideoPlayer.setCurrentTime(0.0);
                myVideoPlayer.pause();
            };

            
            
            // These hacks are to get events (play, seek) before they're
            // actually handled on the supervisor side, and run them on
            // to the interpreter side so that they can be handled almost
            // in parallel, reducing the delay.
            var pfx = '.' + this.classPrefix;
            
//          $(pfx + 'playpause-button, ' + pfx + '__overlay-play').on('click', function() {    
            $(pfx + 'playpause-button').on('click', function() {    
                if (! myVideoPlayer.paused) {
                    if (interpreterData && interpreterData.open)
                        interpreterData.send({action: "playvideo"});
                }
                console.log("CLICK playpause button ( paused:", myVideoPlayer.paused, ")");
            });
            
            /*
            $(pfx + 'overlay-button').on('click', function(e) {
                console.log("CLICK overlay button ( paused:", myVideoPlayer.paused, ")");
            });            
            */
            
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
                    
                    //if (role === RoleInterpreter && sharingScreen() ) unshareScreen();
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
        
        //console.log("Crossfade value:", b);
        
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

  
    $('#run-player').on('click', function() {
        var videoURL = $('#video-url').val();
        myVideoPlayer.setSrc(videoURL);
        if (interpreterData && interpreterData.open) {

            console.log("Sending video " + videoURL + " to interpreter");
            interpreterData.send({
                action: "loadvideo",
                url: videoURL,
                time: /*myVideoPlayer.getCurrentTime() +*/ 0.01,
                pause: true
            });
            
            //interpreterData.send({action: "seekvideo", time: 0.0, pause: true});
            myVideoPlayer.setSrc(videoURL);
            myVideoPlayer.setCurrentTime(0.0);
            myVideoPlayer.pause();
        }

        //myVideoPlayer.play();
        //myVideoPlayer.volume = 1;        
        console.log(videoURL);
    });
    
    $('#load-player').on('click', function() {
        showPlayer = !showPlayer;
        
        if (showPlayer) {
            if (interpreterData && interpreterData.open)
                interpreterData.send({action: "showplayer"});
        
            $('#load-player i').removeClass('fab fa-youtube').addClass('fas fa-times-circle');
            $('#player-container').removeClass('stack-bottom').addClass('stack-top');
            //$('#player-panel').fadeTo(1000, 1);
            $('#player-panel').fadeTo(0, 1);
            $('#player-panel').animate({ width: $('#player-panel').css('max-width')}, 400);
            
        } else {
            if (interpreterData && interpreterData.open)
                interpreterData.send({action: "hideplayer"});
        
            $('#load-player i').removeClass('fas fa-times-circle').addClass('fab fa-youtube');
            $('#player-container').removeClass('stack-top').addClass('stack-bottom');
            //$('#player-panel').fadeTo(500, 0);
            $('#player-panel').animate({ width: '0' }, 400);
            $('#player-panel').fadeTo(0, 0);
            
        }
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
        
        if (/*$("#record-audio > i").hasClass("fa-square")*/ recording) {
        
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
    
    
    $('#share-screen').on('click', function() {
    
        if (sharingScreen()) {
        
            unshareScreen();
            
/*            
            screenshareMediaStream.getTracks().forEach(track => track.stop())
            screenshareMediaStream = null;

            sharingScreenActive = false;
            screenshareMediaStream = null;
            speakerVideo.srcObject = speakerMediaStream;
        
            console.log('Sharing screen ended');  
            //me.unshareScreen();
            $('#share-screen > i').removeClass('fa-blink');
            
            speakerVideo.load();
*/
            
        } else {
            navigator.mediaDevices
                
                .getDisplayMedia({video: true, audio: true,})
                .then(stream => {

                    shareScreen(stream);
                    
                    return stream;
                    
                }).catch(err => {
                
                    /*
                    sharingScreenActive = false;
                    screenshareMediaStream = null;
                    // me.unshareScreen();
                    $('#share-screen > i').removeClass('fa-blink');
                    */
                    unshareScreen();
                    console.error("Error sharing screen: " + err);
                    return null; 
                });
        }
    
    });
    
    function sharingScreen() {
        return sharingScreenActive && screenshareMediaStream &&
               screenshareMediaStream.getVideoTracks().some(track => track.readyState === 'live');
    }
    
    function unshareScreen() {
        if (!sharingScreenActive) return;
        console.log('Unsharing screen');
        sharingScreenActive = false;
        const stream = screenshareMediaStream;
        screenshareMediaStream = null;
        if (stream) stream.getTracks().forEach(track => {
            track.onended = null;
            track.stop();
        });
        closePeerConnection(screenshareConnection);
        screenshareConnection = null;
        refreshSpeakerVideoSource();
        $('#share-screen > i').removeClass('fa-blink');
        initCrossFader();
    }

    function shareScreen(stream) {
    
        console.log("interpreterPeer: " + interpreterPeer);
        console.log("sharing screen: " + sharingScreen());
        
        if (!sharingScreen()) {

            console.log('Screen, application or browser tab has been shared');


            sharingScreenActive = true;
            screenshareMediaStream = stream;
            refreshSpeakerVideoSource();
            $('#share-screen > i').addClass('fa-blink');
            
            const videoTrack = stream.getVideoTracks()[0];
            if (videoTrack) videoTrack.onended = () => unshareScreen();
            
            if (interpreterPeer != null) {
                
                console.log("Now calling the interpreter");
                screenshareConnection = myPeer.call(
                    interpreterPeer, stream, { metadata: {role: RoleScreenShare}  } 
                );
                

            }
            
            initCrossFader();
        
        }
    }


    // ondevicechange event (webcam or headset has been plugged in or out)
    navigator.mediaDevices.ondevicechange = (e) => {
        console.log("Device list change detected");
        handleDeviceListChange(e); // io-devices.js
    }
});

// Start/stop decalage timer when pressing space bar
$(document).keypress(function(e) {
  if (e.target.id != 'chattext'  && e.which == 32) {
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
    }
    if (typeof channel2 === "object" && channel2 != null) {
        console.log("Disconnecting audio channel 2");
        channel2.disconnect();
    }
    
    if (sharingScreenActive && screenshareMediaStream &&
        screenshareMediaStream.getAudioTracks().length) {
        console.log("Adding screen share audio to crossfader...");
        channel1 = audioContext.createMediaStreamSource(screenshareMediaStream);
    } else if (speakerMedia && speakerMedia.open && speakerMediaStream) {
        console.log("Adding speaker audio to crossfader...");
        channel1 = audioContext.createMediaStreamSource(speakerMediaStream);
    } else {
        console.log("Replacing speaker audio with brownian noise in the crossfader...");
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
