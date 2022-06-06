const blake2 = require('blake2');
const { base58_to_binary, binary_to_base58 } = require('base58-js')

function hashBlock(block, isUniversal) {
    const h = blake2.createHash('blake2b', { digestLength: 32 });
    h.update(block);
    const hash = h.digest();
    /*if (isUniversal) {
        hash[0] |= 0x80;
    } else {
        hash[0] &= 0x7f;
    }*/
    return hash;
}

function encodeAddress(publicKey) {
    let checksum = blake2.createHash('blake2b', { digestLength: 8 });
    checksum.update(publicKey);
    checksum = checksum.digest();

    return "aur_" + binary_to_base58(Buffer.concat([
        publicKey,
        checksum
    ]));
}

console.log(encodeAddress(Buffer.alloc(32, 0)))

function decodeAddress(address) {
    if (!address.startsWith("aur_")) throw Error("Address isn't an Aurium Address");
    const decoded = Buffer.from(
        base58_to_binary(address.slice(4))
    );

    let checksum = blake2.createHash('blake2b', { digestLength: 8 });
    checksum.update(decoded.subarray(0, 32));
    checksum = checksum.digest();

    if (checksum.equals(decoded.subarray(32))) {
        return decoded.subarray(0, 32);
    } else {
        throw Error("Address is corrupted");
    }
}

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

(() => {
    const txn = env.beginTxn({ readOnly: true });

    var cursor = new lmdb.Cursor(txn, accountDBI);

    for (var found = cursor.goToFirst(); found !== null; found = cursor.goToNext()) {
        console.log(cursor.getCurrentBinary());
    }
})();

const BLOCK_TYPES = {
    SEND: 0,
    SPLIT: 1,
    CLAIM: 2
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
            block.set(Buffer.from(blockInfo.signature, "hex"), 113);

            block.writeBigUInt64BE(BigInt(blockInfo.timestamp), 177);
            return block;
        }
    }
}

const genesisBlock = encodeBlock({
    type: "SEND",
    source: "aur_11111111111111111111111111111111ZxeF6dTF8vL",
    recipient: "aur_8uxVDkPRuevhF9cFtiM1igEqMHJJvTwAewrCSZDzEvpdqmfG4nXYBSu",
    amount: "15000000000000",
    blockLink: "0000000000000000000000000000000000000000000000000000000000000000",
    signature: "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
    timestamp: "0"
})

console.log(genesisBlock)

function readBigUInt128BE(buffer, offset) {
    let result = buffer.readBigUInt64BE(offset) << 64n;
    result |= buffer.readBigUInt64BE(offset + 8);

    return result;
}

function writeBigUInt128BE(buffer, value, offset) {
    buffer.writeBigUInt64BE(value >> 64n, offset);
    buffer.writeBigUInt64BE(value & 0xffffffffffffffffn, offset + 8);
}

function _insertBlock(txn, block, bypassCheck) {
    const hash = hashBlock(block);

    if (txn.getBinary(blockDBI, hash)) {
        txn.abort();
        return "BLOCK ALREADY EXISTS";
    }

    let insert = true;

    switch(block[0]) {
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
    return _insertBlock(txn, block, bypassCheck);
}

insertBlock(genesisBlock, true);