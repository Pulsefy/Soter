"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const generic_transformers_1 = require("@redis/client/dist/lib/commands/generic-transformers");
exports.default = {
    IS_READ_ONLY: true,
    parseCommand(parser, key, values) {
        parser.push('TDIGEST.CDF');
        parser.pushKey(key);
        for (const item of values) {
            parser.push(item.toString());
        }
    },
    transformReply: generic_transformers_1.transformDoubleArrayReply
};
//# sourceMappingURL=CDF.js.map