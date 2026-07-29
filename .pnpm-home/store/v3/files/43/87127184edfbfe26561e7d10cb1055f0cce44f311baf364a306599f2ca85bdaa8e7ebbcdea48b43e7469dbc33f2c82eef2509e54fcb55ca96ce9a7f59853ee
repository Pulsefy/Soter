"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const generic_transformers_1 = require("@redis/client/dist/lib/commands/generic-transformers");
exports.default = {
    IS_READ_ONLY: true,
    parseCommand(parser, key, lowCutPercentile, highCutPercentile) {
        parser.push('TDIGEST.TRIMMED_MEAN');
        parser.pushKey(key);
        parser.push(lowCutPercentile.toString(), highCutPercentile.toString());
    },
    transformReply: generic_transformers_1.transformDoubleReply
};
//# sourceMappingURL=TRIMMED_MEAN.js.map