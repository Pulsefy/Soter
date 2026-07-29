"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = {
    IS_READ_ONLY: false,
    parseCommand(parser, destination, source, options) {
        parser.push('TDIGEST.MERGE');
        parser.pushKey(destination);
        parser.pushKeysLength(source);
        if (options?.COMPRESSION !== undefined) {
            parser.push('COMPRESSION', options.COMPRESSION.toString());
        }
        if (options?.OVERRIDE) {
            parser.push('OVERRIDE');
        }
    },
    transformReply: undefined
};
//# sourceMappingURL=MERGE.js.map