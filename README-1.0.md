# InTrain 1.0 stabilization branch

This branch starts from the deployed InTrain files supplied in November 2026, not from the older `master` application sources. It preserves the existing three roles, PeerJS full-mesh topology, stereo monitoring and WAV recording, video-player controls, and current screen-sharing implementation.

## Deployment configuration

`js/config.js` intentionally contains `SET_AT_DEPLOYMENT` placeholders for TURN credentials. Configure the PeerJS host and TURN credentials on the deployed web server; **never commit permanent TURN passwords to the public repository**. The deployed configuration may be kept out of version control. The remaining PeerJS/STUN/TURN configuration should be verified against the actual services in use.

## Corrections

- Close PeerJS media/data connections regardless of whether their `open` getter is an own property; avoid hanging on close events and recursive cleanup.
- Reject unknown or conflicting incoming media connections, including unauthorized screen-share calls.
- Prevent a failed camera/microphone selection from stopping the working capture; await outgoing track replacements and preserve the user's muted state.
- Stop the previous Web Audio VU meter graph and animation when capture changes, without closing the shared AudioContext.
- Correct automatic speaker reconnection after role switching.
- Correct desktop-only audio capture for the speaker; clean up screen-sharing video and media connections when stopped from the browser or the application.
- Avoid inheriting a disabled camera's video mute state when sharing a screen.
- Send the current training/briefing mode and recording indicator when a late participant connects.
- Keep an ongoing supervisor screen share visible while speaker media joins, disconnects or reconnects; resend the current share when the interpreter reconnects, without replacing it with the speaker camera.
- Escape incoming chat messages and file names before inserting them into HTML.

## Verification

Run the dependency-free regression tests with `node --test tests/smoke.test.js`. Check JavaScript syntax with `node --check js/intrain.js` and `node --check js/peercommon.js`. Tests exercise JavaScript with mocked browser APIs; they **do not** replace testing with real devices, multiple browsers, TURN/ICE, stereo monitoring, recording, or screen sharing.

Suggested manual acceptance test: connect supervisor, speaker and interpreter; verify briefing/training audio routing, stereo balance, recorder output with separate L/R channels, role switching, late joining, reconnection, camera/microphone device changes, and screen sharing (with and without desktop audio, including stopping from the browser UI). In particular, test speaker joining while supervisor screen sharing is active, interpreter reconnecting to an active share, and restoration of speaker video when sharing ends.

## Code maintenance

The application still uses its existing PeerJS mesh topology and separate role pages.
This maintenance work does not change signaling, routing or role semantics.

- Bootstrap 5.3.9 replaces Bootstrap 4.6.1. The Bootstrap bundle provides Popper;
  `js/bootstrap-ui.js` exposes explicit native APIs for modals, tooltips and popovers.
  Bootstrap 5 markup and RTL-aware spacing classes replace Bootstrap 4 attributes.
- Inline application JavaScript was moved into readable, unminified scripts:
  `js/role-index.js`, `js/role-supervisor.js`, `js/role-speaker.js`,
  and `js/role-interpreter.js`. Shared logic stays in its existing files.
- `js/storage.js` saves persistent browser preferences under `intrain.*` in
  `localStorage`. The first read migrates the corresponding old cookie and expires
  it; no new preference cookies are written. The live session mode remains
  supervisor-controlled and is deliberately **not** restored from browser storage.
- The obsolete Bootstrap 4 input clearer is replaced by the readable
  `js/input-clearer.js`. Existing third-party prebuilt libraries, such as the
  bundled PeerJS client, are not rewritten or minified as part of this change.
- Removed abandoned commented-out implementation blocks. Explanatory comments,
  including the stereo audio graph and the original language of comments, remain.

## Manual UI validation after Bootstrap 5 migration

Check all four pages: splash screen, popovers, tooltips, device selectors,
login and configuration dialogs, briefing/training buttons, debug-log collapse,
role-switch dialog, screen-share controls and responsive sizing. Then repeat a
three-peer exercise with recording and device switching. Automated unit tests
cannot verify visual layout or browser-specific WebRTC behavior.
