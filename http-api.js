let nodeState;
const express = require('express');
const app = express();
const WebSocket = require("ws");

app.use(express.json());

const PEER_EXPIRY = 2 * 60 * 1000;

app.get('/', function (req, res) {
    let peerCount = 0;

    for (const value of nodeState.peerList.values()) {
        if (value.isConnected === true && ((Date.now() - value.lastPing) < PEER_EXPIRY)) {
            peerCount++;
        }
    }

    res.json({
        peerCount
    })
});

function setupWSS(hServer) {
    const wss = new WebSocket.Server({
        noServer: true,
        path: "/ws",
    });
    
    hServer.on("upgrade", (request, socket, head) => {
        wss.handleUpgrade(request, socket, head, (websocket) => {
            wss.emit("connection", websocket, request);
        });
    });
    
    wss.on('connection', function connection(ws) {
        ws.on('message', function message(data) {
          console.log(data)
        });      
    });
}



function start(state, port) {
    nodeState = state;
    setupWSS(app.listen(port));
}

module.exports = start;