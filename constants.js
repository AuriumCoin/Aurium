const { decodeAddress } = require('./utils.js')
const GENESIS_ADDRESS = "aur_AUdeYSF6fZ6XKY8F39Kp8hvCLbX4t7WFY7p6rq8TJ9sEgUAtkZGxqb6";
const GENESIS_PUBLIC = decodeAddress(GENESIS_ADDRESS);

module.exports = {
    GENESIS_ADDRESS,
    GENESIS_PUBLIC
}