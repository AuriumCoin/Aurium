const ed25519_blake2b = require('./ed25519-blake2b/index.js');

const {
    GENESIS_ADDRESS,
    HASH_BLOCK_SIZES,
    BLOCK_TYPES,
    NULL_BLOCK
} = require('./constants.js');

const EventEmitter = require('events');

const txnQueue = require('./txnQueue.js');

const {
    decodeAddress,
    encodeAddress,
    hashBlock,
    readBigUInt128BE,
    writeBigUInt128BE
} = require('./utils.js')

const ledgerEvents = new EventEmitter();

const lmdb = require('node-lmdb');
const fs = require('fs');
if (!fs.existsSync(__dirname + "/data")) {
    fs.mkdirSync(__dirname + "/data")
}
const env = new lmdb.Env();
env.open({
    path: __dirname + "/data",
    maxDbs: 100
});

const envQueue = new txnQueue.WriteTransactionQueue(env);

const blockDBI = env.openDbi({
    name: "blocks",
    create: true,
    keyIsBuffer: true
});

const pendingDBI = env.openDbi({
    name: "pending",
    create: true,
    keyIsBuffer: true
});

const accountDBI = env.openDbi({
    name: "accounts",
    create: true,
    keyIsBuffer: true
});

function encodeRPCBlock(blockInfo) {
    if (BLOCK_TYPES[blockInfo.type] === undefined) throw Error("Block Type doesn't exist.");
    switch (blockInfo.type) {
        case "SEND": {
            const block = Buffer.alloc(201);
            block[0] = BLOCK_TYPES.SEND;
            block.set(decodeAddress(blockInfo.source), 1);
            block.set(decodeAddress(blockInfo.recipient), 33);

            writeBigUInt128BE(block, BigInt(blockInfo.amount), 65);

            block.set(Buffer.from(blockInfo.blockLink, "hex"), 81);
            block.set(Buffer.from(blockInfo.reference, "hex"), 113);
            block.writeBigUInt64BE(BigInt(blockInfo.timestamp), 129);
            block.set(Buffer.from(blockInfo.signature, "hex"), 137);
            return block;
        }
    }
}

function decodeBlock(block) {
    switch (block[0]) {
        case BLOCK_TYPES.SEND: {
            const source = block.subarray(1, 33); // Sender
            const recipient = block.subarray(33, 65);
            const amount = readBigUInt128BE(block, 65);
            const blockLink = block.subarray(81, 113);
            const reference = block.subarray(113, 129);
            const timestamp = block.readBigUInt64BE(129);
            const signature = block.subarray(137, 201);
            return {
                source,
                recipient,
                amount,
                blockLink,
                reference,
                timestamp,
                signature
            }
        }
        case BLOCK_TYPES.RECEIVE: {
            const recipient = block.subarray(1, 33);
            const source = block.subarray(33, 65); // Block Hash
            const blockLink = block.subarray(65, 97);
            const timestamp = block.readBigUInt64BE(97);
            const signature = block.subarray(105, 169);
            return {
                recipient,
                source,
                blockLink,
                timestamp,
                signature
            }
        }
    }

    return null;
}

const genesisBlock = encodeRPCBlock({
    type: "SEND",
    source: "aur_11111111111111111111111111111111ZxeF6dTF8vL",
    recipient: GENESIS_ADDRESS,
    amount: "15000000000000",
    blockLink: "0000000000000000000000000000000000000000000000000000000000000000",
    reference: "53a7257123db5568cb0cd0edb420dee3",
    timestamp: "1654549740842",
    signature: "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
})

function validateBlockSignature(block, hash, blockType) {
    switch (blockType) {
        case BLOCK_TYPES.RECEIVE:
        case BLOCK_TYPES.SEND: {
            return ed25519_blake2b.verify(block.subarray(-64), hash, block.subarray(1, 33));
        }
    }
    return false;
}

class AccountInfo {
    static encode(balance, head) {
        const accountInfo = Buffer.alloc(48);
        writeBigUInt128BE(accountInfo, balance, 0);
        accountInfo.set(head, 16);

        return accountInfo;
    }
    static decode(accountInfo) {
        if (accountInfo == null) {
            return {
                balance: 0n,
                head: NULL_BLOCK
            }
        } else {
            return {
                balance: readBigUInt128BE(accountInfo, 0),
                head: accountInfo.subarray(16, 48)
            }
        }
    }
}

function _insertBlock(txn, block, bypassCheck) {
    const blockInfo = decodeBlock(block);
    if (blockInfo == null) return 1;
    const blockType = block[0];
    const BLOCK_SIZE = HASH_BLOCK_SIZES[blockType];

    const hash = hashBlock(block.subarray(0, BLOCK_SIZE));

    const isValid = validateBlockSignature(block, hash, blockType);

    if (!bypassCheck && !isValid) return 2;

    if (txn.getBinary(blockDBI, hash)) return 3;

    switch(blockType) {
        case BLOCK_TYPES.SEND: {
            if (!bypassCheck) {
                const sourceEntry = txn.getBinary(accountDBI, blockInfo.source);
                if (sourceEntry == null) return 4;

                if (!(sourceEntry.subarray(16, 48).equals(blockInfo.blockLink))) return 5;

                const sourceBalance = readBigUInt128BE(sourceEntry, 0);

                if (sourceBalance < blockInfo.amount) return 4;

                const newBalance = sourceBalance - blockInfo.amount;

                writeBigUInt128BE(sourceEntry, newBalance, 0);
                sourceEntry.set(hash, 16);

                txn.putBinary(accountDBI, blockInfo.source, sourceEntry);

                ledgerEvents.emit("accountState", {
                    account: blockInfo.source,
                    hash,
                    balance: newBalance
                })
            }

            const blockAmount = Buffer.alloc(16);
            writeBigUInt128BE(blockAmount, blockInfo.amount, 0);

            txn.putBinary(pendingDBI, Buffer.concat([
                blockInfo.recipient,
                hash
            ]), blockAmount);

            ledgerEvents.emit("pending", {
                account: blockInfo.recipient,
                block: hash,
                amount: blockInfo.amount
            })

            break;
        }
        case BLOCK_TYPES.RECEIVE: {
            const pendingKey = Buffer.concat([
                blockInfo.recipient,
                blockInfo.source
            ]);
            const pendingBlock = txn.getBinary(pendingDBI, pendingKey);
            if (!pendingBlock) return 6;
            const recieveAmount = readBigUInt128BE(pendingBlock, 0);
            txn.del(pendingDBI, pendingKey);

            const accountInfo = AccountInfo.decode(txn.getBinary(accountDBI, blockInfo.recipient));
            if (!blockInfo.blockLink.equals(accountInfo.head)) return 5;

            const newBalance = accountInfo.balance + recieveAmount;


            txn.putBinary(accountDBI, blockInfo.recipient, AccountInfo.encode(
                newBalance,
                hash
            ));

            ledgerEvents.emit("accountState", {
                account: blockInfo.recipient,
                hash,
                balance: newBalance
            })

            break;
        }
        default: {
            return 1;
        }
    }

    txn.putBinary(blockDBI, hash, block);
    return 0;
}


function _preProccessBlock(txn, block, bypassCheck) {
    const blockInfo = decodeBlock(block);
    if (blockInfo == null) return 1;
    const blockType = block[0];
    const BLOCK_SIZE = HASH_BLOCK_SIZES[blockType];

    const hash = hashBlock(block.subarray(0, BLOCK_SIZE));

    const isValid = validateBlockSignature(block, hash, blockType);

    if (!bypassCheck && !isValid) return 2;

    if (txn.getBinary(blockDBI, hash)) return 3;

    switch(blockType) {
        case BLOCK_TYPES.SEND: {
            if (!bypassCheck) {
                const sourceEntry = txn.getBinary(accountDBI, blockInfo.source);
                if (sourceEntry == null) return 6;
                if (!(sourceEntry.subarray(16, 48).equals(blockInfo.blockLink))) return 5;
                const sourceBalance = readBigUInt128BE(sourceEntry, 0);
                if (sourceBalance < blockInfo.amount) return 4;
            }
            break;
        }
        case BLOCK_TYPES.RECEIVE: {
            const pendingBlock = txn.getBinary(pendingDBI, Buffer.concat([
                blockInfo.recipient,
                blockInfo.source
            ]));
            if (!pendingBlock) return 6;

            const accountInfo = AccountInfo.decode(txn.getBinary(accountDBI, blockInfo.recipient));
            if (!blockInfo.blockLink.equals(accountInfo.head)) return 5;

            return 0;
        }
        default: {
            return 1;
        }
    }

    return 0;
}

function preProccessBlock(block, bypassCheck) {
    const txn = env.beginTxn({ readOnly: true });
    const result = _preProccessBlock(txn, block, bypassCheck);
    txn.abort();
    return result;
}

function insertBlock({
    block,
    bypassCheck = false,
    callback = null
}) {
    const preProcessResult = preProccessBlock(block, bypassCheck); // Pre Proccesing by itself isn't secure. Only used for filtering spam blocks
    
    if (preProcessResult == 0) {
        envQueue.requestTxn(
            function (txn) {
                const result = _insertBlock(txn, block, bypassCheck);
    
                if (result == 0) {
                    txn.commit();

                    ledgerEvents.emit("blockInserted", block);
                } else {
                    txn.abort();
                }

                if (callback) {
                    callback(result);
                }
            }
        );
    } else {
        callback(preProcessResult);
    }

    return preProcessResult;
}

insertBlock({
    block: genesisBlock,
    bypassCheck: true,
    callback: function (result) {
        //console.log(INSERT_RESULT_CODES[result])
    }
})

function listAccounts() {
    const txn = env.beginTxn({ readOnly: true });

    var cursor = new lmdb.Cursor(txn, accountDBI);

    let list = [];

    for (var found = cursor.goToFirst(); found !== null; found = cursor.goToNext()) {
        const value = cursor.getCurrentBinary();
        const balance = readBigUInt128BE(value, 0).toString();
        const account = encodeAddress(found);
        const head = value.subarray(16, 48).toString("hex").toUpperCase();

        list.push({
            balance,
            account,
            head
        })
    }

    txn.abort();

    return list;
}

function listPending() {
    const txn = env.beginTxn({ readOnly: true });

    var cursor = new lmdb.Cursor(txn, pendingDBI);

    let list = [];

    for (var found = cursor.goToFirst(); found !== null; found = cursor.goToNext()) {
        const recipient = encodeAddress(found.subarray(0, 32));
        const blockHash = found.subarray(32, 64);
        const block = txn.getBinary(blockDBI, blockHash);
        if (!block) continue;
        const amount = readBigUInt128BE(block, 65).toString();

        list.push({
            recipient,
            hash: blockHash.toString("hex").toUpperCase(),
            amount
        })
    }

    txn.abort();

    return list;
}

//console.log(listPending())

function getAccount(publicKey, normalize = true) {
    const txn = env.beginTxn({ readOnly: true });
    const accountInfo = txn.getBinary(accountDBI, publicKey);
    txn.abort();

    if (accountInfo == null && !normalize) {
        return null;
    } else {
        return AccountInfo.decode(accountInfo);
    }
}

const pendingStartRange = Buffer.alloc(32, 0x00);

function getPending(publicKey, limit = 50) {
    const startKey = Buffer.concat([
        publicKey,
        pendingStartRange
    ]);

    const txn = env.beginTxn({ readOnly: true });
    const cursor = new lmdb.Cursor(txn, pendingDBI);

    let list = [];

    var i = 0;

    for (var found = cursor.goToRange(startKey); found !== null; found = cursor.goToNext()) {
        if (i++ >= limit) break;
        if (!found.subarray(0, 32).equals(publicKey)) break;
        const blockHash = found.subarray(32, 64);
        const amount = readBigUInt128BE(cursor.getCurrentBinary(), 0);

        list.push({
            hash: blockHash,
            amount
        })
    }

    txn.abort();

    return list;
}

module.exports = {
    insertBlock,
    ledgerEvents,
    getAccount,
    getPending
}
