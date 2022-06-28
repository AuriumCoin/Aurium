const { decodeAddress } = require('./utils.js')
const GENESIS_ADDRESS = "aur_AUdeYSF6fZ6XKY8F39Kp8hvCLbX4t7WFY7p6rq8TJ9sEgUAtkZGxqb6";
const GENESIS_PUBLIC = decodeAddress(GENESIS_ADDRESS);

const PEER_EXPIRY = 2 * 60 * 1000;

const NULL_BLOCK = Buffer.alloc(32, 0);

const BLOCK_TYPES = {
    SEND: 0,
    RECEIVE: 1,
    SPLIT: 2,
    CLAIM: 3
}

const HASH_BLOCK_SIZES = {
    [BLOCK_TYPES.SEND]: 137,
    [BLOCK_TYPES.RECEIVE]: 105
}

const BLOCK_SIZES = {
    [BLOCK_TYPES.SEND]: 201,
    [BLOCK_TYPES.RECEIVE]: 169
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

module.exports = {
    PEER_EXPIRY,
    GENESIS_ADDRESS,
    GENESIS_PUBLIC,
    BLOCK_TYPES,
    BLOCK_SIZES,
    HASH_BLOCK_SIZES,
    NULL_BLOCK,
    INSERT_RESULT_CODES
}
