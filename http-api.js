let nodeState;
const { decodeAddress } = require("./utils")
const express = require('express');
const app = express();
const WebSocket = require("ws");

const {
    NULL_BLOCK,
    BLOCK_SIZES,
    INSERT_RESULT_CODES
} = require('./constants.js');

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

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
})

app.post("/publish", (req, res) => {
    if (!req.body.block) return res.status(400).json({});
    const block = Buffer.from(req.body.block, "hex");
    const expectedBlockSize = BLOCK_SIZES[block[0]];

    if (block.length != expectedBlockSize) return res.status(400).json({});

    nodeState.ledger.insertBlock({
        block,
        callback: function(result) {
            res.status(200).json({
                resultCode: result,
                result: INSERT_RESULT_CODES[result]
            });
        }
    })
})

const accountUpdatesMap = new Map();

function addToMap(map, key, value) {
    const existing = map.get(key);
    if (existing) {
        if (existing.includes(value)) return;
        existing.push(value);
    } else {
        map.set(key, [value]);
    }
}

function deleteFromMap(map, key, value) {
    const existing = map.get(key);
    if (existing) {
        const index = existing.indexOf(value);
        if (index > -1) {
            existing.splice(index, 1);
        }

        if (existing.length == 0) {
            map.delete(key);
        }
    }
}

function closeWS(hook, hookKey, ws) {
    ws.close();
    if (hook) {
        deleteFromMap(hook, hookKey, ws);
    }
}

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
        let currentHook = null;
        let hookKey = null;
        ws.on('message', function message(data) {
          try {
            const json = JSON.parse(data.toString());

            switch (json.type) {
                case "connect": {
                    switch (json.hook) {
                        case "accountUpdates": {
                            const PublicKey = decodeAddress(json.account);

                            currentHook = accountUpdatesMap;
                            hookKey = PublicKey.toString("binary");

                            addToMap(accountUpdatesMap, hookKey, ws);

                            ws.send(JSON.stringify({
                                type: "connack"
                            }))

                            const account = nodeState.ledger.getAccount(PublicKey);
                            ws.send(JSON.stringify({
                                type: "state",
                                hash: account.head.toString("hex"),
                                balance: account.balance.toString()
                            }))

                            const pendingList = nodeState.ledger.getPending(PublicKey);

                            for (const pending of pendingList) {
                                ws.send(JSON.stringify({
                                    type: "pending",
                                    hash: pending.hash.toString("hex"),
                                    amount: pending.amount.toString(),
                                }))
                            }
                            break;
                        }
                        default: {
                            throw Error("Invalid Hook Type");
                        }
                    }

                    break;
                }
                default: {
                    throw Error("Invalid Message Type");
                }
            }
          } catch(e) {
            console.log(e)
            closeWS(currentHook, hookKey, ws);
          }
        });
        
        ws.on("close", () => {
            deleteFromMap(currentHook, hookKey, ws);
        })
    });
}



function start(state, port) {
    nodeState = state;
    setupWSS(app.listen(port));

    nodeState.ledger.ledgerEvents.on("accountState", (accountState) => {
        const array = accountUpdatesMap.get(accountState.account.toString("binary"));

        if (array) {
            const message = JSON.stringify({
                type: "state",
                hash: accountState.hash.toString("hex"),
                balance: accountState.balance.toString()
            })
            for (const ws of array) {
                ws.send(message);
            }
        }
    })

    nodeState.ledger.ledgerEvents.on("pending", (pendingBlock) => {
        const array = accountUpdatesMap.get(pendingBlock.account.toString("binary"));

        if (array) {
            const message = JSON.stringify({
                type: "pending",
                hash: pendingBlock.hash.toString("hex"),
                amount: pendingBlock.amount.toString()
            })
            for (const ws of array) {
                ws.send(message);
            }
        }
    })
}

module.exports = start;