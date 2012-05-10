/*global require: true*/
/*global exports: true*/
/*global console: true*/
/*global module: true*/

var net = require('net');
var EventEmitter = require('events').EventEmitter;
var SmpProtocol = require('./protocol').SmpProtocol;

function SmpConnection(tcpSocket, config)
{
    var protocol = this.protocol = new SmpProtocol(this, tcpSocket, config.protocol);

    tcpSocket.on('connect', protocol.connect);
    tcpSocket.on('data', protocol.onData);
    tcpSocket.on('close', protocol.close);
}

require('util').inherits(SmpConnection, EventEmitter);

function SmpServer(config)
{
    var tcpServer = net.createServer(config.socket);

    function socketListening()
    {
        function socketConnection(tcpSocket)
        {
            var connection = new SmpConnection(tcpSocket, config);
            this.emit('connection', connection);
        }

        tcpServer.on('connection', socketConnection);
    }

    tcpServer.listen(config.port, '0.0.0.0');
    tcpServer.on('listening', socketListening);
}

require('util').inherits(SmpServer, EventEmitter);

module.exports.SmpServer = SmpServer;
