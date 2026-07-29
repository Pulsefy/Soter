"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCfInsertArguments = void 0;
const generic_transformers_1 = require("@redis/client/dist/lib/commands/generic-transformers");
function parseCfInsertArguments(parser, key, items, options) {
    parser.pushKey(key);
    if (options?.CAPACITY !== undefined) {
        parser.push('CAPACITY', options.CAPACITY.toString());
    }
    if (options?.NOCREATE) {
        parser.push('NOCREATE');
    }
    parser.push('ITEMS');
    parser.pushVariadic(items);
}
exports.parseCfInsertArguments = parseCfInsertArguments;
exports.default = {
    IS_READ_ONLY: false,
    parseCommand(...args) {
        args[0].push('CF.INSERT');
        parseCfInsertArguments(...args);
    },
    transformReply: generic_transformers_1.transformBooleanArrayReply
};
//# sourceMappingURL=INSERT.js.map