"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const INCRBY_1 = __importDefault(require("./INCRBY"));
const INFO_1 = __importDefault(require("./INFO"));
const INITBYDIM_1 = __importDefault(require("./INITBYDIM"));
const INITBYPROB_1 = __importDefault(require("./INITBYPROB"));
const MERGE_1 = __importDefault(require("./MERGE"));
const QUERY_1 = __importDefault(require("./QUERY"));
exports.default = {
    /**
     * Increases the count of one or more items in a Count-Min Sketch
     * @param key - The name of the sketch
     * @param items - A single item or array of items to increment, each with an item and increment value
     */
    INCRBY: INCRBY_1.default,
    /**
     * Increases the count of one or more items in a Count-Min Sketch
     * @param key - The name of the sketch
     * @param items - A single item or array of items to increment, each with an item and increment value
     */
    incrBy: INCRBY_1.default,
    /**
     * Returns width, depth, and total count of items in a Count-Min Sketch
     * @param key - The name of the sketch to get information about
     */
    INFO: INFO_1.default,
    /**
     * Returns width, depth, and total count of items in a Count-Min Sketch
     * @param key - The name of the sketch to get information about
     */
    info: INFO_1.default,
    /**
     * Initialize a Count-Min Sketch using width and depth parameters
     * @param key - The name of the sketch
     * @param width - Number of counters in each array (must be a multiple of 2)
     * @param depth - Number of counter arrays (determines accuracy of estimates)
     */
    INITBYDIM: INITBYDIM_1.default,
    /**
     * Initialize a Count-Min Sketch using width and depth parameters
     * @param key - The name of the sketch
     * @param width - Number of counters in each array (must be a multiple of 2)
     * @param depth - Number of counter arrays (determines accuracy of estimates)
     */
    initByDim: INITBYDIM_1.default,
    /**
     * Initialize a Count-Min Sketch using error rate and probability parameters
     * @param key - The name of the sketch
     * @param error - Estimate error, as a decimal between 0 and 1
     * @param probability - The desired probability for inflated count, as a decimal between 0 and 1
     */
    INITBYPROB: INITBYPROB_1.default,
    /**
     * Initialize a Count-Min Sketch using error rate and probability parameters
     * @param key - The name of the sketch
     * @param error - Estimate error, as a decimal between 0 and 1
     * @param probability - The desired probability for inflated count, as a decimal between 0 and 1
     */
    initByProb: INITBYPROB_1.default,
    /**
     * Merges multiple Count-Min Sketches into a single sketch, with optional weights
     * @param destination - The name of the destination sketch
     * @param source - Array of sketch names or array of sketches with weights
     */
    MERGE: MERGE_1.default,
    /**
     * Merges multiple Count-Min Sketches into a single sketch, with optional weights
     * @param destination - The name of the destination sketch
     * @param source - Array of sketch names or array of sketches with weights
     */
    merge: MERGE_1.default,
    /**
     * Returns the count for one or more items in a Count-Min Sketch
     * @param key - The name of the sketch
     * @param items - One or more items to get counts for
     */
    QUERY: QUERY_1.default,
    /**
     * Returns the count for one or more items in a Count-Min Sketch
     * @param key - The name of the sketch
     * @param items - One or more items to get counts for
     */
    query: QUERY_1.default
};
//# sourceMappingURL=index.js.map