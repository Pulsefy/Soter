declare const _default: {
    /**
     * Adds one or more items to a Top-K filter and returns items dropped from the top-K list
     * @param key - The name of the Top-K filter
     * @param items - One or more items to add to the filter
     */
    readonly ADD: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, items: import("@redis/client/dist/lib/commands/generic-transformers").RedisVariadicArgument) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").BlobStringReply<string>>;
    };
    /**
     * Adds one or more items to a Top-K filter and returns items dropped from the top-K list
     * @param key - The name of the Top-K filter
     * @param items - One or more items to add to the filter
     */
    readonly add: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, items: import("@redis/client/dist/lib/commands/generic-transformers").RedisVariadicArgument) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").BlobStringReply<string>>;
    };
    /**
     * Returns the count of occurrences for one or more items in a Top-K filter
     * @param key - The name of the Top-K filter
     * @param items - One or more items to get counts for
     */
    readonly COUNT: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, items: import("@redis/client/dist/lib/commands/generic-transformers").RedisVariadicArgument) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").NumberReply<number>>;
    };
    /**
     * Returns the count of occurrences for one or more items in a Top-K filter
     * @param key - The name of the Top-K filter
     * @param items - One or more items to get counts for
     */
    readonly count: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, items: import("@redis/client/dist/lib/commands/generic-transformers").RedisVariadicArgument) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").NumberReply<number>>;
    };
    /**
     * Increases the score of one or more items in a Top-K filter by specified increments
     * @param key - The name of the Top-K filter
     * @param items - A single item or array of items to increment, each with an item name and increment value
     */
    readonly INCRBY: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, items: import("./INCRBY").TopKIncrByItem | import("./INCRBY").TopKIncrByItem[]) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").NullReply | import("@redis/client/dist/lib/RESP/types").SimpleStringReply<string>>;
    };
    /**
     * Increases the score of one or more items in a Top-K filter by specified increments
     * @param key - The name of the Top-K filter
     * @param items - A single item or array of items to increment, each with an item name and increment value
     */
    readonly incrBy: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, items: import("./INCRBY").TopKIncrByItem | import("./INCRBY").TopKIncrByItem[]) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").NullReply | import("@redis/client/dist/lib/RESP/types").SimpleStringReply<string>>;
    };
    /**
     * Returns configuration and statistics of a Top-K filter, including k, width, depth, and decay parameters
     * @param key - The name of the Top-K filter to get information about
     */
    readonly INFO: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument) => void; /**
         * Returns the count of occurrences for one or more items in a Top-K filter
         * @param key - The name of the Top-K filter
         * @param items - One or more items to get counts for
         */
        readonly transformReply: {
            readonly 2: (reply: [import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"k">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"width">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"depth">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"decay">, import("@redis/client/dist/lib/RESP/types").BlobStringReply<string>], preserve?: unknown, typeMapping?: import("@redis/client/dist/lib/RESP/types").TypeMapping | undefined) => import("./INFO").TopKInfoReplyMap;
            readonly 3: () => import("./INFO").TopKInfoReplyMap;
        };
    };
    /**
     * Returns configuration and statistics of a Top-K filter, including k, width, depth, and decay parameters
     * @param key - The name of the Top-K filter to get information about
     */
    readonly info: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument) => void; /**
         * Returns the count of occurrences for one or more items in a Top-K filter
         * @param key - The name of the Top-K filter
         * @param items - One or more items to get counts for
         */
        readonly transformReply: {
            readonly 2: (reply: [import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"k">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"width">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"depth">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"decay">, import("@redis/client/dist/lib/RESP/types").BlobStringReply<string>], preserve?: unknown, typeMapping?: import("@redis/client/dist/lib/RESP/types").TypeMapping | undefined) => import("./INFO").TopKInfoReplyMap;
            readonly 3: () => import("./INFO").TopKInfoReplyMap;
        };
    };
    /**
     * Returns all items in a Top-K filter with their respective counts
     * @param key - The name of the Top-K filter
     */
    readonly LIST_WITHCOUNT: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument) => void;
        readonly transformReply: (this: void, rawReply: (import("@redis/client/dist/lib/RESP/types").NumberReply<number> | import("@redis/client/dist/lib/RESP/types").BlobStringReply<string>)[]) => {
            item: import("@redis/client/dist/lib/RESP/types").BlobStringReply<string>;
            count: import("@redis/client/dist/lib/RESP/types").NumberReply<number>; /**
             * Adds one or more items to a Top-K filter and returns items dropped from the top-K list
             * @param key - The name of the Top-K filter
             * @param items - One or more items to add to the filter
             */
        }[];
    };
    /**
     * Returns all items in a Top-K filter with their respective counts
     * @param key - The name of the Top-K filter
     */
    readonly listWithCount: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument) => void;
        readonly transformReply: (this: void, rawReply: (import("@redis/client/dist/lib/RESP/types").NumberReply<number> | import("@redis/client/dist/lib/RESP/types").BlobStringReply<string>)[]) => {
            item: import("@redis/client/dist/lib/RESP/types").BlobStringReply<string>;
            count: import("@redis/client/dist/lib/RESP/types").NumberReply<number>; /**
             * Adds one or more items to a Top-K filter and returns items dropped from the top-K list
             * @param key - The name of the Top-K filter
             * @param items - One or more items to add to the filter
             */
        }[];
    };
    /**
     * Returns all items in a Top-K filter
     * @param key - The name of the Top-K filter
     */
    readonly LIST: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").BlobStringReply<string>>;
    };
    /**
     * Returns all items in a Top-K filter
     * @param key - The name of the Top-K filter
     */
    readonly list: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").BlobStringReply<string>>;
    };
    /**
     * Checks if one or more items are in the Top-K list
     * @param key - The name of the Top-K filter
     * @param items - One or more items to check in the filter
     */
    readonly QUERY: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, items: import("@redis/client/dist/lib/commands/generic-transformers").RedisVariadicArgument) => void;
        readonly transformReply: {
            2: (reply: import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").NumberReply<0 | 1>>) => boolean[];
            3: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").BooleanReply<boolean>>;
        };
    };
    /**
     * Checks if one or more items are in the Top-K list
     * @param key - The name of the Top-K filter
     * @param items - One or more items to check in the filter
     */
    readonly query: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, items: import("@redis/client/dist/lib/commands/generic-transformers").RedisVariadicArgument) => void;
        readonly transformReply: {
            2: (reply: import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").NumberReply<0 | 1>>) => boolean[];
            3: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").BooleanReply<boolean>>;
        };
    };
    /**
     * Creates a new Top-K filter with specified parameters
     * @param key - The name of the Top-K filter
     * @param topK - Number of top occurring items to keep
     * @param options - Optional parameters for filter configuration
     * @param options.width - Number of counters in each array
     * @param options.depth - Number of counter-arrays
     * @param options.decay - Counter decay factor
     */
    readonly RESERVE: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, topK: number, options?: import("./RESERVE").TopKReserveOptions | undefined) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"OK">;
    };
    /**
     * Creates a new Top-K filter with specified parameters
     * @param key - The name of the Top-K filter
     * @param topK - Number of top occurring items to keep
     * @param options - Optional parameters for filter configuration
     * @param options.width - Number of counters in each array
     * @param options.depth - Number of counter-arrays
     * @param options.decay - Counter decay factor
     */
    readonly reserve: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, topK: number, options?: import("./RESERVE").TopKReserveOptions | undefined) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"OK">;
    };
};
export default _default;
//# sourceMappingURL=index.d.ts.map