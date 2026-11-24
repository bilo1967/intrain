/*
 *
 */
 
async function joinSupervisor(e, peerOptions, setAudioMode = () => {}) {
    
    if (e) e.preventDefault();
    
    console.log("Call/disconnect button pressed"); 

    // We're connected and we want to disconnect
    if (peerConnected) {
        console.log("Closing...");
        
        // Notify everybody we're disconnecting
        if (supervisorData && supervisorData.open) {
            supervisorData.send({action: "leaving", message: "bye"});
        }
        if (myRole == RoleSpeaker && interpreterData && interpreterData.open) {
            interpreterData.send({action: "leaving", message: "bye"});
        }
        if (myRole == RoleInterpreter && speakerData && speakerData.open) {
            speakerData.send({action: "leaving", message: "bye"});
        }

        $('#cancel-button').attr("disabled", true);
        
        // Close all data/media connections, streams and reset handlers            
        await closeAllConnections();
        
        
        resetIndicators();

        $("#login-info").html("You're disconnected");
        logToChat("You are not connected");

        InTrainUI.showModal('#login-dialog');        


        return true;
    }
    
    // Enable cancel button in login form
    $('#cancel-button').attr("disabled", false);

    userName = $("#username").val().trim();
    if (userName == "") {
        logToPanel("User name is empty", "info");
        return false;
    }    
    userID = userName.toLowerCase().hash64();

    myPeer = new Peer(PeerJSConfig, peerOptions);
    myPeer.connected = false;

    loadPeerHandlers(setAudioMode);
} 


/* 
 *
 * Handle the connection to myPeer server for interpreter and speaker
 *
 */

function loadPeerHandlers(setAudioMode = () => {}) {

    //
    // Data connections
    //
    myPeer.on('connection', function(c) { 

        var role = c.options?.metadata?.role; // Who's connecting

        // Interpreter and speaker should receive an incoming data connection
        // only from each other, but not from the supervisor, who is called by
        // each of them
        if (role == myRole || role == RoleSupervisor) { c.close(); return; }

        c.on('open', function() {

            console.log('SET AUDIO MODE');
            setAudioMode();
            
            if (setupDataConnection(c, role)) {
                console.log("Connection handle has been set");
                // Handle data connections
                switch (role) {
                case RoleInterpreter:
                    interpreterData.on('data', function(data) {
                        handleChat(data, RoleInterpreter, ColorInterpreter, c);
                    });
                    break;
                case RoleSpeaker:
                    speakerData.on('data', function(data) {
                        handleChat(data, RoleSpeaker, ColorSpeaker, c);
                    });
                    break;
                case RoleSupervisor:
                    break;
                }
            } else {
                console.warn("Rejecting unwanted data connection");
                c.close();
            }
        
        });
    });  
    
    //
    // Calls (media connections)
    //
    myPeer.on('call', function(c) {
        
        var role = c.options?.metadata?.role; // Who's connecting

        // Interpreter and speaker should receive a media call only from each other
        // but not from the supervisor, who is called by each of them.
        // The interpreter can also receive the supervisor's screen or local-file floor.
        if (role == myRole || role == RoleSupervisor ||
            !verifyMediaConnection(c, role)) {
            c.close();
            return;
        }

        console.log("media call from ", c);
        
        switch (role) {
        case RoleSpeaker:
            speakerMedia = c;
            speakerMedia.answer(localStream);
            speakerMedia.on('stream', function(mediaStream) {
                speakerMediaStream = mediaStream;
                refreshSpeakerVideoSource();
                speakerVideo.onloadedmetadata = function(e) {
                    speakerVideo.play();
                    refreshSpeakerVideoSource();
                };
            });  
            speakerMedia.on('close', function() {
                resetConnection(RoleSpeaker);
                logToPanel("<b>" + RoleSpeaker + "</b> media connection closed", "danger");
                logToChat("<b>" + RoleSpeaker + "</b> media connection closed");
                console.log(RoleSpeaker + " media connection closed");
            });                   
            break;
        case RoleInterpreter:
            interpreterMedia = c;
            interpreterMedia.answer(localStream);
            interpreterMedia.on('stream', function(mediaStream) {
              
              interpreterVideo.srcObject = mediaStream;
              interpreterMediaStream = mediaStream;
             
              //interpreterVideo.play();
              //interpreterVideo.muted = interpreterAudioMuted;

              interpreterVideo.onloadedmetadata = function(e) {
                  interpreterVideo.play();
                  interpreterVideo.muted = interpreterAudioMuted;
              }
            });  
            interpreterMedia.on('close', function() {
                resetConnection(RoleInterpreter);
                logToPanel("<b>" + RoleInterpreter + "</b> media connection closed", "danger");
                logToChat("<b>" + RoleInterpreter + "</b> media connection closed");
                console.log(RoleInterpreter + " media connection closed");
            });                
            break;
        case RoleSupervisor:

            break;
        }
    
    });

    //
    // Connection to peerJS server
    //
    myPeer.on('open', function() {

        console.log("Peer: open");

        // here you have myPeer.id
        peerConnected = true;
        peerError = false;
        
        logToPanel("Connection successful. You're now connected to the signaling server as <strong>" + myPeer.id + "</strong>. Trying to establish a data connection to " + userName, "success");
        
        $("#username").prop("disabled", true);
        $("#join-button").text("Disconnect");
        $("#join-button").removeClass("btn-success").addClass("btn-warning");
        $('#login-status').html('');
        InTrainUI.hideModal('#login-dialog');

        logToPanel("Trying to join the training session");

        //
        // Open a data connection with the supervisor
        //
        console.log("Joining", userName, "as", myRole)
        supervisorData = myPeer.connect(userID, { 
            metadata: {role: myRole}, 
            reliable: true, 
        });

        // 
        // Data connection to the supervisor successful
        //
        supervisorData.on('open', function() {
        
            $("#login-info").html("You've joined the training session as the <strong>" + myRole + "</strong> [id=" + myPeer.id + "]");
            
            logToChat("You have joined the training session");
            logToPanel("You have joined the training session");
            
            console.log("Established data connection to the supervisor");
          
            // Supervisor data channel
            supervisorData.on('data', function(data) {
                var act = (typeof data === "object") ? data.action : "chat";
                
                if (InTrainFileTransfer.receive(supervisorData, data, RoleSupervisor)) return;

                switch (act) {
                case 'floorstate':
                    InTrainFloorMedia.receiveState(supervisorData, data);
                    break;
                case 'chat':
                    logToChat(escapeHTML(data.message), RoleSupervisor, ColorSupervisor);
                    break;
                case 'leaving':
                    logToChat("The training session is over. You're not connected.");
                    logToPanel("The supervisor has terminated this training session. You're not connected.", "warning", true);
                    closeAllConnections();
                    $("#login-info").html("You're disconnected");
                    $('#cancel-button').attr("disabled", true);
                    resetIndicators();
                    break;
                case 'sendfile':
                    var link = getFileDownloadLinkFromData(data);
                    if (link !== null) {
                        console.log("Received file '" + data.filename + "' of type '" + data.filetype + "' from " + RoleSupervisor);
                        logToChat("The " + RoleSupervisor + " has sent you a file: " + link);
                    } else {
                        console.warn("Invalid file transfer from", RoleSupervisor);
                        logToChat("Invalid file transfer from", RoleSupervisor);
                    }
                    break;                        
                case 'dial':
                    console.log('Supervisor told me to call the', data.role, 'using id', data.peerid);
                    dialPeer(data.peerid, myRole, data.role);
                    break;
                case 'reject':
                    console.warn(act, data.message);
                    logToPanel(data.message, "warning", true);
                    $('#join-button').trigger("click");
                    break;

                case 'showplayer':
                    if (myRole === RoleInterpreter) {
                        setInterpreterPlayerVisible(true);
                        // Mute the floor audio while interpreting a synchronized video.
                        if (speakerMedia && speakerMedia.open)
                            muteMicrophone(RoleSpeaker, true);
                    }
                    break;

                case 'hideplayer':
                    if (myRole === RoleInterpreter) {
                        setInterpreterPlayerVisible(false);
                        // Return the floor audio when the video is hidden.
                        if (speakerMedia && speakerMedia.open)
                            muteMicrophone(RoleSpeaker, false);
                    }
                    break;

                case 'playerstate':
                    if (myRole === RoleInterpreter) {
                        setInterpreterPlayerVisible(data.visible === true);
                        if (data.url) applyRemoteVideoState(data);
                        if (speakerMedia && speakerMedia.open)
                            muteMicrophone(RoleSpeaker, data.visible === true);
                    }
                    break;

                case 'syncprepare':
                    if (myRole === RoleInterpreter) prepareInterpreterVideoSync(data);
                    break;
                case 'syncstart':
                    if (myRole === RoleInterpreter) startInterpreterSynchronizedVideo(data);
                    break;
                case 'videosyncping':
                    if (myRole === RoleInterpreter) answerInterpreterVideoPing(data);
                    break;

                case 'loadvideo':
                    if (myRole === RoleInterpreter) {
                        setInterpreterPlayerVisible(true);
                        applyRemoteVideoState({
                            url: data.url,
                            time: data.time,
                            playing: data.pause !== true
                        });
                    }
                    break;

                case 'playvideo':
                    if (myRole === RoleInterpreter) setRemoteVideoPlaying(true);
                    break;

                case 'pausevideo':
                    if (myRole === RoleInterpreter) setRemoteVideoPlaying(false);
                    break;

                case 'seekvideo':
                    if (myRole === RoleInterpreter)
                        seekRemoteVideo(data.time, data.pause);
                    break;
                case 'setaudiomode':
                    setSessionMode(data.mode);
                    setAudioMode(data.mode);
                    InTrainFloorMedia.applyVolume();
                    InTrainFloorMedia.syncInterpreterLayout();
                    break;
                case 'switch-role':
                    handleRoleSwitch(data);
                    break;                            
                case 'recording':
                    if (data.mode === "on") {

                        $('#recording-icon').html('Recording').addClass('fa-blink');
                    } else {

                        $('#recording-icon').html('').removeClass('fa-blink');
                    }
                    
                    break;                    
                }
            });
        });
        supervisorData.on('close', function() {
            resetConnection(RoleSupervisor);
            logToPanel("<b>" + RoleSupervisor + "</b> data connection closed", "danger");
            logToChat("<b>" + RoleSupervisor + "</b> data connection closed");
            console.log(RoleSupervisor + " data connection closed");
        });
        
        supervisorData.on('error', function(err) {
            console.error('error in data connection from ' + RoleSupervisor + ':', err);
            logToPanel("Connection failed: maybe " + userName + " is already connected with someone else with your role?", "warning", true);
            $('#join-button').trigger("click");        
        });

        //
        // Media call the supervisor
        //
        
        supervisorMedia = myPeer.call(userID,
            InTrainFloorMedia.participantOfferStream(localStream, audioContext),
            { metadata: {role: myRole} } );

        // Media call successful
        supervisorMedia.on('stream', function(mediaStream) {
            const currentCall = supervisorMedia;
            // Track events can arrive separately (especially across browsers).
            // Bind only tracks belonging to the current supervisor connection.
            const updateRemoteMedia = () => {
                if (supervisorMedia !== currentCall) return;
                supervisorMediaStream = mediaStream;
                InTrainFloorMedia.captureRemote(currentCall, mediaStream);
                const picture = mediaStream.getVideoTracks()[0];
                if (picture && supervisorVideo.srcObject?.getVideoTracks()[0] !== picture) {
                    supervisorVideo.srcObject = new MediaStream([picture]);
                    supervisorVideo.muted = true;
                    const playback = supervisorVideo.play();
                    if (playback?.catch) playback.catch(error =>
                        console.warn('Supervisor video autoplay prevented:', error));
                }
                InTrainFloorMedia.changeAudioOutput();
                InTrainFloorMedia.applyVolume();
            };
            updateRemoteMedia();
            mediaStream.addEventListener?.('addtrack', updateRemoteMedia);
            loadAndPlay("sounds/whistle.mp3", $('#select-audio-output').val());
        });

        supervisorMedia.on('close', function() {
            InTrainFloorMedia.clear(supervisorMedia);
            resetConnection(RoleSupervisor);
            logToPanel("<b>" + RoleSupervisor + "</b> media connection closed", "danger");
            logToChat("<b>" + RoleSupervisor + "</b> media connection closed");
            console.log(RoleSupervisor + " media connection closed");
        });            

    });

    // 'close' event is fired after 'disconnected'
    myPeer.on('close', function() {
        peerConnected = false;
        
        logToPanel("Connection closed", "success");
        $("#username").prop("disabled", false);
        
        $("#join-button").text("Call");
        $("#join-button").removeClass("btn-warning").addClass("btn-success");
    });
    
    myPeer.on('disconnected', function(){
        // myPeer.reconnect();
        console.log("Event peer disconnected")
    });
    
    myPeer.on('error', peerErrors);

}


/**
 * Gestisce il redirect per switch ruoli
 */
async function handleRoleSwitch(data) {
    logToPanel(`Switching to ${data.newRole} role...`, "info");
    
    roleSwitching = true;
    
    // Chiudi tutte le connessioni in modo pulito
    await closeAllConnections();

   
    // Redirect alla nuova pagina ruolo

        const newRolePage = data.newRole + '.html';
        const supervisorParam = encodeURIComponent(data.supervisor);
        window.location.href = `${newRolePage}?supervisor=${supervisorParam}&action=switching`;

}

function resetIndicators() {
    $('#session-mode').html( '' ).addClass('hidden');
    $('#recording-icon').html( '' );
    $('#recording-indicator').html( '' );
}
