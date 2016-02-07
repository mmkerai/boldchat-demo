var socket = io.connect();
var auth2;
var Gid_token;
var profile;
var did;

function onSignIn(googleUser) {
// Useful data for your client-side scripts:
	profile = googleUser.getBasicProfile();
	console.log("ID: " + profile.getId()); // Don't send this directly to your server!
	console.log("Name: " + profile.getName());
	console.log("Image URL: " + profile.getImageUrl());
	console.log("Email: " + profile.getEmail());

	// The ID token you need to pass to your backend:
	Gid_token = googleUser.getAuthResponse().id_token;
	socket.emit('authenticate', {token: Gid_token, email: profile.getEmail()});
}

$(document).ready(function() {
did = getURLParameter("did");
console.log("did is "+did);

  	$("#g-signout").hide();

	socket.on('authResponse', function(data){
		$("#g-signout").show();
		$("#gname").text(profile.getName());
		$("#gprofile-image").attr({src: profile.getImageUrl()});
		$("#error").text("");
	});

	socket.on('errorResponse', function(data){
		$("#error").text(data);
	});

});


function signOut() {
	auth2 = gapi.auth2.getAuthInstance();
	if(auth2 === 'undefined')
		console.log("auth2 is undefined");
	
	auth2.signOut().then(function () {
		console.log('User signed out.');
		$("#g-signout").hide();

	if(Gid_token !== 'undefined')
		socket.emit('un-authenticate', {token: Gid_token, email: profile.getEmail()});
	});
}

function getURLParameter(name) {
  return decodeURIComponent((new RegExp('[?|&]' + name + '=' + '([^&;]+?)(&|#|;|$)').exec(location.search)||[,""])[1].replace(/\+/g, '%20'))||null
}
