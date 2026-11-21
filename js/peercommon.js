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

        $('#login-dialog').modal('show');        

        /*
        setTimeout(function() { 
            //myPeer.destroy();
            closeAllConnections();
        }, 0);
        */
        
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
                        handleChat(data, RoleInterpreter, ColorInterpreter);
                    });
                    break;
                case RoleSpeaker:
                    speakerData.on('data', function(data) {
                        handleChat(data, RoleSpeaker, ColorSpeaker);
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
        // Interpreter cal also receive a screen share connection
        if (role == myRole || role == RoleSupervisor ||
            (myRole == RoleSpeaker && role == RoleScreenShare) ||
            (role == RoleScreenShare && c.peer !== userID) ||
            (role != RoleScreenShare && !verifyMediaConnection(c, role))) {
            c.close();
            return;
        }

        console.log("media call from ", c);
        
        switch (role) {
        case RoleScreenShare:
            screenshareConnection = c;
            c.answer();
            c.on('stream', function(stream) {
                if (screenshareConnection !== c) return;
                screenshareMediaStream = stream;
                refreshSpeakerVideoSource();

                // Speaker media arriving later must not replace the current screen.
                stream.getTracks().forEach(track => {
                    track.onended = () => {
                        if (screenshareConnection !== c || screenshareMediaStream !== stream) return;
                        screenshareMediaStream = null;
                        refreshSpeakerVideoSource();
                    };
                });
                console.log('Receiving a screen share');
            });
            c.on('close', function() {
                // Ignore an old connection closing after a replacement arrived.
                if (screenshareConnection !== c) return;
                screenshareConnection = null;
                screenshareMediaStream = null;
                refreshSpeakerVideoSource();
            });
            break;                
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
        $('#login-dialog').modal('hide');

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
                
                console.log("received: " + JSON.stringify(data) +  " from ", RoleSupervisor);
                
                switch (act) {
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
                    if (myRole == RoleInterpreter ) {
                        $('#player-container').removeClass('stack-bottom hidden').addClass('stack-top');
                        $('#player-panel').fadeTo(1000, 1);
                        showPlayer = true;

                        // Mute speaker audio while in video player mode
                        if (speakerMedia && speakerMedia.open) 
                            muteMicrophone(RoleSpeaker, true);
                    }
                    break;
                    
                case 'hideplayer':
                    if (myRole == RoleInterpreter ) {
                        showPlayer = false;
                        $('#player-container').removeClass('stack-top').addClass('stack-bottom hidden');
                        $('#player-panel').fadeTo(500, 0);
                    }
                    break;

                case 'loadvideo':
                    if (myRole == RoleInterpreter ) {
                        $('#player-container').removeClass('stack-bottom hidden').addClass('stack-top');
                        $('#player-panel').fadeTo(1000, 1);
                        if (myVideoPlayer != null) {
                            console.log("Received video " + data.url);
                            myVideoPlayer.setSrc(data.url);
                            if (data.time)
                                myVideoPlayer.setCurrentTime(parseFloat(data.time));
                            if (data.pause)
                                myVideoPlayer.pause();
                        }
                    }
                    break;
                case 'playvideo':
                    if (myVideoPlayer != null) {
                        console.log("play video");
                        myVideoPlayer.play();
                    }
                    break;
                case 'pausevideo':
                    if (myVideoPlayer != null) {
                        console.log("pause video");
                        myVideoPlayer.pause();
                    }
                    break;
                case 'seekvideo':
                    if (myVideoPlayer != null) {
                        //myVideoPlayer.pause();
                        myVideoMediaElement.setCurrentTime(parseFloat(data.time));
                        if (data.pause) myVideoPlayer.pause();
                        console.log("seek video to", data.time);
                    }
                    break;
                case 'setaudiomode':
                    setSessionMode(data.mode);
                    setAudioMode(data.mode);
                    break;
                case 'switch-role':
                    handleRoleSwitch(data);
                    break;                            
                case 'recording':
                    if (data.mode === "on") {
                        //$('#recording-indicator').html('supervisor is recording this session').addClass('fa-blink');
                        $('#recording-icon').html('Recording').addClass('fa-blink');
                    } else {
                        //$('#recording-indicator').html('').removeClass('fa-blink');
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
        
        supervisorMedia = myPeer.call(userID, localStream, { metadata: {role: myRole} } );

        // Media call successful
        supervisorMedia.on('stream', function(mediaStream) {
            // `stream` is the mediaStream of the remote peer.
            // Here you'd add it to an HTML video/canvas element.
            
            supervisorVideo.srcObject = mediaStream;
            supervisorMediaStream = mediaStream;
            
            //supervisorVideo.play();
            //supervisorVideo.muted = supervisorAudioMuted;
            
            supervisorVideo.onloadedmetadata = function(e) {
                supervisorVideo.play();
                supervisorVideo.muted = supervisorAudioMuted;
            }
            
            loadAndPlay("sounds/whistle.mp3", $('#select-audio-output').val());
        });

        supervisorMedia.on('close', function() {
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
    //setTimeout(() => {
        const newRolePage = data.newRole + '.html';
        const supervisorParam = encodeURIComponent(data.supervisor);
        window.location.href = `${newRolePage}?supervisor=${supervisorParam}&action=switching`;
    //}, 1500);
}

function resetIndicators() {
    $('#session-mode').html( '' ).addClass('hidden');
    $('#recording-icon').html( '' );
    $('#recording-indicator').html( '' );
}