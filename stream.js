function encodeHeader(opcode, extensions) {
    if (opcode > 0x1F) throw Error("Opcode is above 5 bits");
    if (extensions > 0x7FF) throw Error("Extensions is above 11 bits");
    const Header = Buffer.alloc(2);
    Header[0] = (opcode << 3) | (extensions >> 8);
    Header[1] = extensions & 0xFF;

    return Header;
}

function decodeHeader(header) {
    const opcode = header[0] >> 3;
    const extensions = ((header[0] & 7) << 8) | header[1];

    return {
        opcode,
        extensions
    }
}

module.exports = {
    encodeHeader,
    decodeHeader 
}