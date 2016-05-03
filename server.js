// Boldchat test script for Nodejs
//******** Set up Express Server and socket.io

var http = require('http');
var https = require('https');
var app = require('express')();
var	server = http.createServer(app);
var	io = require('socket.io').listen(server);
var fs = require('fs');
var crypto = require('crypto');
var bodyParser = require('body-parser');
app.use( bodyParser.json() );       // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
  extended: true
})); 

//********** Get port used by Heroku or use a default
var PORT = Number(process.env.PORT || 1337);
server.listen(PORT);

//*********** Get BoldChat API Credentials
var EnVars;
var AID;
var SETTINGSID;
var KEY;
var DoAuth = true;	// default do manual auth from JSON

try
{
	console.log("Reading API variables from config.json file...");
	EnVars = JSON.parse(fs.readFileSync('config.json', 'utf8'));
	AID = EnVars.AID || 0;
	SETTINGSID = EnVars.APISETTINGSID || 0;
	KEY = EnVars.APIKEY || 0;
	DoAuth = false;		// if using config file then must be on TechM server so no user auth required
}
catch (e)
{
	if(e.code === 'ENOENT')
	{
		console.log("Config file not found, Reading Heroku Environment Variables");
		AID = process.env.AID || 0;
		SETTINGSID = process.env.APISETTINGSID || 0;
		KEY = process.env.APIKEY || 0;
	}
	else
		console.log("Error code: "+e.code);
}

if(AID == 0 || SETTINGSID == 0 || KEY == 0)
{
	console.log("BoldChat API Credentials not set. Terminating!");
	process.exit(1);
}

console.log("AID is "+AID);
console.log("API is "+SETTINGSID);
console.log("KEY is "+KEY);
var TriggerUrl = "https://bolddemo.herokuapp.com";		// used to validate the signature of push data
//********************************* Callbacks for all URL requests
app.get('/', function(req, res){
	res.sendFile(__dirname + '/index.html');
});
app.get('/index.css', function(req, res){ 
	res.sendFile(__dirname + '/index.css');
});
app.get('/index.js', function(req, res){
	res.sendFile(__dirname + '/index.js');
});
app.get('/favicon.ico', function(req, res){
	res.sendFile(__dirname + '/favicon.ico');
});
app.get('/jquery-2.1.3.min.js', function(req, res){
	res.sendFile(__dirname + '/jquery-2.1.3.min.js');
});
app.get('/bootstrap.min.css', function(req, res){
	res.sendFile(__dirname + '/bootstrap.min.css');
});

//********************************* Global variables for chat data
var ThisSocket;
var NoOfRequests;
var TestStatus;
var ApiSuccess;
var ApiDataNotReady = 0;
var ChatStatus = ["Logged Out","Away","Available"];

function initialiseGlobals () {
	NoOfRequests = 0;
	TestStatus = 1;
	ApiSuccess = 0;
}

// Process incoming Boldchat triggered operator data
app.post('/operator-status-changed', function(req, res){
	if(validateSignature(req.body, TriggerUrl+'/operator-status-changed') != true) 
	{
		console.log("Trigger failed validation");
		debugLog("operator-status-changed post message ",req.body);
	}
	ThisSocket.emit('testComplete',"Operator: "+req.body.UserName+" ,Status Changed to: "+ChatStatus[req.body.StatusType]);
	res.send({ "result": "success" });
});

function validateSignature(body, triggerUrl) {
	
	var unencrypted = getUnencryptedSignature(body, triggerUrl);
//	console.log('unencrypted signature', unencrypted);
	console.log('computed signature: '+ encryptSignature(unencrypted));
	console.log('trigger signature: '+ body.signature);
	return true;
};

function getUnencryptedSignature(body, triggerUrl) {
	if (!body.signed) {
		throw new Error('No signed parameter found for computing signature hash');
	}
	var signatureParamNames = body.signed.split('&');

	var paramNameValues = new Array();
	for (var i = 0; i < signatureParamNames.length; i++) {
		var signParam = signatureParamNames[i];
		paramNameValues.push(encodeURIComponent(signParam) + '=' + encodeURIComponent(body[signParam]));
	}

	var separator = triggerUrl.indexOf('?') === -1 ? '?' : '&';
	return triggerUrl + separator + paramNameValues.join('&');
}

function encryptSignature(unencryptedSignature) {
	var source = unencryptedSignature + KEY;
	var hash = crypto.createHash('sha512').update(source).digest('hex');
	return hash.toUpperCase();
}

// Set up code for outbound BoldChat API calls.  All of the capture callback code should ideally be packaged as an object.
var fs = require('fs');
eval(fs.readFileSync('hmac-sha512.js')+'');
var https = require('https');

function BC_API_Request(api_method,params,callBackFunction) {
	var auth = AID + ':' + SETTINGSID + ':' + (new Date()).getTime();
	var authHash = auth + ':' + CryptoJS.SHA512(auth + KEY).toString(CryptoJS.enc.Hex);
	var options = {
		host : 'api.boldchat.com', 
		port : 443, 
		path : '/aid/'+AID+'/data/rest/json/v1/'+api_method+'?auth='+authHash+'&'+params, 
		method : 'GET'
		};
	https.request(options, callBackFunction).end();
}

function debugLog(name, dataobj) {
	console.log(name+": ");
	for(key in dataobj) {
		if(dataobj.hasOwnProperty(key))
			console.log(key +":"+dataobj[key]);
	}
}

// this function calls API again if data is truncated
function loadNext(method, next, callback) {
	var str = [];
	for(var key in next) {
		if (next.hasOwnProperty(key)) {
			str.push(encodeURIComponent(key) + "=" + encodeURIComponent(next[key]));
		}
	}
	getApiData(method, str.join("&"), callback);
}

// calls extraction API and receives JSON objects which are processed by the callback method
function getApiData(method, params, fcallback,cbparam) {
	ApiDataNotReady++;		// flag to track api calls
	BC_API_Request(method, params, function (response) {
		var str = '';
		//another chunk of data has been received, so append it to `str`
		response.on('data', function (chunk) {
			str += chunk;
		});
		//the whole response has been received, take final action.
		response.on('end', function () {
			ApiDataNotReady--;
			var jsonObj;
			try {
				jsonObj = JSON.parse(str);
			}
			catch (e){
				console.log("API or JSON error: "+e.message);
				return;
			}
			var next = jsonObj.Next;
			var data = new Array();
			data = jsonObj.Data;
			if(data === 'undefined' || data == null)
			{
				console.log("No data returned: "+str);
				return;		// exit out if error json message received
			}
			fcallback(data,cbparam);
			

			if(typeof next !== 'undefined') 
			{
				loadNext(method, next, fcallback);
			}
		});
		// in case there is a html error
		response.on('error', function(err) {
		// handle errors with the request itself
		console.error("Error with the request: ", err.message);
		ApiDataNotReady--;
		});
	});
}

function getDepartmentsCallback(dlist) {
	var deptdata = "";
	for(var i in dlist) 
	{
		deptdata = deptdata + "Dept: "+dlist[i].Name+ ",ID: "+dlist[i].DepartmentID+"<br/>";
	}
	ThisSocket.emit('testResponse',deptdata);
}

function doTest() {
	if(TestStatus == 2)		// if complete
	{
		TestStatus = 0;	// reset for next time
		return;
	}
	NoOfRequests++;
	ThisSocket.emit('errorResponse',"Requests made: "+NoOfRequests);
	getApiData("getDepartments", "", getDepartmentsCallback);
	setTimeout(doTest,30000);	// run it every 30 seconds
}

// Set up callbacks
io.sockets.on('connection', function(socket){
	ThisSocket = socket;
	
	socket.on('testAction', function(data)
	{
		TimeNow = new Date();

		if(data == "start")
		{
			if(TestStatus == 1)		// test already started
			{
				socket.emit('errorResponse', "Test already started");				
			}
			else
			{
				initialiseGlobals();
				doTest();
				socket.emit('testResponse',"Started at "+TimeNow);
			}
		}
		else if(data == "stop")
		{
			TestStatus = 2;			// complete
			socket.emit('testResponse',"Stopped at "+TimeNow);
		}
		else
			console.log("Invalid Test Action");
		
	});
});

console.log("Server Started");
