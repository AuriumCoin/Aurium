const dgram = require('dgram');
const server = dgram.createSocket('udp6');
const DNS = require('dns');
const ip6addr = require('ip6addr');

const ed25519 = require('./ed25519.js');
const crypto = require('crypto');
const blake2 = require('blake2');

const NodeSecretKey = crypto.randomBytes(64);
const NodePublicKey = ed25519.getPublicKey(NodeSecretKey);

const { isIPv4, isIPv6 } = require('net');

const {
    encodeHeader,
    decodeHeader,
    getBodySize
} = require('./stream.js');

// For the love of god, don't use boost (colin moment)

const yargs = require('yargs/yargs')
const { hideBin } = require('yargs/helpers')

const argv = yargs(hideBin(process.argv)).options({
    port: { 
        type: 'number',
        alias: 'p',
        default: 7145,
        describe: '[integer] Set a port number. 0 means no port binding',
        array: false
    },
    listenAddress: { 
        type: 'string',
        alias: 'a',
        default: '::',
        describe: '[string] Set a listening address. Has to be IPv6',
        array: false
    },
    'default-peer': { 
        type: 'string',
        alias: 'd',
        default: '127.0.0.1:8081',
        describe: '[IP]:[PORT] Set the peer which Node connects on first start up.',
        array: true
    }
    
}).check(function (argv) {
    if (Array.isArray(argv.port)) {
        throw new Error('Argument check failed: Multiple instances of option port.');
    }
    if (Number.isNaN(argv.port)) {
        throw new Error('Argument check failed: Port is Not a Number.');
    }
    if (!Number.isInteger(argv.port)) {
        throw new Error('Argument check failed: Port is Not a Integer.');
    }

    if (argv.port > 65535) {
        throw new Error('Argument check failed: Port is Not a Valid Port.');
    }

    if (!isIPv6(argv.listenAddress)) {
        throw new Error('Argument check failed: Listening Addrses is not a valid IPv6 Address.');
    }

    if (!(argv['default-peer'].length === 1 && argv['default-peer'][0] === "0")) {
        for (const pair of argv['default-peer']) {
            const pairSegments = pair.split(":");
            if (pairSegments.length < 2) {
                throw new Error('Argument check failed: Invalid Peer Format. 1');
            }
            if (pairSegments.length > 2) {
                if (!isIPv6(pairSegments.slice(0, -1).join(":"))) {
                    throw new Error('Argument check failed: Invalid Peer Format. 2');
                }
            }
    
            if (isNaN(pairSegments[pairSegments.length-1])) {
                throw new Error('Argument check failed: Invalid Peer Format.');
            }
        }
    }

    return true;
}).argv

//console.log(argv)

server.bind(argv.port, argv.listenAddress);

function isArgTrue(arg) {
    if (arg === "true") return true;
    if (arg == 1) return true;

    return false;
}

const defaultPeerList = [];


const peerList = new Map();

/* 
{
    isConnected: Boolean
    NodeID: Buffer <32 bytes> / null
    lastPing: Timestamp,
    cookie: Buffer <32 bytes>,
    hasCookie: Boolean,
    sharedSecret: Buffer <32 bytes> / null,
    msgHeight: Bigint,
    thisMsgHeight: Bigint,
}
*/

function XORBuffer32(buf1, buf2) {
    const buf = Buffer.alloc(32);
    for (var i = 0; i < 32; i++) {
        buf[i] = buf1[i] ^ buf2[i]
    }

    return buf;
}

function signMessage(message, height, sharedSecret, cookie) {
    const h = blake2.createKeyedHash('blake2b', Buffer.concat([
        sharedSecret,
        cookie
    ]));
    const buf = Buffer.alloc(message.length + 8);
    buf.writeBigUInt64BE(height);
    buf.set(message, 8);
    h.update(buf);
 
    return h.digest();
}

function establishConnection(address, port, raw) {
    const thisCookie = crypto.randomBytes(32);
    peerList.set(raw.toString("binary"), {
        isConnected: false,
        NodeID: null,
        lastPing: 0,
        cookie: thisCookie,
        hasCookie: false,
        sharedSecret: null,
        msgHeight: 0n,
        thisMsgHeight: 1n
    })

    server.send(Buffer.concat([
        encodeHeader(0, 1 | 4),
        thisCookie,
        NodePublicKey
    ]), port, address);
}

for (const peer of argv['default-peer']) {
    if (peer === "0") break;
    const peerSegments = peer.split(":");
    const port = Number(peerSegments[peerSegments.length-1]);
    const address = peerSegments.slice(0, -1).join(":");

    if (isIPv4(address)) {
        const buf = Buffer.alloc(18);
        const rawAddress = ip6addr.parse('::ffff:'+address).toBuffer();
        buf.set(rawAddress);
        buf.writeUInt16LE(port, 16);
        defaultPeerList.push(buf);

        establishConnection('::ffff:'+address, port, buf);
    } else if (isIPv6(address)) {
        const buf = Buffer.alloc(18);
        const rawAddress = ip6addr.parse(address).toBuffer();
        buf.set(rawAddress);
        buf.writeUInt16LE(port, 16);
        defaultPeerList.push(buf);


        establishConnection(address, port, buf);
    } else {
        throw Error('DNS not supported yet.');
    }
}

function getRawConnecitonInfo(rinfo) {
    const buf = Buffer.alloc(18);
    const rawAddress = ip6addr.parse(rinfo.address).toBuffer();
    buf.set(rawAddress);
    buf.writeUInt16LE(rinfo.port, 16);

    return buf;
}

server.on('message', (msg, rinfo) => {
    if (msg.length < 2) return;
    const header = decodeHeader(msg);
    const body = msg.subarray(2);
    const expectedBodySize = getBodySize(header);
    if (body.length !== expectedBodySize) return;
    const connectionID = getRawConnecitonInfo(rinfo).toString("binary");

    const peerEntry = peerList.get(connectionID);


    switch (header.opcode) {
        case 0: {
            const isNewConnection = (header.extensions & 4);
            if (peerEntry == null && !isNewConnection) return;
            const hasCookie = (header.extensions & 1);
            const hasResponse = (header.extensions & 2);

            if (hasCookie) {
                const NodeID = body.subarray(32, 64);
                const sharedSecret = ed25519.getSharedSecret(
                    NodeSecretKey,
                    NodeID
                )
                
                if (isNewConnection) {
                    const thisCookie = crypto.randomBytes(32);
                    peerList.set(connectionID, {
                        isConnected: false,
                        NodeID: body.subarray(32, 64),
                        lastPing: 0,
                        cookie: XORBuffer32(thisCookie, body),
                        hasCookie: true,
                        sharedSecret: sharedSecret,
                        msgHeight: 1n,
                        thisMsgHeight: 1n
                    });

                    console.log("Shared Secret", sharedSecret);
                    console.log("Cookie", XORBuffer32(thisCookie, body));

                    server.send(Buffer.concat([
                        encodeHeader(0, 1),
                        thisCookie,
                        NodePublicKey
                    ]), rinfo.port, rinfo.address);
                } else if (!peerEntry.hasCookie) {
                    peerEntry.hasCookie = true;
                    const cookie = XORBuffer32(peerEntry.cookie, body);
                    peerEntry.cookie = cookie;

                    console.log("Shared Secret", sharedSecret);
                    console.log("Cookie", cookie);

                    peerEntry.sharedSecret = sharedSecret;

                }
            }

            break;
        }
        case 1: {
            break;
        }
    }
    console.log("server got:", header, ` from ${rinfo.address}:${rinfo.port}`);
});

server.on('listening', () => {
    const address = server.address();
    console.log(`Socket listening ${address.address}:${address.port}`);
});