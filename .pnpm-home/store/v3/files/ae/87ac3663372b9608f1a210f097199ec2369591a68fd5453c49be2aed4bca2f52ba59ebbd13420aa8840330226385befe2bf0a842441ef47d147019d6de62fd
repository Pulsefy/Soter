declare const _default: {
    /**
     * Increases the count of one or more items in a Count-Min Sketch
     * @param key - The name of the sketch
     * @param items - A single item or array of items to increment, each with an item and increment value
     */
    readonly INCRBY: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, items: import("./INCRBY").BfIncrByItem | import("./INCRBY").BfIncrByItem[]) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").NumberReply<number>>;
    };
    /**
     * Increases the count of one or more items in a Count-Min Sketch
     * @param key - The name of the sketch
     * @param items - A single item or array of items to increment, each with an item and increment value
     */
    readonly incrBy: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, items: import("./INCRBY").BfIncrByItem | import("./INCRBY").BfIncrByItem[]) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").NumberReply<number>>;
    };
    /**
     * Returns width, depth, and total count of items in a Count-Min Sketch
     * @param key - The name of the sketch to get information about
     */
    readonly INFO: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument) => void;
        readonly transformReply: {
            readonly 2: (this: void, reply: [import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"width">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"depth">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"count">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>], _: any, typeMapping?: import("@redis/client/dist/lib/RESP/types").TypeMapping | undefined) => import("./INFO").CmsInfoReply;
            readonly 3: () => import("./INFO").CmsInfoReply;
        };
    };
    /**
     * Returns width, depth, and total count of items in a Count-Min Sketch
     * @param key - The name of the sketch to get information about
     */
    readonly info: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument) => void;
        readonly transformReply: {
            readonly 2: (this: void, reply: [import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"width">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"depth">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"count">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>], _: any, typeMapping?: import("@redis/client/dist/lib/RESP/types").TypeMapping | undefined) => import("./INFO").CmsInfoReply;
            readonly 3: () => import("./INFO").CmsInfoReply;
        };
    };
    /**
     * Initialize a Count-Min Sketch using width and depth parameters
     * @param key - The name of the sketch
     * @param width - Number of counters in each array (must be a multiple of 2)
     * @param depth - Number of counter arrays (determines accuracy of estimates)
     */
    readonly INITBYDIM: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, width: number, depth: number) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"OK">;
    };
    /**
     * Initialize a Count-Min Sketch using width and depth parameters
     * @param key - The name of the sketch
     * @param width - Number of counters in each array (must be a multiple of 2)
     * @param depth - Number of counter arrays (determines accuracy of estimates)
     */
    readonly initByDim: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, width: number, depth: number) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"OK">;
    };
    /**
     * Initialize a Count-Min Sketch using error rate and probability parameters
     * @param key - The name of the sketch
     * @param error - Estimate error, as a decimal between 0 and 1
     * @param probability - The desired probability for inflated count, as a decimal between 0 and 1
     */
    readonly INITBYPROB: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, error: number, probability: number) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"OK">;
    };
    /**
     * Initialize a Count-Min Sketch using error rate and probability parameters
     * @param key - The name of the sketch
     * @param error - Estimate error, as a decimal between 0 and 1
     * @param probability - The desired probability for inflated count, as a decimal between 0 and 1
     */
    readonly initByProb: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, error: number, probability: number) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"OK">;
    };
    /**
     * Merges multiple Count-Min Sketches into a single sketch, with optional weights
     * @param destination - The name of the destination sketch
     * @param source - Array of sketch names or array of sketches with weights
     */
    readonly MERGE: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, destination: import("@redis/client/dist/lib/RESP/types").RedisArgument, source: import("./MERGE").BfMergeSketches) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"OK">;
    };
    /**
     * Merges multiple Count-Min Sketches into a single sketch, with optional weights
     * @param destination - The name of the destination sketch
     * @param source - Array of sketch names or array of sketches with weights
     */
    readonly merge: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, destination: import("@redis/client/dist/lib/RESP/types").RedisArgument, source: import("./MERGE").BfMergeSketches) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"OK">;
    };
    /**
     * Returns the count for one or more items in a Count-Min Sketch
     * @param key - The name of the sketch
     * @param items - One or more items to get counts for
     */
    readonly QUERY: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, items: import("@redis/client/dist/lib/commands/generic-transformers").RedisVariadicArgument) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").NumberReply<number>>;
    };
    /**
     * Returns the count for one or more items in a Count-Min Sketch
     * @param key - The name of the sketch
     * @param items - One or more items to get counts for
     */
    readonly query: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, items: import("@redis/client/dist/lib/commands/generic-transformers").RedisVariadicArgument) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").NumberReply<number>>;
    };
};
export default _default;
//# sourceMappingURL=index.d.ts.map