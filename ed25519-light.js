function numberTo32BytesLE(num) {
    const hex = num.toString(16).padStart(64, '0')
    return Buffer.from(hex, "hex").reverse();
}

function bytesToNumberLE32(buffer) {
    let result = buffer.readBigUInt64LE(0);
    result += buffer.readBigUInt64LE(8) << 64n;
    result += buffer.readBigUInt64LE(16) << 128n;
    result += buffer.readBigUInt64LE(24) << 192n;

    return result;
}

const CurveP = 57896044618658097711785492504343953926634992332820282019728792003956564819949n;

function mod(a, b = CurveP) {
    const res = a % b
    return res >= 0n ? res : b + res
}

function invert(number, modulo = CurveP) {
    // Eucledian GCD https://brilliant.org/wiki/extended-euclidean-algorithm/
    let a = mod(number, modulo)
    let b = modulo
    // prettier-ignore
    let x = 0n, y = 1n, u = 1n, v = 0n // eslint-disable-line
    while (a !== 0n) {
      const q = b / a
      const r = b % a
      const m = x - u * q
      const n = y - v * q
      // prettier-ignore
      b = a, a = r, x = u, y = v, u = m, v = n // eslint-disable-line
    }
    return mod(x, modulo)
}

function toX25519(bytes) {
    const normed = Buffer.from(bytes)
    normed[31] = bytes[31] & ~0x80;
    const y = bytesToNumberLE32(normed)

    const u = mod((1n + y) * invert(1n - y))
    return numberTo32BytesLE(u)
}

module.exports = {
    toX25519
}