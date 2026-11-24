# InTrain 1.2 - one supervisor media call with independent floor tracks

Branch `1.2` starts from the working `1.0` branch. It is experimental:
`1.0` is unchanged and remains the fallback until full three-browser acceptance.

## Architecture

The supervisor answers each ordinary PeerJS MediaConnection with three tracks:
the live supervisor microphone, a **separate persistent floor audio track**,
and the chosen video track. A blank floor is silent rather than missing.
The video is the supervisor camera when the selected floor is Speaker or a
local audio-only file, and becomes the screen capture or the local video-file
picture when available.

Floor audio is connected to a dedicated Web Audio
`MediaStreamDestination`. Switching sources changes its incoming graph, so
audio track identity stays stable. Video switches by `replaceTrack()` on the
two existing outgoing peer senders, without opening another MediaConnection.
The original additional `RoleScreenShare` call from the supervisor to the
interpreter is no longer used.

The participant **offer** must already have two audio m-lines, because WebRTC
cannot add an extra m-line to an SDP **answer**. In this initial version each
participant calls with its microphone plus one unconnected, silent Web Audio
destination track. The supervisor reads only the first (microphone) received
audio transceiver when creating its monitor/recorder source; it ignores the
silent uplink. Later we can experiment with an extra recvonly transceiver in
the initial offer, avoiding even this silent uplink.

The supervisor sends the microphone/floor RTP transceiver MID mapping and
current floor kind via the existing data channel (`floorstate` messages).
Receivers use MID to bind each audio track to its own output; they never assume
that audio tracks arrive in a particular order. The video element carries
picture only, avoiding duplicate audio playback.

## Participant behavior

With Screen share or Multimedia file selected **in training mode**:
- Interpreter: automatically shows supervisor video in the main frame (using
  the existing speaker/supervisor swap), mutes the live speaker and supervisor
  microphones, and listens to the separate floor track.
- Speaker: sees the supervisor's floor video, mutes the interpreter and
  supervisor microphones, and listens to the separate floor track.
- Supervisor: keeps the 1.0 local crossfader and the independent stereo WAV
  tap unchanged. The new published floor stream never feeds this local mix.

In briefing mode, the supervisor microphone is available as before and the
remote floor track is muted locally. Reverting to Speaker restores the
interpreter's normal large speaker video. The speaker and interpreter receive
a floor status label; screen capture without an audio track is reported but
does not raise an exception. A local file with unsupported audio is reported
when its decoder detects the condition.

YouTube/Vimeo remains a special case: the interpreter keeps its existing
synchronized MediaElement iframe player. The speaker sees a status label, but
cannot receive or render the embedded video through the supervisor's WebRTC
stream. That limitation is intentional in this iteration.

## Acceptance tests before replacing 1.0

1. Test Chrome/Firefox in both directions, including reconnection and late
   arrival of the interpreter or speaker while a floor is active.
2. Switch Speaker -> Screen share (with and without system audio) -> Speaker.
3. Switch Speaker -> local video + audio -> local audio-only -> Speaker;
   include a silent/unsupported-audio video file.
4. In training, verify speaker/interpreter receive independent floor audio
   and their microphone mutes work; the interpreter's large video swaps and
   returns correctly. In briefing verify the microphones return.
5. Verify YouTube/Vimeo synchronization and visibility remain intact.
6. Verify the supervisor's crossfader, mute, swap L/R and stereo WAV recording
   match the original 1.0 tests.
7. Change local microphone/camera while a floor is active and confirm that
   published floor tracks continue.
8. Test speaker screen share while the supervisor has selected a different
   floor. Verify speaker reconnections, changing roles (briefing only), and
   that no duplicate audio or unintended extra PeerJS media calls appear.

The unit/regression CI does not replace these cross-browser WebRTC checks.
