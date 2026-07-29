"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = {
    IS_READ_ONLY: true,
    parseCommand(parser, key, errorRate, capacity, options) {
        parser.push('BF.RESERVE');
        parser.pushKey(key);
        parser.push(errorRate.toString(), capacity.toString());
        if (options?.EXPANSION) {
            parser.push('EXPANSION', options.EXPANSION.toString());
        }
        if (options?.NONSCALING) {
            parser.push('NONSCALING');
        }
    },
    transformReply: undefined
};
//# sourceMappingURL=RESERVE.js.map