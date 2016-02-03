// acronyms used
// cconc - concurrency
// cph - chats per hour
// ciq - chats in queue
// lwt - longest waiting time
// tco - chats offered (chats active, answered and unabandoned)
// tac - total active chats (answered)
// tcan - total chats answered complete (closed)
// tcuq - total chats unanswered/abandoned in queue
// tcua - total chats unanswered/abandoned after assigned
// tcun - total chats unavailable
// asa - average speed to answer
// act - average chat time
// acc - available chat capacity
// aaway - total number of agents away
// aavail - total number of agents available
// status - current status 0 - logged out, 1 - away, 2 - available
// tcs - time in current status
// tct - total chat time
// mct - multi chat time
// csla - no of chats within sla
// psla - percent of chats within sla (csla/tcan * 100)


//********************************* Set up Express Server 
http = require('http');
var express = require('express'),
	app = express(),
	server = require('http').createServer(app),
	io = require('socket.io').listen(server);
var bodyParser = require('body-parser');
//var cookieParser = require('cookie-parser');
//var session = require("express-session");
//app.use(cookieParser());
//app.use(session({resave: true, saveUninitialized: true, secret: 'LMIDashboardCodebyMMK', cookie: { maxAge: 600000 }}));
app.use( bodyParser.json() );       // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
  extended: true
})); 

//********************************* Get port used by Heroku
var PORT = Number(process.env.PORT || 3000);
server.listen(PORT);

//********************************* Get BoldChat API Credentials stored in Heroku environmental variables
var AID = process.env.AID || 0;
var APISETTINGSID = process.env.APISETTINGSID || 0;
var KEY = process.env.KEY || 0;
var PAGEPATH = process.env.PAGEPATH || "/"; //  Obsecur page path such as /bthCn2HYe0qPlcfZkp1t
var GMAILS = process.env.GMAILS; // list of valid emails
var GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
var SLATHRESHOLD = process.env.SLATHRESHOLDS;
var VALIDACCESSNETWORKS = JSON.parse(process.env.VALIDACCESSNETWORKS) || {};  // JSON string with valid public ISP addresses { "83.83.95.62": "Mark Troyer (LMI) Home Office", "10.10.10.1": "LogMeIn UK Office", "10.10": "H3G internal Network"};
if (AID == 0 || APISETTINGSID == 0 || KEY == 0) {
	console.log("AID = "+AID+", APISETTINGSID = "+APISETTINGSID+", KEY = "+KEY);
	console.log("BoldChat API Environmental Variables not set in HEROKU App.  Please verify..");
	process.exit(1);
}

//********************************* Callbacks for all URL requests
app.get(PAGEPATH, function(req, res){
	var ip = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0] : req.connection.remoteAddress;
	if (VALIDACCESSNETWORKS[ip])  // TODO:  Add in Access Control via White List
	{
		console.log("IP Addrees: "+ip+" was on the white list.");
	}
	else 
	{
		console.log("IP Address: "+ip+" was NOT on the white list.");
	}
	
	debugLog("Cookies",req.cookies);
	debugLog("Session",req.session);
	res.sendFile(__dirname + '/dashboard.html');
});

app.get('/agents.html', function(req, res){
	res.sendFile(__dirname + '/agents.html');
});
app.get('/department.html', function(req, res){
	res.sendFile(__dirname + '/department.html');
});
app.get('/index.css', function(req, res){ 
	res.sendFile(__dirname + '/index.css');
});
app.get('/dashboard.js', function(req, res){
	res.sendFile(__dirname + '/dashboard.js');
});
app.get('/favicon.ico', function(req, res){
	res.sendFile(__dirname + '/favicon.ico');
});
app.get('/threelogo.png', function(req, res){
	res.sendFile(__dirname + '/threelogo.png');
});

//********************************* Global class for chat data
var ChatData = function(chatid, dept, start) {
		this.chatID = chatid;
		this.department = dept;
		this.started = start;		// times ISO times must be converted to epoch (milliseconds since 1 Jan 1970)
		this.answered = 0;			// so it is easy to do the calculations
		this.ended = 0;
		this.closed = 0;
		this.operator = 0;	
		this.status = 0;	// 0 is closed, 1 is waiting (started), 2 is active (answered)
};

//******************* Global class for dashboard metrics
var DashMetrics = function(id,name) {
		this.did = id;		// dept id
		this.name = name;
		this.cconc = 0;
//		this.tct = 0;
//		this.mct = 0;
		this.csla = 0;		// number
		this.psla = 0;		// percent
		this.cph = 0;
		this.ciq = 0;
		this.lwt = 0;
		this.tco = 0;
		this.tac = 0;
		this.tcan = 0;
		this.tcuq = 0;
		this.tcua = 0;
		this.tcun = 0;
		this.tcaban = 0;
		this.asa = 0;
		this.act = 0;
		this.acc = 0;
		this.oaway = 0;
		this.oavail = 0;	
};

//**************** Global class for operator metrics
var OpMetrics  = function(id,name) {
		this.oid = id;		// operator id
		this.name = name;
		this.ccap = 2;		// assume chat capacity of 2
		this.cconc = 0;		// chat concurrency
		this.tcan = 0;		// total chats answered
		this.csla = 0;		// chats answered within SLA
		this.status = 0;	// 0 - logged out, 1 - away, 2 - available
		this.activeChats = new Array();
		this.tcs = 0;	// time in current status	
		this.tct = 0;	// total chat time with atleast one chat
		this.mct = 0;	// multi chat time i.e. more than 1 chat
};																				

//********************************* Global variables for chat data
var LoggedInUsers;
var AllChats;
var	Departments;	// array of dept ids and dept name objects
var	DeptOperators;	// array of operators by dept id
var	OperatorDepts;	// array of depts for each operator
var	OperatorCconc;	// chat concurrency for each operator
var	Folders;	// array of folder ids and folder name objects
var	Operators;	// array of operator ids and name objects
var	WaitingTimes;	// array of chat waiting times objects
var	Teams;	// array of team names
var ApiDataNotReady;	// Flag to show when data has been received from API so that data can be processed
var TimeNow;			// global for current time
var EndOfDay;			// global time for end of the day before all stats are reset
var Overall;		// top level stats
var	OperatorsSetupComplete;

function sleep(milliseconds) {
  var start = new Date().getTime();
  for(var i = 0; i < 1e7; i++) {
    if ((new Date().getTime() - start) > milliseconds){
      break;
    }
  }
}

function initialiseGlobals () {
	LoggedInUsers = new Array();
	AllChats = new Object();
	Departments = new Object();	
	DeptOperators = new Object();
	OperatorDepts = new Object();
	OperatorCconc = new Object();
	Folders = new Object();	
	Operators = new Object();
	WaitingTimes = new Object();
	Teams = new Object();
	ApiDataNotReady = 0;
	TimeNow = new Date();
	EndOfDay = TimeNow;
	EndOfDay.setHours(23,59,59,0);	// last second of the day
	Overall = new DashMetrics("11111111","Overall");	
	OperatorsSetupComplete = false;
}
// Process incoming Boldchat triggered chat data
app.post('/chat-started', function(req, res){
//	debugLog("Chat-started",req.body);
	if(ApiDataNotReady == 0)		//make sure all static data has been obtained first
		processStartedChat(req.body);
	res.send({ "result": "success" });
});

// Process incoming Boldchat triggered chat data
app.post('/chat-unavailable', function(req, res){
//	debugLog("Chat-unavailable",req.body);
	if(ApiDataNotReady == 0)		//make sure all static data has been obtained first
		processUnavailableChat(req.body);
	res.send({ "result": "success" });
});

// Process incoming Boldchat triggered chat data
app.post('/chat-answered', function(req, res){
//	debugLog("Chat-answered",req.body);
	if(ApiDataNotReady == 0)		//make sure all static data has been obtained first
		processAnsweredChat(req.body);
	res.send({ "result": "success" });
});

// Process incoming Boldchat triggered chat data
app.post('/chat-closed', function(req, res){
//	debugLog("Chat-closed", req.body);
	if(ApiDataNotReady == 0)		//make sure all static data has been obtained first
		processClosedChat(req.body);
	res.send({ "result": "success" });
});

// Process incoming Boldchat triggered operator data
app.post('/operator-status-changed', function(req, res){ 
//	debugLog("*****operator-status-changed post",req.body);
	if(ApiDataNotReady == 0)		//make sure all static data has been obtained first
		processOperatorStatusChanged(req.body);
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

function Google_Oauth_Request(token,callBackFunction) {
	var options = {
		host : 'www.googleapis.com', 
		port : 443, 
		path : '/oauth2/v3/tokeninfo?id_token='+token, 
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

function deptsCallback(dlist) {
	var dname, newname;
	for(var i in dlist) 
	{
		dname = dlist[i].Name;
		if(dname.indexOf("PROD") == -1)	continue;		// if this is not a PROD dept
		newname = dname.replace("PROD - ","");		// remove PROD from name
		Departments[dlist[i].DepartmentID] = new DashMetrics(dlist[i].DepartmentID,newname);
	}
	console.log("No of PROD Depts: "+Object.keys(Departments).length);
	for(var did in Departments)
	{
		parameters = "DepartmentID="+did;
		getApiData("getDepartmentOperators",parameters,deptOperatorsCallback,did);	// extra func param due to API
	}
}

function operatorsCallback(dlist) {
	for(var i in dlist) 
	{
		Operators[dlist[i].LoginID] = new OpMetrics(dlist[i].LoginID,dlist[i].Name);																			
		var conc = new Array(1440).fill(0);	// initialise with zeros
		OperatorCconc[dlist[i].LoginID] = conc;
	}
	console.log("No of Operators: "+Object.keys(Operators).length);
}

function foldersCallback(dlist) {
	for(var i in dlist) 
	{
		if(dlist[i].FolderType == 5)		// select only chat folder types
		{
			Folders[dlist[i].FolderID] = dlist[i].Name;
		}
	}
	console.log("No of Chat Folders: "+Object.keys(Folders).length);
}

function deptOperatorsCallback(dlist, dept) {
	var doperators = new Array();
	for(var i in dlist) 
	{
		doperators.push(dlist[i].LoginID);
	}
	
	DeptOperators[dept] = doperators;
	console.log("Operators in dept: "+dept+" - "+DeptOperators[dept].length);
}


function operatorAvailabilityCallback(dlist) {
	// StatusType 0, 1 and 2 is Logged out, logged in as away, logged in as available respectively
	var operator;
	var depts;
	for(var i in dlist)
	{
		operator = dlist[i].LoginID;
		if(Operators[operator] !== 'undefined')		// check operator id is valid
		{
			Operators[operator].status = dlist[i].StatusType;
			Operators[operator].tcs = Math.round((TimeNow - new Date(dlist[i].Created))/1000);
			// update metrics
			if(dlist[i].StatusType == 1)
			{
				Overall.oaway++;
				depts = new Array();
				depts = OperatorDepts[operator];
				for(var did in depts)
					Departments[depts[did]].oaway++;
			}
			else if(dlist[i].StatusType == 2)
			{
				Overall.oavail++;
				depts = new Array();
				depts = OperatorDepts[operator];
				for(var did in depts)
					Departments[depts[did]].oavail++;
			}
		}
	}
}

function getDepartmentNameFromID(id) {
	return(Departments[id].name);
}

function getOperatorNameFromID(id) {
	return(Operators[id].name);
}

// set up operator depts from department operators for easier indexing
function setupOperatorDepts() {
	var ops, depts;
	for(var did in Departments)
	{
		ops = new Array();
		ops = DeptOperators[did];
		for(var k in ops)
		{		
			depts = OperatorDepts[ops[k]];
			if(typeof(depts) === 'undefined')
				depts = new Array();

			depts.push(did);	// add dept to list of operators
			OperatorDepts[ops[k]] = depts;
		}
	} 
	OperatorsSetupComplete = true;	
}

// setup all globals TODO: add teams
function doStartOfDay() {
	initialiseGlobals();	// zero all memory
	getApiData("getDepartments", 0, deptsCallback);
	sleep(1000);
	getApiData("getOperators", 0, operatorsCallback);
	sleep(1000);
	getApiData("getFolders", "FolderType=5", foldersCallback);	// get only chat folders
	sleep(1000);
	getOperatorAvailabilityData();
	getInactiveChatData();
	getActiveChatData();
	calculateInactiveConc();		// concurrency for all closed/inactive chats
}

// process started chat object and update all relevat dept, operator and global metrics
function processStartedChat(chat) {
	if(chat.DepartmentID == null || chat.DepartmentID == "") return;// should never be null at this stage but I have seen it
	deptobj = Departments[chat.DepartmentID];
	if(typeof(deptobj) === 'undefined') return;		// a dept we are not interested in

	var starttime = new Date(chat.Started);
	var tchat = new ChatData(chat.ChatID, chat.DepartmentID, starttime);
	tchat.status = 1;	// waiting to be answered
	AllChats[chat.ChatID] = tchat;		// save this chat details
}

// process unavailable chat object. Occurs when visitor gets the unavailable message as ACD queue is full or nobody available
function processUnavailableChat(chat) {
	if(chat.DepartmentID === null) return;	
	deptobj = Departments[chat.DepartmentID];
	if(typeof(deptobj) === 'undefined') return;		// a dept we are not interested in
	// make sure that this is genuine and sometime this event is triggered for an old closed chat
	if(chat.Started == "" && chat.Answered == "")
	{
		deptobj.tcun++;
		Overall.tcun++;
	}
}

// active chat means a started chat has been answered by an operator so it is no longer in the queue
function processAnsweredChat(chat) {
	var deptobj, opobj, tchat;
	var anstime=0, starttime=0;
	
	if(chat.DepartmentID == null || chat.DepartmentID == "") return;	// should never be null at this stage but I have seen it
	if(chat.OperatorID == null || chat.OperatorID == "") return;		// operator id not set for some strange reason

	deptobj = Departments[chat.DepartmentID];
	if(typeof(deptobj) === 'undefined') return;		// a non PROD dept we are not interested in
	opobj = Operators[chat.OperatorID];
	
	if(chat.Started != null && chat.Started != "")
		starttime = new Date(chat.Started);

	if(chat.Answered != null && chat.Answered != "")
		anstime = new Date(chat.Answered);

	tchat = AllChats[chat.ChatID];
	if(typeof(tchat) === 'undefined')	// if this chat did not exist (only true if processing at startup not triggers)
		tchat = new ChatData(chat.ChatID, chat.DepartmentID, starttime);

	tchat.answered = anstime;
	tchat.operator = chat.OperatorID;
	tchat.status = 2;		// active chat
	AllChats[chat.ChatID] = tchat;		// save this chat info
	
	mcstime = anstime;
	if(anstime != 0)		// make sure this was a chat that was answered
	{
		if(opobj.activeChats.length == 1) 	// already one chat so this is a multichat
			opobj.activeChats[0].mcstarttime = mcstime;
		
		opobj.activeChats.push({chatid: chat.ChatID,
						mcstarttime: mcstime,			// start time for a multichat
						deptname: deptobj.name,
						messages: chat.OperatorMessageCount + chat.VisitorMessageCount
						});
	}
}

// process all active chat objects 
function allActiveChats(achats) {
	for(var i in achats) 
	{
		processAnsweredChat(achats[i]);
	}
}

// process closed chat object. closed chat may not be started or answered if it was abandoned or unavailable
function processClosedChat(chat) {
	var deptobj,opobj,tchat;
	var starttime=0,anstime=0,endtime=0,closetime=0,opid=0;

	if(chat.DepartmentID === null)		// should never be null at this stage but I have seen it
	{									// perhaps it is an abandoned chat
//		debugLog("Closed Chat, Dept null", chat);
		return;
	}
	deptobj = Departments[chat.DepartmentID];
	if(typeof(deptobj) === 'undefined') return;		// a non PROD dept we are not interested in

	if(chat.ChatStatusType >= 7 && chat.ChatStatusType <= 15)		// unavailable chat
	{
		Overall.tcun++;
		deptobj.tcun++;
		return;
	}

	if(chat.Started != null && chat.Started != "")
		starttime = new Date(chat.Started);

	if(chat.Answered != null && chat.Answered != "")
		anstime = new Date(chat.Answered);

	if(chat.Ended != null && chat.Ended != "")
		endtime = new Date(chat.Ended);

	if(chat.Closed != null && chat.Closed != "")
		closetime = new Date(chat.Closed);

	if(chat.OperatorID != null && chat.OperatorID != "")
		opid = chat.OperatorID;

//	var messagecount = chat.OperatorMessageCount + chat.VisitorMessageCount
	tchat = AllChats[chat.ChatID];
	if(typeof(tchat) === 'undefined')		// if this chat did not exist 
		tchat = new ChatData(chat.ChatID, chat.DepartmentID, starttime);

	tchat.status = 0;		// inactive/complete/cancelled/closed
	if(anstime == 0)		// chat unanswered
	{
		if(opid == 0)	// operator unassigned
		{
			Overall.tcuq++;
			deptobj.tcuq++;
		}
		else
		{
			Overall.tcua++;
			deptobj.tcua++;			
		}
		return;	// all done 
	}

	tchat.answered = anstime;
	tchat.ended = endtime;
	tchat.closed = closetime;
	tchat.operator = opid;
	AllChats[chat.ChatID] = tchat;	// update chat

//	if(opid == 0) return;		// operator id not set if chat abandoned before answering
	opobj = Operators[opid];		// if answered there will always be a operator assigned
	if(typeof(opobj) === 'undefined') 	
	{									// in case there isnt
		debugLog("*****Error Operator obj is null",chat);
		return;
	}

	Overall.tcan++;
	deptobj.tcan++;
	var speed = anstime - starttime;
	if(speed < (SLATHRESHOLD*1000))		// sla threshold in milliseconds
	{
		Overall.csla++;
		deptobj.csla++;
		opobj.csla++;
		Overall.psla = Math.round((Overall.csla/Overall.tcan)*100);
		deptobj.psla = Math.round((deptobj.csla/deptobj.tcan)*100);
	}
	
	opobj.tcan++;	// chats answered and complete
	// now remove from active chat list and update stats
	var achats = new Array();
	achats = opobj.activeChats;
	if(achats.length == 1)		// single chat
	{
		if(achats[0].chatid == chat.ChatID)			// this is the chat that has closed
			opobj.activeChats == new Array();		// remove from list by re-initiasing variable
	}
	else if(achats.length > 1)				// must be multi chat
	{
		for(var x in achats) // go through each multichat
		{
			if(achats[x].chatid == chat.ChatID)
			{
				achats.splice(x,1);
				opobj.activeChats = achats;		// save back after removing
			}
		}
	}
}

// process operator status changed. or unavailable
function processOperatorStatusChanged(ostatus) {
	var depts = new Array();

	operator = ostatus.LoginID;	
	if(Operators[operator] === 'undefined') return;
	var cstatus = Operators[operator].status	
	// update metrics
	if(ostatus.StatusType == 1)	// away
	{
		Overall.oaway++;
		if(cstatus == 2) 		// if operator was available
			Overall.oavail--;
		depts = OperatorDepts[operator];
		if(typeof(depts) === 'undefined') return;	// operator not recognised
		for(var did in depts)
		{
			Departments[depts[did]].oaway++;
			if(cstatus == 2) 		// if operator was available
				Departments[depts[did]].oavail--;
		}
	}
	else if(ostatus.StatusType == 2)	// available
	{
		Overall.oavail++;
		if(cstatus == 1) 		// if operator was away
			Overall.oaway--;
		depts = OperatorDepts[operator];
		if(typeof(depts) === 'undefined') return;	// operator not recognised
		for(var did in depts)
		{
			Departments[depts[did]].oavail++;
			if(cstatus == 1) 		// if operator was away
				Departments[depts[did]].oaway--;
		}
	}
	else if(ostatus.StatusType == 0)		// logged out
	{
		if(cstatus == 1) 		// if operator was away
			Overall.oaway--;
		else if(cstatus == 2)	// or available previously
			Overall.oavail--;
		
		depts = OperatorDepts[operator];
		if(typeof(depts) === 'undefined') return;	// operator not recognised
		for(var did in depts)
		{
			if(cstatus == 1) 		// if operator was away
				Departments[depts[did]].oaway--;
			else if(cstatus == 2)	// or available previously
				Departments[depts[did]].oavail--;
		}
	}
	Operators[operator].status = ostatus.StatusType;
}

// process all inactive (closed) chat objects
function allInactiveChats(chats) {
	var sh,sm,eh,em,sindex,eindex;
//	var conc = new Array();
	var opobj;
	for(var i in chats)
	{
		processClosedChat(chats[i]);	// add the chat to AllChats object
		
		// now save time/duration the chat was active to help calculate concurrency later
		tchat = AllChats[chats[i].ChatID];		// get the sanitized chat details
		if(typeof(tchat) === 'undefined') continue;		// if this chat did not exist 
		if(tchat.operator == 0) continue;		// operator id not set - go to next one
		if(tchat.answered == 0 || tchat.closed == 0) continue; // not answered and closed so go to next one
		updateCconc(tchat);
	}
}

function updateCconc(tchat) {
	var conc = OperatorCconc[tchat.operator];		// chat concurrency array
		
	sh = tchat.answered.getHours();
	sm = tchat.answered.getMinutes();
	eh = tchat.closed.getHours();
	em = tchat.closed.getMinutes();
	sindex = (sh*60)+sm;	// convert to minutes from midnight
	eindex = (eh*60)+em;	// convert to minutes from midnight
	for(var count=sindex; count <= eindex; count++)
	{
		conc[count] = conc[count] + 1; // save chat activity for the closed chats
	}			
	OperatorCconc[tchat.operator] = conc;		// save it back for next time	
}

// calculate ACT and Chat per hour - both are done after chats are complete (ended)
function calculateACT_CPH() {
	var tchat,count=0,chattime=0,cph=0;
	var dchattime = new Object();
	var dcount = new Object();
	var dcph = new Object();
	var pastHour = TimeNow - (60*60*1000);	// Epoch time for past hour

	for(var i in Departments)
	{
		Departments[i].act = 0;
		dcount[i] = 0;
		dchattime[i] = 0;
		dcph[i] = 0;
	}
	
	for(var i in AllChats)
	{
		tchat = AllChats[i];
		if(tchat.status == 0 && tchat.ended != 0 && tchat.answered != 0)		// chat ended
		{
			count++;
			dcount[tchat.department] = dcount[tchat.department] + 1;
			ctime = tchat.ended - tchat.answered;
			chattime = chattime + ctime;
			dchattime[tchat.department] = dchattime[tchat.department] + ctime;	
			if(tchat.ended >= pastHour)
			{
				cph++;
				dcph[tchat.department]++;
			}
		}
	}
	
	Overall.cph = cph;
	if(count != 0)	// dont divide by 0
		Overall.act = Math.round((chattime / count)/1000);
	for(var i in dcount)
	{
		if(dcount[i] != 0)	// musnt divide by 0
			Departments[i].act = Math.round((dchattime[i] / dcount[i])/1000);
			
		Departments[i].cph = dcph[i];
	}
}

function calculateASA() {
	var tchat, count = 0, tac = 0, anstime = 0;
	var danstime = new Object();
	var dcount = new Object();
	var dtac = new Object();

	for(var i in Departments)
	{
		Departments[i].asa = 0;
		Departments[i].tac = 0;
		dcount[i] = 0;
		danstime[i] = 0;
		dtac[i] = 0;
	}
	
	for(var i in AllChats)
	{
		tchat = AllChats[i];
		if((tchat.status == 2 || tchat.status == 0) && tchat.answered != 0 && tchat.started != 0)
		{
			count++;
			dcount[tchat.department] = dcount[tchat.department] + 1;
			speed = tchat.answered - tchat.started;
//			if(speed < SLATHRESHOLD)	// asa is within threshold
//				Overall.sla++;
				
			anstime = anstime + speed;
			danstime[tchat.department] = danstime[tchat.department] + speed;
			if(tchat.status == 2)	// active chat
			{
				tac++;
				dtac[tchat.department] = dtac[tchat.department] +1;
			}
		}
	}
	if(count != 0)	// dont divide by 0
		Overall.asa = Math.round((anstime / count)/1000);
	Overall.tac = tac;
	for(var i in dcount)
	{
		if(dcount[i] != 0)	// musnt divide by 0
			Departments[i].asa = Math.round((danstime[i] / dcount[i])/1000);
		Departments[i].tac = dtac[i];
	}
}

function calculateLWT_CIQ() {
	var tchat, waittime, tciq = 0;
	var maxwait = 0;
	
	// first zero out the lwt for all dept
	for(var i in Departments)
	{
		Departments[i].lwt = 0;
		Departments[i].ciq = 0;
	}
	
	// now recalculate the lwt by dept and save the overall
	for(var i in AllChats)
	{
		tchat = AllChats[i];
		if(tchat.status == 1 && tchat.answered == 0 && tchat.started != 0 && tchat.ended == 0)		// chat not answered yet
		{
			tciq++;
			Departments[tchat.department].ciq++;
			waittime = Math.round((TimeNow - tchat.started)/1000);
			if(Departments[tchat.department].lwt < waittime)
				Departments[tchat.department].lwt = waittime;
			
			if(maxwait < waittime)
				maxwait = waittime;
			}
	}
	Overall.lwt = maxwait;
	Overall.ciq = tciq;
}

//use operators by dept to calc chat concurrency and available chat capacity
function calculateACC_CCONC() {
	var dtct = new Object();
	var dmct = new Object();
	var dcap = new Object();
	var active;
	var otct = 0, omct = 0, ocap = 0;
	// first zero out the cconc and acc for all dept
	for(var i in Departments)
	{
		Departments[i].cconc = 0;
		Departments[i].acc = 0;
		dtct[i] = 0;
		dmct[i] = 0;
	}

	
	calculateOperatorConc();
	var acc;
	for(var i in OperatorDepts)
	{
		var depts = new Array();
		depts = OperatorDepts[i];
		if(typeof(depts) === 'undefined') continue;	// operator not recognised
		
		opobj = Operators[i];
		if(typeof(opobj) === 'undefined') continue;	// operator not recognised
		
		otct = otct + opobj.tct;
		omct = omct + opobj.mct;
		if(opobj.status == 2)		// make sure operator is available
		{
			active = opobj.ccap - opobj.activeChats.length;
			if(active < 0) active = 0;			// make sure not negative
			ocap = ocap + active;
		}
		// all depts that the operator belongs to
		for(var x in depts)
		{
			dtct[depts[x]] = dtct[depts[x]] + opobj.tct;
			dmct[depts[x]] = dmct[depts[x]] + opobj.mct;
			if(Operators[i].status == 2)	// operator available
			{
				acc = opobj.ccap - opobj.activeChats.length;
				if(acc < 0) acc = 0;		// make sure this is never negative which can occur sometimes
				Departments[depts[x]].acc = Departments[depts[x]].acc + acc;
			}
		}
	}
	console.log("****tct and mct is " +otct+","+omct);
	if(otct != 0)
		Overall.cconc = ((otct+omct)/otct).toFixed(2);
	Overall.acc = ocap;
	for(var did in Departments)
	{
		if(dtct[did] != 0)		// dont divide by zero
			Departments[did].cconc = ((dtct[did]+dmct[did])/dtct[did]).toFixed(2);
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

// calls extraction API and receives JSON objects 
function getApiData(method, params, fcallback, cbparam) {
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
			var jsonObj = JSON.parse(str);
//			console.log("Response received: "+str);
			var data = new Array();
			var next = jsonObj.Next;
			data = jsonObj.Data;
			if(data === 'undefined' || data == null)
			{
				console.log("No data returned: "+str);
				return;		// exit out if error json message received
			}
			fcallback(data, cbparam);

			if(typeof next !== 'undefined') 
			{
//				console.log("*****Next required: "+next);
				loadNext(method, next, fcallback);
			}
		});
		// in case there is a html error
		response.on('error', function(err) {
			// handle errors with the request itself
			console.error("*****Error with the request: ", err.message);
			ApiDataNotReady--;
		});
	});
}

// calculates conc for all inactive chats (used during start up only)
function calculateInactiveConc() {
	if(ApiDataNotReady)
	{
		console.log("Chat data not ready (CiC): "+ApiDataNotReady);
		setTimeout(calculateInactiveConc, 1000);
		return;
	}
	
	calculateOperatorConc();
}

// calculate total chat times for concurrency
function calculateOperatorConc() {
	for(var op in OperatorCconc)
	{
		opobj = Operators[op];
		if(typeof(opobj) === 'undefined') continue;
		var chattime=0, mchattime=0;		// times in minutes
		conc = new Array();
		conc = OperatorCconc[op];
		for(var i in conc)
		{
			if(conc[i] > 0) chattime++;		// all chats
			if(conc[i] > 1) mchattime++;	// multichats
		}
		opobj.tct = opobj.tct + (chattime*60000);		// minutes to milliseconds
		opobj.mct = opobj.mct + (mchattime*60000);		// minutes to milliseconds
	}
}

// gets operator availability info 
function getOperatorAvailabilityData() {
	if(ApiDataNotReady)
	{
		console.log("Static data not ready (OA): "+ApiDataNotReady);
		setTimeout(getOperatorAvailabilityData, 1000);
		return;
	}
	setupOperatorDepts();			// convert dept operators to operator depts for easier updating
	getApiData("getOperatorAvailability", "ServiceTypeID=1", operatorAvailabilityCallback);
}


// gets current active chats 
function getActiveChatData() {
	if(ApiDataNotReady)
	{
		console.log("Static data not ready (AC): "+ApiDataNotReady);
		setTimeout(getActiveChatData, 1000);
		return;
	}
	
	for(var did in Departments)	// active chats are by department
	{
		parameters = "DepartmentID="+did;
		getApiData("getActiveChats",parameters,allActiveChats);
		sleep(200);
	}
}


// gets today's chat data incase system was started during the day
function getInactiveChatData() {
	if(ApiDataNotReady)
	{
		console.log("Static data not ready (IC): "+ApiDataNotReady);
		setTimeout(getInactiveChatData, 1000);
		return;
	}

	// set date to start of today. Search seems to work by looking at closed time i.e. everything that closed after
	// "FromDate" will be included even if the created datetime is before the FromDate.
//	var startDate = new Date();
	var startDate = TimeNow;
	startDate.setHours(0,0,0,0);

	console.log("Getting inactive chat info from "+ Object.keys(Folders).length +" folders");
	var parameters;
	for(var fid in Folders)	// Inactive chats are by folders
	{
		parameters = "FolderID="+fid+"&FromDate="+startDate.toISOString();
		getApiData("getInactiveChats", parameters, allInactiveChats);
		sleep(200);
	}	
}

// Set up callbacks
io.sockets.on('connection', function(socket){
	
	socket.on('authenticate', function(data){
		console.log("authentication request received for: "+data.email);
		if(GMAILS[data.email] === 'undefined')
		{
			console.log("This gmail is invalid: "+data.email);
			socket.emit('errorResponse',"Invalid email");
		}
		else
		{
			Google_Oauth_Request(data.token, function (response) {
			var str = '';
			//another chunk of data has been received, so append it to `str`
			response.on('data', function (chunk) {
				str += chunk;
			});
			//the whole response has been received, take final action.
			response.on('end', function () {
				var jwt = JSON.parse(str);
//				console.log("Response received: "+str);
				if(jwt.aud == GOOGLE_CLIENT_ID)		// valid token response
				{
//					console.log("User authenticated, socket id: "+socket.id);
					LoggedInUsers.push(socket.id);		// save the socket id so that updates can be sent
					socket.emit('authResponse',"success");
				}
				else
					socket.emit('errorResponse',"Invalid token");
				});
			});
		}
	});

	socket.on('un-authenticate', function(data){
		console.log("un-authentication request received: "+data.email);
		if(GMAILS[data.email] === 'undefined')
		{
			console.log("This gmail is invalid: "+data.email);
			socket.emit('errorResponse',"Invalid email");
		}
		else
		{
			console.log("Valid gmail: "+data.email);
			var index = LoggedInUsers.indexOf(socket.id);
			if(index > -1) LoggedInUsers.splice(index, 1);
		}
	});
	
	socket.on('disconnect', function(data){
		console.log("connection disconnect");
		var index = LoggedInUsers.indexOf(socket.id);	
		if(index > -1) LoggedInUsers.splice(index, 1);	// remove from list of valid users
	});
	
		socket.on('end', function(data){
		console.log("connection ended");
	});

});

function updateChatStats() {
	TimeNow = new Date();		// update the time for all calculations
	if(TimeNow > EndOfDay)		// we have skipped to a new day
	{
		doStartOfDay();
		console.log("New day started, stats reset");
		setTimeout(updateChatStats, 10000);
		return;
	}
	calculateLWT_CIQ();
	calculateASA();
	calculateACT_CPH();
	calculateACC_CCONC();
	Overall.tco = Overall.tcan + Overall.tcuq + Overall.tcua;
	for(var did in Departments)
	{
		Departments[did].tco = Departments[did].tcan + Departments[did].tcuq + Departments[did].tcua;
	}
	
	for(var i in LoggedInUsers)
	{
		socket = LoggedInUsers[i];
//		console.log("Socket id is: "+socket);
		io.sockets.connected[socket].emit('overallStats', Overall);
		io.sockets.connected[socket].emit('departmentStats', Departments);
	}
//	debugLog("Overall", Overall);
	setTimeout(updateChatStats, 2000);	// send update every second
}

function tidyUp() {
	getApiData("getOperatorAvailability", "ServiceTypeID=1", operatorAvailabilityCallback);
	setTimeout(tidyUp,60000);			// tidy up every minute
}
doStartOfDay();		// initialise everything
setTimeout(updateChatStats,5000);	// updates socket io data at infinitum
//setTimeout(tidyUp,60000);			// tidy up every minute
