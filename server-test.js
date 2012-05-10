/*global require: true*/
/*global console: true*/

var SmpServer = require('./server').SmpServer;

var config = {
    host: '127.0.0.1',
    port: 9999
};

var smpServer = new SmpServer(config);

function listening()
{
    function onConnection(smpConnection)
    {
        console.log('Client connection ' + smpConnection.tcpSocket.remoteAddress + ':' + config.port);
        smpConnection.write('Hello from the server');

        function onMessage(msg)
        {
            console.log('Recieved: "' + msg + '"');
        }

        function onDisconnect(msg)
        {
            console.log('Disconnected');
        }

        smpConnection.on('message', onMessage);
        smpConnection.on('disconnect', onDisconnect);
    }
    smpServer.on('connection', onConnection);
}
smpServer.listen(listening);
