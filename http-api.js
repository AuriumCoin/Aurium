let nodeState;
const express = require('express')
const app = express()

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
})
  
function start(state, port) {
    nodeState = state;
    app.listen(port)
}

module.exports = start;