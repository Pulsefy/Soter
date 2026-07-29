"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = {
    IS_READ_ONLY: false,
    parseCommand(parser, key, capacity, options) {
        parser.push('CF.RESERVE');
        parser.pushKey(key);
        parser.push(capacity.toString());
        if (options?.BUCKETSIZE !== undefined) {
            parser.push('BUCKETSIZE', options.BUCKETSIZE.toString());
        }
        if (options?.MAXITERATIONS !== undefined) {
            parser.push('MAXITERATIONS', options.MAXITERATIONS.toString());
        }
        if (options?.EXPANSION !== undefined) {
            parser.push('EXPANSION', options.EXPANSION.toString());
        }
    },
    transformReply: undefined
};
//# sourceMappingURL=RESERVE.js.map