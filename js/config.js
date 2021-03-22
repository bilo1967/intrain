/*
 * Configuration options
 */

// PeerJS client config

// DITLab server
const PeerJSConfig = {
    debug: 2,
    secure: true,

    path: '/',
    host: 'own-peerjs-server.herokuapp.com',
    port: 443, // <= TCP

    config: {
        'iceServers': [
            { urls: 'stun:intrain.ditlab.it:3478'   }, // <= UDP
            { urls: 'stun:stun.l.google.com:19302'  }, // <= UDP
//          { urls: 'turn:numb.viagenie.ca', username: 'webrtc@live.com', credential: 'muazkh'},
        ]
    }
};



// Default public server 
//var PeerJSConfig = {};


// Wait this time (in ms) before closing
// connection to allow error messages to
// be delivered
const WaitBeforeClose = 500; // in milliseconds
