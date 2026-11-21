/* Load after common.js */

function logToChat(m, w = "", color = "white") {
    
    var t = "";
    
    if (w != '') {
        t = "<span style='color: " + color + ";'><strong>" + w + "</strong>: " + m + "<br/></span>";
    } else {
        t = "<span style='color: " + color + ";'>" + m + "<br/></span>";
        
    }

    animateCSS('#chatboard', 'bounce');
    
    $("#chatboard").append(t);
                  
    $("#chatboard").scrollToEnd();
}


let hideLogPanelTimeout = null;

function logToPanel(m, c = "info", l = false) {
    // Cancel previous timeout, if it exists
    if (hideLogPanelTimeout) {
        clearTimeout(hideLogPanelTimeout);
    }

    if (l) $('#login-status').html(m);

    $('#log-panel').fadeOut(250, function() {
        $('#log-text').html(m);
        $('#log-panel')
            .removeClass("alert-warning alert-success alert-danger alert-info alert-primary alert-secondary alert-success alert-clear alert-dark")
            .addClass("alert-" + c);
    }).fadeIn(150);

    // Hide panel after 5 seconds
    hideLogPanelTimeout = setTimeout(() => {
        $('#log-panel').fadeOut(1000);
        hideLogPanelTimeout = null;
    }, 5000);
}

function verifyMediaConnection(c, role) {
  if (c == null) return false;
  if (role != RoleSpeaker && role != RoleInterpreter && role != RoleSupervisor) return false;
  return !(
    (c != speakerMedia) && speakerMedia && speakerMedia.open && (role == RoleSpeaker) ||
    (c != interpreterMedia) && interpreterMedia && interpreterMedia.open && (role == RoleInterpreter) ||
    (c != supervisorMedia) && supervisorMedia && supervisorMedia.open && (role == RoleSupervisor)
  );
}


function verifyDataConnection(c, role) {
    
    // Refuse connection if role is mine
    if (role == myRole) {
        return {action: "reject", message: "You cannot play my role"};
    }
    
    // Refuse connection if role is unknown
    if (role != RoleInterpreter && role != RoleSpeaker && role != RoleSupervisor) {
        return {action: "reject", message: "Unknown role '" + role + "'"};
    }
    
    // Refuse further data connections if partecipants are already connected
    if (interpreterData != null && interpreterData.open && role == RoleInterpreter || 
        speakerData != null && speakerData.open && role == RoleSpeaker ) {
        return {action: "reject", message: "Some one with role '" + role + "' is already connected"};
    }
   
    // handle other errors
    switch (role) {
    case RoleInterpreter:
        if (interpreterPeer != null && interpreterPeer != c.peer) {
           return {action: "reject", message: "Can't establish interpreter data and media connections from different peers. Closing connection."};
        }
        break;
    case RoleSpeaker:
        if (speakerPeer != null && speakerPeer != c.peer && speakerPeer.open) {
           return {action: "reject", message: "Can't establish speaker data and media connections from different peers"};
        }            
        break;
    case RoleSupervisor:
        if (supervisorPeer != null && supervisorPeer != c.peer) {
           return {action: "reject", message: "Can't establish supervisor data and media connections from different peers. Closing connection."};
        }
        break;
    }
    return false;
}    



function setupDataConnection(c, role) {
    
//  async function sendErrorMessage(c, o) {
//      c.send(o);
//  }    
    
    var role = c.options.metadata.role;
    
    var err = verifyDataConnection(c, role);
    
    if (err === false) {
    
        switch (role) {
        case RoleInterpreter:
            interpreterData = c;
            interpreterPeer = c.peer;
            break;
        case RoleSpeaker:
            speakerData = c;
            speakerPeer = c.peer;
            break;
        case RoleSupervisor:
            supervisorData = c;
            supervisorPeer = c.peer;
            break;
        }
        
        console.log(role, "has joined");
        logToChat("<b>" + role + "</b> has joined us");

        return true;
    } else {
        console.warn("Connection refused: ", err.message);
        return false;
    }
}


function enableMic(v) {
    if (typeof micStream !== 'object') return null;
    
    const tracks = micStream.getAudioTracks();
    // if MediaStream has reference to track
    if (tracks[0]) {
        tracks[0].enabled = v;
        return v;
    }
    return null;
}

function enableCam(v) {
    if (typeof micStream !== 'object') return null;
    
    const tracks = micStream.getVideoTracks();
    // if MediaStream has reference to track
    if (tracks[0]) {
        tracks[0].enabled = v;
        return v;
    }
    return null;
}

function toggleMic() {
    if (typeof micStream !== 'object') return null;
    
    const tracks = micStream.getAudioTracks();
    // if MediaStream has reference to track
    if (tracks[0]) {
        tracks[0].enabled = !tracks[0].enabled;
        return tracks[0].enabled;
    }
    return null;
}

function toggleCam() {
    if (typeof localStream !== 'object') return null;
    
    const tracks = localStream.getVideoTracks();
    // if MediaStream has reference to track
    if (tracks[0]) {
        tracks[0].enabled = !tracks[0].enabled;
        return tracks[0].enabled;
    }
    return null;
}

function isCamEnabled() {
    if (typeof localStream !== 'object') return null;
    return localStream.getVideoTracks()[0].enabled;
}

function isMicEnabled() {
    if (typeof micStream !== 'object') return null;
    return micStream.getAudioTracks()[0].enabled;
}

function addCopyright() {
    $('#appname').html(appName + " v" + appVersion);
    $('#copyright').html(appCopyright);
    $('#license').html(appLicense);
    $('#license-compact').html(appLicenseCompact);
    $('#company').html(appCompany);
    $('#credits').html(appCredits);
}


// These event handlers are shared by all the peers
function loadCommonHandlers() {
    
    console.log("loading common handlers");
    
    
    // logging
    saveLog = "Log file for " + myRole + "\n";
    
    $('.download-log-link').on('click', function(e) {
        this.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(saveLog));
        this.setAttribute('download', 'log.txt');
    });

    //#debugging
    $('.debug-checkbox').on('change', function() {

        //$('#debugging2').prop('checked', this.checked);
        $('.debug-checkbox').prop('checked', this.checked);
        
        
        if (this.checked) { 
            redirectConsole(); 
        } else {
            restoreConsole(); 
            saveLog = "Log file for " + myRole + "\n";;
        }
        
        console.warn("Debug mode " + (this.checked ? "on" : "off"));
    });
    
    $('#debug-ging2').on('click', function() {
        $('#debugging').trigger('click');
    });
    

    // Text inserted in the chat input box is sent to the 
    // chat window and to each peer
    $("#chattext").on("keypress", function(e) {
        
        if (e.which == 13) {
        
            if (speakerData && speakerData.open) {
                console.log("sending text to speaker:", $(this).val());
                speakerData.send({action: "chat", message: $(this).val()});
            }
            if (interpreterData && interpreterData.open) {
                console.log("sending text to interpreter:", $(this).val());
                interpreterData.send({action: "chat", message: $(this).val()});
            }
            if (supervisorData && supervisorData.open) {
                console.log("sending text to supervisor:", $(this).val());
                supervisorData.send({action: "chat", message: $(this).val()});
            }
            
            logToChat($(this).val(), "me", myColor);
            
            $(this).val('');
            
            return false;
        }
    });    

    // Click the "home" button on the login dialog 
    // to redirect to the index page
    $("#home-button").on("click", function() {
        window.location.replace("index.html"); // Back to index.html
    });
    
    // Click the "logout" button on the main panel
    // to open the login/logout dialog
    $("#logout-button").on("click", function() {
        $('#login-dialog').modal('show');
    });
    
    // Click the "cancel" button on the login/logout
    // dialog to hide it and return in the main panel
    $('#cancel-button').on("click", function() {
        $('#login-status').html('');
        $('#login-dialog').modal('hide');
    });
    
    
    // Click the "swap" button to exchange the main 
    // with the secondary video
    $('#swap-button').on("click", function() {
        $("#video1").fadeOut(250);
        $("#video3").fadeOut(250, function() {
          $("#video1 video").toggleClass("mini-video normal-video");
          $("#video3 video").toggleClass("mini-video normal-video");
          $("#video1").toggleClass("mini-video-height normal-video-height");
          $("#video3").toggleClass("mini-video-height normal-video-height");
          $("#video1").swap("#video3");
          $("#video1").fadeIn(250);
          $("#video3").fadeIn(250);          
        });
    });

    // Toggle microphone on/off
    $("#toggle-microphone").on("click", function() {
        console.log("Toggling microphone on/off");
        let m = toggleMic();
        if (m !== null) {
            console.log("Microphone is now " + (m ? "open": "muted"));
            logToPanel("Your microphone is now " + (m ? "open": "muted"), "success");
            $("#toggle-microphone > i").toggleClass("fa-microphone-slash fa-microphone");
            $("#toggle-microphone").toggleClass("btn-danger btn-success");
        } else {
            console.warn("Can't access microphone");
        }
    });
    
    // Toggle camera on/off
    $("#toggle-camera").on("click", function() {
        console.log("Toggling camera on/off");
        $("#toggle-camera").toggleClass("fa-video fa-video-slash");
        let m = toggleCam();
        
        if (m !== null) {
            console.log("Camera is now " + (m ? "on": "off"));
        } else {
            console.warn("Can't access camera");
        }
    });

    // Prevent dropping objects on the page
    $('.undroppable').on('dragenter', stopProcessingEvent);
    $('.undroppable').on('dragover', stopProcessingEvent);
    $('.undroppable').on('drop', function(e) { e.preventDefault();} );

    // Send a file to a specific peer
    $('#send-file-to-interpreter, #send-file-to-speaker, #send-file-to-supervisor').on("change", function(e) {
        var id = $(this).attr('id');
        
        switch (id) {
        case 'send-file-to-interpreter':
            sendFilesToDataChannel(interpreterData, e.target.files);
            break;
        case 'send-file-to-speaker':
            sendFilesToDataChannel(speakerData, e.target.files);
            break;
        case 'send-file-to-supervisor':
            sendFilesToDataChannel(supervisorData, e.target.files);
            break;
        }
        $(this).val();        
    });
    
    // Send a file to all peers
    $('#send-file-to-all').on("change", function(e) {
        console.log("Sending a file to everybody");
        sendFilesToDataChannel(interpreterData, e.target.files);
        sendFilesToDataChannel(speakerData,     e.target.files);
        sendFilesToDataChannel(supervisorData,  e.target.files);
        $(this).val();
    });
    

    
    $('#speaker-audio-toggle').on('click', function(){
        if (speakerMedia && speakerMedia.open) {

            speakerAudioMuted = !speakerAudioMuted;  // toggle
            
            muteMicrophone(RoleSpeaker, speakerAudioMuted);
            
            logToPanel(RoleSpeaker + " audio is now " + (speakerAudioMuted ? "off" : "on"), "success");
            console.log(RoleSpeaker + " audio is now " + (speakerAudioMuted ? "off" : "on"));
        }     
    });

    $('#interpreter-audio-toggle').on('click', function(){
        if (interpreterMedia && interpreterMedia.open) {

            interpreterAudioMuted = !interpreterAudioMuted; // toggle
            
            muteMicrophone(RoleInterpreter, interpreterAudioMuted);
           
            logToPanel(RoleInterpreter + " audio is now " + (interpreterAudioMuted ? "off" : "on"), "success");
            console.log(RoleInterpreter + " audio is now " + (interpreterAudioMuted ? "off" : "on"));
        }
    });
    
    $('#supervisor-audio-toggle').on('click', function(){
        if (supervisorMedia && supervisorMedia.open) {

            supervisorAudioMuted  = !supervisorAudioMuted;  // toggle
            
            muteMicrophone(RoleSupervisor, supervisorAudioMuted);
            
            logToPanel(RoleSupervisor + " audio is now " + (supervisorAudioMuted ? "off" : "on"), "success");
            console.log(RoleSupervisor + " audio is now " + (supervisorAudioMuted ? "off" : "on"));
        }
    });
    
    $('#interpreter-fullscreen').on("click", function() {
        openFullscreen($("#interpreterVideo")[0]);
    });    
    $('#speaker-fullscreen').on("click", function() {
        openFullscreen($("#speakerVideo")[0]);
    });    
    $('#supervisor-fullscreen').on("click", function() {
        openFullscreen($("#supervisorVideo")[0]);
    });    
       
    
/*    
    // Avoid form submit on ENTER key
    $(document).on("keypress", ":input:not(textarea)", function(event) {
        if (event.keyCode == 13) {
            event.preventDefault();
        }
    });
*/
    // Map login form submit action to to "join" button
    $("#login-form").on("submit", function(event) {
        event.preventDefault();
        $("#join-button").trigger("click");
        return false;
    });
    
    
    // Handle page close or reload
    window.addEventListener('beforeunload', async function (e) {
        
        if (!roleSwitching) e.preventDefault(); // Cancel the event
        
        console.warn("Page has been closed or reloaded");
        
        if (supervisorData && supervisorData.open) {
            console.log("Bye supervisor");
            supervisorData.send({action: "leaving", message: "bye"});
        }
        if (speakerData && speakerData.open) {
            console.log("Bye speaker");
            speakerData.send({action: "leaving", message: "bye"});
        }  
        if (interpreterData && interpreterData.open) {
            console.log("Bye interpreter");
            interpreterData.send({action: "leaving", message: "bye"});
        }  
        /*
        setTimeout(function() {
            closeAllConnections();
            e.returnValue = true; // Chrome requires returnValue to be set
        }, 1000);
        */
        await closeAllConnections();
        e.returnValue = true;
    });

    addCopyright();
}

function sendFilesToDataChannel(datachannel, file_or_file_list) {
    if (datachannel && datachannel.open) { 
        
        Array.from(file_or_file_list).forEach(function(file) {
            
            const blob = new Blob([ file ], { type: file.type });
            
            console.log("Sending file '" + file.name + "'");
            
            datachannel.send({
                action: "sendfile", 
                filename: file.name,
                filetype: file.type,
                file: blob
            });            
            
        });
    }
}    
function getFileDownloadLinkFromData(data) {
    var html = null;
    if (typeof data === "object") {
        var name = data.filename;
        if (data.file.constructor === ArrayBuffer) {
            var dataView = new Uint8Array(data.file);
            var blob = new Blob([dataView]);
            html = "<a href='" + URL.createObjectURL(blob) + "' download='" + name + "'>" + name + "</a>";
        }
    }
    return html;
}

// Reset connection with a specific participant
async function resetConnection(role, t = 0) {
    
    console.log(role + " is leaving, resetting connection.");

    const closeConnection = async (obj) => {
        if (obj && obj.hasOwnProperty('open') && obj.open ) {
            await new Promise(resolve => {
                obj.on('close', resolve);
                obj.close();
            });
            return null;
        }        
    };

    switch (role) {
    case RoleInterpreter:
        interpreterData  = await closeConnection(interpreterData);
        interpreterMedia = await closeConnection(interpreterMedia);
        interpreterMediaStream = null;
        if (interpreterVideo) interpreterVideo.srcObject = null;    
        interpreterPeer = null;
        muteMicrophone(role, interpreterAudioMutedDefault);
        break;
    case RoleSpeaker:
        speakerData  = await closeConnection(speakerData);
        speakerMedia = await closeConnection(speakerMedia);
        speakerMediaStream = null;
        if (speakerVideo) speakerVideo.srcObject = null;
        speakerPeer = null;
        muteMicrophone(role, speakerAudioMutedDefault);
        break;    
    case RoleSupervisor:
        supervisorData  = await closeConnection(supervisorData);
        supervisorMedia = await closeConnection(supervisorMedia);
        supervisorMediaStream = null;
        if (supervisorVideo) supervisorVideo.srcObject = null;    
        supervisorPeer = null;
        muteMicrophone(role, supervisorAudioMutedDefault);
        break;    
    }

/*    
    setTimeout(function() {
        switch (role) {
        case RoleInterpreter:
            if (interpreterData && interpreterData.open) interpreterData.close();
            if (interpreterMedia && interpreterMedia.open) interpreterMedia.close();
            interpreterData = null;
            interpreterMedia = null;
            interpreterMediaStream = null;
            if (interpreterVideo) interpreterVideo.srcObject = null;    
            interpreterPeer = null;
            muteMicrophone(role, interpreterAudioMutedDefault);
            break;
        case RoleSpeaker:
            if (speakerData && speakerData.open) speakerData.close();
            if (speakerMedia && speakerMedia.open) speakerMedia.close();
            speakerData = null;
            speakerMedia = null;
            speakerMediaStream = null;
            if (speakerVideo) speakerVideo.srcObject = null;
            speakerPeer = null;
            muteMicrophone(role, speakerAudioMutedDefault);
            break;    
        case RoleSupervisor:
            if (supervisorData && supervisorData.open) supervisorData.close();
            if (supervisorMedia && supervisorMedia.open) supervisorMedia.close();
            supervisorData = null;
            supervisorMedia = null;
            supervisorMediaStream = null;
            if (supervisorVideo) supervisorVideo.srcObject = null;    
            supervisorPeer = null;
            muteMicrophone(role, supervisorAudioMutedDefault);
            break;    
        }
    }, t);
*/    
}


async function closeAllConnections(t = 0) {
    
    
    console.log("Closing all connections");
    
    const closeConnection = async (obj) => {
        if (obj && obj.hasOwnProperty('open') && obj.open ) {
            await new Promise(resolve => {
                obj.on('close', resolve);
                obj.close();
            });
        }        
    };
    
    if (myRole != RoleSpeaker) {
        console.log('Closing connections to speaker');
        await closeConnection(speakerData);
        await closeConnection(speakerMedia);
        speakerData = null;
        speakerMedia = null;
        console.log('Connections to speaker closed');
    }
    if (myRole != RoleInterpreter) {
        console.log('Closing connections to interpreter');
        await closeConnection(interpreterData);
        await closeConnection(interpreterMedia);
        interpreterData = null;
        interpreterMedia = null;
        console.log('Connections to interpreter closed');
    }
    if (myRole != RoleSupervisor) {
        console.log('Closing connections to supervisor');
        await closeConnection(supervisorData);
        await closeConnection(supervisorMedia);
        supervisorData = null;
        supervisorMedia = null;
        console.log('Connections to supervisor closed');
    }
    
    if (myPeer) {
        console.log('Disconnectiong peer from PeerJS server');
        await new Promise(resolve => {
            myPeer.on('close', resolve);
            myPeer.destroy(); // ==> fires myPeer.close
        });
        console.log('Peer disconnected and destroyed');
    }
    
    initMuted();


/*

    if (myPeer)
        console.log("peer disconnected:", myPeer.disconnected);
    else
        console.log("peer was not connected");

    
    setTimeout(function() {  
//      if (myRole != RoleSpeaker) {
            if (speakerData && speakerData.open) speakerData.close();
            if (speakerMedia && speakerMedia.open) speakerMedia.close();
            speakerData = null;
            speakerMedia = null;
//      }
        
//      if (myRole != RoleInterpreter) {
            if (interpreterData && interpreterData.open) interpreterData.close();
            if (interpreterMedia && interpreterMedia.open) interpreterMedia.close();
            interpreterData = null;
            interpreterMedia = null;
//      }
        
//      if (myRole != RoleSupervisor) {
            if (supervisorData && supervisorData.open) supervisorData.close();
            if (supervisorMedia && supervisorMedia.open) supervisorMedia.close();
            supervisorData = null;
            supervisorMedia = null;
//      }
        
        if (myPeer) myPeer.destroy(); // ==> fires myPeer.close
        initMuted();
    }, t);
*/
}





    
    
    
function peerErrors(err) {

    console.error("Peer: error", "'" + err.type + "'");
    
    var msg, action;
    
    // Skip subsequent errors
    if (peerError) return;
    peerError = true;

    switch(err.type) {
    case 'browser-incompatible': // Fatal error
        msg = "Your browser is not compatible with this application.";
        action = "danger";
        break;
    case 'disconnected': // Error
        msg = "You've already disconnected this peer from the server and can no longer make any new connections on it";
        action = "warning";
        break;
    case 'invalid-id':       // error fatal
        msg = "Username contains invalid characters";
        action = "info";
        break;
    case 'invalid-key':      // error fatal
        msg = "An invalid key has been supplied to the signaling server.";
        action = "danger";
        break;
    case 'network':          // error
        msg = "Lost or cannot establish a connection to the signalling server. Try again later.";
        action = "warning";
        break;
    case 'peer-unavailable': // error
        msg = "The ID you're trying to connect to does not exist";
        action = "warning";
        break;
    case 'ssl-unavailable':  // error fatal
        msg = "Can't establish an encrypted connection (server certificate expired?)";
        action = "danger";
        break;
    case 'server-error':     // error fatal
        msg = "Can't reach the signaling server. Try again later.";
        action = "warning";
        break;
    case 'socket-error':     // error fatal
        msg = "Network error. Try again later.";
        action = "warning";
        break;
    case 'socket-closed':    // error fatal
        msg = "Communication closed unexpectedly";
        action = "warning";
        break;
    case 'unavailable-id':   // error      
        msg = "The username you supplied is already taken. Please, use a different one.";
        action = "info";
        break;
    default:
        msg = err;
        action = "warning";
        break;
    }
    
    switch (action) {
    case 'danger':
        // Fatal error
        break;
    case 'warning':
        // Unexpected disconnection or temporary error
        break;
    case 'retry':
        // Username is invalid or already taken
        break;
    }
    
    console.error(msg, action);
    logToPanel(msg, action, true);

    if (myRole == RoleInterpreter || myRole == RoleSpeaker) {
        $('#join-button').trigger("click");
    }            
}



function dialPeer(calleeID, callerRole, calleeRole) {

    var c, m, s, v, p, color;
    
    p = calleeID;
    switch(calleeRole) {
    case RoleInterpreter:
        v = interpreterVideo;
        interpreterPeer = calleeID;
        calleeColor = ColorInterpreter;
        break;
    case RoleSpeaker:
        v = speakerVideo;
        speakerPeer = calleeID;
        calleeColor = ColorSpeaker;
        break;
    case RoleSupervisor:
        v = supervisorVideo;
        supervisorPeer = calleeID;
        calleeColor = ColorSupervisor;
        break;
    }
    
    // data call
    var c = myPeer.connect(calleeID, { 
        metadata: {role: callerRole}, 
        reliable: true,
    });
    c.on('open', function() {
        console.log("Data connection to the " + calleeRole + " established");
        logToPanel("Data connection to the " + calleeRole + " established");
        logToChat("<b>" + calleeRole + "</b> has joined");

        c.on('data', function(data) {
            handleChat(data, calleeRole, calleeColor);
        });
    });
    c.on('close', function() {
        console.log(calleeRole + ' data connection closed');
    });
    c.on('error', function(e) {
        console.error('Error', e, 'in data connection to', calleeRole);
    });
    
    // video call
    m = myPeer.call(calleeID, localStream, { metadata: {role: callerRole} } );
    m.on('stream', function(mediaStream) {
        // `stream` is the mediaStream of the remote peer.
        // Here you'd add it to an HTML video/canvas element.
        
        v.srcObject = mediaStream;
        s = mediaStream;
        
        //v.play();
        //v.muted = (callerRole == RoleSpeaker && calleeRole == RoleInterpreter);
        
        v.onloadedmetadata = function(e) {
            v.play();
            v.muted = false;
        }
    });
    m.on('close', function() {
        console.log(calleeRole + ' media connection closed');
        v.srcObject = null;
    });
    
    switch(calleeRole) {
    case RoleInterpreter:
        interpreterData = c;
        interpreterMedia = m;
        interpreterMediaStream = s;
        break;
    case RoleSpeaker:
        speakerData = c;
        speakerMedia = m;
        speakerMediaStream = s;
        break;
    case RoleSupervisor:
        supervisorData = c;
        supervisorMedia = m;
        supervisorMediaStream = s;
        break;
    }    
    
}

// Handle the internal data transfer protocol
function handleChat(data, callerRole, callerColor) {
    
    console.log("Data received: ", data);
    
    var action = (typeof data === "object") ? data.action : "chat";
    switch (action) {
    case 'chat':
        logToChat(data.message, callerRole, callerColor);
        break;
    case 'sendfile':
        var link = getFileDownloadLinkFromData(data);
        if (link !== null) {
            console.log("Received file '" + data.filename + "' of type '" + data.filetype + "' from " + callerRole);
            logToChat("The " + callerRole + " has sent you a file: " + link);
        } else {
            console.warn("Invalid file transfer from", callerRole);
            logToChat("Invalid file transfer from", callerRole);
        }
        break;                
    case 'leaving':
        resetConnection(callerRole);
        logToPanel("<b>" + callerRole + "</b> has logged out", "danger");
        logToChat("<b>" + callerRole + "</b> has logged out");
        console.log(callerRole + " has logged out");
        break;

    }
        
}

function isMicrophoneMuted(role) {
    var retVal;
    switch (role) {
    case RoleInterpreter:
        retVal = interpreterAudioMuted;
        break;
    case RoleSpeaker:
        retVal = speakerAudioMuted;
        break;
    case RoleSupervisor:
        retVal = supervisorAudioMuted;
        break;
    }
    return retVal;
}

function muteMicrophone(role, muted = true) {
    var e = null;
    var c = null;
    
    switch (role) {
    case RoleInterpreter:
        interpreterAudioMuted = muted;
        e = '#interpreter-audio-toggle';
        c = interpreterVideo;
        break;
    case RoleSpeaker:
        speakerAudioMuted = muted;
        e = '#speaker-audio-toggle';
        c = speakerVideo;
        break;
    case RoleSupervisor:
        supervisorAudioMuted = muted;
        e = '#supervisor-audio-toggle';
        c = supervisorVideo;
        break;
    }
    
    
    
    if (c) {
        // Supervisor toggles audio using Web Audio API because of crossfading
        if (myRole == RoleSupervisor) {
            $("#cross-fader").trigger("input");
        } else {
            c.muted = muted;    
        }             
    }
    
    if (e) {
        //$(e + ' > i').removeClass('fa-volume-up fa-volume-mute').addClass(muted ? 'fa-volume-up' : 'fa-volume-mute');
        $(e + ' > i').removeClass('fa-volume-up fa-volume-mute').addClass(muted ? 'fa-volume-mute' : 'fa-volume-up');
        //$(e).html('<i class="fas ' + (muted ? 'fa-volume-up' : 'fa-volume-mute') + ' fa-lg"></i>');
    }
    
}

function initMuted() {
    muteMicrophone(RoleInterpreter, interpreterAudioMutedDefault);
    muteMicrophone(RoleSpeaker, speakerAudioMutedDefault);
    muteMicrophone(RoleSupervisor, supervisorAudioMutedDefault);
}


function loadClock() {
    updateClock();
    setInterval(updateClock, 1000);
}


function updateClock() {
    
    var dt = getDateTime();
    
    $('#date').text(dt.date);
    $('#hours').text(dt.hours);
    $('#minutes').text(dt.minutes);
    $('#seconds').text(dt.seconds);
} 


function playStream(stream, sinkId = null) {
    
    return;
    if (!stream instanceof MediaStream) return;
    
    const player = new Audio();
    player.srcObject = stream;
    
    if (sinkId) {
        player.setSinkId(sinkId).then(() => {
            console.log("Playing stream on device: " + player.sinkId)
            player.play();
        }).catch(e => {
           console.log(e) ;
        });        
    } else {
        player.play();
    }
            
}


// Audio can be attached to an existing player and played
// on the preferred device
function loadAndPlay(tunePath, /*loop = false, */ sinkId = null) {

    var req = new XMLHttpRequest(),
        //ctx = new AudioContext(),
        dest = null;

console.log('LOADANDPLAY');

    // Load file
    req.open("GET", tunePath, true);
    req.responseType = "arraybuffer";
    req.onload = function() {
        audioContext.decodeAudioData(req.response, onDecoded);
    }

    function onDecoded(buffer) {

        var node = audioContext.createBufferSource();
        node.buffer = buffer;
        
        if (sinkId) {
            
            console.log("Play in media element: " + tunePath);    
            
            const dest = audioContext.createMediaStreamDestination();
            node.connect(dest); 
            
            const player = new Audio();
            player.srcObject = dest.stream;
            
            player.setSinkId(sinkId).then(() => {
                console.log("Hardware id: " + player.sinkId)
                player.play();
                
            }).catch(e => {
               console.log(e) ;
                
            });
            
            
            
        } else {
            console.log("Play in default context: " + tunePath);    
            node.connect(audioContext.destination);
        }
        
        node.loop = false; //loop;
        node.start();
    }
    
    req.send();
};



async function setUserMediaConstraints() {
  try {
    if (window.stream) {
      window.stream.getTracks().forEach(track => {
        track.stop();
      });
    }
    
    const videoSource = $('#select-video-source').val();
    const audioSource = $('#select-audio-source').val();
    
    var constraints = {};
    switch (myRole) {
      case RoleInterpreter:
        constraints = InterpreterMediaStreamConstraints;
        break;
      case RoleSpeaker:
        constraints = SpeakerMediaStreamConstraints;
        break;
      case RoleSupervisor:
        constraints = SupervisorMediaStreamConstraints;
        break;
    }
    
    constraints.audio.deviceId = audioSource ? {exact: audioSource} : undefined;
    constraints.video.deviceId = videoSource ? {exact: videoSource} : undefined;
    
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    await gotLocalMediaStream(stream);
    await getDevices();
    
  } catch (error) {
    handleLocalMediaStreamError(error);
  }
}





/* When the openFullscreen() function is executed, open the video in fullscreen.
Note that we must include prefixes for different browsers, as they don't support the requestFullscreen method yet */
function openFullscreen(elem) {
  if (elem.requestFullscreen) {
    elem.requestFullscreen();
  } else if (elem.mozRequestFullScreen) { /* Firefox */
    elem.mozRequestFullScreen();
  } else if (elem.webkitRequestFullscreen) { /* Chrome, Safari and Opera */
    elem.webkitRequestFullscreen();
  } else if (elem.msRequestFullscreen) { /* IE/Edge */
    elem.msRequestFullscreen();
  }
  elem.controls = false;
}





// Il a different video or audio device has been selected we need
// to replace these tracks in streams to connected peers, also;
// and we need to do it ayncronously.
// Call this function passing the media connection and the new
// stream

function replaceStreamInMediaConnection(conn, stream) {
    
    
    console.log("CONNECTION:" + conn);
    
    if (!conn || typeof conn !== 'object' || !conn.open) return false;
    if (!stream || typeof stream !== 'object') return false;

    console.log("Replacing stream in media conection to [peer:" + conn.peer +  "]");

    let pc = conn.peerConnection;
    let tracks = [ stream.getVideoTracks()[0], stream.getAudioTracks()[0] ];
    
    (function() { 
        tracks.forEach((track) => {
            
            var sender = pc.getSenders().find((s) => {
                return s.track.kind == track.kind;
            });
               
            if (sender) {
                track.enabled = sender.track.enabled; // Preserve enabled status of track
                sender.replaceTrack(track); // Replace track
                console.log('Replaced ' + track.kind + ' track.');
            } else {
                console.log('No ' + track.kind + ' track found.');
            }
        });
    }) ();
    
    return true;
}




// Setup the VU-Meter

// This functions draws a bar vumeter for MediaStream stream on a canvas element elem
// options.bars: maximum bars on canvas
// options.barSepWidth: pixels separating each bar

function setVuMeter(stream, elem, options = {} ) {
    
    options = Object.assign ({type: 'dbmeter', bars: 20, barSepWidth: 1, minDecibels: -110, maxDecibels: -60 }, options);

    if (stream == null) return;

    if (! stream instanceof MediaStream) throw Error("stream is not a MediaStream");
    if (! elem instanceof HTMLCanvasElement) throw Error("elem parameter is not a canvas");
    
    if (typeof close === 'function') 

    // Check options consistency
    if (options.bars == 0) options.bars = 1
    
    var canvasCtx = elem.getContext("2d", {alpha: false});

    
    // var audioContext = new AudioContext();
console.log('VUMETER');    

    var srcNode = audioContext.createMediaStreamSource(stream); // create an audioContext source node from stream
    
    // Create an analyser to draw a waveform for audio input
    var analyser = audioContext.createAnalyser();
    
    var bufferLength = 0;
    var dataArray = [];
    
    if (options.type == 'waveform') {
        analyser.fftSize = 64;
        analyser.minDecibels = options.minDecibels; 
        analyser.maxDecibels = options.maxDecibels;
        bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
    } else if (options.type == 'dbmeter') {
        //analyser.smoothingTimeConstant = .5;
        analyser.minDecibels = options.minDecibels;
        analyser.maxDecibels = options.maxDecibels;
        //analyser.frequencyBinCount = 16;
        dataArray = new Uint8Array(1);
    } else {
        //analyser.smoothingTimeConstant = .5;
        analyser.minDecibels = options.minDecibels;
        analyser.maxDecibels = options.maxDecibels;
        //analyser.frequencyBinCount = 16;
        dataArray = new Uint8Array(1);        
    }

    // Create a zero gain node to avoid audio feedback to headphones
    var zeroGain = audioContext.createGain();
    zeroGain.gain.value = 0.0;
    
    // Create node chain 
    srcNode.connect(analyser);
    analyser.connect(zeroGain);
    zeroGain.connect(audioContext.destination);


    // Common canvas and analyser values
    
    
    // Get canvas width and height
    const w = elem.width * window.devicePixelRatio;
    const h = elem.height * window.devicePixelRatio;
    
    elem.width = w;
    elem.height = h;
    
    // Compute vertical bar width
    const barWidth = Math.ceil( (w - (options.bars-1) * options.barSepWidth) / options.bars );
    
    // Shortcuts to decibel range
    const minD = analyser.minDecibels;
    const maxD = analyser.maxDecibels;
    const rangeD = maxD - minD;
    
    
    
    // Clear canvas
    canvasCtx.clearRect(0, 0, w, h);
    
    
    // Define draw function
    var draw = null;
    
    if (options.type == 'waveform') {

        //
        // waveform meter
        //
        
        const dx = 1.0 * w / bufferLength;

        draw = () => {

            var drawVisual = requestAnimationFrame(draw);

            analyser.getByteTimeDomainData(dataArray);

            canvasCtx.fillStyle = 'rgb(255, 255, 255)';
            canvasCtx.fillRect(0, 0, w, h);

            canvasCtx.lineWidth = 2;
            canvasCtx.strokeStyle = 'rgb(0, 0, 0)';
            canvasCtx.beginPath();
            
            var x = 0;
            
            for(var i = 0; i < bufferLength; i++) {
                var v = dataArray[i] / 128.0;
                var y = v * h/2;
        
                if(i === 0) {
                    canvasCtx.moveTo(x, y);
                } else {
                    canvasCtx.lineTo(x, y);
                }
        
                x += dx;
            }
            
            canvasCtx.lineTo(w, h/2);
            canvasCtx.stroke();
        };
        

    } else if (options.type == 'dbmeter') {
        //
        // dB meter
        //

        const step = w / rangeD;
        
        
        draw = () => {
            var drawVisual = requestAnimationFrame(draw);

            analyser.getByteFrequencyData(dataArray);

            // clear canvas
            canvasCtx.fillStyle = 'rgb(240, 240, 240)'; 
            canvasCtx.fillRect(0, 0, w, h);
            

            var value = dataArray[0];
            var percent =  value / 255;
            var dB = minD + rangeD * percent; // If needed
            
            //var x = (dB - minD) * step;
            
            var x = percent * w;
            var n = Math.round(percent * options.bars);
            

            if (percent >= 0.9)
                canvasCtx.fillStyle = 'rgb(200,40,40)'; // draw in red when audio is loud
            else
                canvasCtx.fillStyle = 'rgb(40,40,150)'; // else draw in blude            
            
            for (var c = 0, i = 0; i < n; i++) {
                canvasCtx.fillRect(c, 0, barWidth - options.barSepWidth, h);
                c += barWidth + options.barSepWidth;
            }            
            
            canvasCtx.stroke();

        }
    } else {
        
        // Just display dBs
        
        draw = () => {
            var drawVisual = requestAnimationFrame(draw);

            analyser.getByteFrequencyData(dataArray);

            // clear canvas
            canvasCtx.fillStyle = 'rgb(250, 250, 250)';
            canvasCtx.fillRect(0, 0, w, h);
            // canvasCtx.clearRect(0, 0, w, h);
            

            var value = dataArray[0];
            var percent =  value / 255;
            var dB = minD + rangeD * percent; // If needed
            
            canvasCtx.font = "16px sans-serif"; 
            canvasCtx.textAlign = "center";
            canvasCtx.fillStyle = 'black';
            canvasCtx.fillText(parseFloat(dB).toFixed(1) + ' dB', w/2, h/2 + 6  );

            canvasCtx.stroke();
        }
    }
    draw();
    
    return () => {
        canvasCtx.clearRect(0, 0, w, h);
        audioContext.close();
    };
}



function setSessionMode(mode, animate = true) {
    
    mode = mode.toLowerCase();
    var icon = null;
    var color = 'white';

    switch (mode) {
    case 'briefing':
        icon = '<div class="mr-2"><i class="fas fa-bullhorn"></i></div>';
        break;
    case 'training':
        color = 'yellow';
        icon = '<i class="material-icons mr-2">record_voice_over</i>';
        break;
    default:
        mode = '';
        break;
    }
    
    if (mode) {
        
        $('#session-mode').html( icon + `${mode} mode`.toUpperCase() + '</div>' ).removeClass('hidden');
    
        if (animate) animateCSS('#session-mode', 'heartBeat');
        
        sessionMode = mode;

        logToChat(`We are in <b style="color:${color}">${sessionMode}</b> mode.`);

        // Only supervisor 
        if (myRole == RoleSupervisor) {
            if (interpreterData && interpreterData.open) {
                interpreterData.send({action: "setaudiomode", mode: mode});
                console.log('sending audiomode to interpreter');
            } else {
                console.log('data connection with interpreter has not been set yet');
            }
            if (speakerData && speakerData.open) {
                speakerData.send({action: "setaudiomode", mode:  mode});
                console.log('sending audiomode to speaker');
            } else {
                console.log('data connection with speaker has not been set yet');
            }
            if (mode === 'briefing') {
                $('#switch-roles').prop('disabled', false);
            } else {
                $('#switch-roles').prop('disabled', true);
            }            
        }
        
    } else {
    
        $('#session-mode').html( '' ).addClass('hidden');
        
    }
}

// Sets the MediaStream as the video element src.
function gotLocalMediaStream(mediaStream) {

    // Save local microphone and camera status
    micEnabled = isMicEnabled();
    if (micEnabled === null) {
        switch(myRole) {
        case RoleSpeaker:
            micEnabled = !speakerAudioMutedDefault;
            break;
        case RoleSupervisor:
            micEnabled = !supervisorAudioMutedDefault;
            break;
        case RoleInterpreter:
            micEnabled = !interpreterAudioMutedDefault;
            break;
        }
    }
    camEnabled = isCamEnabled() !== false;
    
    window.stream = mediaStream; // make stream available to console0 
    
    localVideo.srcObject = mediaStream;
    localStream = mediaStream;
    micStream = mediaStream;
    
    localVideo.play();
    localVideo.muted = true;
    
    localVideo.onloadedmetadata = function(e) {
        localVideo.play();
        localVideo.muted = true;
    }
    
    // Display vumeter
    setVuMeter(mediaStream, micGraph, {bars: 16});

    
    console.log('Received local stream.');
    
    // Il a different video or audio device has been 
    // selected we need to replace these tracks in 
    // streams to to connected peers, also;    
    if (myRole != RoleSpeaker)     replaceStreamInMediaConnection(speakerMedia, mediaStream);
    if (myRole != RoleInterpreter) replaceStreamInMediaConnection(interpreterMedia, mediaStream);
    if (myRole != RoleSupervisor)  replaceStreamInMediaConnection(supervisorMedia, mediaStream);

    // Restore local microphone and camera status
    enableMic(micEnabled);
    enableCam(camEnabled);        
    
    // Pass argument to next element in promise chain
    return navigator.mediaDevices.enumerateDevices();  
}

// Handles error by logging a message to the console.
function handleLocalMediaStreamError(error) {
  console.error(`navigator.getUserMedia error: ${error.toString()}.`);
}










