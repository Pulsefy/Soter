"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const generic_transformers_1 = require("@redis/client/dist/lib/commands/generic-transformers");
exports.default = {
    IS_READ_ONLY: false,
    parseCommand(parser, key, items) {
        parser.push('TOPK.QUERY');
        parser.pushKey(key);
        parser.pushVariadic(items);
    },
    transformReply: generic_transformers_1.transformBooleanArrayReply
};
//# sourceMappingURL=QUERY.js.map