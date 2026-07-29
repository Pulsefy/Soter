"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = {
    IS_READ_ONLY: true,
    parseCommand(parser, key, iterator) {
        parser.push('CF.SCANDUMP');
        parser.pushKey(key);
        parser.push(iterator.toString());
    },
    transformReply(reply) {
        return {
            iterator: reply[0],
            chunk: reply[1]
        };
    }
};
//# sourceMappingURL=SCANDUMP.js.map