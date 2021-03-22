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


var hideLogPanelInterval = 1;

setInterval(function(){
   if(hideLogPanelInterval == 10){
       $('#log-panel').fadeOut(1000); 
       hideLogPanelInterval = 1;
   }
   hideLogPanelInterval++;
},1000);
    
function logToPanel(m, c = "info", l = false) {
    
    if (l) $('#login-status').html(m);

    $('#log-panel').fadeOut(150, function() {
        $('#log-text').html(m);
        $('#log-panel').removeClass("alert-warning alert-success alert-danger alert-info alert-primary alert-secondary alert-success alert-clear alert-dark");
        $('#log-panel').addClass("alert-" + c);
    }).fadeIn(150).delay(300);

    hideLogPanelInterval = 1;  
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
    if (typeof localStream !== 'object') return null;
    
    const tracks = localStream.getAudioTracks();
    // if MediaStream has reference to track
    if (tracks[0]) {
        tracks[0].enabled = v;
        return v;
    }
    return null;
}

function enableCam(v) {
    if (typeof localStream !== 'object') return null;
    
    const tracks = localStream.getVideoTracks();
    // if MediaStream has reference to track
    if (tracks[0]) {
        tracks[0].enabled = v;
        return v;
    }
    return null;
}

function toggleMic() {
    if (typeof localStream !== 'object') return null;
    
    const tracks = localStream.getAudioTracks();
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
    if (typeof localStream !== 'object') return null;
    return localStream.getAudioTracks()[0].enabled;
}

/*
function vuMeter(analyser, qvumeter, qled) {
      
    var w = $(qvumeter).width();
    var h = $(qvumeter).height();
    
    var data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    
    var values = 0;
    
    var length = data.length;
    for (var i = 0; i < length; i++) {
      values += (data[i]);
    }
    
    var average = values / (length);
    
    (function (vol) {
      let all_pids = $(qled);
    
      let amout_of_pids = Math.round(vol/10);
      let elem_range = all_pids.slice(0, amout_of_pids)
      for (var i = 0; i < all_pids.length; i++) {
        all_pids[i].style.backgroundColor="#e6e7e8";
      }
      for (var i = 0; i < elem_range.length; i++) {
        // console.log(elem_range[i]);
        elem_range[i].style.backgroundColor="#69ce2b";
      }
    })(average * 2.5);
}
*/

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
    window.addEventListener('beforeunload', function (e) {
        
        e.preventDefault(); // Cancel the event
        
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
        setTimeout(function() {
            closeAllConnections();
            e.returnValue = true; // Chrome requires returnValue to be set
        }, 1000);
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


function resetConnection(role, t = 0) {
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
}

// Close all data/media connections, streams and reset handlers
function closeAllConnections(t = 0) {
    
    if (myPeer)
        console.log("peer disconnected:", myPeer.disconnected);
    else
        console.log("peer was not connected");
    
    setTimeout(function() {  
        if (speakerData && speakerData.open) speakerData.close();
        speakerData = null;
        speakerMedia = null;
        if (speakerMedia && speakerMedia.open) speakerMedia.close();
        if (interpreterData && interpreterData.open) interpreterData.close();
        if (interpreterMedia && interpreterMedia.open) interpreterMedia.close();
        interpreterData = null;
        interpreterMedia = null;
        if (supervisorData && supervisorData.open) supervisorData.close();
        if (supervisorMedia && supervisorMedia.open) supervisorMedia.close();
        supervisorData = null;
        supervisorMedia = null;
        
        if (myPeer) myPeer.destroy(); // ==> fires myPeer.close
        initMuted();
    }, t);
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
        $(e + ' > i').removeClass('fa-volume-up fa-volume-mute').addClass(muted ? 'fa-volume-up' : 'fa-volume-mute');
        //$(e).html('<i class="fas ' + (muted ? 'fa-volume-up' : 'fa-volume-mute') + ' fa-lg"></i>');
    }
    
}

function initMuted() {
    muteMicrophone(RoleInterpreter, interpreterAudioMutedDefault);
    muteMicrophone(RoleSpeaker, speakerAudioMutedDefault);
    muteMicrophone(RoleSupervisor, supervisorAudioMutedDefault);
}

function _setMuted(role, value) {
    var h = '<i class="fas ' + (value ? 'fa-volume-up' : 'fa-volume-mute') + ' fa-lg"></i></label>';
    
    switch (role) {
    case RoleInterpreter:
        $('#interpreter-audio-toggle').html(h);
        break;
    case RoleSpeaker:
        $('#speaker-audio-toggle').html(h);
        break;
    case RoleSupervisor:
        $('#supervisor-audio-toggle').html(h);
        break;
    }
}


function loadClock() {
    updateClock();
    setInterval(updateClock, 1000);
}




function updateClock(){
    
    var dt = getDateTime();
    
    $('#date').text(dt.date);
    $('#hours').text(dt.hours);
    $('#minutes').text(dt.minutes);
    $('#seconds').text(dt.seconds);
} 

function loadAndPlay(tunePath, loop = false) {
    var ctx = new AudioContext(),
        req = new XMLHttpRequest();
    
    req.open("GET", tunePath, true);
    req.responseType = "arraybuffer";
    req.onload = function() {
        ctx.decodeAudioData(req.response, onDecoded);
    }
    
    function onDecoded(buffer) {
        var node = ctx.createBufferSource();
        node.buffer = buffer;
        node.connect(ctx.destination);
        node.loop = loop;
        node.start();
    }
    console.log("Play", tunePath);
    req.send();
};


// Il a different video or audio device has been selected we need
// to replace these tracks in streams to connected peers, also;
// and we need to do it ayncronously.
// Call this function passing the media connection and the new
// stream

function replaceStreamInMediaConnection(conn, stream) {
    
    if (!conn || typeof conn !== 'object' || !conn.open) return false;
    if (!stream || typeof stream !== 'object') return false;

    console.log("Replacing stream in media conection to [peer:" + conn.peer +  "]  (" + conn.options.metadata.role + ")");
   
    let pc = conn.peerConnection;
    let tracks = [ stream.getVideoTracks()[0], stream.getAudioTracks()[0] ];
    
    (function() { 
        tracks.forEach(function(track) {
            var sender = pc.getSenders().find(function(s) {
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




function setUserMediaConstraints() {

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
  
  navigator.mediaDevices.getUserMedia(constraints)
           .then(gotLocalMediaStream)
           .then(gotDevices)
           .catch(handleLocalMediaStreamError);
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
