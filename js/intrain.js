/* Load after common.js */

// Escape text received from a peer before inserting it into HTML-based chat UI.

/*
 * Only complete HTTPS links are accepted; bare IDs are deliberately rejected.
 * A syntactically valid link can still refer to an unavailable video.
 */
function validateVideoURL(value) {
    const invalid = error => ({valid: false, error});
    const valueText = String(value || '').trim();
    let url;

    if (!valueText) return invalid('Enter a complete YouTube, Vimeo or Facebook video URL.');
    try {
        url = new URL(valueText);
    } catch (error) {
        return invalid('Invalid video URL: include https:// and the video address.');
    }

    if (url.protocol !== 'https:' || url.username || url.password || url.port) {
        return invalid('Use an HTTPS video URL without credentials or a custom port.');
    }

    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const path = url.pathname.split('/').filter(Boolean);
    const isYouTube = ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'youtu.be'].includes(host);

    if (isYouTube) {
        let id = '';
        if (host === 'youtu.be' && path.length === 1) id = path[0];
        else if (path[0] === 'watch' && path.length === 1) id = url.searchParams.get('v') || '';
        else if (['embed', 'shorts', 'live'].includes(path[0]) && path.length === 2) id = path[1];
        if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) {
            return invalid('Invalid YouTube link: use a complete video URL with an 11-character ID.');
        }
        return {valid: true, provider: 'youtube', url: 'https://www.youtube.com/watch?v=' + id};
    }

    if (['vimeo.com', 'player.vimeo.com'].includes(host)) {
        let id = '';
        if (host === 'player.vimeo.com' && path[0] === 'video' && path.length === 2) id = path[1];
        else if (host === 'vimeo.com') {
            if (path.length === 1) id = path[0];
            else if (path[0] === 'channels' && path.length === 3) id = path[2];
            else if (path[0] === 'groups' && path[2] === 'videos' && path.length === 4) id = path[3];
        }
        if (!/^\d{1,12}$/.test(id)) {
            return invalid('Invalid Vimeo link: use a complete URL containing the numeric video ID.');
        }
        return {valid: true, provider: 'vimeo', url: url.href};
    }

    // Keep full Facebook video links supported by the previous player.
    if (['facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.watch'].includes(host)) {
        const watch = path[0] === 'watch' && /^\d+$/.test(url.searchParams.get('v') || '');
        const reel = path[0] === 'reel' && /^\d+$/.test(path[1] || '');
        const video = path.includes('videos') && /^\d+$/.test(path[path.length - 1] || '');
        const short = host === 'fb.watch' && path.length === 1 && /^[\w-]+$/.test(path[0]);
        if (watch || reel || video || short) return {valid: true, provider: 'facebook', url: url.href};
        return invalid('Invalid Facebook video link.');
    }

    return invalid('Unsupported video URL. Use YouTube, Vimeo or Facebook.');
}

function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
}

function logToChat(m, w = "", color = "#475569") {
    // Color the sender only; the message inherits the chat panel's dark text color.
    var t = "";

    if (w != '') {
        t = "<span><strong style='color: " + color + ";'>" + escapeHTML(w) + "</strong>: " + m + "<br/></span>";
    } else {
        t = "<span>" + m + "<br/></span>";
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
  // A role belongs to one Peer ID; a second caller must not hijack its media.
  const knownPeer = role === RoleSpeaker ? speakerPeer :
                    role === RoleInterpreter ? interpreterPeer : supervisorPeer;
  if (knownPeer && knownPeer !== c.peer) return false;
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
    if ((interpreterData && interpreterData.open && role == RoleInterpreter) ||
        (speakerData && speakerData.open && role == RoleSpeaker) ||
        (supervisorData && supervisorData.open && role == RoleSupervisor)) {
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
        if (speakerPeer != null && speakerPeer != c.peer) {
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
    
    var role = c.options?.metadata?.role;
    
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
        logToChat("<b>" + escapeHTML(role) + "</b> has joined us");

        return true;
    } else {
        console.warn("Connection refused: ", err.message);
        return false;
    }
}


function enableMic(v) {
    if (!micStream || typeof micStream.getAudioTracks !== 'function') return null;
    
    const tracks = micStream.getAudioTracks();
    // if MediaStream has reference to track
    if (tracks[0]) {
        tracks[0].enabled = v;
        return v;
    }
    return null;
}

function enableCam(v) {
    if (!micStream || typeof micStream.getVideoTracks !== 'function') return null;
    
    const tracks = micStream.getVideoTracks();
    // if MediaStream has reference to track
    if (tracks[0]) {
        tracks[0].enabled = v;
        return v;
    }
    return null;
}

function toggleMic() {
    if (!micStream || typeof micStream.getAudioTracks !== 'function') return null;
    
    const tracks = micStream.getAudioTracks();
    // if MediaStream has reference to track
    if (tracks[0]) {
        tracks[0].enabled = !tracks[0].enabled;
        return tracks[0].enabled;
    }
    return null;
}

function toggleCam() {
    // The speaker's camera control must never disable a shared desktop track.
    const cameraStream = micStream || localStream;
    if (!cameraStream || typeof cameraStream.getVideoTracks !== 'function') return null;
    
    const tracks = cameraStream.getVideoTracks();
    // if MediaStream has reference to track
    if (tracks[0]) {
        tracks[0].enabled = !tracks[0].enabled;
        return tracks[0].enabled;
    }
    return null;
}

function isCamEnabled() {
    const cameraStream = micStream || localStream;
    if (!cameraStream || typeof cameraStream.getVideoTracks !== 'function') return null;
    return cameraStream.getVideoTracks()[0]?.enabled ?? null;
}

function isMicEnabled() {
    if (!micStream || typeof micStream.getAudioTracks !== 'function') return null;
    return micStream.getAudioTracks()[0]?.enabled ?? null;
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
            
            logToChat(escapeHTML($(this).val()), "me", myColor);
            
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
        this.value = ''; // Allow selecting the same file again.
    });
    
    // Send a file to all peers
    $('#send-file-to-all').on("change", function(e) {
        console.log("Sending a file to everybody");
        sendFilesToDataChannel(interpreterData, e.target.files);
        sendFilesToDataChannel(speakerData,     e.target.files);
        sendFilesToDataChannel(supervisorData,  e.target.files);
        this.value = ''; // Allow selecting the same file again.
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


    // Map login form submit action to to "join" button
    $("#login-form").on("submit", function(event) {
        event.preventDefault();
        $("#join-button").trigger("click");
        return false;
    });
    
    
    // beforeunload cannot wait for Promises or timers. Signal peers and close synchronously.
    window.addEventListener('pagehide', function () {
        for (const connection of [supervisorData, speakerData, interpreterData]) {
            if (connection && connection.open) {
                try { connection.send({action: 'leaving', message: 'bye'}); }
                catch (error) { console.warn('Could not send leaving notification', error); }
            }
        }
        closeAllConnections();
    });

    addCopyright();
}

function sendFilesToDataChannel(datachannel, file_or_file_list) {
    return InTrainFileTransfer.sendFiles(datachannel, file_or_file_list);
}
function getFileDownloadLinkFromData(data) {
    var html = null;
    if (typeof data === "object") {
        var name = data.filename;
        if (typeof name === 'string' && data.file instanceof ArrayBuffer) {
            var dataView = new Uint8Array(data.file);
            var blob = new Blob([dataView]);
            const safeName = escapeHTML(name);
            html = "<a href='" + URL.createObjectURL(blob) + "' download='" + safeName + "'>" + safeName + "</a>";
        }
    }
    return html;
}

// Keep the supervisor's secondary floor (screen or file) selected while speaker
// media connects or disconnects; volume stays on the same playback element.
function refreshSpeakerVideoSource() {
    if (!speakerVideo) return;
    const screenIsActive = !!screenshareMediaStream &&
        (myRole === RoleSupervisor ? sharingScreenActive : myRole === RoleInterpreter);
    const stream = (screenIsActive ? screenshareMediaStream : speakerMediaStream) || null;
    if (speakerVideo.srcObject !== stream) speakerVideo.srcObject = stream;
    speakerVideo.muted = myRole === RoleSupervisor || (!screenIsActive && speakerAudioMuted);
}

// PeerJS exposes `open` as an inherited getter. Never use hasOwnProperty('open').
// close() is synchronous; awaiting a `close` event can hang for already closed calls.
function closePeerConnection(connection) {
    if (!connection || typeof connection.close !== 'function') return;
    try {
        connection.close();
    } catch (error) {
        console.warn('Failed to close PeerJS connection', error);
    }
}

async function resetConnection(role, t = 0) {
    if (t > 0) await new Promise(resolve => setTimeout(resolve, t));
    console.log(role + ' is leaving, resetting connection.');

    switch (role) {
    case RoleInterpreter: {
        const data = interpreterData, media = interpreterMedia;
        interpreterData = interpreterMedia = interpreterMediaStream = null;
        interpreterPeer = null;
        if (interpreterVideo) interpreterVideo.srcObject = null;
        closePeerConnection(data);
        closePeerConnection(media);
        break;
    }
    case RoleSpeaker: {
        const data = speakerData, media = speakerMedia;
        speakerData = speakerMedia = speakerMediaStream = null;
        speakerPeer = null;
        refreshSpeakerVideoSource();
        closePeerConnection(data);
        closePeerConnection(media);
        break;
    }
    case RoleSupervisor: {
        const data = supervisorData, media = supervisorMedia;
        supervisorData = supervisorMedia = supervisorMediaStream = null;
        supervisorPeer = null;
        if (supervisorVideo) supervisorVideo.srcObject = null;
        closePeerConnection(data);
        closePeerConnection(media);
        break;
    }
    default:
        return;
    }
    muteMicrophone(role, role === RoleSpeaker ? speakerAudioMutedDefault :
                         role === RoleInterpreter ? interpreterAudioMutedDefault :
                         supervisorAudioMutedDefault);
}

async function closeAllConnections(t = 0) {
    if (t > 0) await new Promise(resolve => setTimeout(resolve, t));
    // End local desktop capture when the speaker leaves the session.
    if (myRole === RoleSpeaker && typeof stopSpeakerScreenShare === 'function') {
        await stopSpeakerScreenShare(false);
    }
    const connections = [speakerData, speakerMedia, interpreterData,
                         interpreterMedia, supervisorData, supervisorMedia,
                         screenshareConnection];
    speakerData = speakerMedia = speakerMediaStream = speakerPeer = null;
    interpreterData = interpreterMedia = interpreterMediaStream = interpreterPeer = null;
    supervisorData = supervisorMedia = supervisorMediaStream = supervisorPeer = null;
    screenshareConnection = null;
    for (const connection of connections) closePeerConnection(connection);
    if (myPeer && !myPeer.destroyed) {
        try { myPeer.destroy(); }
        catch (error) { console.warn('Failed to destroy peer', error); }
    }
    peerConnected = false;
    initMuted();
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
        if (calleeRole === RoleSpeaker && speakerData === c) resetConnection(calleeRole);
        if (calleeRole === RoleInterpreter && interpreterData === c) resetConnection(calleeRole);
        if (calleeRole === RoleSupervisor && supervisorData === c) resetConnection(calleeRole);
    });
    c.on('error', function(e) {
        console.error('Error', e, 'in data connection to', calleeRole);
    });
    
    // video call
    m = myPeer.call(calleeID, localStream, { metadata: {role: callerRole} } );
    m.on('stream', function(mediaStream) {
        // `stream` is the mediaStream of the remote peer.
        // Here you'd add it to an HTML video/canvas element.
        
        s = mediaStream;
        if (calleeRole === RoleSpeaker) {
            speakerMediaStream = mediaStream;
            refreshSpeakerVideoSource();
        } else {
            v.srcObject = mediaStream;
            if (calleeRole === RoleInterpreter) interpreterMediaStream = mediaStream;
            else if (calleeRole === RoleSupervisor) supervisorMediaStream = mediaStream;
        }

        //v.play();
        //v.muted = (callerRole == RoleSpeaker && calleeRole == RoleInterpreter);
        
        v.onloadedmetadata = function(e) {
            v.play();
            if (calleeRole === RoleSpeaker) refreshSpeakerVideoSource();
            else v.muted = false;
        }
    });
    m.on('close', function() {
        console.log(calleeRole + ' media connection closed');
        if (calleeRole === RoleSpeaker && speakerMedia === m) resetConnection(calleeRole);
        if (calleeRole === RoleInterpreter && interpreterMedia === m) resetConnection(calleeRole);
        if (calleeRole === RoleSupervisor && supervisorMedia === m) resetConnection(calleeRole);
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
function handleChat(data, callerRole, callerColor, connection = null) {
    // The transfer manager consumes chunk messages without logging file contents.
    if (InTrainFileTransfer.receive(connection, data, callerRole)) return;

    var action = (typeof data === "object") ? data.action : "chat";
    switch (action) {
    case 'chat':
        logToChat(escapeHTML(data.message), callerRole, callerColor);
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
    // This function mutes local playback of a remote participant, not their
    // transmitted microphone. An embedded floor must exclude the live speaker
    // even if a briefing/training change tries to restore participant audio.
    if (myRole === RoleInterpreter && role === RoleSpeaker &&
        typeof showPlayer !== 'undefined' && showPlayer) muted = true;
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

        $(e + ' > i').removeClass('fa-volume-up fa-volume-mute').addClass(muted ? 'fa-volume-mute' : 'fa-volume-up');

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


// Audio can be attached to an existing player and played
// on the preferred device
function loadAndPlay(tunePath,  sinkId = null) {

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
        
        // Notifications use the same final listening level as conversation audio.
        const output = audioContext.createMediaStreamDestination();
        node.connect(output);
        const player = new Audio();
        player.srcObject = output.stream;
        if (typeof InTrainHeadphones !== 'undefined') InTrainHeadphones.registerOutput(player);
        node.onended = () => {
            player.pause();
            if (typeof InTrainHeadphones !== 'undefined') InTrainHeadphones.unregisterOutput(player);
            node.disconnect();
            output.stream.getTracks().forEach(track => track.stop());
            player.srcObject = null;
        };
        const ready = sinkId && typeof player.setSinkId === 'function'
            ? player.setSinkId(sinkId).catch(error => console.warn('Using default notification output', error))
            : Promise.resolve();
        ready.then(() => player.play()).then(() => {
            node.loop = false;
            node.start();
        }).catch(error => {node.onended(); console.warn('Cannot play notification', error);});
    }

    req.send();
};


async function setUserMediaConstraints() {
    // Replacing capture devices during a shared-screen session would overwrite
    // its outgoing video track. Leave the existing capture intact in that case.
    if (myRole === RoleSpeaker && sharingScreenActive) {
        logToPanel('Stop screen sharing before changing camera or microphone.', 'warning');
        return false;
    }

    const videoSource = $('#select-video-source').val();
    const audioSource = $('#select-audio-source').val();
    const baseConstraints = myRole === RoleInterpreter ? InterpreterMediaStreamConstraints :
                            myRole === RoleSpeaker ? SpeakerMediaStreamConstraints :
                            SupervisorMediaStreamConstraints;
    const constraints = {
        audio: {...baseConstraints.audio, deviceId: audioSource && audioSource !== 'default'
                    ? {exact: audioSource} : undefined},
        video: {...baseConstraints.video, deviceId: videoSource && videoSource !== 'default'
                    ? {exact: videoSource} : undefined}
    };
    const oldStream = micStream;
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        await gotLocalMediaStream(stream);
        if (oldStream && oldStream !== stream) {
            oldStream.getTracks().forEach(track => track.stop());
        }
        await getDevices();
        return true;
    } catch (error) {
        // A failed selection must not leave the previous working stream stopped.
        if (stream && stream !== oldStream) stream.getTracks().forEach(track => track.stop());
        if (oldStream) {
            await Promise.allSettled([speakerMedia, interpreterMedia, supervisorMedia]
                .map(conn => replaceStreamInMediaConnection(conn, oldStream)));
        }
        handleLocalMediaStreamError(error);
        return false;
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

async function replaceStreamInMediaConnection(conn, stream, preserveMute = true) {
    if (!conn || !conn.open || !conn.peerConnection || !stream) return false;

    const pc = conn.peerConnection;
    const senders = pc.getSenders();
    const replacements = [];
    for (const track of stream.getTracks()) {
        const sender = senders.find(s => s.track && s.track.kind === track.kind);
        if (!sender) continue;
        // Preserve the user's mute/camera preferences across device changes.
        if (preserveMute) track.enabled = sender.track.enabled;
        replacements.push(sender.replaceTrack(track));
    }
    await Promise.all(replacements);
    return true;
}


// Setup the VU-Meter

// This functions draws a bar vumeter for MediaStream stream on a canvas element elem
// options.bars: maximum bars on canvas
// options.barSepWidth: pixels separating each bar

function setVuMeter(stream, elem, options = {} ) {
    
    options = Object.assign ({type: 'dbmeter', bars: 20, barSepWidth: 1, minDecibels: -110, maxDecibels: -60 }, options);

    if (stream == null) return;

    if (!(stream instanceof MediaStream)) throw Error('stream is not a MediaStream');
    if (!(elem instanceof HTMLCanvasElement)) throw Error('elem parameter is not a canvas');


    // Check options consistency
    if (options.bars == 0) options.bars = 1
    
    var canvasCtx = elem.getContext("2d", {alpha: false});

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
    const w = Math.round((elem.clientWidth || elem.width) * (window.devicePixelRatio || 1));
    const h = Math.round((elem.clientHeight || elem.height) * (window.devicePixelRatio || 1));
    
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
    let frameId = null;
    let stopped = false;
    const scheduleFrame = () => { if (!stopped) frameId = requestAnimationFrame(draw); };
    
    if (options.type == 'waveform') {

        //
        // waveform meter
        //
        
        const dx = 1.0 * w / bufferLength;

        draw = () => {

            scheduleFrame();

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
            scheduleFrame();

            analyser.getByteFrequencyData(dataArray);

            // clear canvas
            canvasCtx.fillStyle = 'rgb(240, 240, 240)'; 
            canvasCtx.fillRect(0, 0, w, h);
            

            var value = dataArray[0];
            var percent =  value / 255;
            var dB = minD + rangeD * percent; // If needed

            
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
            scheduleFrame();

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
        stopped = true;
        if (frameId !== null) cancelAnimationFrame(frameId);
        srcNode.disconnect();
        analyser.disconnect();
        zeroGain.disconnect();
        canvasCtx.clearRect(0, 0, w, h);
    };
}


function setSessionMode(mode, animate = true) {
    
    mode = mode.toLowerCase();
    var icon = null;
    var color = '#475569';

    switch (mode) {
    case 'briefing':
        icon = '<i class="fas fa-bullhorn session-mode-icon me-2" aria-hidden="true"></i>';
        break;
    case 'training':
        color = '#946200';
        icon = '<span class="material-font session-mode-icon me-2" aria-hidden="true">record_voice_over</span>';
        break;
    default:
        mode = '';
        break;
    }

    if (mode) {
        // Both icons use the same spacing. Keep the Material Symbols ligature
        // in its own element so uppercasing the label cannot change its name.
        $('#session-mode').html(icon + '<span>' + (mode + ' mode').toUpperCase() + '</span>')
            .removeClass('hidden');
    
        if (animate) animateCSS('#session-mode', 'heartBeat');
        
        sessionMode = mode;

        // Bootstrap 5 no longer manages the former nested radio-button group.
        // Keep its two existing activity buttons synchronized with session mode.
        if (myRole === RoleSupervisor) {
            $('#briefing-mode').toggleClass('active', mode === 'briefing')
                .attr('aria-pressed', String(mode === 'briefing'));
            $('#training-mode').toggleClass('active', mode === 'training')
                .attr('aria-pressed', String(mode === 'training'));
        }

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
let stopLocalVuMeter = null;

async function gotLocalMediaStream(mediaStream) {

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
    
    // Do not publish the new local stream until all existing senders accept it.
    await Promise.all([speakerMedia, interpreterMedia, supervisorMedia]
        .map(conn => replaceStreamInMediaConnection(conn, mediaStream)));

    window.stream = mediaStream; // accessible for debugging
    localVideo.srcObject = mediaStream;
    localStream = mediaStream;
    micStream = mediaStream;
    
    localVideo.play();
    localVideo.muted = true;
    
    localVideo.onloadedmetadata = function(e) {
        localVideo.play();
        localVideo.muted = true;
    }
    
    // Stop the previous animation and disconnect its Web Audio graph.
    if (stopLocalVuMeter) stopLocalVuMeter();
    stopLocalVuMeter = setVuMeter(mediaStream, micGraph, {bars: 16});

    
    console.log('Received local stream.');
    
    // Il a different video or audio device has been 
    // selected we need to replace these tracks in 
    // streams to to connected peers, also;    
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


