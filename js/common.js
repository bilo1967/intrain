/* Load before config.js */

const appName           = "inTrain";
const appVersion        = "1.2.0";
const appAuthor         = "Gabriele Carioli";
const appCompany        = "Dipartimento di Interpretazione e Traduzione &ndash; Universit&agrave; di Bologna &ndash; Campus di Forl&igrave;";
const appLicense        = 'Available under <a target="_blank" href="https://www.gnu.org/licenses/agpl-3.0.html">AGPL v3</a> license (see <a href="credits" target="_blank">credits</a>)';
const appLicenseCompact = 'License: <a target="_blank" href="https://www.gnu.org/licenses/agpl-3.0.html">AGPLv3</a> &ndash; Credits: <a href="credits" target="_blank">credits</a>';

const appCredits        = null;

const appCopyright      = null;




const RoleInterpreter = "interpreter";
const RoleSpeaker     = "speaker";
const RoleSupervisor  = "supervisor";
const RoleScreenShare = "screenshare"; // supervisor second stream...

const ColorInterpreter = "#2459A2";
const ColorSpeaker     = "#176C46";
const ColorSupervisor  = "#475569";

var myRole;
var myColor;

var userName;
var userID;

var peerConnected = false;
var peerError     = false;


var sessionMode = 'briefing';  // Session mode indicator (briefing / training)

var roleSwitching = false;

var audioContext = null;







// This code is common
// one of these three sets of variables won't be used
var myPeer                 = null;
var interpreterPeer        = null; // Interpreter peer id
var interpreterData        = null; // Interpreter data connection handle
var interpreterMedia       = null; // Interpreter media connection handle
var interpreterMediaStream = null; // Interpreter media stream
var speakerPeer            = null; // Speaker peer id
var speakerData            = null; // Speaker data connection handle
var speakerMedia           = null; // Speaker media connection handle
var speakerMediaStream     = null; // Speaker media stream
var supervisorPeer         = null; // Supervisor peer id
var supervisorData         = null; // Supervisor data connection handle
var supervisorMedia        = null; // Supervisor media connection handle
var supervisorMediaStream  = null; // Supervisor media stream

// Screen share controls
var screenshareConnection  = null; // Supervisor media connection handle
var screenshareMediaStream = null; // Supervisor screen share media stream
var sharingScreenActive    = false; 


// Default settings for role peers audio
// Settings are different for each role and any module should
// set them properly
var speakerAudioMutedDefault     = false;
var interpreterAudioMutedDefault = false;
var supervisorAudioMutedDefault  = false;

// Actual settings for role peers audio
var supervisorAudioMuted  = false;
var speakerAudioMuted     = false;
var interpreterAudioMuted = false;


var speakerVideo;
var interpreterVideo;
var supervisorVideo;
var localVideo;
var localStream;
var micStream; // Usually an alias of localStream, except for speaker when sharing screen

// Player
var myVideoPlayer = null;
var myVideoMediaElement = null;


// Dynamic audio element used to actually play audio
var audioOutputElement = null; 


const SpeakerPeerOptions = {
    metadata: {role: RoleSpeaker }
};

const InterpreterPeerOptions = {
    metadata: {role: RoleInterpreter }
};

const SupervisorPeerOptions = {
    metadata: {role: RoleSupervisor }
};



/*
 * WARNING: when debugging on a single PC,
 * you cannot use different constraints for 
 * the same webcam at the same time
 */

const SupervisorMediaStreamConstraints = {
  video: {
    width: 640,
    height: 400,
    //aspectRatio: 1.777777778,  
  },
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: false,
  }
}

const SpeakerMediaStreamConstraints = {
  video: {
    width: 640,
    height: 400,
    //aspectRatio: 1.777777778,  
  },
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: false,
  }
};

const InterpreterMediaStreamConstraints = {
  video: {
    width: 640,
    height: 400,
    //aspectRatio: 1.777777778,  
  },
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: false,
  }
};



// Sistema il warning per gli elementi aria-hidden che hanno
// un discendente attivo (bootbox e modal)
$(document).on('hide.bs.modal', '.bootbox', function() {
    if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur(); // Forces focus removal
    }
});
$(document).on('hide.bs.modal', '.modal', function() {
    if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur(); // Forces focus removal
    }
});
