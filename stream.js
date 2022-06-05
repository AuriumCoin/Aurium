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

function getBodySize(headerinfo) {
    switch (headerinfo.opcode) { }
    
    return null;
}

/*
Callback OpCodes:
 0 - Message
 1 - Streaming / Parsing Error
*/

class StreamUtility {
    constructor() {
        this.callback = null;
        this.callbackQueue = [];

        this.state = {
            headerinfo: null,
            header: Buffer.alloc(2),
            headerSize: 0,
            bodySize: 0,
            body: null,
            expectedBodySize: null
        }
    }

    resetState() {
        this.state.headerSize = 0;
        this.state.bodySize = 0;
    }

    destroy() {
        this.state = null;
        this.triggerCallback(1, null);
    }

    streamHeader(packet) {
        if (this.state == null) return;
        if (this.state.headerSize == 2) {

        } else {
            const headerPtr = (2 - this.state.headerSize);
            const header = packet.subarray(0, headerPtr);
            this.state.header.set(header, this.state.headerSize);
            this.state.headerSize += header.length;

            if (this.state.headerSize == 2) {
                this.headerinfo = decodeHeader(this.state.header);
                const bodySize = getBodySize(this.headerinfo);

                if (bodySize == null) {
                    this.destroy();
                    return;
                }
            }
        }
    }

    triggerCallback(opcode, data) {
        if (this.callback) {
            this.callback(opcode, data);
        } else {
            this.callbackQueue.push([opcode, data]);
        }
    }

    hookCallback(func) {
        this.callback = func;
        for (;;) {
            const next = this.callbackQueue.shift();
            if (next) {
                func(next[0], next[1]);
            } else {
                break;
            }
        }
    }
}

module.exports = {
    encodeHeader,
    decodeHeader,
    StreamUtility
}