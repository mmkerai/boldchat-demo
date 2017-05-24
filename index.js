var socket = io.connect();

function startTest() {
	socket.emit('testAction',"start");
}

function sleepfor(ms) {
	socket.emit('sleepAction',ms);
}

function stopTest() {
	socket.emit('testAction',"stop");
}

$(document).ready(function() {

	socket.on('errorResponse', function(data){
		$("#error").text(data);
	});

	socket.on('testResponse', function(data){
		$("#message1").html(data);
	});

	socket.on('testComplete', function(data){
		$("#message2").text(data);
	});

});

function getURLParameter(name) {
  return decodeURIComponent((new RegExp('[?|&]' + name + '=' + '([^&;]+?)(&|#|;|$)').exec(location.search)||[,""])[1].replace(/\+/g, '%20'))||null
}
