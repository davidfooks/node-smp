/*global require: true*/
/*global module: true*/
/*global console: true*/
/*global Buffer: true*/

var net = require('net');

var tcpSocket = net.Socket();
var tcpSocketConnected = false;

var writeQueueSize = 256;
var writeQueue = new Array(writeQueueSize);
var writeQueueStart = 0;
var writeQueueEnd = 0;
var writeQueueEmpty = true;

function writeCompleted()
{
    console.log('writeCompleted');
    writeQueue[writeQueueStart] = null;
    writeQueueStart += 1;
    if (writeQueueStart > writeQueueSize)
    {
        writeQueueStart = 0;
    }
    if (writeQueueEnd === writeQueueStart)
    {
        writeQueueEmpty = true;
    }
}

function socketDrain()
{
    console.log('socketDrain');
}

var write = this.write = function write(buffer)
{
    if (!tcpSocketConnected)
    {
        return false;
    }
    if (!writeQueueEmpty && writeQueueEnd === writeQueueStart)
    {
        // we have probably lost connection here
        console.error('BUFFER FULL');
        return false;
    }

    var flushed = tcpSocket.write(buffer, null, writeCompleted);
    if (!flushed)
    {
        console.log('you forgot to flush');
        writeQueue[writeQueueEnd] = buffer;
        writeQueueEmpty = false;
        writeQueueEnd += 1;
        if (writeQueueEnd > writeQueueSize)
        {
            writeQueueEnd = 0;
        }
    }
    return true;
};

function socketConnection()
{
    console.log('connected');
    tcpSocketConnected = true;
    write('Hello\n');
}

var count = 0;

function socketHeartbeat()
{
    count += 1;
    console.log('Sending "Heartbeat ' + count + '"');
    write('Heartbeat ' + count + '\n');
}

setInterval(socketHeartbeat, 1000);

function socketData(buffer)
{
    console.log(buffer.toString());
}

function socketClose(transmissionError)
{
    tcpSocketConnected = false;
    console.log('socket closed');

    var i;
    var writeQueueLength = writeQueueEnd - writeQueueStart;
    if (writeQueueLength < 0)
    {
        writeQueueLength = writeQueueSize - writeQueueLength;
    }
    for (i = writeQueueStart; i !== writeQueueEnd; i += 1)
    {
        console.log(writeQueue[i].toString());
        if (i > writeQueueSize)
        {
            i = 0;
        }
    }
}

function socketError(error)
{
    console.log(error);
}

tcpSocket.connect(9999, '192.168.0.65');

tcpSocket.on('connect', socketConnection);
tcpSocket.on('data', socketData);
tcpSocket.on('close', socketClose);
tcpSocket.on('drain', socketDrain);
tcpSocket.on('error', socketError);

