const dgram = require('dgram');
const server = dgram.createSocket('udp4');

const { isIPv4, isIPv6 } = require('net');

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
    'default-peer': { 
        type: 'string',
        alias: 'd',
        default: '127.0.0.1:8081',
        describe: '[IP]:[PORT] Set the peer which Node connects on first start up.',
        array: true
    }
    
}).check(function (argv) {
    if (Number.isNaN(argv.port)) {
        throw new Error('Argument check failed: Port is Not a Number.')
    }
    if (!Number.isInteger(argv.port)) {
        throw new Error('Argument check failed: Port is Not a Integer.')
    }

    if (argv.port > 65535) {
        throw new Error('Argument check failed: Port is Not a Valid Port.')
    }

    return true;
}).argv

console.log(argv)

function isArgTrue(arg) {
    if (arg === "true") return true;
    if (arg == 1) return true;

    return false;
}

const defaultConfig = {
    defaultPeer: {
        address: "",

    }
}

const peerList = new Map();

server.on('message', (msg, rinfo) => {
    console.log(`server got: ${msg} from ${rinfo.address}:${rinfo.port}`);
});

if (argv.port !== 0) {
    server.bind(argv.port)
}