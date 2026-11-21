$(document).ready(function() {
    
        $('.pop-on-hover').popover({
            trigger: 'hover',
            html: true,
        });

        $('.pop-on-click').popover({
            trigger: 'focus',
			width: 300,
            html: true,
        });  		
		
        
        addCopyright();


		// Check if browser allows audio output device selection
		const audioOutputElement = new Audio();
		
		if (typeof audioOutputElement.sinkId === 'undefined') {
		
			$('#setsinkid-disclaimer').show();
		}
		
        
        var hideWhatsnew = Cookies.get('whatsnew-dismissed' + appVersion);
        
        if (!hideWhatsnew) {
            $("#whatsnew").css('display', 'block');
        }
        $("#dismiss-whatsnew").on('click', function() {
            Cookies.set('whatsnew-dismissed' + appVersion, true);
            $("#whatsnew").fadeOut(200);
        });
        
        
    
        // Set title and version
        $("#app-name").html("Welcome to " + appName);
        $("#app-version").html("(version " + appVersion + ")");
        
        $('#appname').on('click', function() {
            $("#whatsnew").fadeIn(200);
        });
    
        // Cookie to check if splash screen has already been displayed
        var splash = Cookies.get('splash' + appVersion);
        
        // Display splash screen only if coming from another location
        if (!splash) {
            $('#splash').modal({
                keyboard: false,
                focus: true,
            });
            $(".transparent").fadeTo(100, 1);
            Cookies.set('splash' + appVersion, true);
        } else {
            $(".transparent").fadeTo(2000, 1);
        }
        
        $('#splash-close').on("click", function() {
            $('#splash').fadeOut(1500);
            setTimeout(function() {
                
                $("#splash").modal('hide');
                
                loadAndPlay("sounds/heartbeat.mp3");
                animateCSS('#headset-icon', 'heartBeat', 8);
            }, 1100)        
        });
        
        $('#headset-icon').on("click", function() {
            $('#splash').fadeOut(500);
            setTimeout(function() {
                $("#splash").modal('hide');
                loadAndPlay("sounds/heartbeat.mp3");
                animateCSS('#headset-icon', 'heartBeat', 8);
            }, 500)        
        });        
        
    });
