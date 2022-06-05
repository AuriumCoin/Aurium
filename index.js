const dgram = require('dgram');
const server = dgram.createSocket('udp4');

// For the love of god, don't use boost (colin moment)

const peerList = new Map();

server.on('message', (msg, rinfo) => {
    console.log(`server got: ${msg} from ${rinfo.address}:${rinfo.port}`);
});

server.send("Hello", 1632, "138.68.158.26")