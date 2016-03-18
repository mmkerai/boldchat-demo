// Boldchat test script for Nodejs and socket.io
//********************************* Set up Express Server 
http = require('http');
var express = require('express'),
	app = express(),
	server = require('http').createServer(app),
	io = require('socket.io').listen(server);
var bodyParser = require('body-parser');
app.use( bodyParser.json() );       // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
  extended: true
})); 

//********************************* Get port used by Heroku
var PORT = Number(process.env.PORT || 3000);
server.listen(PORT);

//********************************* Get BoldChat API Credentials stored in Heroku environmental variables
var AID = "5021647476238876565";
var APISETTINGSID = "1012509183542984935";
var KEY = "USaFdI7k9QE24WbB2j7Ks18fMRWzvR4t/6Bszd0VYuayPG0/Ac08HdHD2CQgB+aA9GPc16RS+AOrTSN/cfLvHw==";

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

//********************************* Global variables for chat data
var ThisSocket;
var NoOfRequests;
var TestStatus;
var ApiSuccess;
var ApiDataNotReady = 0;

function sleep(milliseconds) {
  var start = new Date().getTime();
  for(var i = 0; i < 1e7; i++) {
    if ((new Date().getTime() - start) > milliseconds){
      break;
    }
  }
}

function initialiseGlobals () {
	NoOfRequests = 0;
	TestStatus = 1;
	ApiSuccess = 0;
}

// Set up code for outbound BoldChat API calls.  All of the capture callback code should ideally be packaged as an object.
var fs = require('fs');
eval(fs.readFileSync('hmac-sha512.js')+'');
var https = require('https');

function BC_API_Request(api_method,params,callBackFunction) {
	var auth = AID + ':' + APISETTINGSID + ':' + (new Date()).getTime();
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
				updateWebPage('errorResponse', "Data error: "+ str);
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
		updateWebPage('testComplete', "Test Complete. Requests made: "+ NoOfRequests+" success: "+ApiSuccess);
		TestStatus = 0;	// reset for next time
		return;
	}
	NoOfRequests++;
	getApiData("getDepartments", "", getDepartmentsCallback);
	setTimeout(doTest,60000);	// run it every 30 seconds
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
