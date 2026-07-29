"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = {
    IS_READ_ONLY: false,
    parseCommand(parser, key, values) {
        parser.push('TDIGEST.ADD');
        parser.pushKey(key);
        for (const value of values) {
            parser.push(value.toString());
        }
    },
    transformReply: undefined
};
//# sourceMappingURL=ADD.js.map