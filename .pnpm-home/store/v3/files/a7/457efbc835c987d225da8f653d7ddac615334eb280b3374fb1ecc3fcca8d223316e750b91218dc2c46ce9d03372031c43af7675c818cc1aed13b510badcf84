"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = {
    IS_READ_ONLY: false,
    parseCommand(parser, key, options) {
        parser.push('TDIGEST.CREATE');
        parser.pushKey(key);
        if (options?.COMPRESSION !== undefined) {
            parser.push('COMPRESSION', options.COMPRESSION.toString());
        }
    },
    transformReply: undefined
};
//# sourceMappingURL=CREATE.js.map