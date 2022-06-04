const dgram = require('dgram');
const server = dgram.createSocket('udp6');

// For the love of god, don't use boost (colin moment)

server.bind(7145);