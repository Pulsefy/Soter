"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const generic_transformers_1 = require("@redis/client/dist/lib/commands/generic-transformers");
exports.default = {
    IS_READ_ONLY: false,
    parseCommand(parser, key, items, options) {
        parser.push('BF.INSERT');
        parser.pushKey(key);
        if (options?.CAPACITY !== undefined) {
            parser.push('CAPACITY', options.CAPACITY.toString());
        }
        if (options?.ERROR !== undefined) {
            parser.push('ERROR', options.ERROR.toString());
        }
        if (options?.EXPANSION !== undefined) {
            parser.push('EXPANSION', options.EXPANSION.toString());
        }
        if (options?.NOCREATE) {
            parser.push('NOCREATE');
        }
        if (options?.NONSCALING) {
            parser.push('NONSCALING');
        }
        parser.push('ITEMS');
        parser.pushVariadic(items);
    },
    transformReply: generic_transformers_1.transformBooleanArrayReply
};
//# sourceMappingURL=INSERT.js.map