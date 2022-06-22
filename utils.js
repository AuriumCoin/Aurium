const ed25519_blake2b = require('./ed25519-blake2b/index.js');
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
    const h = ed25519_blake2b.hash(privateKey, 64);
    h[0] &= 248;
    h[31] &= 127;
    h[31] |= 64;

    return h;
}

function hashBlock(block, isUniversal) {
    const hash = ed25519_blake2b.hash(block, 32);
    /*if (isUniversal) {
        hash[0] |= 0x80;
    } else {
        hash[0] &= 0x7f;
    }*/
    return hash;
}

function encodeAddress(publicKey) {
    const checksum = ed25519_blake2b.hash(block, 8);

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

    const checksum = ed25519_blake2b.hash(decoded.subarray(0, 32), 8);

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