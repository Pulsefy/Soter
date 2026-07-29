"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = {
    IS_READ_ONLY: false,
    parseCommand(parser, key, topK, options) {
        parser.push('TOPK.RESERVE');
        parser.pushKey(key);
        parser.push(topK.toString());
        if (options) {
            parser.push(options.width.toString(), options.depth.toString(), options.decay.toString());
        }
    },
    transformReply: undefined
};
//# sourceMappingURL=RESERVE.js.map