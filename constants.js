const { decodeAddress } = require('./utils.js')
const GENESIS_ADDRESS = "aur_AUdeYSF6fZ6XKY8F39Kp8hvCLbX4t7WFY7p6rq8TJ9sEgUAtkZGxqb6";
const GENESIS_PUBLIC = decodeAddress(GENESIS_ADDRESS);

const BLOCK_TYPES = {
    SEND: 0,
    RECEIVE: 1,
    SPLIT: 2,
    CLAIM: 3
}

const HASH_BLOCK_SIZES = {
    [BLOCK_TYPES.SEND]: 121
}

const BLOCK_SIZES = {
    [BLOCK_TYPES.SEND]: 185
}

module.exports = {
    GENESIS_ADDRESS,
    GENESIS_PUBLIC,
    BLOCK_TYPES,
    BLOCK_SIZES,
    HASH_BLOCK_SIZES
}