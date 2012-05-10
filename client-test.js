/*global require: true*/
/*global console: true*/

var SmpClient = require('./client').SmpClient;

var config = {
    host: '127.0.0.1',
    port: 9999
};

var smpClient = new SmpClient(config);

var smpConnection = smpClient.connect();

function onConnect()
{
    console.log('Connected to ' + config.host + ':' + config.port);
    smpConnection.write('Hello from the client');
}

function onMessage(msg)
{
    console.log('Recieved: "' + msg + '"');
}

function onDisconnect(msg)
{
    console.log('Disconnected');
}

function onError(error)
{
    console.log(error);
}

smpConnection.on('connect', onConnect);
smpConnection.on('message', onMessage);
smpConnection.on('disconnect', onDisconnect);
smpConnection.on('error', onError);

var hiyoCount = 0;
function hiyo()
{
    smpConnection.write('Hiyo! ' + hiyoCount);
    hiyoCount += 1;
}

setInterval(hiyo, 1000);
