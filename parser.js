/*global Buffer: true*/
/*global module: true*/
/*global console: true*/
/*global process: true*/

function SmpParser(protocol)
{
    var msgTypes = this.msgTypes = {
        connected: 'C'.charCodeAt(0),
        disconnected: 'D'.charCodeAt(0),
        message: 'M'.charCodeAt(0),
        ack: 'A'.charCodeAt(0),
        error: 'E'.charCodeAt(0)
    };

    var msgTypeFnLookUp = {};

    var readState;
    var tmpMsgBuffer;

    var resetState = this.resetState = function resetStateFn()
    {
        readState = null;
        tmpMsgBuffer = new Buffer(1024);
    };
    resetState();

    function growBuffer()
    {
        var newBuffer = new Buffer(tmpMsgBuffer.length * 2);
        tmpMsgBuffer.copy(newBuffer);
        tmpMsgBuffer = newBuffer;
    }

    var parseDataRecursive = function parseDataRecursive(buffer, start, end)
    {
        if (start >= end)
        {
            return;
        }
        if (readState)
        {
            //console.log('readState');
            readState.fn(buffer, 0, end);
        }
        else
        {
            var msgTypeId = buffer.readUInt8(start);
            //console.log(String.fromCharCode(msgTypeId));
            var msgTypeFn = msgTypeFnLookUp[msgTypeId];
            if (msgTypeFn)
            {
                msgTypeFn(buffer, start, end);
            }
            else
            {
                console.error('Simple Message Protocol: Unrecongnized message type ' + msgTypeId);
            }
        }
    };

    var parseData = this.parseData = function parseData(buffer)
    {
        parseDataRecursive(buffer, 0, buffer.length);
    };

    var parseFixedLength = function parseFixedLengthFn(buffer, start, end)
    {
        // if not all of the fixed length message bytes are here
        var remainingLength = readState.fixedLength - readState.tmpMsgLength;
        if (start + remainingLength > end)
        {
            // copy the available message bytes
            var partLength = end - start;
            buffer.copy(tmpMsgBuffer, readState.tmpMsgLength, start, start + partLength);
            readState.tmpMsgLength += partLength;
            return;
        }

        var messageStart;
        if (readState.tmpMsgLength > 0)
        {
            // copy the remaining message length bytes
            buffer.copy(tmpMsgBuffer, readState.tmpMsgLength, start, remainingLength);
            messageStart = start + remainingLength;
        }
        else
        {
            messageStart = start + readState.fixedLength;
        }
        readState.nextFn(buffer, start, messageStart, end);
    };

    var parseConnected = function parseConnectedFn(buffer, start, end)
    {
        protocol.onConnected();
        parseDataRecursive(buffer, start + 1, end);
    };

    var parseDisconnected = function parseDisconnectedFn(buffer, start, end)
    {
        protocol.onDisconnected();
        parseDataRecursive(buffer, start + 1, end);
    };

    var parseMessagePart = function parseMessagePartFn(buffer, start, end)
    {
        var msgEnd = start + readState.msgRemainingLength;
        var msgPartLength;
        //console.log('start', start);
        //console.log('end', end);
        //console.log('readState.msgRemainingLength', readState.msgRemainingLength);
        //console.log('msgEnd', msgEnd);
        //console.log('readState.tmpMsgLength', readState.tmpMsgLength);
        if (msgEnd <= end)
        {
            if (readState.tmpMsgLength === 0)
            {
                //console.log('readState "' + buffer.toString('utf8', start, msgEnd) + '"');
                protocol.onMessage(buffer.toString('utf8', start, msgEnd), readState.ackIndex);
            }
            else
            {
                //console.log('tmpMsgBuffer.copy fin');
                msgPartLength = msgEnd - start;
                if (readState.tmpMsgLength + msgPartLength > tmpMsgBuffer.length)
                {
                    growBuffer();
                }
                buffer.copy(tmpMsgBuffer, readState.tmpMsgLength, start, msgEnd);
                readState.tmpMsgLength += msgEnd - start;
                protocol.onMessage(tmpMsgBuffer.toString('utf8', 0, readState.tmpMsgLength), readState.ackIndex);
            }

            // finished reading the message
            //console.log('readstate null');
            readState = null;
            parseDataRecursive(buffer, msgEnd, end);
        }
        else
        {
            msgPartLength = end - start;
            if (readState.tmpMsgLength + msgPartLength > tmpMsgBuffer.length)
            {
                growBuffer();
            }
            buffer.copy(tmpMsgBuffer, readState.tmpMsgLength, start, end);
            readState.msgRemainingLength -= msgPartLength;
            readState.tmpMsgLength += msgPartLength;

            //console.log('tmpMsgBuffer.copy length', readState.tmpMsgLength);
        }
    };

    var parseMessageData = function parseMessageDataFn(buffer, start, messageStart, end)
    {
        var msgLength;
        var ackIndex;
        if (readState.tmpMsgLength > 0)
        {
            ackIndex = tmpMsgBuffer.readUInt16BE(0);
            msgLength = tmpMsgBuffer.readUInt16BE(2);
        }
        else
        {
            ackIndex = buffer.readUInt16BE(start);
            msgLength = buffer.readUInt16BE(start + 2);
        }

        readState = {
            fn: parseMessagePart,
            tmpMsgLength: 0,
            ackIndex: ackIndex,
            msgRemainingLength: msgLength
        };

        if (messageStart < end)
        {
            parseMessagePart(buffer, messageStart, end);
        }
        else if (msgLength === 0)
        {
            // if the message has no length then emit it now
            // or it wont be emitted until parseData is next called
            // and will read the next message type byte!
            protocol.onMessage('', ackIndex);
            readState = null;
        }
    };

    var parseMessage = function parseMessageFn(buffer, start, end)
    {
        readState = {
            fixedLength: 4,
            tmpMsgLength: 0,
            fn: parseFixedLength,
            nextFn: parseMessageData
        };
        parseFixedLength(buffer, start + 1, end);
    };

    var parseHeartbeat = function parseHeartbeatFn(buffer, start, end)
    {
        protocol.heartbeatRecieved();
        parseDataRecursive(buffer, start + 1, end);
    };

    var parseAckIndex = function parseAckIndex(buffer, start, newStart, end)
    {
        var ackIndex;
        if (readState.tmpMsgLength > 0)
        {
            ackIndex = tmpMsgBuffer.readUInt16BE(0);
        }
        else
        {
            ackIndex = buffer.readUInt16BE(start);
        }
        protocol.onAck(ackIndex);
        readState = null;

        parseDataRecursive(buffer, newStart, end);
    };

    var parseAck = function parseAckFn(buffer, start, end)
    {
        readState = {
            fixedLength: 2,
            tmpMsgLength: 0,
            fn: parseFixedLength,
            nextFn: parseAckIndex
        };
        parseFixedLength(buffer, start + 1, end);
    };

    msgTypeFnLookUp[msgTypes.connected] = parseConnected;
    msgTypeFnLookUp[msgTypes.disconnected] = parseDisconnected;
    msgTypeFnLookUp[msgTypes.message] = parseMessage;
    msgTypeFnLookUp[msgTypes.heartbeat] = parseHeartbeat;
    msgTypeFnLookUp[msgTypes.ack] = parseAck;
}

module.exports.SmpParser = SmpParser;
