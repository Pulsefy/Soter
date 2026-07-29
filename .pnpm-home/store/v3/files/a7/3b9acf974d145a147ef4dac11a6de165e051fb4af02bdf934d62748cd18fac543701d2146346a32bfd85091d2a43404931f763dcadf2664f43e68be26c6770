"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = {
    IS_READ_ONLY: false,
    parseCommand(parser, key, iterator, chunk) {
        parser.push('BF.LOADCHUNK');
        parser.pushKey(key);
        parser.push(iterator.toString(), chunk);
    },
    transformReply: undefined
};
//# sourceMappingURL=LOADCHUNK.js.map