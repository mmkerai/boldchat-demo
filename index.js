var fromDate;
var toDate;

function toHHMMSS(seconds) {
    var sec_num = parseInt(seconds, 10); // don't forget the second param
    var hours   = Math.floor(sec_num / 3600);
    var minutes = Math.floor((sec_num - (hours * 3600)) / 60);
    var seconds = sec_num - (hours * 3600) - (minutes * 60);

    if (hours   < 10) {hours   = "0"+hours;}
    if (minutes < 10) {minutes = "0"+minutes;}
    if (seconds < 10) {seconds = "0"+seconds;}
    var time    = hours+':'+minutes+':'+seconds;
    return time;
}

function initialiseValues() {
	$('#error').text("");
	$('#message').text("");
	$('#result').text("");
	$('#link2').html("");
}

$(document).ready(function() {
	var socket = io.connect();
	var csvfile = null;

	$('#loginreportform').submit(function(event) {
		event.preventDefault();
		initialiseValues();
		var dt = $('#fromDate').val();
		fromDate = new Date(dt);
		toDate = new Date(dt);
		toDate.setHours(23,59,59);

//		toDate = $('#toDate').val();
//		socket.emit('getChatReport', {fd: fromDate, td: toDate});
		socket.emit('getLoginReport', {fd: fromDate.toISOString, td: toDate.toISOString});
	});
	
	socket.on('errorResponse', function(data){
		$("#error").text(data);
	});
	socket.on('messageResponse', function(data){
		$("#message").text(data);
	});
	socket.on('userTimeResponse', function(data){
		console.log("User Data received "+Object.keys(data).length);
/*		var str = "";
		for(var i in data)
		{
			var time = data[i];
//			console.log("Time is:"+time+" is "+toHHMMSS(time));
			str = str + i+": "+toHHMMSS(time)+"<br/>";
		}
		$("#result").html(str); */
	});
	socket.on('loginsResponse', function(data){
		console.log("Login Data received "+Object.keys(data).length);
/*		var str = "";
		for(var i in data)
		{
//			str = str + "Ldata["+i+"] = {OperatorID:"+data[i].OperatorID+",<br/>" +
//									"Created:'"+data[i].Created+"',<br/>" +
//									"Ended:'"+data[i].Ended+"'};<br/>";
		}
		$("#result").html(str);*/
	});
	socket.on('doneResponse', function(data){
		$("#done").text("Creating csv file");
		var filedata = new Blob([data], {type: 'text/plain'});
		// If we are replacing a previously generated file we need to
		// manually revoke the object URL to avoid memory leaks.
		if (csvfile !== null)
		{
			window.URL.revokeObjectURL(csvfile);
		}

    csvfile = window.URL.createObjectURL(filedata);
 	$('#link2').attr('href', csvfile);
	$('#link2').html("Download file");
	});
		
});


