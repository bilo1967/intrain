$(document).ready(function() {
    
        // Bootstrap 5 popovers preserve the existing hover/focus behavior.
        InTrainUI.initPopovers('.pop-on-hover', {trigger: 'hover', html: true});
        InTrainUI.initPopovers('.pop-on-click', {trigger: 'focus', html: true});

        addCopyright();


		// Check if browser allows audio output device selection
		const audioOutputElement = new Audio();
		
		if (typeof audioOutputElement.sinkId === 'undefined') {
		
			$('#setsinkid-disclaimer').show();
		}
		
        
        var hideWhatsnew = InTrainStorage.get('whatsnew-dismissed' + appVersion);
        
        if (!hideWhatsnew) {
            $("#whatsnew").css('display', 'block');
        }
        $("#dismiss-whatsnew").on('click', function() {
            InTrainStorage.set('whatsnew-dismissed' + appVersion, true);
            $("#whatsnew").fadeOut(200);
        });
        
        
    
        // Set title and version
        $("#app-name").html("Welcome to " + appName);
        $("#app-version").html("(version " + appVersion + ")");
        
        $('#appname').on('click', function() {
            $("#whatsnew").fadeIn(200);
        });
    
        // Browser preference to avoid showing the splash screen on every visit
        var splash = InTrainStorage.get('splash' + appVersion);
        
        // Display splash screen only if coming from another location
        if (!splash) {
            InTrainUI.showModal('#splash', {keyboard: false, focus: true});
            $(".transparent").fadeTo(100, 1);
            InTrainStorage.set('splash' + appVersion, true);
        } else {
            $(".transparent").fadeTo(2000, 1);
        }
        
        $('#splash-close').on("click", function() {
            $('#splash').fadeOut(1500);
            setTimeout(function() {
                
                InTrainUI.hideModal('#splash');
                
                loadAndPlay("sounds/heartbeat.mp3");
                animateCSS('#headset-icon', 'heartBeat', 8);
            }, 1100)        
        });
        
        $('#headset-icon').on("click", function() {
            $('#splash').fadeOut(500);
            setTimeout(function() {
                InTrainUI.hideModal('#splash');
                loadAndPlay("sounds/heartbeat.mp3");
                animateCSS('#headset-icon', 'heartBeat', 8);
            }, 500)        
        });        
        
    });
