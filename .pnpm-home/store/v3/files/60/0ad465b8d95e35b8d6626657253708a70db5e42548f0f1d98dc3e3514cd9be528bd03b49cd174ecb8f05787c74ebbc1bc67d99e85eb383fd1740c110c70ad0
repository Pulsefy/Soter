"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ADD_1 = __importDefault(require("./ADD"));
const COUNT_1 = __importDefault(require("./COUNT"));
const INCRBY_1 = __importDefault(require("./INCRBY"));
const INFO_1 = __importDefault(require("./INFO"));
const LIST_WITHCOUNT_1 = __importDefault(require("./LIST_WITHCOUNT"));
const LIST_1 = __importDefault(require("./LIST"));
const QUERY_1 = __importDefault(require("./QUERY"));
const RESERVE_1 = __importDefault(require("./RESERVE"));
exports.default = {
    /**
     * Adds one or more items to a Top-K filter and returns items dropped from the top-K list
     * @param key - The name of the Top-K filter
     * @param items - One or more items to add to the filter
     */
    ADD: ADD_1.default,
    /**
     * Adds one or more items to a Top-K filter and returns items dropped from the top-K list
     * @param key - The name of the Top-K filter
     * @param items - One or more items to add to the filter
     */
    add: ADD_1.default,
    /**
     * Returns the count of occurrences for one or more items in a Top-K filter
     * @param key - The name of the Top-K filter
     * @param items - One or more items to get counts for
     */
    COUNT: COUNT_1.default,
    /**
     * Returns the count of occurrences for one or more items in a Top-K filter
     * @param key - The name of the Top-K filter
     * @param items - One or more items to get counts for
     */
    count: COUNT_1.default,
    /**
     * Increases the score of one or more items in a Top-K filter by specified increments
     * @param key - The name of the Top-K filter
     * @param items - A single item or array of items to increment, each with an item name and increment value
     */
    INCRBY: INCRBY_1.default,
    /**
     * Increases the score of one or more items in a Top-K filter by specified increments
     * @param key - The name of the Top-K filter
     * @param items - A single item or array of items to increment, each with an item name and increment value
     */
    incrBy: INCRBY_1.default,
    /**
     * Returns configuration and statistics of a Top-K filter, including k, width, depth, and decay parameters
     * @param key - The name of the Top-K filter to get information about
     */
    INFO: INFO_1.default,
    /**
     * Returns configuration and statistics of a Top-K filter, including k, width, depth, and decay parameters
     * @param key - The name of the Top-K filter to get information about
     */
    info: INFO_1.default,
    /**
     * Returns all items in a Top-K filter with their respective counts
     * @param key - The name of the Top-K filter
     */
    LIST_WITHCOUNT: LIST_WITHCOUNT_1.default,
    /**
     * Returns all items in a Top-K filter with their respective counts
     * @param key - The name of the Top-K filter
     */
    listWithCount: LIST_WITHCOUNT_1.default,
    /**
     * Returns all items in a Top-K filter
     * @param key - The name of the Top-K filter
     */
    LIST: LIST_1.default,
    /**
     * Returns all items in a Top-K filter
     * @param key - The name of the Top-K filter
     */
    list: LIST_1.default,
    /**
     * Checks if one or more items are in the Top-K list
     * @param key - The name of the Top-K filter
     * @param items - One or more items to check in the filter
     */
    QUERY: QUERY_1.default,
    /**
     * Checks if one or more items are in the Top-K list
     * @param key - The name of the Top-K filter
     * @param items - One or more items to check in the filter
     */
    query: QUERY_1.default,
    /**
     * Creates a new Top-K filter with specified parameters
     * @param key - The name of the Top-K filter
     * @param topK - Number of top occurring items to keep
     * @param options - Optional parameters for filter configuration
     * @param options.width - Number of counters in each array
     * @param options.depth - Number of counter-arrays
     * @param options.decay - Counter decay factor
     */
    RESERVE: RESERVE_1.default,
    /**
     * Creates a new Top-K filter with specified parameters
     * @param key - The name of the Top-K filter
     * @param topK - Number of top occurring items to keep
     * @param options - Optional parameters for filter configuration
     * @param options.width - Number of counters in each array
     * @param options.depth - Number of counter-arrays
     * @param options.decay - Counter decay factor
     */
    reserve: RESERVE_1.default
};
//# sourceMappingURL=index.js.map