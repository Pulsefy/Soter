"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function pushIncrByItem(parser, { item, incrementBy }) {
    parser.push(item, incrementBy.toString());
}
exports.default = {
    IS_READ_ONLY: false,
    parseCommand(parser, key, items) {
        parser.push('TOPK.INCRBY');
        parser.pushKey(key);
        if (Array.isArray(items)) {
            for (const item of items) {
                pushIncrByItem(parser, item);
            }
        }
        else {
            pushIncrByItem(parser, items);
        }
    },
    transformReply: undefined
};
//# sourceMappingURL=INCRBY.js.map