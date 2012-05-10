/*global Buffer: true*/
/*global module: true*/
/*global console: true*/
/*global process: true*/
/*global require: true*/

var SmpParser = require('./parser').SmpParser;
var EventEmitter = require('events').EventEmitter;

function SmpConnection(tcpSocket, config)
{
    this.tcpSocket = tcpSocket;
    this.config = config;

    this.errorLookup = {
        heartbeat: 0,
        transmission: 1,
        remoteDisconnect: 2,
        remoteClose: 3,
        tcpError: 4
    };

    var parser = this.parser = new SmpParser(this);
    this.sentAckIndex = 0;
    this.sentSinceLastAck = 0;
    this.lastAckIndex = 0;

    this.recievedAckIndex = 0;
    this.recievedSinceLastAck = 0;

    // Prepare the fixed size buffers
    var connectedBuffer = this.connectedBuffer = new Buffer(1);
    connectedBuffer.writeUInt8(parser.msgTypes.connected, 0);

    var disconnectedBuffer = this.disconnectedBuffer = new Buffer(1);
    disconnectedBuffer.writeUInt8(parser.msgTypes.disconnected, 0);

    var ackBufferReference = false;
    var ackBuffer = this.ackBuffer = new Buffer(3);
    ackBuffer.writeUInt8(parser.msgTypes.ack, 0);

    // this buffer holds a record of messages sent
    // so if we lose the connection then they are not lost
    this.messagesBuffer = [];
}

require('util').inherits(SmpConnection, EventEmitter);

SmpConnection.prototype.destroy = function destroyFn()
{
    clearInterval(this.heartbeatInterval);
};

SmpConnection.prototype.onData = function onDataFn(buffer)
{
    this.parser.parseData(buffer);
};

SmpConnection.prototype.onConnected = function connectedFn()
{
    if (this.connected)
    {
        return;
    }
    this.emit('connected');
    this.connected = true;

    var that = this;
    var heartbeatInterval = this.config.heartbeatInterval;
    this.lastHeartbeat = Date.now();
    function sendAndCheckHeartbeat()
    {
        // send heartbeat
        that.writeAck();

        // check heartbeat
        if (that.lastHeartbeat < Date.now() - (heartbeatInterval * 1.5))
        {
            console.log('Heartbeat timeout');
            // stop parser state if we are halfway through a message
            that.parser.resetState();
            that.connected = false;
            that.emit('disconnected', {'err': that.errorLookup.heartbeat, 'msg': 'Heartbeat timeout'});
        }
    }

    if (heartbeatInterval)
    {
        this.heartbeatInterval = setInterval(sendAndCheckHeartbeat, heartbeatInterval);
    }
};

SmpConnection.prototype.onDisconnected = function disconnectedFn()
{
    if (this.connected)
    {
        this.emit('disconnected', {'err': this.errorLookup.remoteDisconnect, 'msg': 'Connection disconnected remotely'});
        this.connected = false;
    }
};

SmpConnection.prototype.onMessage = function messageFn(data, ackIndex)
{
    //console.log('message', this.recievedAckIndex, ackIndex);
    if (this.recievedAckIndex + 1 === ackIndex || (this.recievedAckIndex === 65535 && ackIndex === 0))
    {
        this.recievedAckIndex = ackIndex;
        this.emit('message', data);
        this.recievedSinceLastAck += 1;

        if (this.recievedSinceLastAck > this.config.messagesPerAck)
        {
            this.writeAck();
        }
    }
};

SmpConnection.prototype.onAck = function ackFn(ackIndex)
{
    this.lastHeartbeat = Date.now();
    // remove all the messages that have been confirmed as sent
    if (ackIndex > this.lastAckIndex)
    {
        this.messagesBuffer = this.messagesBuffer.slice(ackIndex - this.lastAckIndex);
    }
    else
    {
        // the ack index has wrapped round so add 2^16
        this.messagesBuffer = this.messagesBuffer.slice(65536 + (ackIndex - this.lastAckIndex));
    }
    this.lastAckIndex = ackIndex;
};

SmpConnection.prototype.write = function writeFn(message)
{
    if (!this.connected)
    {
        console.error('SMP ERROR: Cannot write to disconnected socket');
        return;
    }

    this.sentAckIndex += 1;
    this.sentSinceLastAck += 1;
    if (this.sentAckIndex > 65535)
    {
        this.sentAckIndex = 0;
    }

    var buffer = this.createMessageBuffer(message);
    buffer.writeUInt16BE(this.sentAckIndex, 1);

    this.messagesBuffer.push({buf: buffer});
    this.tcpSocket.write(buffer);
};

// Returns true if the buffer is safe to modify.
// Otherwise, callback is called once the buffer is safe to modify.
SmpConnection.prototype.writeMessageBuffer = function writeMessageBuffer(messageBuffer, callback)
{
    if (!this.connected)
    {
        console.error('SMP ERROR: Cannot write to disconnected socket');
        return null;
    }

    this.sentAckIndex += 1;
    this.sentSinceLastAck += 1;
    if (this.sentAckIndex > 65535)
    {
        this.sentAckIndex = 0;
    }

    messageBuffer.writeUInt16BE(this.sentAckIndex, 1);

    this.messagesBuffer.push({buf: messageBuffer, ack: this.sentAckIndex});
    return this.tcpSocket.write(messageBuffer, callback);
};

SmpConnection.prototype.connect = function connectFn()
{
    this.tcpSocket.write(this.connectedBuffer);
};

SmpConnection.prototype.disconnect = function disconnectFn()
{
    this.tcpSocket.write(this.disconnectedBuffer);
    clearInterval(this.heartbeatInterval);
};

SmpConnection.prototype.close = function closeFn(transmissionError)
{
    if (this.connected)
    {
        // stop parser state if we are halfway through a message
        this.parser.resetState();
        this.connected = false;
        var error;
        if (transmissionError)
        {
            error = {'err': this.errorLookup.transmission, 'msg': 'Transmission error'};
        }
        else
        {
            error = {'err': this.errorLookup.remoteClose, 'msg': 'Connection closed remotely'};
        }
        this.emit('disconnected', error);
    }
};

SmpConnection.prototype.error = function errorFn(error)
{
    this.emit('error', error);
};

SmpConnection.prototype.writeAck = function writeAckFn()
{
    var that = this;
    this.recievedSinceLastAck = 0;

    function clearReference()
    {
        that.ackBufferReference = false;
    }

    // try to reuse the buffer if possible
    if (!this.ackBufferReference)
    {
        this.ackBuffer.writeUInt16BE(this.recievedAckIndex, 1);
    }
    else
    {
        // otherwise just create a new buffer
        var ackBuffer = this.ackBuffer = new Buffer(3);
        ackBuffer.writeUInt8(this.parser.msgTypes.ack, 0);
        ackBuffer.writeUInt16BE(this.recievedAckIndex, 1);
    }

    var flushed = this.tcpSocket.write(this.ackBuffer, clearReference);
    this.ackBufferReference = !flushed;
};

// Testing function do not use!
SmpConnection.prototype.addMessageBufferAck = function addMessageBufferAckFn(messageBuffer)
{
    this.sentAckIndex += 1;
    if (this.sentAckIndex > 65535)
    {
        this.sentAckIndex = 0;
    }
    messageBuffer.writeUInt16BE(this.sentAckIndex, 1);
};

SmpConnection.prototype.createMessageBuffer = function createMessageBuffer(message)
{
    var messageLength = message.length;
    if (messageLength > 65535)
    {
        console.error('SMP ERROR: Message is too long');
        return null;
    }
    var buffer = new Buffer(messageLength + 5);
    buffer.writeUInt8(this.parser.msgTypes.message, 0);
    buffer.writeUInt16BE(messageLength, 3);
    // we leave the ack bytes for the writeMessageBuffer call to fill in
    buffer.write(message, 5);

    return buffer;
};

module.exports.SmpConnection = SmpConnection;
