const ed25519 = require('./ed25519.js');

const {
    GENESIS_PUBLIC,
    GENESIS_ADDRESS
} = require('./constants.js');

const txnQueue = require('./txnQueue.js');

const {
    decodeAddress,
    encodeAddress,
    hashBlock,
    readBigUInt128BE,
    writeBigUInt128BE
} = require('./utils.js')

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

const BLOCK_TYPES = {
    SEND: 0,
    SPLIT: 1,
    CLAIM: 2
}

const BLOCK_SIZES = {
    [BLOCK_TYPES.SEND]: 121
}

function encodeRPCBlock(blockInfo) {
    if (BLOCK_TYPES[blockInfo.type] === undefined) throw Error("Block Type doesn't exist.");
    switch (blockInfo.type) {
        case "SEND": {
            const block = Buffer.alloc(185);
            block[0] = BLOCK_TYPES.SEND;
            block.set(decodeAddress(blockInfo.source), 1);
            block.set(decodeAddress(blockInfo.recipient), 33);

            writeBigUInt128BE(block, BigInt(blockInfo.amount), 65);

            block.set(Buffer.from(blockInfo.blockLink, "hex"), 81);
            block.writeBigUInt64BE(BigInt(blockInfo.timestamp), 113);
            block.set(Buffer.from(blockInfo.signature, "hex"), 121);
            return block;
        }
    }
}

function decodeBlock(block) {
    switch (block[0]) {
        case BLOCK_TYPES.SEND: {
            const SOURCE = block.subarray(1, 33);
            const RECIPIENT = block.subarray(33, 65);
            const AMOUNT = readBigUInt128BE(block, 65);
            const BLOCK_LINK = block.subarray(81, 113);
            const TIMESTAMP = block.readBigUInt64BE(113);
            const SIGNATURE = block.subarray(121, 185);
            return {
                SOURCE,
                RECIPIENT,
                AMOUNT,
                BLOCK_LINK,
                TIMESTAMP,
                SIGNATURE
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
    timestamp: "1654549740842",
    signature: "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
})

function validateBlockSignature(block, hash, blockType) {
    switch (blockType) {
        case BLOCK_TYPES.SEND: {
            return ed25519.verify(block.subarray(-64), hash, block.subarray(1, 33));
        }
    }
    return false;
}

function _insertBlock(txn, block, bypassCheck) {
    const BLOCK_INFO = decodeBlock(block);
    if (BLOCK_INFO == null) return 1;
    const BLOCK_TYPE = block[0];
    const BLOCK_SIZE = BLOCK_SIZES[BLOCK_TYPE];

    const hash = hashBlock(block.subarray(0, BLOCK_SIZE));

    const isValid = validateBlockSignature(block, hash, BLOCK_TYPE);

    if (!bypassCheck && !isValid) return 2;

    if (txn.getBinary(blockDBI, hash)) return 3;

    switch(BLOCK_TYPE) {
        case BLOCK_TYPES.SEND: {
            if (!bypassCheck) {
                const sourceEntry = txn.getBinary(accountDBI, BLOCK_INFO.SOURCE);
                if (sourceEntry == null) return 6;

                if (!(sourceEntry.subarray(16, 48).equals(BLOCK_INFO.BLOCK_LINK))) return 5;

                const sourceBalance = readBigUInt128BE(sourceEntry, 0);

                if (sourceBalance < BLOCK_INFO.AMOUNT) return 4;

                writeBigUInt128BE(sourceEntry, sourceBalance - BLOCK_INFO.AMOUNT, 0);
                sourceEntry.set(hash, 16);

                txn.putBinary(accountDBI, BLOCK_INFO.SOURCE, sourceEntry);
            }

            txn.putBinary(pendingDBI, Buffer.concat([
                BLOCK_INFO.RECIPIENT,
                hash
            ]), Buffer.from([]));

            /*const destEntry = txn.getBinary(accountDBI, BLOCK_INFO.RECIPIENT);
            if (destEntry) {
                const destBalance = readBigUInt128BE(destEntry, 0);
                writeBigUInt128BE(destEntry, destBalance + BLOCK_INFO.AMOUNT, 0);
                txn.putBinary(accountDBI, BLOCK_INFO.RECIPIENT, destEntry);
            } else {
                const destinationBuffer = Buffer.alloc(48, 0);
                writeBigUInt128BE(destinationBuffer,  BLOCK_INFO.AMOUNT, 0);

                txn.putBinary(accountDBI, BLOCK_INFO.RECIPIENT, destinationBuffer);
            }*/
            break;
        }
        default: {
            return 1;
        }
    }

    txn.putBinary(blockDBI, hash, block);
    return 0;
}

const INSERT_RESULT_CODES = {
    0: "SUCCESS",
    1: "INVALID BLOCK",
    2: "MALFORMED SIGNATURE",
    3: "BLOCK ALREADY EXISTS",
    4: "SOURCE DOESN'T HAVE SUFFICENT BALANCE",
    5: "INVALID FRONTIER",
    6: "SOURCE DOESN'T EXIST"
}

function _preProccessBlock(txn, block, bypassCheck) {
    const BLOCK_INFO = decodeBlock(block);
    if (BLOCK_INFO == null) return 1;
    const BLOCK_TYPE = block[0];
    const BLOCK_SIZE = BLOCK_SIZES[BLOCK_TYPE];

    const hash = hashBlock(block.subarray(0, BLOCK_SIZE));

    const isValid = validateBlockSignature(block, hash, BLOCK_TYPE);

    if (!bypassCheck && !isValid) return 2;

    if (txn.getBinary(blockDBI, hash)) return 3;

    switch(BLOCK_TYPE) {
        case BLOCK_TYPES.SEND: {
            if (!bypassCheck) {
                const sourceEntry = txn.getBinary(accountDBI, BLOCK_INFO.SOURCE);
                if (sourceEntry == null) return 6;
                if (!(sourceEntry.subarray(16, 48).equals(BLOCK_INFO.BLOCK_LINK))) return 5;
                const sourceBalance = readBigUInt128BE(sourceEntry, 0);
                if (sourceBalance < BLOCK_INFO.AMOUNT) return 4;
            }
            break;
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

function insertBlock(block, bypassCheck, callback) {
    const preProcessResult = preProccessBlock(block, bypassCheck)
    
    if (preProcessResult == 0) {
        envQueue.requestTxn(
            function (txn) {
                const result = _insertBlock(txn, block, bypassCheck);
    
                if (result == 0) {
                    txn.commit();
                } else {
                    txn.abort();
                }

                callback(result);
            }
        );
    } else {
        console.log("Pre Process Failed")
        callback(preProcessResult);
    }

    return preProcessResult;
}

insertBlock(genesisBlock, true, (result) => {
    console.log(INSERT_RESULT_CODES[result])
});

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

console.log(listPending())

module.exports = {
    INSERT_RESULT_CODES,

}