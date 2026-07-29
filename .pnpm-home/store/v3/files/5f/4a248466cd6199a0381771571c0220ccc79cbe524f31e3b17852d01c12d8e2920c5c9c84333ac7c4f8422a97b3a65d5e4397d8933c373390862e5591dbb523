"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bloom_1 = require("../bloom");
exports.default = {
    IS_READ_ONLY: true,
    parseCommand(parser, key) {
        parser.push('TDIGEST.INFO');
        parser.pushKey(key);
    },
    transformReply: {
        2: (reply, _, typeMapping) => {
            return (0, bloom_1.transformInfoV2Reply)(reply, typeMapping);
        },
        3: undefined
    }
};
//# sourceMappingURL=INFO.js.map