declare const _default: {
    /**
     * Adds one or more observations to a t-digest sketch
     * @param key - The name of the t-digest sketch
     * @param values - Array of numeric values to add to the sketch
     */
    readonly ADD: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, values: number[]) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"OK">;
    };
    /**
     * Adds one or more observations to a t-digest sketch
     * @param key - The name of the t-digest sketch
     * @param values - Array of numeric values to add to the sketch
     */
    readonly add: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, values: number[]) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"OK">;
    };
    /**
     * Returns value estimates for one or more ranks in a t-digest sketch
     * @param key - The name of the t-digest sketch
     * @param ranks - Array of ranks to get value estimates for (ascending order)
     */
    readonly BYRANK: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, ranks: number[]) => void;
        readonly transformReply: {
            2: (reply: import("@redis/client/dist/lib/RESP/types").BlobStringReply<string>[], preserve?: any, typeMapping?: import("@redis/client/dist/lib/RESP/types").TypeMapping | undefined) => import("@redis/client/dist/lib/RESP/types").DoubleReply<number>[];
            3: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").DoubleReply<number>>;
        };
    };
    /**
     * Returns value estimates for one or more ranks in a t-digest sketch
     * @param key - The name of the t-digest sketch
     * @param ranks - Array of ranks to get value estimates for (ascending order)
     */
    readonly byRank: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, ranks: number[]) => void;
        readonly transformReply: {
            2: (reply: import("@redis/client/dist/lib/RESP/types").BlobStringReply<string>[], preserve?: any, typeMapping?: import("@redis/client/dist/lib/RESP/types").TypeMapping | undefined) => import("@redis/client/dist/lib/RESP/types").DoubleReply<number>[];
            3: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").DoubleReply<number>>;
        };
    };
    /**
     * Returns value estimates for one or more ranks in a t-digest sketch, starting from highest rank
     * @param key - The name of the t-digest sketch
     * @param ranks - Array of ranks to get value estimates for (descending order)
     */
    readonly BYREVRANK: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, ranks: number[]) => void;
        readonly transformReply: {
            2: (reply: import("@redis/client/dist/lib/RESP/types").BlobStringReply<string>[], preserve?: any, typeMapping?: import("@redis/client/dist/lib/RESP/types").TypeMapping | undefined) => import("@redis/client/dist/lib/RESP/types").DoubleReply<number>[];
            3: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").DoubleReply<number>>;
        };
    };
    /**
     * Returns value estimates for one or more ranks in a t-digest sketch, starting from highest rank
     * @param key - The name of the t-digest sketch
     * @param ranks - Array of ranks to get value estimates for (descending order)
     */
    readonly byRevRank: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, ranks: number[]) => void;
        readonly transformReply: {
            2: (reply: import("@redis/client/dist/lib/RESP/types").BlobStringReply<string>[], preserve?: any, typeMapping?: import("@redis/client/dist/lib/RESP/types").TypeMapping | undefined) => import("@redis/client/dist/lib/RESP/types").DoubleReply<number>[];
            3: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").DoubleReply<number>>;
        };
    };
    /**
     * Estimates the cumulative distribution function for values in a t-digest sketch
     * @param key - The name of the t-digest sketch
     * @param values - Array of values to get CDF estimates for
     */
    readonly CDF: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, values: number[]) => void;
        readonly transformReply: {
            2: (reply: import("@redis/client/dist/lib/RESP/types").BlobStringReply<string>[], preserve?: any, typeMapping?: import("@redis/client/dist/lib/RESP/types").TypeMapping | undefined) => import("@redis/client/dist/lib/RESP/types").DoubleReply<number>[];
            3: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").DoubleReply<number>>;
        };
    };
    /**
     * Estimates the cumulative distribution function for values in a t-digest sketch
     * @param key - The name of the t-digest sketch
     * @param values - Array of values to get CDF estimates for
     */
    readonly cdf: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, values: number[]) => void;
        readonly transformReply: {
            2: (reply: import("@redis/client/dist/lib/RESP/types").BlobStringReply<string>[], preserve?: any, typeMapping?: import("@redis/client/dist/lib/RESP/types").TypeMapping | undefined) => import("@redis/client/dist/lib/RESP/types").DoubleReply<number>[];
            3: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").DoubleReply<number>>;
        };
    };
    /**
     * Creates a new t-digest sketch for storing distributions
     * @param key - The name of the t-digest sketch
     * @param options - Optional parameters for sketch creation
     * @param options.COMPRESSION - Compression parameter that affects performance and accuracy
     */
    readonly CREATE: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, options?: import("./CREATE").TDigestCreateOptions | undefined) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"OK">;
    };
    /**
     * Creates a new t-digest sketch for storing distributions
     * @param key - The name of the t-digest sketch
     * @param options - Optional parameters for sketch creation
     * @param options.COMPRESSION - Compression parameter that affects performance and accuracy
     */
    readonly create: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, options?: import("./CREATE").TDigestCreateOptions | undefined) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"OK">;
    };
    /**
     * Returns information about a t-digest sketch including compression, capacity, nodes, weights, observations and memory usage
     * @param key - The name of the t-digest sketch to get information about
     */
    readonly INFO: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument) => void;
        readonly transformReply: {
            readonly 2: (this: void, reply: [import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"Compression">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"Capacity">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"Merged nodes">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"Unmerged nodes">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"Merged weight">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"Unmerged weight">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"Observations">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"Total compressions">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"Memory usage">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>], _: any, typeMapping?: import("@redis/client/dist/lib/RESP/types").TypeMapping | undefined) => import("./INFO").TdInfoReplyMap;
            readonly 3: () => import("./INFO").TdInfoReplyMap;
        };
    };
    /**
     * Returns information about a t-digest sketch including compression, capacity, nodes, weights, observations and memory usage
     * @param key - The name of the t-digest sketch to get information about
     */
    readonly info: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument) => void;
        readonly transformReply: {
            readonly 2: (this: void, reply: [import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"Compression">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"Capacity">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"Merged nodes">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"Unmerged nodes">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"Merged weight">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"Unmerged weight">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"Observations">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"Total compressions">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>, import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"Memory usage">, import("@redis/client/dist/lib/RESP/types").NumberReply<number>], _: any, typeMapping?: import("@redis/client/dist/lib/RESP/types").TypeMapping | undefined) => import("./INFO").TdInfoReplyMap;
            readonly 3: () => import("./INFO").TdInfoReplyMap;
        };
    };
    /**
     * Returns the maximum value from a t-digest sketch
     * @param key - The name of the t-digest sketch
     */
    readonly MAX: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument) => void;
        readonly transformReply: {
            2: (reply: import("@redis/client/dist/lib/RESP/types").BlobStringReply<string>, preserve?: any, typeMapping?: import("@redis/client/dist/lib/RESP/types").TypeMapping | undefined) => import("@redis/client/dist/lib/RESP/types").DoubleReply<number>;
            3: () => import("@redis/client/dist/lib/RESP/types").DoubleReply<number>;
        };
    };
    /**
     * Returns the maximum value from a t-digest sketch
     * @param key - The name of the t-digest sketch
     */
    readonly max: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument) => void;
        readonly transformReply: {
            2: (reply: import("@redis/client/dist/lib/RESP/types").BlobStringReply<string>, preserve?: any, typeMapping?: import("@redis/client/dist/lib/RESP/types").TypeMapping | undefined) => import("@redis/client/dist/lib/RESP/types").DoubleReply<number>;
            3: () => import("@redis/client/dist/lib/RESP/types").DoubleReply<number>;
        };
    };
    /**
     * Merges multiple t-digest sketches into one, with optional compression and override settings
     * @param destination - The name of the destination t-digest sketch
     * @param source - One or more source sketch names to merge from
     * @param options - Optional parameters for merge operation
     * @param options.COMPRESSION - New compression value for merged sketch
     * @param options.OVERRIDE - If true, override destination sketch if it exists
     */
    readonly MERGE: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, destination: import("@redis/client/dist/lib/RESP/types").RedisArgument, source: import("@redis/client/dist/lib/commands/generic-transformers").RedisVariadicArgument, options?: import("./MERGE").TDigestMergeOptions | undefined) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"OK">;
    };
    /**
     * Merges multiple t-digest sketches into one, with optional compression and override settings
     * @param destination - The name of the destination t-digest sketch
     * @param source - One or more source sketch names to merge from
     * @param options - Optional parameters for merge operation
     * @param options.COMPRESSION - New compression value for merged sketch
     * @param options.OVERRIDE - If true, override destination sketch if it exists
     */
    readonly merge: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, destination: import("@redis/client/dist/lib/RESP/types").RedisArgument, source: import("@redis/client/dist/lib/commands/generic-transformers").RedisVariadicArgument, options?: import("./MERGE").TDigestMergeOptions | undefined) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"OK">;
    };
    /**
     * Returns the minimum value from a t-digest sketch
     * @param key - The name of the t-digest sketch
     */
    readonly MIN: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument) => void;
        readonly transformReply: {
            2: (reply: import("@redis/client/dist/lib/RESP/types").BlobStringReply<string>, preserve?: any, typeMapping?: import("@redis/client/dist/lib/RESP/types").TypeMapping | undefined) => import("@redis/client/dist/lib/RESP/types").DoubleReply<number>;
            3: () => import("@redis/client/dist/lib/RESP/types").DoubleReply<number>;
        };
    };
    /**
     * Returns the minimum value from a t-digest sketch
     * @param key - The name of the t-digest sketch
     */
    readonly min: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument) => void;
        readonly transformReply: {
            2: (reply: import("@redis/client/dist/lib/RESP/types").BlobStringReply<string>, preserve?: any, typeMapping?: import("@redis/client/dist/lib/RESP/types").TypeMapping | undefined) => import("@redis/client/dist/lib/RESP/types").DoubleReply<number>;
            3: () => import("@redis/client/dist/lib/RESP/types").DoubleReply<number>;
        };
    };
    /**
     * Returns value estimates at requested quantiles from a t-digest sketch
     * @param key - The name of the t-digest sketch
     * @param quantiles - Array of quantiles (between 0 and 1) to get value estimates for
     */
    readonly QUANTILE: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, quantiles: number[]) => void;
        readonly transformReply: {
            2: (reply: import("@redis/client/dist/lib/RESP/types").BlobStringReply<string>[], preserve?: any, typeMapping?: import("@redis/client/dist/lib/RESP/types").TypeMapping | undefined) => import("@redis/client/dist/lib/RESP/types").DoubleReply<number>[];
            3: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").DoubleReply<number>>;
        };
    };
    /**
     * Returns value estimates at requested quantiles from a t-digest sketch
     * @param key - The name of the t-digest sketch
     * @param quantiles - Array of quantiles (between 0 and 1) to get value estimates for
     */
    readonly quantile: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, quantiles: number[]) => void;
        readonly transformReply: {
            2: (reply: import("@redis/client/dist/lib/RESP/types").BlobStringReply<string>[], preserve?: any, typeMapping?: import("@redis/client/dist/lib/RESP/types").TypeMapping | undefined) => import("@redis/client/dist/lib/RESP/types").DoubleReply<number>[];
            3: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").DoubleReply<number>>;
        };
    };
    /**
     * Returns the rank of one or more values in a t-digest sketch (number of values that are lower than each value)
     * @param key - The name of the t-digest sketch
     * @param values - Array of values to get ranks for
     */
    readonly RANK: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, values: number[]) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").NumberReply<number>>;
    };
    /**
     * Returns the rank of one or more values in a t-digest sketch (number of values that are lower than each value)
     * @param key - The name of the t-digest sketch
     * @param values - Array of values to get ranks for
     */
    readonly rank: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, values: number[]) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").NumberReply<number>>;
    };
    /**
     * Resets a t-digest sketch, clearing all previously added observations
     * @param key - The name of the t-digest sketch to reset
     */
    readonly RESET: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"OK">;
    };
    /**
     * Resets a t-digest sketch, clearing all previously added observations
     * @param key - The name of the t-digest sketch to reset
     */
    readonly reset: {
        readonly IS_READ_ONLY: false;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").SimpleStringReply<"OK">;
    };
    /**
     * Returns the reverse rank of one or more values in a t-digest sketch (number of values that are higher than each value)
     * @param key - The name of the t-digest sketch
     * @param values - Array of values to get reverse ranks for
     */
    readonly REVRANK: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, values: number[]) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").NumberReply<number>>;
    };
    /**
     * Returns the reverse rank of one or more values in a t-digest sketch (number of values that are higher than each value)
     * @param key - The name of the t-digest sketch
     * @param values - Array of values to get reverse ranks for
     */
    readonly revRank: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, values: number[]) => void;
        readonly transformReply: () => import("@redis/client/dist/lib/RESP/types").ArrayReply<import("@redis/client/dist/lib/RESP/types").NumberReply<number>>;
    };
    /**
     * Returns the mean value from a t-digest sketch after trimming values at specified percentiles
     * @param key - The name of the t-digest sketch
     * @param lowCutPercentile - Lower percentile cutoff (between 0 and 100)
     * @param highCutPercentile - Higher percentile cutoff (between 0 and 100)
     */
    readonly TRIMMED_MEAN: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, lowCutPercentile: number, highCutPercentile: number) => void;
        readonly transformReply: {
            2: (reply: import("@redis/client/dist/lib/RESP/types").BlobStringReply<string>, preserve?: any, typeMapping?: import("@redis/client/dist/lib/RESP/types").TypeMapping | undefined) => import("@redis/client/dist/lib/RESP/types").DoubleReply<number>;
            3: () => import("@redis/client/dist/lib/RESP/types").DoubleReply<number>;
        };
    };
    /**
     * Returns the mean value from a t-digest sketch after trimming values at specified percentiles
     * @param key - The name of the t-digest sketch
     * @param lowCutPercentile - Lower percentile cutoff (between 0 and 100)
     * @param highCutPercentile - Higher percentile cutoff (between 0 and 100)
     */
    readonly trimmedMean: {
        readonly IS_READ_ONLY: true;
        readonly parseCommand: (this: void, parser: import("@redis/client").CommandParser, key: import("@redis/client/dist/lib/RESP/types").RedisArgument, lowCutPercentile: number, highCutPercentile: number) => void;
        readonly transformReply: {
            2: (reply: import("@redis/client/dist/lib/RESP/types").BlobStringReply<string>, preserve?: any, typeMapping?: import("@redis/client/dist/lib/RESP/types").TypeMapping | undefined) => import("@redis/client/dist/lib/RESP/types").DoubleReply<number>;
            3: () => import("@redis/client/dist/lib/RESP/types").DoubleReply<number>;
        };
    };
};
export default _default;
//# sourceMappingURL=index.d.ts.map