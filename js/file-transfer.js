/*
 * PeerJS file transfers. Send small ordered messages instead of one huge Blob:
 * PeerJS's internal chunking otherwise buffers the complete file in memory.
 */
const InTrainFileTransfer = (() => {
    const CHUNK_BYTES = 12 * 1024;       // Below PeerJS's 16,300-byte chunk limit.
    const MAX_FILE_BYTES = 256 * 1024 * 1024;
    const MAX_BUFFER_BYTES = 256 * 1024;
    const STALL_MS = 120000;

    const outboundQueues = new WeakMap();
    const receipts = new WeakMap();
    const incoming = new WeakMap();
    const observing = new WeakSet();
    const downloadURLs = new Set();
    let nextId = 0;

    function printable(value) {
        return escapeHTML(String(value ?? ''));
    }

    function peerName(connection) {
        if (typeof speakerData !== 'undefined' && connection === speakerData) return 'speaker';
        if (typeof interpreterData !== 'undefined' && connection === interpreterData) return 'interpreter';
        if (typeof supervisorData !== 'undefined' && connection === supervisorData) return 'supervisor';
        return 'peer';
    }

    function stateFor(store, connection) {
        let states = store.get(connection);
        if (!states) { states = new Map(); store.set(connection, states); }
        return states;
    }

    function reportError(connection, filename, error) {
        const message = 'File transfer to ' + peerName(connection) + ' failed (' +
            printable(filename) + '): ' + printable(error.message || error);
        console.warn(message);
        logToPanel(message, 'warning');
    }

    function watchConnection(connection) {
        if (observing.has(connection) || typeof connection.on !== 'function') return;
        observing.add(connection);
        connection.on('close', () => {
            const transfers = incoming.get(connection);
            if (transfers) {
                for (const transfer of transfers.values()) clearTimeout(transfer.timer);
                transfers.clear();
            }
            const pending = receipts.get(connection);
            if (pending) {
                for (const receipt of pending.values()) {
                    clearTimeout(receipt.timer);
                    receipt.reject(new Error('Data connection closed'));
                }
                pending.clear();
            }
        });
    }

    async function waitForRoom(connection) {
        const started = Date.now();
        while (connection.open) {
            const buffered = connection.dataChannel?.bufferedAmount || 0;
            const waiting = connection.bufferSize || 0;
            if (buffered <= MAX_BUFFER_BYTES && waiting < 32) return;
            if (Date.now() - started > STALL_MS) throw new Error('Data channel stalled');
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error('Data connection closed');
    }

    async function sendOne(connection, file) {
        if (!file || !Number.isSafeInteger(file.size) || file.size < 0 ||
            typeof file.slice !== 'function') throw new Error('Invalid file');
        if (file.size > MAX_FILE_BYTES)
            throw new Error('File exceeds the 256 MiB transfer limit');
        if (!connection.open) throw new Error('Data connection closed');

        watchConnection(connection);
        const id = Date.now().toString(36) + '-' + (++nextId).toString(36);
        const total = Math.ceil(file.size / CHUNK_BYTES);
        const pending = stateFor(receipts, connection);
        let finishReceipt;
        const receiptPromise = new Promise((resolve, reject) => {
            finishReceipt = {resolve, reject, timer: null};
            pending.set(id, finishReceipt);
        });
        // Attach an early rejection handler, even if a peer rejects the header
        // before the last chunk has been read.
        receiptPromise.catch(() => {});

        try {
            connection.send({
                action: 'file-begin', id, name: file.name || 'file',
                type: file.type || '', size: file.size, total
            });
            for (let index = 0; index < total; index++) {
                await waitForRoom(connection);
                const offset = index * CHUNK_BYTES;
                const bytes = await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer();
                if (!connection.open) throw new Error('Data connection closed');
                connection.send({action: 'file-part', id, index, bytes});
            }
            await waitForRoom(connection);
            connection.send({action: 'file-finish', id});
            finishReceipt.timer = setTimeout(() => {
                pending.delete(id);
                finishReceipt.reject(new Error('No delivery confirmation received'));
            }, STALL_MS);
            await receiptPromise;
            logToChat('File delivered to ' + peerName(connection) + ': ' + printable(file.name));
        } catch (error) {
            if (connection.open) {
                try { connection.send({action: 'file-cancel', id}); } catch (_) {}
            }
            throw error;
        } finally {
            clearTimeout(finishReceipt.timer);
            pending.delete(id);
        }
    }

    function sendFiles(connection, files) {
        const selected = Array.from(files || []);
        if (!selected.length) return Promise.resolve();
        if (!connection || !connection.open) {
            logToPanel('Cannot send files: recipient is not connected.', 'warning');
            return Promise.resolve();
        }

        // All sends on one channel are serialized, including repeated selections.
        const previous = outboundQueues.get(connection) || Promise.resolve();
        const task = previous.catch(() => {}).then(async () => {
            for (const file of selected) {
                try { await sendOne(connection, file); }
                catch (error) {
                    reportError(connection, file?.name || 'file', error);
                    if (!connection.open) break;
                }
            }
        });
        outboundQueues.set(connection, task);
        task.then(() => {
            if (outboundQueues.get(connection) === task) outboundQueues.delete(connection);
        }, () => {
            if (outboundQueues.get(connection) === task) outboundQueues.delete(connection);
        });
        return task;
    }

    function sendResult(connection, id, ok, message = '') {
        if (!connection.open) return;
        try { connection.send({action: 'file-result', id, ok, message}); }
        catch (error) { console.warn('Could not acknowledge file transfer', error); }
    }

    function endIncoming(connection, id) {
        const states = incoming.get(connection);
        const entry = states?.get(id);
        if (entry) clearTimeout(entry.timer);
        states?.delete(id);
        return entry;
    }

    function resetDeadline(connection, id, entry) {
        clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
            endIncoming(connection, id);
            logToPanel('File reception timed out: ' + printable(entry.name), 'warning');
            sendResult(connection, id, false, 'Reception timed out');
        }, STALL_MS);
    }

    function failIncoming(connection, id, message) {
        endIncoming(connection, id);
        sendResult(connection, id, false, message);
        console.warn('File reception rejected:', message);
    }

    function asBytes(value) {
        if (value instanceof ArrayBuffer) return new Uint8Array(value);
        if (ArrayBuffer.isView(value))
            return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        return null;
    }

    function downloadLink(name, blob) {
        const href = URL.createObjectURL(blob);
        downloadURLs.add(href);
        const safeName = printable(name);
        return '<a href="' + href + '" download="' + safeName + '">' + safeName + '</a>';
    }

    function receive(connection, data, role) {
        if (!data || typeof data !== 'object') return false;
        const action = data.action;
        if (!['file-begin', 'file-part', 'file-finish', 'file-result', 'file-cancel'].includes(action)) return false;
        if (!connection) return true;
        watchConnection(connection);

        if (action === 'file-result') {
            const pending = receipts.get(connection)?.get(data.id);
            if (pending) {
                clearTimeout(pending.timer);
                if (data.ok === true) pending.resolve();
                else pending.reject(new Error(data.message || 'Recipient rejected the file'));
            }
            return true;
        }

        const id = data.id;
        if (typeof id !== 'string' || id.length < 1 || id.length > 100) return true;
        const active = stateFor(incoming, connection);
        if (action === 'file-cancel') {
            endIncoming(connection, id);
            return true;
        }

        if (action === 'file-begin') {
            const name = data.name;
            if (typeof name !== 'string' || !name.length || name.length > 255 ||
                !Number.isSafeInteger(data.size) || data.size < 0 ||
                data.size > MAX_FILE_BYTES || !Number.isSafeInteger(data.total) ||
                data.total !== Math.ceil(data.size / CHUNK_BYTES) ||
                active.size >= 2 || active.has(id)) {
                sendResult(connection, id, false, 'Invalid file header or transfer limit');
                return true;
            }
            const entry = {
                name, type: typeof data.type === 'string' ? data.type.slice(0, 100) : '',
                size: data.size, total: data.total, chunks: [], received: 0, timer: null
            };
            active.set(id, entry);
            resetDeadline(connection, id, entry);
            return true;
        }

        const entry = active.get(id);
        if (!entry) return true;

        if (action === 'file-part') {
            const part = asBytes(data.bytes);
            if (!part || data.index !== entry.chunks.length ||
                part.byteLength !== Math.min(CHUNK_BYTES, entry.size - entry.received) ||
                entry.chunks.length >= entry.total) {
                failIncoming(connection, id, 'Invalid file chunk');
                return true;
            }
            entry.chunks.push(part);
            entry.received += part.byteLength;
            resetDeadline(connection, id, entry);
            return true;
        }

        if (action === 'file-finish') {
            if (entry.received !== entry.size || entry.chunks.length !== entry.total) {
                failIncoming(connection, id, 'Incomplete file transfer');
                return true;
            }
            endIncoming(connection, id);
            try {
                const blob = new Blob(entry.chunks, {type: entry.type});
                logToChat('The ' + printable(role) + ' has sent you a file: ' +
                    downloadLink(entry.name, blob));
                sendResult(connection, id, true);
            } catch (error) {
                sendResult(connection, id, false, 'Cannot assemble received file');
                console.warn('Could not assemble received file', error);
            }
            return true;
        }
        return true;
    }

    if (typeof window !== 'undefined') window.addEventListener('pagehide', () => {
        for (const url of downloadURLs) URL.revokeObjectURL(url);
        downloadURLs.clear();
    });

    return {sendFiles, receive};
})();
