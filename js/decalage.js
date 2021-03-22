$('document').ready(function() {

    $(function () {
        $('[data-toggle="tooltip"]').tooltip()
    })


    // Load the component in div with ID=decalage
    $("#decalage").load("decalage.html");


    var timerStarted = false;
    var displayTimerInterval = null;
    var startTime = null;

    
    function updateDecalageAverage() {
        
        var v = $('.decalage');
        var m = "(no values)";

        if (v.length > 0) {
            var sum = 0, n=0;
            
            v.each(function(){
                n++;
                sum += parseFloat($(this).text());  // Or this.innerHTML, this.innerText
            });
            m = "average: " + (Math.round(100*sum/n) / 100) + "s";
        }
        
        $("#decalage-average").text(m);
    }
    
    
    
    $(document).on("click", ".delete-decalage", function() {
        $(this).parent().remove();
        updateDecalageAverage();
        
    });

    $(document).on('click', "#timepad-toggle", function(e) {
        e.preventDefault();
        $(this).blur();
        
        updateDecalageAverage();
        
        $("#timepad").slideToggle(100);
        $("#timepad").scrollToEnd();
    });
    
    
    function displayTimer() {
        var now = new Date().getTime();
        var t = Math.round((now-startTime)/100)/10;
        
        var m = Math.trunc(t/60);
        var s = Math.trunc(t - m*60);
        var c = Math.trunc(10*(t - Math.trunc(t)));
        
        var mm = m+""; if (mm.length < 2) mm = "0" + mm;
        var ss = s+""; if (ss.length < 2) ss = "0" + ss;
        var cc = c+""; //if (cc.length < 2) cc = "0" + cc;
        
        $("#timer-display").text(mm + ":" + ss + "." + cc);
        
        
    }
    
    $(document).on("dblclick", "#decalage-average", function() {
        
        //$("#timepad").focus;
        
        animateCSS('#timepad', 'heartBeat');
        
        t = '';
        $('#timepad').children('.decalage,#decalage-average').each(function() {
            t += $(this).text().trim() + String.fromCharCode(13); 
        });
        
        copyTextToClipboard(t);
        
    });

    $(document).on('click', '#timer-reset', function(e) {
        e.preventDefault();
        $(this).blur();
    });
    $(document).on('dblclick', '#timer-reset', function(e) {
        e.preventDefault();
        $(this).blur();
        
        startTime = null;
        clearInterval(displayTimerInterval);
        
        $(".decalage").remove();
        updateDecalageAverage();
        
        timerStarted = false;
        $("#timer-startstop").removeClass('btn-primary btn-danger');
        $("#timer-startstop").addClass('btn-primary');
        
        $("#timer-display").text('00:00.0');
        
        return false;
    });
    
    $(document).on('click', "#timer-startstop", function(e) {
        e.preventDefault();
        $(this).blur();
        // Stop or start?
        if (timerStarted) {
            // Stop
    
            // Take stop time and clear the display timer function
            var stopTime = new Date().getTime();
            var t = Math.round((stopTime-startTime)/10)/100; // t is in seconds
            
            startTime = null;
            clearInterval(displayTimerInterval);
            
            var d = $("<div />", { class: "decalage w-100", });
            d.text(t + "s"); 
            $('<span class="delete-decalage mr-1"><i class="fas fa-times"></i></span>').appendTo(d);
            d.insertBefore('#decalage-average');
            updateDecalageAverage();
            $("#timepad").scrollToEnd();
            
            $("#timer-display").fadeTo(500, 0.4, function() {
                $(this).text('00:00.0').fadeTo(500, 1);
            });
            animateCSS('#timepad-toggle', 'heartBeat');
            
            timerStarted = false;

        } else {
            // Start
            
            startTime = new Date().getTime();
            displayTimerInterval = setInterval(displayTimer, 100);
            
            timerStarted = true;

        }
        $(this).toggleClass('btn-primary btn-danger');
        
    });


    
});  
