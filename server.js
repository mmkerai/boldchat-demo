// Boldchat test script for Nodejs and socket.io
//********************************* Set up Express Server 
// Boldchat test script for Nodejs and socket.io
//********************************* Set up Express Server 
var http = require('http');
var https = require('https');
var app = require('express')();
var	server = http.createServer(app);
var	io = require('socket.io').listen(server);
var fs = require('fs');
var bodyParser = require('body-parser');
app.use( bodyParser.json() );       // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
  extended: true
})); 

//********************************* Get port used by Heroku
var PORT = Number(process.env.PORT || 1337);
server.listen(PORT);

//********************************* Get BoldChat API Credentials

var AID = process.env.AID || 0;
var APISETTINGSID = process.env.APISETTINGSID || 0;
var KEY = process.env.KEY || 0;
if(AID == 0 || APISETTINGSID == 0 || KEY == 0)
{
	console.log("BoldChat API Variables not set in Heroku. Reading from config file...");
	var EnVars = JSON.parse(fs.readFileSync('config.json', 'utf8'));
	AID = EnVars.AID;
	APISETTINGSID = EnVars.APISETTINGSID;
	KEY = EnVars.KEY;
	if(AID == 0 || APISETTINGSID == 0 || KEY == 0)
	{
		console.log("BoldChat API Environmental Variables not set.  Please verify..");
		process.exit(1);
	}
}

console.log("AID is "+AID);
console.log("API is "+APISETTINGSID);
console.log("KEY is "+KEY);

//********************************* Callbacks for all URL requests
console.log("Node js dir is "+__dirname);

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

// Process incoming Boldchat triggered operator data
app.post('/operator-status-changed', function(req, res){ 
	debugLog("operator-status-changed post message ",req.body);
	ThisSocket.emit('testComplete',"Operator: "+req.body.UserName+" ,Status Changed to: "+ChatStatus[req.body.StatusType]);
	res.send({ "result": "success" });
});

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
