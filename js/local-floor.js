/* A local file is decoded once, then sent as media, never uploaded as a file.
 * Web Audio keeps a live (silent when paused) audio track. A canvas keeps the
 * last video frame live at EOF, so replay and seeking need no new PeerJS call.
 */
async function createLocalFileFloor(file, context) {
    const media = document.createElement('video');
    media.controls = true;
    media.playsInline = true;
    media.preload = 'auto';
    media.className = 'normal-video rounded';
    media.setAttribute('aria-label', 'Local floor: ' + file.name);
    const url = URL.createObjectURL(file);
    let source, destination, stream, canvasStream, frameId, heartbeat, disposed = false;
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        media.pause();
        if (frameId !== undefined) media.cancelVideoFrameCallback(frameId);
        clearInterval(heartbeat);
        if (source) source.disconnect();
        if (destination) destination.disconnect();
        const tracks = new Set([...(stream?.getTracks() || []), ...(canvasStream?.getTracks() || [])]);
        tracks.forEach(track => track.stop());
        media.removeAttribute('src');
        media.load();
        media.remove();
        URL.revokeObjectURL(url);
    };
    try {
        if (!context || context.state === 'closed') throw new Error('Audio is not ready.');
        await context.resume();
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => finish(new Error('The file took too long to load.')), 15000);
            const finish = error => {
                clearTimeout(timeout);
                media.onloadeddata = media.onerror = null;
                error ? reject(error) : resolve();
            };
            media.onloadeddata = () => finish();
            media.onerror = () => finish(new Error('The browser cannot decode this file.'));
            media.src = url;
            media.load();
        });
        source = context.createMediaElementSource(media);
        destination = context.createMediaStreamDestination();
        destination.channelCount = 1; // Both stereo sides belong to the single floor channel.
        source.connect(destination); // No direct speakers: use InTrain's crossfader.
        stream = new MediaStream(destination.stream.getAudioTracks());
        if (media.videoWidth && media.videoHeight) {
            const canvas = document.createElement('canvas');
            if (!canvas.captureStream || !media.requestVideoFrameCallback)
                throw new Error('Local video sharing is not supported by this browser. Try Chrome or Edge.');
            // Preserve aspect ratio while bounding encoding cost for large source files.
            const scale = Math.min(1, 1280 / media.videoWidth, 720 / media.videoHeight);
            canvas.width = Math.max(2, Math.round(media.videoWidth * scale));
            canvas.height = Math.max(2, Math.round(media.videoHeight * scale));
            const drawing = canvas.getContext('2d');
            drawing.drawImage(media, 0, 0, canvas.width, canvas.height);
            canvasStream = canvas.captureStream(0);
            const track = canvasStream.getVideoTracks()[0];
            stream.addTrack(track);
            const paint = () => {
                if (disposed || media.readyState < 2) return;
                drawing.drawImage(media, 0, 0, canvas.width, canvas.height);
                track.requestFrame();
            };
            const draw = () => {
                if (disposed) return;
                paint();
                frameId = media.requestVideoFrameCallback(draw);
            };
            draw();
            // Late joiners also receive a picture while paused or at EOF.
            heartbeat = setInterval(paint, 1000);
        }
        // Loaded, initially paused: the teacher chooses when the exercise starts.
        return {media, stream, dispose};
    } catch (error) {
        dispose();
        throw error;
    }
}
