import { CommandParser } from '@redis/client/dist/lib/client/parser';
import { RedisArgument, NumberReply, TuplesToMapReply, SimpleStringReply, TypeMapping } from '@redis/client/dist/lib/RESP/types';
export type TdInfoReplyMap = TuplesToMapReply<[
    [
        SimpleStringReply<'Compression'>,
        NumberReply
    ],
    [
        SimpleStringReply<'Capacity'>,
        NumberReply
    ],
    [
        SimpleStringReply<'Merged nodes'>,
        NumberReply
    ],
    [
        SimpleStringReply<'Unmerged nodes'>,
        NumberReply
    ],
    [
        SimpleStringReply<'Merged weight'>,
        NumberReply
    ],
    [
        SimpleStringReply<'Unmerged weight'>,
        NumberReply
    ],
    [
        SimpleStringReply<'Observations'>,
        NumberReply
    ],
    [
        SimpleStringReply<'Total compressions'>,
        NumberReply
    ],
    [
        SimpleStringReply<'Memory usage'>,
        NumberReply
    ]
]>;
declare const _default: {
    readonly IS_READ_ONLY: true;
    readonly parseCommand: (this: void, parser: CommandParser, key: RedisArgument) => void;
    readonly transformReply: {
        readonly 2: (this: void, reply: [SimpleStringReply<"Compression">, NumberReply<number>, SimpleStringReply<"Capacity">, NumberReply<number>, SimpleStringReply<"Merged nodes">, NumberReply<number>, SimpleStringReply<"Unmerged nodes">, NumberReply<number>, SimpleStringReply<"Merged weight">, NumberReply<number>, SimpleStringReply<"Unmerged weight">, NumberReply<number>, SimpleStringReply<"Observations">, NumberReply<number>, SimpleStringReply<"Total compressions">, NumberReply<number>, SimpleStringReply<"Memory usage">, NumberReply<number>], _: any, typeMapping?: TypeMapping) => TdInfoReplyMap;
        readonly 3: () => TdInfoReplyMap;
    };
};
export default _default;
//# sourceMappingURL=INFO.d.ts.map