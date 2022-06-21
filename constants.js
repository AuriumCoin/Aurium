const { decodeAddress } = require('./utils.js')
const GENESIS_ADDRESS = "aur_AUdeYSF6fZ6XKY8F39Kp8hvCLbX4t7WFY7p6rq8TJ9sEgUAtkZGxqb6";
const GENESIS_PUBLIC = decodeAddress(GENESIS_ADDRESS);

const PEER_EXPIRY = 2 * 60 * 1000;

const BLOCK_TYPES = {
    SEND: 0,
    RECEIVE: 1,
    SPLIT: 2,
    CLAIM: 3
}

const HASH_BLOCK_SIZES = {
    [BLOCK_TYPES.SEND]: 121,
    [BLOCK_TYPES.RECEIVE]: 105
}

const BLOCK_SIZES = {
    [BLOCK_TYPES.SEND]: 185,
    [BLOCK_TYPES.RECEIVE]: 169
}

module.exports = {
    PEER_EXPIRY,
    GENESIS_ADDRESS,
    GENESIS_PUBLIC,
    BLOCK_TYPES,
    BLOCK_SIZES,
    HASH_BLOCK_SIZES
}