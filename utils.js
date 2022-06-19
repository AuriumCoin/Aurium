const blake2 = require('blake2');
const { base58_to_binary, binary_to_base58 } = require('base58-js')

function readBigUInt128BE(buffer, offset) {
    let result = buffer.readBigUInt64BE(offset) << 64n;
    result |= buffer.readBigUInt64BE(offset + 8);

    return result;
}

function writeBigUInt128BE(buffer, value, offset) {
    buffer.writeBigUInt64BE(value >> 64n, offset);
    buffer.writeBigUInt64BE(value & 0xffffffffffffffffn, offset + 8);
}

function getScalarKey(privateKey) {
    let h = blake2.createHash('blake2b', { digestLength: 64 });
    h.update(privateKey);
    h = h.digest();
    h[0] &= 248;
    h[31] &= 127;
    h[31] |= 64;

    return h;
}

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

module.exports = {
    hashBlock,
    encodeAddress,
    decodeAddress,
    getScalarKey,
    readBigUInt128BE,
    writeBigUInt128BE
}