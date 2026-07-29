import { CommandParser } from '@redis/client/dist/lib/client/parser';
import { RedisArgument, NumberReply, TuplesToMapReply, SimpleStringReply, TypeMapping } from '@redis/client/dist/lib/RESP/types';
export type CfInfoReplyMap = TuplesToMapReply<[
    [
        SimpleStringReply<'Size'>,
        NumberReply
    ],
    [
        SimpleStringReply<'Number of buckets'>,
        NumberReply
    ],
    [
        SimpleStringReply<'Number of filters'>,
        NumberReply
    ],
    [
        SimpleStringReply<'Number of items inserted'>,
        NumberReply
    ],
    [
        SimpleStringReply<'Number of items deleted'>,
        NumberReply
    ],
    [
        SimpleStringReply<'Bucket size'>,
        NumberReply
    ],
    [
        SimpleStringReply<'Expansion rate'>,
        NumberReply
    ],
    [
        SimpleStringReply<'Max iterations'>,
        NumberReply
    ]
]>;
declare const _default: {
    readonly IS_READ_ONLY: true;
    readonly parseCommand: (this: void, parser: CommandParser, key: RedisArgument) => void;
    readonly transformReply: {
        readonly 2: (this: void, reply: [SimpleStringReply<"Size">, NumberReply<number>, SimpleStringReply<"Number of buckets">, NumberReply<number>, SimpleStringReply<"Number of filters">, NumberReply<number>, SimpleStringReply<"Number of items inserted">, NumberReply<number>, SimpleStringReply<"Number of items deleted">, NumberReply<number>, SimpleStringReply<"Bucket size">, NumberReply<number>, SimpleStringReply<"Expansion rate">, NumberReply<number>, SimpleStringReply<"Max iterations">, NumberReply<number>], _: any, typeMapping?: TypeMapping) => CfInfoReplyMap;
        readonly 3: () => CfInfoReplyMap;
    };
};
export default _default;
//# sourceMappingURL=INFO.d.ts.map