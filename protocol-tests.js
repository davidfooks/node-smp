/*global require: true*/
/*global Buffer: true*/
/*global console: true*/

var net = require('net');
var EventEmitter = require('events').EventEmitter;

var SmpConnection = require('./connection').SmpConnection;
var SmpParser = require('./parser').SmpParser;
//var SmpClient = require('./client').SmpClient;
//var SmpServer = require('./server').SmpServer;

function TestSocket(remoteConnection) {}

require('util').inherits(TestSocket, EventEmitter);

TestSocket.prototype.write = function writeBuffer(buffer)
{
    this.remoteConnection.onData(buffer);
    return true;
};

var numPassed = 0;
var numTests = 0;

function result(msg, testResult)
{
    numTests += 1;
    if (testResult)
    {
        numPassed += 1;
        console.log('PASS: ' + msg);
    }
    else
    {
        console.log('FAIL: ' + msg);
    }
}

function protocolTests()
{
    var testSocketA = new TestSocket();
    var testSocketB = new TestSocket();
    var config = {
        heartbeatInterval: 1000,
        messagesPerAck: 512
    };
    var connectionA = new SmpConnection(testSocketA, config);
    var connectionB = new SmpConnection(testSocketB, config);

    // send messages between the 2 protocol instances
    testSocketA.remoteConnection = connectionB;
    testSocketB.remoteConnection = connectionA;

    var testMsgBuffer;

    //
    // Connection test
    //
    var testConnectedPassA = false;
    var testConnectedPassB = false;
    function testConnectedA()
    {
        testConnectedPassA = true;
    }
    function testConnectedB()
    {
        testConnectedPassB = true;
    }

    connectionA.on('connected', testConnectedA);
    connectionB.on('connected', testConnectedB);
    connectionA.connect();
    connectionB.connect();
    result('Connection test A', testConnectedPassA);
    result('Connection test B', testConnectedPassB);

    //
    // Message test
    //
    var testMessage;
    var testMessageString;
    function testMessages(message)
    {
        testMessage = message;
    }
    connectionB.on('message', testMessages);

    testMessageString = "Hello";
    testMsgBuffer = connectionA.createMessageBuffer(testMessageString);

    console.log(((testMessageString.length + 5 === testMsgBuffer.length) ? 'PASS' : 'FAIL') + ': Message test (length)');
    connectionA.writeMessageBuffer(testMsgBuffer);
    result('Message test "' + testMessageString + '"', testMessage === testMessageString);

    testMessageString = "world";
    testMsgBuffer = connectionA.createMessageBuffer(testMessageString);
    connectionA.writeMessageBuffer(testMsgBuffer);
    result('Message test "' + testMessageString + '"', testMessage === testMessageString);

    // zero length message test
    testMessageString = "";
    testMsgBuffer = connectionA.createMessageBuffer(testMessageString);
    connectionA.writeMessageBuffer(testMsgBuffer);
    result('Message test "' + testMessageString + '"', testMessage === testMessageString);

    //
    // Fragmented message tests
    //
    var split1;
    var split2;
    var split3;
    var i;
    testMessageString = "Hello";
    testMsgBuffer = connectionA.createMessageBuffer(testMessageString);
    for (i = 1; i < testMsgBuffer.length - 1; i += 1)
    {
        testMessage = '';
        connectionA.addMessageBufferAck(testMsgBuffer);
        split1 = testMsgBuffer.slice(0, i);
        split2 = testMsgBuffer.slice(i, testMsgBuffer.length);
        //console.log('onData', split1);
        connectionA.tcpSocket.write(split1);
        //console.log('onData', split2);
        connectionA.tcpSocket.write(split2);
        result('Message test "' + testMessageString + '" split ' + i, testMessage === testMessageString);
    }

    for (i = 1; i < testMsgBuffer.length - 2; i += 1)
    {
        testMessage = '';
        connectionA.addMessageBufferAck(testMsgBuffer);
        split1 = testMsgBuffer.slice(0, i);
        split2 = testMsgBuffer.slice(i, i + 1);
        split3 = testMsgBuffer.slice(i + 1, testMsgBuffer.length);
        //console.log('onData', split1);
        connectionA.tcpSocket.write(split1);
        //console.log('onData', split2);
        connectionA.tcpSocket.write(split2);
        connectionA.tcpSocket.write(split3);
        result('Message test "' + testMessageString + '" split2 ' + i, testMessage === testMessageString);
    }

    //
    // Simple soak test
    //
    testMessageString = "This is a long message MDCHAMD ";
    for (i = 0; i < 10; i += 1)
    {
        testMessageString += testMessageString;
    }

    var soakTestPass = true;
    var j;
    for (j = 0; j < 1000; j += 1)
    {
        testMessage = '';
        testMsgBuffer = connectionA.createMessageBuffer(testMessageString);
        connectionA.addMessageBufferAck(testMsgBuffer);
        var startSplit;
        var endSplit = Math.floor(Math.random() * 30);
        for (startSplit = 0; endSplit < testMsgBuffer.length;)
        {
            split1 = testMsgBuffer.slice(startSplit, endSplit);
            connectionA.tcpSocket.write(split1);

            startSplit = endSplit;
            endSplit += Math.floor(Math.random() * 30);
        }
        split1 = testMsgBuffer.slice(startSplit, testMsgBuffer.length);
        connectionA.tcpSocket.write(split1);
        if (testMessage !== testMessageString)
        {
            soakTestPass = false;
            break;
        }
    }
    result('Soak message tests', soakTestPass);

    //
    // Ack overflow test
    //
    var ackTestPass = true;
    var log = false;
    var lastAckUpdateIndex;

    // check that the messages in the buffer are correct
    var minBounds;
    var maxBounds;
    var breakLoop = false;
    var nextValue = null;
    var dummyProtocol = {
        onMessage: function tmpProtocolMessage(data)
        {
            var messageValue = parseInt(data, 10);
            if (messageValue < minBounds || messageValue > maxBounds)
            {
                console.log('ERROR: Messages buffer contains old values');
                ackTestPass = false;
                breakLoop = true;
            }
            if (nextValue && nextValue !== messageValue)
            {
                console.log('ERROR: Messages buffer out of order');
                ackTestPass = false;
                breakLoop = true;
            }
            nextValue = messageValue + 1;
        }
    };
    var dummyParser = new SmpParser(dummyProtocol);

    lastAckUpdateIndex = connectionA.lastAckIndex;
    var bufferExpectedSize = 0;
    // needs to be more than 2 ^ 16 - 1 = 65535
    for (i = 0; i < 66000 * 2 && !breakLoop; i += 1)
    {
        testMessage = '';
        testMessageString = i.toString(10);
        connectionA.write(testMessageString);
        bufferExpectedSize += 1;

        if (testMessage !== testMessageString)
        {
            console.log('ERROR: Messages string incorrect');
            ackTestPass = false;
            break;
        }

        if (lastAckUpdateIndex !== connectionA.lastAckIndex)
        {
            lastAckUpdateIndex = connectionA.lastAckIndex;
            bufferExpectedSize = 0;
        }

        if (connectionA.messagesBuffer.length !== bufferExpectedSize)
        {
            console.log('ERROR: Messages buffer not expected size (expected ' + bufferExpectedSize + ' but found ' + connectionA.messagesBuffer.length);
            ackTestPass = false;
            break;
        }

        // this is slow so only test it one in every 10 times
        if (Math.floor(Math.random() * 10) === 0)
        {
            var protocolMessagesBufferLength = connectionA.messagesBuffer.length;
            minBounds = i - config.messagesPerAck;
            maxBounds = i;
            nextValue = null;
            for (j = 0; j < protocolMessagesBufferLength; j += 1)
            {
                dummyParser.parseData(connectionA.messagesBuffer[j].buf);
            }
        }
    }
    result('Ack overflow test', ackTestPass);
    result('Ack overflow test (Message buffer emptied)', connectionA.messagesBuffer.length <= config.messagesPerAck);

    function checkHeartbeat()
    {
        result('Heartbeat test A', connectionA.lastHeartbeat > Date.now() - (config.heartbeatInterval * 1.5));
        result('Heartbeat test B', connectionB.lastHeartbeat > Date.now() - (config.heartbeatInterval * 1.5));

        //
        // Disconnect test
        //
        var testDisconnectedPass = false;
        function testDisconnected()
        {
            testDisconnectedPass = true;
        }

        connectionB.on('disconnected', testDisconnected);
        testMsgBuffer = new Buffer(1);
        testMsgBuffer.writeUInt8('D'.charCodeAt(0), 0);
        connectionA.tcpSocket.write(testMsgBuffer);
        result('Disconnection test', testDisconnectedPass);

        console.log();
        if (numPassed === numTests)
        {
            console.log('All tests passed');
        }
        else
        {
            console.log('ERROR: ' + (numTests - numPassed) + ' TESTS FAILED!');
        }

        connectionA.destroy();
        connectionB.destroy();
    }

    // After all of these synchronous tests we need to update the heartbeat
    // for the second protocol (to test fairly)
    // In reality this won't be a problem because the heartbeats will be longer
    connectionB.lastHeartbeat = Date.now();
    setTimeout(checkHeartbeat, config.heartbeatInterval * 2);
}

protocolTests();
