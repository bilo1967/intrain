# inTrain

## Disclaimer

This code is still full of commented parts and debugging instructions and needs to be cleaned up. Also, some of the internal documentation is still in Italian and needs to be translated. Use it at your own risk. We do not take any responsibility for any kind of damage it might cause. That said, once you meet the prerequisites and edit the configuration files accordingly, inTrain should work as is. Please, read the License section below before downloading inTrain.

## What is inTrain and how it works

inTrain (which stands for _INterpreter TRAINing_) is a [WebRTC](https://webrtc.org/) based platform for conference interpreter training, conceived and developed for the Department of Interpretation and Translation (DIT) at the University of Bologna by Gabriele Carioli and Nicoletta Spinolo.

The system connects a supervisor (instructor), an interpreter and a speaker.

inTrain WebRTC connections are peer-to-peer. There's a single audio/video WebRTC connection between the supervisor and the speaker, the supervisor and the interpreter, the speaker and the interpreter. .

## Prerequisites

- A working [PeerJS server](https://github.com/peers/peerjs-server). See [README-PEERJS.md](/README-PEERJS.md) for a hint.
- One or more STUN servers; you may use a free existing one or setup your own (e.g. [CoTURN](https://github.com/coturn/coturn)).
- One or more TURN servers; you may buy access to an existing one or set up your own (e.g. [CoTURN](https://github.com/coturn/coturn) or [eTURNal](https://eturnal.net/)). You may try without a TURN server but users behind a symmetrical NAT won't be able to use inTrain.
- A web server supporting HTTPS and URL rewriting to host your inTrain installation. No server-side scripting is needed. Here I refer to Apache but any other modern web server should be fine.

Having a [PeerJS server](https://github.com/peers/peerjs-server) is mandatory. The PeerJS server lets users find each other by keeping track of their connection status. It basically just stores usernames and IP addresses of connected users. No peer-to-peer data is routed through the server, which acts only as a connection broker. Therefore it generates very low network traffic and workload for your hardware and infrastructure. The authors of PeerJS offer free access to their PeerJS server, but many people use it and you may find it busy: you'll likely need to deploy your own. See [README-PEERJS.md](/README-PEERJS.md) for a quick start guide.

STUN, TURN (and ICE) are a set of IETF standard protocols for negotiating traversing NATs when establishing peer-to-peer communication sessions. WebRTC and other VoIP stacks implement support for ICE to improve the reliability of IP communications. The PeerJS library used by inTrain makes it's ICE (Interactive Connectivity Establishment) implementation by coordinating STUN and TURN to make a connection between hosts. A host uses Session Traversal Utilities for NAT (STUN) to discover its public IP address when it is located behind a NAT/Firewall. When this host wants to receive an incoming connection from another party, it provides this public IP address as a possible location where it can receive a connection. If the NAT/Firewall still won't allow the two hosts to connect directly, they make a connection to a server implementing Traversal Using Relay around NAT (TURN), which will relay media between the two parties. 

A STUN server may be enough for testing purposes but you'll definitely also need a TURN server in a production environment.

You can find plenty of free STUN servers. Google provides at least a dozen for free and a few of them are already configured in `config.js` (see below). A TURN server, on the other hand, may have a heavy bandwidth impact on your infrastructure. You may find a free one but it will likely have strong bandwidth restrictions, making it a non viable solution. You need either a commercial TURN service ([Metered.Ca](https://www.metered.ca/tools/openrelay/), for example, lets you try a free fully functional TURN server with the only limitation of 500Mb of montly traffic, which is enough for testing) or to set up your own. [CoTURN](https://github.com/coturn/coturn) is an excellent open source TURN (and STUN) implementation, available on most linux distributions. [eTURNal](https://eturnal.net/) is also an excellent implementation. 

If you setup your own STUN, TURN or PeerJS server, be sure that their ports are not blocked by your firewall for inbound connections (expecially PeerJS which may not use a standard port). Also, verify that you can access those ports from your location.

Once you have your working PeerJS server and access to at least a STUN and a TURN server, you can download the inTrain webroot from GitHub, set up the configuration files and have your inTrain installation served by a webserver.

## Installation

Create a webroot directory and deploy inTrain into it.

```bash
[you@localhost ~]$ sudo mkdir /var/www/virtualhosts/your_site_webroot
[you@localhost ~]$ cd /var/www/virtualhosts/your_site_webroot
[you@localhost ~]$ sudo git clone https://github.com/bilo1967/intrain.git .
```

Then configure your web server so that it will serve your intrain webroot directory as https://your.site/ (or whatever).

URL rewriting must be also enabled so that the extension for php scripts and html pages is removed. See [.htaccess](.htaccess) file.


## Upgrading

Basically you need to get the new version of inTrain from GitHub (just do a ```git clone https://github.com/bilo1967/intrain.git``` in a temporary directory) and replace everything on your webroot except your configuration file (always check for additions or changes) and any images you may have replaced or customized. Always make a backup copy of your webroot before trying an upgrade.


## Configuration and authentication module

There's a single configuration file you have to set up:
- [config/config.js](config/config.js) for the javascript code running on your browser

### config.js

Here you basically just have to configure the javascript access to your PeerJS, STUN and TURN servers.
```js
const PeerJSConfig = {
    host:   'your.peerjs.server', // your peerjs server address
    port:   9443,                 // your peerjs server port
    path:   '/',                  // your peerjs path
    secure: true,                 // your peerjs server uses SSL?
    
    // You may use a STUN-only configuration for testing purposes but if you need
    // to actually reach (mostly) everyone you definitely need also a TURN server...
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
//          { urls: 'turn:numb.viagenie.ca', username: 'webrtc@live.com', credential: 'muazkh'},
//          { urls: 'turn:0.peerjs.com:3478', username: 'peerjs', credential: 'peerjsp' },
        ]
    },
};
```
 At the moment you can leave any other setting as is.



## License

inTrain is available under the [GNU Affero General Public v3](https://www.gnu.org/licenses/agpl-3.0.html) License. 

In brief, this program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as  published by the Free Software Foundation, either version 3 of the  License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but **WITHOUT ANY WARRANTY**; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the [GNU Affero General Public License](https://www.gnu.org/licenses/agpl-3.0.html) for more details.

Documentation is available under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) license. 

inTrain uses several third-party frameworks, components, libraries and resources:
* [PeerJS](https://peerjs.com/">https://peerjs.com/)
* [JQuery](https://jquery.com/">https://jquery.com/)
* [Bootstrap 4](https://getbootstrap.com/)
* [BootBox JS](http://bootboxjs.com/)
* [JsZip](https://stuk.github.io/jszip/)
* [Moment JS](https://momentjs.com/)
* [Animate.css](https://github.com/animate-css/animate.css)
* [FontAwesome](https://fontawesome.com/)
* [Code snippets from WebRTC Samples](https://webrtc.github.io/samples/)
* [PHP Mailer](https://github.com/PHPMailer/PHPMailer)

