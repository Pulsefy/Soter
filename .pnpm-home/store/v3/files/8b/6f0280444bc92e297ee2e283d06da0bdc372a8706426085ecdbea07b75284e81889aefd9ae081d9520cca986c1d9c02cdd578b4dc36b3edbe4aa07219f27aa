export * from './helpers';
declare const _default: {
    /**
     * Adds an item to a Bloom Filter
     * @param key - The name of the Bloom filter
     * @param item - The item to add to the filter
     */
    readonly ADD: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, item: import("@redis/client/dist/lib/RESP/types").RedisArgument) => void;
        readonly transformReply: {
            2: (reply: import("@redis/client/dist/lib/RESP/types").NumberReply<0 | 1>) => boolean;
            3: () => import("@redis/client/dist/lib/RESP/types").BooleanReply<boolean>;
        };
    };
    /**
     * Adds an item to a Bloom Filter
     * @param key - The name of the Bloom filter
     * @param item - The item to add to the filter
     */
    readonly add: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, item: import("@redis/client/dist/lib/RESP/types").RedisArgument) => void;
        readonly transformReply: {
            2: (reply: import("@redis/client/dist/lib/RESP/types").NumberReply<0 | 1>) => boolean;
            3: () => import("@redis/client/dist/lib/RESP/types").BooleanReply<boolean>;
        };
    };
    /**
     * Returns the cardinality (number of items) in a Bloom Filter
     * @param key - The name of the Bloom filter to query
     */
    readonly CARD: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").NumberReply<number>;
    };
    /**
     * Returns the cardinality (number of items) in a Bloom Filter
     * @param key - The name of the Bloom filter to query
     */
    readonly card: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").NumberReply<number>;
    };
    /**
     * Checks if an item exists in a Bloom Filter
     * @param key - The name of the Bloom filter
     * @param item - The item to check for existence
     */
    readonly EXISTS: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, item: import("@redis/client/dist/lib/RESP/types").RedisArgument) => void;
        readonly transformReply: {
            2: (reply: import("@redis/client/dist/lib/RESP/types").NumberReply<0 | 1>) => boolean;
            3: () => import("@redis/client/dist/lib/RESP/types").BooleanReply<boolean>;
        };
    };
    /**
     * Checks if an item exists in a Bloom Filter
     * @param key - The name of the Bloom filter
     * @param item - The item to check for existence
     */
    readonly exists: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, item: import("@redis/client/dist/lib/RESP/types").RedisArgument) => void;
        readonly transformReply: {
            2: (reply: import("@redis/client/dist/lib/RESP/types").NumberReply<0 | 1>) => boolean;
            3: () => import("@redis/client/dist/lib/RESP/types").BooleanReply<boolean>;
        };
    };
    /**
     * Returns information about a Bloom Filter, including capacity, size, number of filters, items inserted, and expansion rate
     * @param key - The name of the Bloom filter to get information about
     */
    readonly INFO: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument) => void;
        readonly transformReply: {
            readonly 2: (this: void, reply: [import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"Capacity">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"Size">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"Number of filters">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"Number of items inserted">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"Expansion rate">, import("@redis/client/dist/lib/RESP/types").NullReply | import("@redis/client/dist/lib/RESP/types").NumberReply<number>], _: any, typeMapping?: import("@redis/client/dist/lib/RESP/types").TypeMapping | undefined) => import("./INFO").BfInfoReplyMap;
            readonly 3: () => import("./INFO").BfInfoReplyMap;
        };
    };
    /**
     * Returns information about a Bloom Filter, including capacity, size, number of filters, items inserted, and expansion rate
     * @param key - The name of the Bloom filter to get information about
     */
    readonly info: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument) => void;
        readonly transformReply: {
            readonly 2: (this: void, reply: [import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"Capacity">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"Size">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"Number of filters">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"Number of items inserted">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"Expansion rate">, import("@redis/client/dist/lib/RESP/types").NullReply | import("@redis/client/dist/lib/RESP/types").NumberReply<number>], _: any, typeMapping?: import("@redis/client/dist/lib/RESP/types").TypeMapping | undefined) => import("./INFO").BfInfoReplyMap;
            readonly 3: () => import("./INFO").BfInfoReplyMap;
        };
    };
    /**
     * Adds one or more items to a Bloom Filter, creating it if it does not exist
     * @param key - The name of the Bloom filter
     * @param items - One or more items to add to the filter
     * @param options - Optional parameters for filter creation
     * @param options.CAPACITY - Desired capacity for a new filter
     * @param options.ERROR - Desired error rate for a new filter
     * @param options.EXPANSION - Expansion rate for a new filter
     * @param options.NOCREATE - If true, prevents automatic filter creation
     * @param options.NONSCALING - Prevents the filter from creating additional sub-filters
     */
    readonly INSERT: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, items: import("@redis/client/dist/lib/commands/generic-transformers").RedisVariadicArgument, options?: import("./INSERT").BfInsertOptions | undefined) => void;
        readonly transformReply: {
            2: (reply: import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").NumberReply<0 | 1>>) => boolean[];
            3: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").BooleanReply<boolean>>;
        };
    };
    /**
     * Adds one or more items to a Bloom Filter, creating it if it does not exist
     * @param key - The name of the Bloom filter
     * @param items - One or more items to add to the filter
     * @param options - Optional parameters for filter creation
     * @param options.CAPACITY - Desired capacity for a new filter
     * @param options.ERROR - Desired error rate for a new filter
     * @param options.EXPANSION - Expansion rate for a new filter
     * @param options.NOCREATE - If true, prevents automatic filter creation
     * @param options.NONSCALING - Prevents the filter from creating additional sub-filters
     */
    readonly insert: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, items: import("@redis/client/dist/lib/commands/generic-transformers").RedisVariadicArgument, options?: import("./INSERT").BfInsertOptions | undefined) => void;
        readonly transformReply: {
            2: (reply: import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").NumberReply<0 | 1>>) => boolean[];
            3: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").BooleanReply<boolean>>;
        };
    };
    /**
     * Restores a Bloom Filter chunk previously saved using SCANDUMP
     * @param key - The name of the Bloom filter to restore
     * @param iterator - Iterator value from the SCANDUMP command
     * @param chunk - Data chunk from the SCANDUMP command
     */
    readonly LOADCHUNK: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, iterator: number, chunk: import("@redis/client/dist/lib/RESP/types").RedisArgument) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"OK">;
    };
    /**
     * Restores a Bloom Filter chunk previously saved using SCANDUMP
     * @param key - The name of the Bloom filter to restore
     * @param iterator - Iterator value from the SCANDUMP command
     * @param chunk - Data chunk from the SCANDUMP command
     */
    readonly loadChunk: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, iterator: number, chunk: import("@redis/client/dist/lib/RESP/types").RedisArgument) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"OK">;
    };
    /**
     * Adds multiple items to a Bloom Filter in a single call
     * @param key - The name of the Bloom filter
     * @param items - One or more items to add to the filter
     */
    readonly MADD: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, items: import("@redis/client/dist/lib/commands/generic-transformers").RedisVariadicArgument) => void;
        readonly transformReply: {
            2: (reply: import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").NumberReply<0 | 1>>) => boolean[];
            3: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").BooleanReply<boolean>>;
        };
    };
    /**
     * Adds multiple items to a Bloom Filter in a single call
     * @param key - The name of the Bloom filter
     * @param items - One or more items to add to the filter
     */
    readonly mAdd: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, items: import("@redis/client/dist/lib/commands/generic-transformers").RedisVariadicArgument) => void;
        readonly transformReply: {
            2: (reply: import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").NumberReply<0 | 1>>) => boolean[];
            3: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").BooleanReply<boolean>>;
        };
    };
    /**
     * Checks if multiple items exist in a Bloom Filter in a single call
     * @param key - The name of the Bloom filter
     * @param items - One or more items to check for existence
     */
    readonly MEXISTS: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, items: import("@redis/client/dist/lib/commands/generic-transformers").RedisVariadicArgument) => void;
        readonly transformReply: {
            2: (reply: import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").NumberReply<0 | 1>>) => boolean[];
            3: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").BooleanReply<boolean>>;
        };
    };
    /**
     * Checks if multiple items exist in a Bloom Filter in a single call
     * @param key - The name of the Bloom filter
     * @param items - One or more items to check for existence
     */
    readonly mExists: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, items: import("@redis/client/dist/lib/commands/generic-transformers").RedisVariadicArgument) => void;
        readonly transformReply: {
            2: (reply: import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").NumberReply<0 | 1>>) => boolean[];
            3: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").BooleanReply<boolean>>;
        };
    };
    /**
     * Creates an empty Bloom Filter with a given desired error ratio and initial capacity
     * @param key - The name of the Bloom filter to create
     * @param errorRate - The desired probability for false positives (between 0 and 1)
     * @param capacity - The number of entries intended to be added to the filter
     * @param options - Optional parameters to tune the filter
     * @param options.EXPANSION - Expansion rate for the filter
     * @param options.NONSCALING - Prevents the filter from creating additional sub-filters
     */
    readonly RESERVE: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, errorRate: number, capacity: number, options?: import("./RESERVE").BfReserveOptions | undefined) => void; /**
         * Returns the cardinality (number of items) in a Bloom Filter
         * @param key - The name of the Bloom filter to query
         */
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"OK">;
    };
    /**
     * Creates an empty Bloom Filter with a given desired error ratio and initial capacity
     * @param key - The name of the Bloom filter to create
     * @param errorRate - The desired probability for false positives (between 0 and 1)
     * @param capacity - The number of entries intended to be added to the filter
     * @param options - Optional parameters to tune the filter
     * @param options.EXPANSION - Expansion rate for the filter
     * @param options.NONSCALING - Prevents the filter from creating additional sub-filters
     */
    readonly reserve: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, errorRate: number, capacity: number, options?: import("./RESERVE").BfReserveOptions | undefined) => void; /**
         * Returns the cardinality (number of items) in a Bloom Filter
         * @param key - The name of the Bloom filter to query
         */
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"OK">;
    };
    /**
     * Begins an incremental save of a Bloom Filter. This is useful for large filters that can't be saved at once
     * @param key - The name of the Bloom filter to save
     * @param iterator - Iterator value; Start at 0, and use the iterator from the response for the next chunk
     */
    readonly SCANDUMP: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, iterator: number) => void;
        readonly transformReply: (this: void, reply: [import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").BlobStringReply<string>]) => {
            iterator: import("@redis/client/dist/lib/RESP/types").NumberReply<number>;
            chunk: import("@redis/client/dist/lib/RESP/types").BlobStringReply<string>;
        };
    };
    /**
     * Begins an incremental save of a Bloom Filter. This is useful for large filters that can't be saved at once
     * @param key - The name of the Bloom filter to save
     * @param iterator - Iterator value; Start at 0, and use the iterator from the response for the next chunk
     */
    readonly scanDump: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, iterator: number) => void;
        readonly transformReply: (this: void, reply: [import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").BlobStringReply<string>]) => {
            iterator: import("@redis/client/dist/lib/RESP/types").NumberReply<number>;
            chunk: import("@redis/client/dist/lib/RESP/types").BlobStringReply<string>;
        };
    };
};
export default _default;
//# sourceMappingURL=index.d.ts.map