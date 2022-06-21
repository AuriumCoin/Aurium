const ed25519 = require('./ed25519.js');

const {
    GENESIS_PUBLIC,
    GENESIS_ADDRESS,
    HASH_BLOCK_SIZES,
    BLOCK_TYPES
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
            const SOURCE = block.subarray(1, 33); // Sender
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
        case BLOCK_TYPES.RECEIVE {
            const RECIPIENT = block.subarray(1, 33);
            const SOURCE = block.subarray(33, 65); // Block Hash
            const BLOCK_LINK = block.subarray(65, 97);
            const TIMESTAMP = block.readBigUInt64BE(97);
            const SIGNATURE = block.subarray(105, 169);
            return {
                RECIPIENT,
                SOURCE,
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
        case BLOCK_TYPES.RECEIVE:
        case BLOCK_TYPES.SEND: {
            return ed25519.verify(block.subarray(-64), hash, block.subarray(1, 33));
        }
    }
    return false;
}

const NULL_BLOCK = Buffer.alloc(32, 0);

class AccountInfo {
    static encode(balance, head) {
        const accountInfo = Buffer.alloc(48);
        writeBigUInt128BE(accountInfo, balance, 0);
        accountInfo.set(head, 16);
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
    const BLOCK_INFO = decodeBlock(block);
    if (BLOCK_INFO == null) return 1;
    const BLOCK_TYPE = block[0];
    const BLOCK_SIZE = HASH_BLOCK_SIZES[BLOCK_TYPE];

    const hash = hashBlock(block.subarray(0, BLOCK_SIZE));

    const isValid = validateBlockSignature(block, hash, BLOCK_TYPE);

    if (!bypassCheck && !isValid) return 2;

    if (txn.getBinary(blockDBI, hash)) return 3;

    switch(BLOCK_TYPE) {
        case BLOCK_TYPES.SEND: {
            if (!bypassCheck) {
                const sourceEntry = txn.getBinary(accountDBI, BLOCK_INFO.SOURCE);
                if (sourceEntry == null) return 4;

                if (!(sourceEntry.subarray(16, 48).equals(BLOCK_INFO.BLOCK_LINK))) return 5;

                const sourceBalance = readBigUInt128BE(sourceEntry, 0);

                if (sourceBalance < BLOCK_INFO.AMOUNT) return 4;

                const newBalance = sourceBalance - BLOCK_INFO.AMOUNT;

                writeBigUInt128BE(sourceEntry, newBalance, 0);
                sourceEntry.set(hash, 16);

                ledgerEvents.emit("balanceUpdate", {
                    account: BLOCK_INFO.SOURCE,
                    balance: newBalance
                })

                txn.putBinary(accountDBI, BLOCK_INFO.SOURCE, sourceEntry);
            }

            const blockAmount = Buffer.alloc(16);
            writeBigUInt128BE(blockAmount, BLOCK_INFO.AMOUNT, 0);

            txn.putBinary(pendingDBI, Buffer.concat([
                BLOCK_INFO.RECIPIENT,
                hash
            ]), blockAmount);

            ledgerEvents.emit("pending", {
                account: BLOCK_INFO.RECIPIENT,
                block: hash
            })

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
        case BLOCK_TYPES.RECEIVE: {
            const pendingKey = Buffer.concat([
                BLOCK_INFO.RECIPIENT,
                BLOCK_INFO.SOURCE
            ]);
            const pendingBlock = txn.getBinary(pendingDBI, pendingKey);
            if (!pendingBlock) return 6;
            const recieveAmount = readBigUInt128BE(pendingBlock, 0);
            txn.del(pendingDBI, pendingKey);

            const accountInfo = AccountInfo.decode(txn.getBinary(accountDBI, BLOCK_INFO.RECIPIENT));
            if (!BLOCK_INFO.BLOCK_LINK.equals(accountInfo.head)) return 5;

            const newBalance = accountInfo.balance + recieveAmount;

            ledgerEvents.emit("balanceUpdate", {
                account: BLOCK_INFO.RECIPIENT,
                balance: newBalance
            })

            txn.putBinary(accountDBI, BLOCK_INFO.RECIPIENT, AccountInfo.encode(
                newBalance,
                hash
            ));

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
    0: "Success",
    1: "Invalid Block Format",
    2: "Signature is invalid",
    3: "Block is already published",
    4: "Source Account doesn't have sufficent balance to furfill transaction.",
    5: "Invalid Head Block",
    6: "Source is invaid",

}

function _preProccessBlock(txn, block, bypassCheck) {
    const BLOCK_INFO = decodeBlock(block);
    if (BLOCK_INFO == null) return 1;
    const BLOCK_TYPE = block[0];
    const BLOCK_SIZE = HASH_BLOCK_SIZES[BLOCK_TYPE];

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

module.exports = {
    INSERT_RESULT_CODES,
    insertBlock,
    ledgerEvents
}
