/*
*  Part of this code is by The WebRTC project authors.
*
*  Use of this source code is governed by a BSD-style license
*  that can be found in the LICENSE file in the root of the source
*  tree.
*/


var videoInputSelect  = null; // select box for video source devices
var audioInputSelect  = null; // select box for audio source devices
var audioOutputSelect = null; // select box for audio output devices


function setDeviceSelector(selector, type) {
    if (typeof selector !== 'object') return false;
    
    switch(type) {
    case 'videoinput':
        videoInputSelect = selector;
        break;
    case 'audioinput':
        audioInputSelect = selector;
        break;
    case 'audiooutput':
        audioOutputSelect = selector;
        break;
    default:
        return false;
        break;
    }
    return true;
}



async function getDevices(deviceInfos = null, update = true, change = false ) {
    
    if (deviceInfos === null) {
        deviceInfos = await navigator.mediaDevices.enumerateDevices();
    }
    if (update) {
        if (videoInputSelect)  await updateDeviceList(deviceInfos, videoInputSelect,  'videoinput',  change);
        if (audioInputSelect)  await updateDeviceList(deviceInfos, audioInputSelect,  'audioinput',  change);
        if (audioOutputSelect) await updateDeviceList(deviceInfos, audioOutputSelect, 'audiooutput', change);
    }
    
    return deviceInfos;
}




// Handler for ondevicechange event (webcam or headset has been plugged in or out)
// We update the device list accordingly
// The event is triggered for each single device change in a group. This means that 
// for a composite device like an headset that consists of headphones and
// a microphone this handler will be called twice.
function handleDeviceListChange(e) {

    getDevices(null, false).then(deviceList => {
        
        // Check if previously selected device has been removed (id no longer in device list)
        // In that case, the default one must be selected (the 1st listed of that kind)
        const changeVI = videoInputSelect  ? !deviceList.find(e => e.deviceId == videoInputSelect.value)  : false,
              changeAI = audioInputSelect  ? !deviceList.find(e => e.deviceId == audioInputSelect.value)  : false,
              changeAO = audioOutputSelect ? !deviceList.find(e => e.deviceId == audioOutputSelect.value) : false;

        updateDeviceList(deviceList, videoInputSelect,  'videoinput',  changeVI);
        updateDeviceList(deviceList, audioInputSelect,  'audioinput',  changeAI);
        updateDeviceList(deviceList, audioOutputSelect, 'audiooutput', changeAO);

        return;
    })
}


//
// Update a select element with the list of desired kind of devices
// from those retrieved by mediaDevices.enumerateDevices()
// 
// deviceList:      array returned by mediaDevices.enumerateDevices(); if set to null, the 
//                  function gets the list by itself. Since this function is meant to update
//                  the select box of a single kind of devices while enumerateDevices gets 
//                  all of them, if we have more select boxes it may be a good idea to get
//                  the device list just once and pass it as an argument.
// deviceSelector:  select element
// kind:            audioinput|videoinput|audiooutput
// change:          force change event on updated device selector
// onError:         callback function to handle possible enumerateDevices errors...
// 
// Returns the device list on success, null on error
//
async function updateDeviceList(deviceList = null, deviceSelector, kind = 'videoinput', change = false, onError = null) {

    if (typeof onError !== 'function') onError = (error) => { console.error('Cannot get device list:', error.message, error.name); };

    try {
        if (deviceList === null) deviceList = await navigator.mediaDevices.enumerateDevices();

        // Get current selected device id from device selector, if any
        const selected = deviceSelector.value;
        
        // Delete all options from device selector
        while (deviceSelector.firstChild) {
            deviceSelector.removeChild(deviceSelector.firstChild);
        }
        
        // For each device, if it's of the desired type, add a select option to the deviceSelector
        var deviceCount = 0;
        deviceList.forEach((e, i) => {
            
            if (e.kind === kind) {
                deviceCount++;
                const option = document.createElement('option');
                
                option.value = e.deviceId;
                option.text = e.label || `${kind} dev. n. ${deviceCount}`;
                
                deviceSelector.appendChild(option)
            } else {
                // Other kind of device
                // console.log(e.kind);
            }
        });
        
        // Set previously selected option if found, or first option in list (if any)
        if (Array.prototype.slice.call(deviceSelector.childNodes).some(n => n.value === selected)) {
            deviceSelector.value = selected;
            if (change) deviceSelector.dispatchEvent(new Event('change'));
        } else if (deviceSelector.firstChild) {
            deviceSelector.value = deviceSelector.firstChild.value;
            if (change) deviceSelector.dispatchEvent(new Event('change'));
        } else {
            throw "No more " + kind + " devices available";
        }
        
        return deviceList;
        
    } catch (error) {
        
        onError(error);
        
        return null;
    }
}


// Attach audio output device to video element using device/sink ID.
async function attachSinkId(element, sinkId) {

    if (typeof element.sinkId !== 'undefined') {
        
        element.setSinkId(sinkId).then(() => {
            console.log(`Success, audio output device attached: ${sinkId}`);
            return sinkId;
        }).catch(error => {
            let errorMessage = error;
            if (error.name === 'SecurityError') {
                errorMessage = `You need to use HTTPS for selecting audio output device: ${error}`;
            }
            console.error(errorMessage);
            // Jump back to first output device in the list as it's the default.
            audioOutputSelect.selectedIndex = 0;
        });
    } else {
        console.warn('Browser does not support output device selection.');
    }

}

// Change audio destination of selected <video> or <audio> element
async function changeAudioDestination(elem) {
    
    if (!elem) return;
    
    const audioDestination = audioOutputSelect.value;

    var id = await attachSinkId(elem, audioDestination);
    return id;
}

