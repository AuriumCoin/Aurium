const ed25519 = require('./ed25519.js');

const {
    GENESIS_PUBLIC,
    GENESIS_ADDRESS
} = require('./constants.js');

const {
    decodeAddress,
    encodeAddress,
    hashBlock
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

const blockDBI = env.openDbi({
    name: "blocks",
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

function encodeBlock(blockInfo) {
    if (BLOCK_TYPES[blockInfo.type] === undefined) throw Error("Block Type doesn't exist.");
    switch (blockInfo.type) {
        case "SEND": {
            const block = Buffer.alloc(185);
            block[0] = BLOCK_TYPES.SEND;
            block.set(decodeAddress(blockInfo.source), 1);
            block.set(decodeAddress(blockInfo.recipient), 33);

            const amountBigInt = BigInt(blockInfo.amount);

            block.writeBigUInt64BE(amountBigInt >> 64n, 65);
            block.writeBigUInt64BE(amountBigInt & 0xffffffffffffffffn, 73);

            block.set(Buffer.from(blockInfo.blockLink, "hex"), 81);
            block.writeBigUInt64BE(BigInt(blockInfo.timestamp), 113);
            block.set(Buffer.from(blockInfo.signature, "hex"), 121);
            return block;
        }
    }
}   

const genesisBlock = encodeBlock({
    type: "SEND",
    source: "aur_11111111111111111111111111111111ZxeF6dTF8vL",
    recipient: GENESIS_ADDRESS,
    amount: "15000000000000",
    blockLink: "0000000000000000000000000000000000000000000000000000000000000000",
    timestamp: "1654549740842",
    signature: "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
})

function readBigUInt128BE(buffer, offset) {
    let result = buffer.readBigUInt64BE(offset) << 64n;
    result |= buffer.readBigUInt64BE(offset + 8);

    return result;
}

function writeBigUInt128BE(buffer, value, offset) {
    buffer.writeBigUInt64BE(value >> 64n, offset);
    buffer.writeBigUInt64BE(value & 0xffffffffffffffffn, offset + 8);
}

function validateBlock(block, hash, blockType) {
    switch (blockType) {
        case BLOCK_TYPES.SEND: {
            return ed25519.verify(block.subarray(-64), hash, block.subarray(1, 33));
        }
    }
    return false;
}

function _insertBlock(txn, block, bypassCheck) {
    const BLOCK_TYPE = block[0];
    const BLOCK_SIZE = BLOCK_SIZES[BLOCK_TYPE];

    const hash = hashBlock(block.subarray(0, BLOCK_SIZE));

    const isValid = validateBlock(block, hash, BLOCK_TYPE);

    if (!bypassCheck && !isValid) {
        txn.abort();
        return "MALFORMED SIGNATURE";
    }

    if (txn.getBinary(blockDBI, hash)) {
        txn.abort();
        return "BLOCK ALREADY EXISTS";
    }

    let insert = true;

    switch(BLOCK_TYPE) {
        case BLOCK_TYPES.SEND: {
            const blockAmount = readBigUInt128BE(block, 65);
            if (!bypassCheck) {
                const sourceAccount = block.subarray(1, 33);
                const sourceEntry = txn.getBinary(accountDBI, sourceAccount);
                if (sourceEntry == null) {
                    insert = false;
                    txn.abort();
                    return "SOURCE DOESN'T EXIST";
                }

                if (!(sourceEntry.subarray(16, 48).equals(block.subarray(81, 113)))) {
                    return "INVALID FRONTIER";
                }

                const sourceBalance = readBigUInt128BE(sourceEntry, 0);

                if (sourceBalance < blockAmount) {
                    insert = false;
                    txn.abort();
                    return "SOURCE DOESN'T HAVE SUFFICENT BALACNE";
                }

                writeBigUInt128BE(sourceEntry, sourceBalance - blockAmount, 0);
                sourceEntry.set(hash, 16);

                txn.putBinary(accountDBI, sourceAccount, sourceEntry);
            }

            const destAccount = block.subarray(33, 65);
            const destEntry = txn.getBinary(accountDBI, destAccount);
            if (destEntry) {
                const destBalance = readBigUInt128BE(destEntry, 0);
                writeBigUInt128BE(destEntry, destBalance + blockAmount, 0);
                txn.putBinary(accountDBI, destAccount, destEntry);
            } else {
                const destinationBuffer = Buffer.alloc(48, 0);
                writeBigUInt128BE(destinationBuffer,  blockAmount, 0);

                txn.putBinary(accountDBI, destAccount, destinationBuffer);
            }
            break;
        }
        default: {
            insert = false;
            txn.abort();
            break;
        }
    }

    if (insert) {
        txn.putBinary(blockDBI, hash, block);
        txn.commit();
    }
}

function insertBlock(block, bypassCheck) {
    const txn = env.beginTxn();
    console.log(_insertBlock(txn, block, bypassCheck));
}

insertBlock(genesisBlock, true);

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

console.log(listAccounts())

module.exports = {

}