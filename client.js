/*global require: true*/
/*global module: true*/
/*global console: true*/
/*global Buffer: true*/

var net = require('net');
var EventEmitter = require('events').EventEmitter;
var SmpProtocol = require('./protocol').SmpProtocol;

function SmpClient(config)
{
    var that = this;
    var tcpSocket = this.tcpSocket = net.Socket(config.socket);
    var protocol = this.protocol = new SmpProtocol(this, tcpSocket, config.protocol);

    tcpSocket.connect(config.port, config.host);

    tcpSocket.on('connect', protocol.connect);
    tcpSocket.on('data', protocol.onData);
    tcpSocket.on('close', protocol.close);
}

require('util').inherits(SmpClient, EventEmitter);

SmpClient.prototype.write = function write(string)
{
    this.protocol.write(string);
};

module.exports.SmpClient = SmpClient;
