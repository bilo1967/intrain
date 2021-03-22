// JQuery extension to scroll element to end when
// its content exceeds height
$.fn.scrollToEnd = function() {
    this.scrollTop(this.prop('scrollHeight'));
};

// event function to avoid event processing and propagation
function stopProcessingEvent(e) {
    e.preventDefault();
    e.stopPropagation();
}

/*
 * Estensione di String
 *
 * Esegue il padding a sinistra di digits caratteri della 
 * stringa corrente, riempiendo la parte mancante color
 * carattere fill
 *
 * Esempio:
 *
 *     var numero = "201";
 *     console.log(numero.lpad(5, 0))
 *     
 *     Scrive: "00201"
 *
 */ 
String.prototype.lpad =
    function(digits, fill)
    {
        var str, pad;
        
        fill = fill == null ? '0' : fill;
        str  = '' + this;
        pad = fill.repeat(digits);

        return pad.substring(0, pad.length - str.length) + str;
    }

/*
 * Estensione di String
 *
 * Tronca la stringa corrente usando i puntini di sospensione
 * Vengono lasciati i primi n caratteri
 *
 * Se useWordBoundary è true allora il troncamento avviene
 * prima dell'ultima parola
 *
 */
String.prototype.trunc = function( n, useWordBoundary ){
    var isTooLong = this.length > n,
        s_ = isTooLong ? this.substr(0, n-1) : this;
    s_ = (useWordBoundary && isTooLong) ? s_.substr(0, s_.lastIndexOf(' ')) : s_;
    return  isTooLong ? s_ + '&hellip;' : s_;
};

/*
 * Estensione di String
 * Produce un hash numerico NON crittografico
 * a 64 bit della stringa
 */
String.prototype.hash64 = function() {
  var i = this.length
  var hash1 = 5381
  var hash2 = 52711

  while (i--) {
    const char = this.charCodeAt(i)
    hash1 = (hash1 * 33) ^ char
    hash2 = (hash2 * 33) ^ char
  }

  return "0x" + ((hash1 >>> 0) * 4096 + (hash2 >>> 0)).toString(16);
}

Date.prototype.toTimeStamp = function() {
    return String(this.getDate()).lpad(2)
    + '/' + String(this.getMonth() + 1).lpad(2) 
    + '/' + this.getFullYear() 
    + ' ' + String(this.getHours()).lpad(2)
    + ':' + String(this.getMinutes()).lpad(2)
    + ':' + String(this.getSeconds()).lpad(2)
    ;
};




/*
 * Dal 2016, con HTML5, i browser possono copiare del testo
 * direttamente nella clipboard. Il metodo è:
 *
 *    document.execCommand("copy")
 *
 * e funziona sul testo attualmente selezionato sulla pagina.
 * 
 * Questa funzione crea un elemento fittizio, copia il testo
 * desiderato al suo interno, lo seleziona, copia nella
 * clipboard e poi distrugge l'elemento creato.
 *
 * Esempio con jQuery:
 *
 *    copyTextToClipboard($('#id-qualsiasi').text());
 *
 */
function copyTextToClipboard(txt)
{
	var elem, current, retval;

    // Creo dinamicamente l'elemento fuori
	// dalla finestra attuale. Non posso crearlo
    // invisibile perché altrimenti il testo al
	// suo interno non è selezionabile.
	// L'id è casuale perché non si sa mai...
	elem = document.createElement('textarea');
	elem.style.width = 0;
	elem.style.height = 0;
	elem.style.position = "absolute";
    elem.style.left = "-9999px";
	elem.id = "an_anonymous_hidden_element_" + 
	          Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 8);
	document.body.appendChild(elem);
	elem.textContent = txt;
	
	// salvo l'elemento attualmente selezionato,
	// passo il focus su quello appena creato e
	// seleziono il testo al suo interno
	current = document.activeElement;
	elem.focus();
	elem.setSelectionRange(0, elem.value.length);
	
	// copio la selezione
    try {
        retval = document.execCommand("copy");
    } catch(e) {
        retval = false;
    }
	
	// distruggo l'elemento temporaneo
	elem.parentNode.removeChild(elem);
	
    // ripasso il focus all'elemento selezionato
    if (current && typeof current.focus === "function") {
        current.focus();
    }
	
	return retval;

}




function getDateTime(date = null) {
    
    const months = [ 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December' ];
    const days = [ 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday' ];
    
    
    if (date === null) {
        date = new Date();
    }
    
    var dt = {};
    
    dt.hours = date.getHours();
    
    dt.minutes = date.getMinutes() < 10 
               ? '0' + date.getMinutes() 
               : date.getMinutes();
    
    dt.seconds = date.getSeconds() < 10 
               ? '0' + date.getSeconds() 
               : date.getSeconds();
               
    dt.dd      = date.getDate() < 10 
               ? '0' + date.getDate() 
               : date.getDate();
               
    dt.mm      = date.getMonth() < 10 
               ? '0' + date.getMonth() 
               : date.getMonth();
               
    
    dt.dayOfWeek = days[date.getDay()];
    dt.month = months[date.getMonth()];
    dt.day = date.getDate();
    dt.year = date.getFullYear();
    
    dt.date = dt.dayOfWeek + ', ' + dt.month + ' ' + dt.day + ', ' + dt.year;
    dt.ddmmyyyy = dt.dd + "/" + dt.mm + "/" + dt.year;
    dt.hms = dt.hours + ":" + dt.minutes + ":" + dt.seconds;
    
    return dt;
}