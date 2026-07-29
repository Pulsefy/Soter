"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const generic_transformers_1 = require("@redis/client/dist/lib/commands/generic-transformers");
exports.default = {
    IS_READ_ONLY: true,
    parseCommand(parser, key, quantiles) {
        parser.push('TDIGEST.QUANTILE');
        parser.pushKey(key);
        for (const quantile of quantiles) {
            parser.push(quantile.toString());
        }
    },
    transformReply: generic_transformers_1.transformDoubleArrayReply
};
//# sourceMappingURL=QUANTILE.js.map