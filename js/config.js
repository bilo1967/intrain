/*
 * Configuration options
 */

// PeerJS client config

// PeerJS server configuration, with ICE servers
const PeerJSConfig = {
    debug: 2,
    secure: true,

    path: '/',
    host: 'peerjs2.ditlab.it',
    port: 443, // <= TCP

    //path: '/',
    //host: 'own-peerjs-server.herokuapp.com',
    //port: 443, // <= TCP

    /*
     * You can test if yout TURN relays are working using Firefox.
     *
     * Open link:  about:config
     * Search for: media.peerconnection.ice.relay_only
     * Set it to:  true
     */
    config: {
        'iceServers': [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }, // <= UDP
            {
                urls: 'turns:ice.ditlab.it:443',
                username: 'SET_AT_DEPLOYMENT',
                credential: 'SET_AT_DEPLOYMENT',
            },
            {
                urls: 'turns:ice2.ditlab.it:5349',
                username: 'SET_AT_DEPLOYMENT',
                credential: 'SET_AT_DEPLOYMENT',
            },
        ]
    }
};



// Default public server 
//var PeerJSConfig = {};


// Wait this time (in ms) before closing
// connection to allow error messages to
// be delivered
const WaitBeforeClose = 500; // in milliseconds
