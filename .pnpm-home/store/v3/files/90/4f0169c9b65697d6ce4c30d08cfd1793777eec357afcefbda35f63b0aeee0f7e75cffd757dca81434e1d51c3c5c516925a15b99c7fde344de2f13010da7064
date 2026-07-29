"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transformRankArguments = void 0;
function transformRankArguments(parser, key, values) {
    parser.pushKey(key);
    for (const value of values) {
        parser.push(value.toString());
    }
}
exports.transformRankArguments = transformRankArguments;
exports.default = {
    IS_READ_ONLY: true,
    parseCommand(...args) {
        args[0].push('TDIGEST.RANK');
        transformRankArguments(...args);
    },
    transformReply: undefined
};
//# sourceMappingURL=RANK.js.map