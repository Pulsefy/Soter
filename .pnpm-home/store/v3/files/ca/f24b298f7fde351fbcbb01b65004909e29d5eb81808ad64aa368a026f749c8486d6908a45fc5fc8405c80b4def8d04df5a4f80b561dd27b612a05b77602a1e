"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = {
    IS_READ_ONLY: true,
    parseCommand(parser, key) {
        parser.push('TOPK.LIST');
        parser.pushKey(key);
        parser.push('WITHCOUNT');
    },
    transformReply(rawReply) {
        const reply = [];
        for (let i = 0; i < rawReply.length; i++) {
            reply.push({
                item: rawReply[i],
                count: rawReply[++i]
            });
        }
        return reply;
    }
};
//# sourceMappingURL=LIST_WITHCOUNT.js.map