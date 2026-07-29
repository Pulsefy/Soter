"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ADD_1 = __importDefault(require("./ADD"));
const CARD_1 = __importDefault(require("./CARD"));
const EXISTS_1 = __importDefault(require("./EXISTS"));
const INFO_1 = __importDefault(require("./INFO"));
const INSERT_1 = __importDefault(require("./INSERT"));
const LOADCHUNK_1 = __importDefault(require("./LOADCHUNK"));
const MADD_1 = __importDefault(require("./MADD"));
const MEXISTS_1 = __importDefault(require("./MEXISTS"));
const RESERVE_1 = __importDefault(require("./RESERVE"));
const SCANDUMP_1 = __importDefault(require("./SCANDUMP"));
__exportStar(require("./helpers"), exports);
exports.default = {
    /**
     * Adds an item to a Bloom Filter
     * @param key - The name of the Bloom filter
     * @param item - The item to add to the filter
     */
    ADD: ADD_1.default,
    /**
     * Adds an item to a Bloom Filter
     * @param key - The name of the Bloom filter
     * @param item - The item to add to the filter
     */
    add: ADD_1.default,
    /**
     * Returns the cardinality (number of items) in a Bloom Filter
     * @param key - The name of the Bloom filter to query
     */
    CARD: CARD_1.default,
    /**
     * Returns the cardinality (number of items) in a Bloom Filter
     * @param key - The name of the Bloom filter to query
     */
    card: CARD_1.default,
    /**
     * Checks if an item exists in a Bloom Filter
     * @param key - The name of the Bloom filter
     * @param item - The item to check for existence
     */
    EXISTS: EXISTS_1.default,
    /**
     * Checks if an item exists in a Bloom Filter
     * @param key - The name of the Bloom filter
     * @param item - The item to check for existence
     */
    exists: EXISTS_1.default,
    /**
     * Returns information about a Bloom Filter, including capacity, size, number of filters, items inserted, and expansion rate
     * @param key - The name of the Bloom filter to get information about
     */
    INFO: INFO_1.default,
    /**
     * Returns information about a Bloom Filter, including capacity, size, number of filters, items inserted, and expansion rate
     * @param key - The name of the Bloom filter to get information about
     */
    info: INFO_1.default,
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
    INSERT: INSERT_1.default,
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
    insert: INSERT_1.default,
    /**
     * Restores a Bloom Filter chunk previously saved using SCANDUMP
     * @param key - The name of the Bloom filter to restore
     * @param iterator - Iterator value from the SCANDUMP command
     * @param chunk - Data chunk from the SCANDUMP command
     */
    LOADCHUNK: LOADCHUNK_1.default,
    /**
     * Restores a Bloom Filter chunk previously saved using SCANDUMP
     * @param key - The name of the Bloom filter to restore
     * @param iterator - Iterator value from the SCANDUMP command
     * @param chunk - Data chunk from the SCANDUMP command
     */
    loadChunk: LOADCHUNK_1.default,
    /**
     * Adds multiple items to a Bloom Filter in a single call
     * @param key - The name of the Bloom filter
     * @param items - One or more items to add to the filter
     */
    MADD: MADD_1.default,
    /**
     * Adds multiple items to a Bloom Filter in a single call
     * @param key - The name of the Bloom filter
     * @param items - One or more items to add to the filter
     */
    mAdd: MADD_1.default,
    /**
     * Checks if multiple items exist in a Bloom Filter in a single call
     * @param key - The name of the Bloom filter
     * @param items - One or more items to check for existence
     */
    MEXISTS: MEXISTS_1.default,
    /**
     * Checks if multiple items exist in a Bloom Filter in a single call
     * @param key - The name of the Bloom filter
     * @param items - One or more items to check for existence
     */
    mExists: MEXISTS_1.default,
    /**
     * Creates an empty Bloom Filter with a given desired error ratio and initial capacity
     * @param key - The name of the Bloom filter to create
     * @param errorRate - The desired probability for false positives (between 0 and 1)
     * @param capacity - The number of entries intended to be added to the filter
     * @param options - Optional parameters to tune the filter
     * @param options.EXPANSION - Expansion rate for the filter
     * @param options.NONSCALING - Prevents the filter from creating additional sub-filters
     */
    RESERVE: RESERVE_1.default,
    /**
     * Creates an empty Bloom Filter with a given desired error ratio and initial capacity
     * @param key - The name of the Bloom filter to create
     * @param errorRate - The desired probability for false positives (between 0 and 1)
     * @param capacity - The number of entries intended to be added to the filter
     * @param options - Optional parameters to tune the filter
     * @param options.EXPANSION - Expansion rate for the filter
     * @param options.NONSCALING - Prevents the filter from creating additional sub-filters
     */
    reserve: RESERVE_1.default,
    /**
     * Begins an incremental save of a Bloom Filter. This is useful for large filters that can't be saved at once
     * @param key - The name of the Bloom filter to save
     * @param iterator - Iterator value; Start at 0, and use the iterator from the response for the next chunk
     */
    SCANDUMP: SCANDUMP_1.default,
    /**
     * Begins an incremental save of a Bloom Filter. This is useful for large filters that can't be saved at once
     * @param key - The name of the Bloom filter to save
     * @param iterator - Iterator value; Start at 0, and use the iterator from the response for the next chunk
     */
    scanDump: SCANDUMP_1.default
};
//# sourceMappingURL=index.js.map