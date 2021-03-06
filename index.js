const dgram = require('dgram');
const server = dgram.createSocket('udp6');
const DNS = require('dns');
const ip6addr = require('ip6addr');

const ledger = require("./database.js");

const {
    PEER_EXPIRY
} = require("./constants.js");

const ed25519_blake2b = require('./ed25519-blake2b/index.js');

const ed25519 = require('./ed25519-light.js');
const crypto = require('crypto');
const blake2 = require('blake2');

const startHTTPAPI = require('./http-api.js');

const ECDH_basepoint = new Uint8Array(32);
ECDH_basepoint[0] = 9;

const NodeSecretKey = crypto.randomBytes(64);
const NodePublicKey = ed25519_blake2b.publicKeyRaw(NodeSecretKey); //ed25519.getPublicKey(NodeSecretKey);

function getSharedSecret(secretKey, publicKey) {
    const sharedSecret = Buffer.alloc(32);
    ed25519_blake2b.bindings.node_ecdh(sharedSecret, secretKey, ed25519.toX25519(publicKey));

    return sharedSecret;
}

function test_ed25519() {
    const old_ed25519 = require('./ed25519.js');

    const TestSecretKey = crypto.randomBytes(64);
    const TestPublicKey = ed25519_blake2b.publicKeyRaw(TestSecretKey);
    
    const sharedSecret = Buffer.from(old_ed25519.getSharedSecret(
        NodeSecretKey,
        TestPublicKey
    ));
    
    const sharedSecret2 = getSharedSecret(
        TestSecretKey,
        NodePublicKey
    );
    
    const ed25519_test1 = sharedSecret2.equals(sharedSecret);
    const ed25519_test2 = NodePublicKey.equals(Buffer.from(old_ed25519.getPublicKey(NodeSecretKey)));
    
    const ed25519_testPass = ed25519_test1 && ed25519_test2;

    console.log("ED25519 Shared Secrets, passed?", ed25519_test1);
    console.log("ED25519 Public Keys, passed?", ed25519_test2, "\n");
    
    console.log("Is ED25519 Configured Properly?", ed25519_testPass);
    
    if (!ed25519_testPass) {
        process.exit();
    }
}

test_ed25519();

const { isIPv4, isIPv6 } = require('net');

const {
    encodeHeader,
    decodeHeader,
    getBodySize
} = require('./stream.js');

// For the love of god, don't use boost (colin moment)

const yargs = require('yargs/yargs')
const { hideBin } = require('yargs/helpers')

const PrivateKeyHexRegex = /^[0-9A-Fa-f]+$/;

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
    httpPort: { 
        type: 'number',
        describe: '[number] Set a port number. Nothing means no HTTP API',
        array: false
    },
    'default-peer': { 
        type: 'string',
        alias: 'd',
        default: '127.0.0.1:8081',
        describe: '[IP]:[PORT] Set the peer which Node connects on first start up.',
        array: true
    },
    'privateKey': { 
        type: 'string',
        alias: 'k',
        default: [],
        describe: 'Representative Private Key for Voting. You can only specify up to 31 representatives.',
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
                throw new Error('Argument check failed: Invalid Peer Format.');
            }
            if (pairSegments.length > 2) {
                if (!isIPv6(pairSegments.slice(0, -1).join(":"))) {
                    throw new Error('Argument check failed: Invalid Peer Format.');
                }
            }
    
            if (isNaN(pairSegments[pairSegments.length-1])) {
                throw new Error('Argument check failed: Invalid Peer Format.');
            }
        }
    }

    if (argv.privateKey.length > 31) {
        throw new Error('Argument check failed: More than 31 Representatives Specified.');
    }

    for (const key of argv.privateKey) {
        if (key.length !== 64 || !PrivateKeyHexRegex.test(key)) {
            throw new Error('Argument check failed: Invalid Private Key: ' + key);
        }
    }

    return true;
}).argv

server.bind(argv.port, argv.listenAddress);

function isArgTrue(arg) {
    if (arg === "true") return true;
    if (arg == 1) return true;

    return false;
}

const peerList = new Map();

const nodeState = {
    peerList,
    ledger
}

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

function _signMessage(message, height, sharedSecret, cookie) {
    const h = blake2.createKeyedHash('blake2b', Buffer.concat([
        sharedSecret,
        cookie
    ]), {digestLength: 32});
    const buf = Buffer.alloc(message.length + 8);
    buf.writeBigUInt64BE(height);
    buf.set(message, 8);
    h.update(buf);
 
    return h.digest();
}

function signMessage(message, height, sharedSecret, cookie) {
    const signature = _signMessage(message, height, sharedSecret, cookie);
 
    return Buffer.concat([
        message,
        signature
    ]);
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

function connectDefault() {
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
    
            establishConnection('::ffff:'+address, port, buf);
        } else if (isIPv6(address)) {
            const buf = Buffer.alloc(18);
            const rawAddress = ip6addr.parse(address).toBuffer();
            buf.set(rawAddress);
            buf.writeUInt16LE(port, 16);
    
            establishConnection(address, port, buf);
        } else {
            throw Error('DNS not supported yet.');
        }
    }
}

function getRawConnecitonInfo(rinfo) {
    const buf = Buffer.alloc(18);
    const rawAddress = ip6addr.parse(rinfo.address).toBuffer();
    buf.set(rawAddress);
    buf.writeUInt16LE(rinfo.port, 16);

    return buf;
}

function encodeIPv6(raw) {
    const hex = raw.toString('hex')
    const hexParts = hex.match(/.{1,4}/g)
    const subnet = hexParts[5]
    let formattedAddress
    formattedAddress = hexParts.join(':')
    return formattedAddress
  }

function decodeConnectionInfo(connection) {
    const address = encodeIPv6(connection.subarray(0, 16))
    const port = connection.readUInt16LE(16)
    return {
        address,
        port
    }
}

function getPeers() {
    let array = [];
    for (const [key, value] of peerList.entries()) {
        if (value.isConnected === true && ((Date.now() - value.lastPing) < PEER_EXPIRY)) {
            array.push(Buffer.from(key, "binary"));
        }
    }
    array = array.sort(() => 0.5 - Math.random()).slice(0, 15);

    return array;
}

function sendSignedMessage(message, address, port, sharedSecret, cookie) {
    server.send(signMessage(
        message,
        0n,
        sharedSecret,
        cookie
    ), port, address);
}

function sendPeers(peers, address, port, sharedSecret, cookie) {
    sendSignedMessage(
        Buffer.concat([
            encodeHeader(2, peers.length),
            ...peers
        ]),
        address, port, sharedSecret, cookie
    )
}

function broadcastBlock(block) {
    const message = Buffer.concat([
        encodeHeader(2, block[0]),
        block.subarray(1)
    ]);
    for (const [key, value] of peerList.entries()) {
        if (value.isConnected === true && ((Date.now() - value.lastPing) < PEER_EXPIRY)) {
            const rinfo = decodeConnectionInfo(Buffer.from(key, 'binary'));
            server.send(message, rinfo.port, rinfo.address);
        }
    }
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
                if (NodeID.equals(NodePublicKey)) return;
                const sharedSecret = getSharedSecret(
                    NodeSecretKey,
                    NodeID
                )

                if (isNewConnection) {
                    const thisCookie = crypto.randomBytes(32);
                    const newCookie = XORBuffer32(thisCookie, body);

                    peerList.set(connectionID, {
                        isConnected: false,
                        NodeID,
                        lastPing: 0,
                        cookie: newCookie,
                        hasCookie: true,
                        sharedSecret: sharedSecret,
                        msgHeight: 1n,
                        thisMsgHeight: 1n
                    });

                    server.send(signMessage(Buffer.concat([
                            encodeHeader(0, 1 | 2),
                            thisCookie,
                            NodePublicKey
                        ]),
                        0n,
                        sharedSecret,
                        newCookie
                    ), rinfo.port, rinfo.address);

                    sendPeers(getPeers(), rinfo.address, rinfo.port, sharedSecret, newCookie);
                } else if (!peerEntry.hasCookie) {
                    const newCookie = XORBuffer32(peerEntry.cookie, body);
                    peerEntry.hasCookie = true;
                    peerEntry.cookie = newCookie;
                    peerEntry.NodeID = NodeID;

                    peerEntry.sharedSecret = sharedSecret;

                    server.send(signMessage(
                        encodeHeader(0, 2),
                        0n,
                        sharedSecret,
                        newCookie
                    ), rinfo.port, rinfo.address);

                    sendPeers(getPeers(), rinfo.address, rinfo.port, sharedSecret, newCookie);
                }
            }

            if (hasResponse && !isNewConnection && !peerEntry.isConnected && peerEntry.sharedSecret) {
                const signature = _signMessage(msg.subarray(0, -32), 0n, peerEntry.sharedSecret, peerEntry.cookie);

                const isValid = (msg.subarray(-32).equals(signature));

                if (isValid) {
                    peerEntry.isConnected = true;
                    peerEntry.lastPing = Date.now()
                    console.log("Established Secure Connection")
                }
            }

            break;
        }
        case 1: {
            if (peerEntry) {
                peerEntry.lastPing = Date.now()
            }
            break;
        }
        case 2: {
            if (peerEntry) {
                const signature = _signMessage(msg.subarray(0, -32), 0n, peerEntry.sharedSecret, peerEntry.cookie);

                const isValid = (msg.subarray(-32).equals(signature));

                if (isValid) {
                    const peerCount = header.extensions & 15;
                    
                    for (var i = 0; i < peerCount; i++) {
                        const peerPtr = i * 18;
                        const peer = body.subarray(peerPtr, peerPtr + 18);
                        const peerBinary = peer.toString("binary");

                        if (peerList.has(peerBinary)) continue;

                        const connectionInfo = decodeConnectionInfo(peer);

                        console.log("New Peer: [" + connectionInfo.address + "]:" + connectionInfo.port);
                        
                        establishConnection(
                            connectionInfo.address, 
                            connectionInfo.port, 
                            peerBinary
                        );
                    }
                }
            }

            break;
        }

        case 3: {
            const block = Buffer.alloc(body.length + 1);
            block[0] = header.extensions & 0xff;
            block.set(body, 1);

            ledger.insertBlock({
                block,
                /*callback: function (result) {
                    if (result == 0) {
                        broadcastBlock(block);
                    }
                }*/
            });
            break;
        }

    }
});

ledger.ledgerEvents.on("blockInserted", (block) => {
    broadcastBlock(block);
})

setInterval(() => {
    for (const [key, value] of peerList.entries()) {
        if (value.isConnected === true && ((Date.now() - value.lastPing) < PEER_EXPIRY)) {
            const rinfo = decodeConnectionInfo(Buffer.from(key, 'binary'));
            server.send(encodeHeader(1, 0), rinfo.port, rinfo.address);
        }
    }
}, 60 * 1000)

setInterval(() => {
    const peers = getPeers();
    const peerMessage = Buffer.concat([
        encodeHeader(2, peers.length),
        ...peers
    ]);

    for (const [key, value] of peerList.entries()) {
        if (value.isConnected === true && ((Date.now() - value.lastPing) < PEER_EXPIRY)) {
            const rinfo = decodeConnectionInfo(Buffer.from(key, 'binary'));
            sendSignedMessage(
                peerMessage,
                rinfo.address,
                rinfo.port,
                value.sharedSecret,
                value.cookie
            );
        }
    }

}, 3 * 60 * 1000)

server.on('listening', () => {
    const address = server.address();
    console.log(`Socket listening ${address.address}:${address.port}`);

    if (argv.httpPort) {
        startHTTPAPI(nodeState, argv.httpPort);
    }

    connectDefault();
});