"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = {
    IS_READ_ONLY: false,
    parseCommand(parser, destination, source) {
        parser.push('CMS.MERGE');
        parser.pushKey(destination);
        parser.push(source.length.toString());
        if (isPlainSketches(source)) {
            parser.pushVariadic(source);
        }
        else {
            for (let i = 0; i < source.length; i++) {
                parser.push(source[i].name);
            }
            parser.push('WEIGHTS');
            for (let i = 0; i < source.length; i++) {
                parser.push(source[i].weight.toString());
            }
        }
    },
    transformReply: undefined
};
function isPlainSketches(src) {
    return typeof src[0] === 'string' || src[0] instanceof Buffer;
}
//# sourceMappingURL=MERGE.js.map