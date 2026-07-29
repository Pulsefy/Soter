"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ADD_1 = __importDefault(require("./ADD"));
const BYRANK_1 = __importDefault(require("./BYRANK"));
const BYREVRANK_1 = __importDefault(require("./BYREVRANK"));
const CDF_1 = __importDefault(require("./CDF"));
const CREATE_1 = __importDefault(require("./CREATE"));
const INFO_1 = __importDefault(require("./INFO"));
const MAX_1 = __importDefault(require("./MAX"));
const MERGE_1 = __importDefault(require("./MERGE"));
const MIN_1 = __importDefault(require("./MIN"));
const QUANTILE_1 = __importDefault(require("./QUANTILE"));
const RANK_1 = __importDefault(require("./RANK"));
const RESET_1 = __importDefault(require("./RESET"));
const REVRANK_1 = __importDefault(require("./REVRANK"));
const TRIMMED_MEAN_1 = __importDefault(require("./TRIMMED_MEAN"));
exports.default = {
    /**
     * Adds one or more observations to a t-digest sketch
     * @param key - The name of the t-digest sketch
     * @param values - Array of numeric values to add to the sketch
     */
    ADD: ADD_1.default,
    /**
     * Adds one or more observations to a t-digest sketch
     * @param key - The name of the t-digest sketch
     * @param values - Array of numeric values to add to the sketch
     */
    add: ADD_1.default,
    /**
     * Returns value estimates for one or more ranks in a t-digest sketch
     * @param key - The name of the t-digest sketch
     * @param ranks - Array of ranks to get value estimates for (ascending order)
     */
    BYRANK: BYRANK_1.default,
    /**
     * Returns value estimates for one or more ranks in a t-digest sketch
     * @param key - The name of the t-digest sketch
     * @param ranks - Array of ranks to get value estimates for (ascending order)
     */
    byRank: BYRANK_1.default,
    /**
     * Returns value estimates for one or more ranks in a t-digest sketch, starting from highest rank
     * @param key - The name of the t-digest sketch
     * @param ranks - Array of ranks to get value estimates for (descending order)
     */
    BYREVRANK: BYREVRANK_1.default,
    /**
     * Returns value estimates for one or more ranks in a t-digest sketch, starting from highest rank
     * @param key - The name of the t-digest sketch
     * @param ranks - Array of ranks to get value estimates for (descending order)
     */
    byRevRank: BYREVRANK_1.default,
    /**
     * Estimates the cumulative distribution function for values in a t-digest sketch
     * @param key - The name of the t-digest sketch
     * @param values - Array of values to get CDF estimates for
     */
    CDF: CDF_1.default,
    /**
     * Estimates the cumulative distribution function for values in a t-digest sketch
     * @param key - The name of the t-digest sketch
     * @param values - Array of values to get CDF estimates for
     */
    cdf: CDF_1.default,
    /**
     * Creates a new t-digest sketch for storing distributions
     * @param key - The name of the t-digest sketch
     * @param options - Optional parameters for sketch creation
     * @param options.COMPRESSION - Compression parameter that affects performance and accuracy
     */
    CREATE: CREATE_1.default,
    /**
     * Creates a new t-digest sketch for storing distributions
     * @param key - The name of the t-digest sketch
     * @param options - Optional parameters for sketch creation
     * @param options.COMPRESSION - Compression parameter that affects performance and accuracy
     */
    create: CREATE_1.default,
    /**
     * Returns information about a t-digest sketch including compression, capacity, nodes, weights, observations and memory usage
     * @param key - The name of the t-digest sketch to get information about
     */
    INFO: INFO_1.default,
    /**
     * Returns information about a t-digest sketch including compression, capacity, nodes, weights, observations and memory usage
     * @param key - The name of the t-digest sketch to get information about
     */
    info: INFO_1.default,
    /**
     * Returns the maximum value from a t-digest sketch
     * @param key - The name of the t-digest sketch
     */
    MAX: MAX_1.default,
    /**
     * Returns the maximum value from a t-digest sketch
     * @param key - The name of the t-digest sketch
     */
    max: MAX_1.default,
    /**
     * Merges multiple t-digest sketches into one, with optional compression and override settings
     * @param destination - The name of the destination t-digest sketch
     * @param source - One or more source sketch names to merge from
     * @param options - Optional parameters for merge operation
     * @param options.COMPRESSION - New compression value for merged sketch
     * @param options.OVERRIDE - If true, override destination sketch if it exists
     */
    MERGE: MERGE_1.default,
    /**
     * Merges multiple t-digest sketches into one, with optional compression and override settings
     * @param destination - The name of the destination t-digest sketch
     * @param source - One or more source sketch names to merge from
     * @param options - Optional parameters for merge operation
     * @param options.COMPRESSION - New compression value for merged sketch
     * @param options.OVERRIDE - If true, override destination sketch if it exists
     */
    merge: MERGE_1.default,
    /**
     * Returns the minimum value from a t-digest sketch
     * @param key - The name of the t-digest sketch
     */
    MIN: MIN_1.default,
    /**
     * Returns the minimum value from a t-digest sketch
     * @param key - The name of the t-digest sketch
     */
    min: MIN_1.default,
    /**
     * Returns value estimates at requested quantiles from a t-digest sketch
     * @param key - The name of the t-digest sketch
     * @param quantiles - Array of quantiles (between 0 and 1) to get value estimates for
     */
    QUANTILE: QUANTILE_1.default,
    /**
     * Returns value estimates at requested quantiles from a t-digest sketch
     * @param key - The name of the t-digest sketch
     * @param quantiles - Array of quantiles (between 0 and 1) to get value estimates for
     */
    quantile: QUANTILE_1.default,
    /**
     * Returns the rank of one or more values in a t-digest sketch (number of values that are lower than each value)
     * @param key - The name of the t-digest sketch
     * @param values - Array of values to get ranks for
     */
    RANK: RANK_1.default,
    /**
     * Returns the rank of one or more values in a t-digest sketch (number of values that are lower than each value)
     * @param key - The name of the t-digest sketch
     * @param values - Array of values to get ranks for
     */
    rank: RANK_1.default,
    /**
     * Resets a t-digest sketch, clearing all previously added observations
     * @param key - The name of the t-digest sketch to reset
     */
    RESET: RESET_1.default,
    /**
     * Resets a t-digest sketch, clearing all previously added observations
     * @param key - The name of the t-digest sketch to reset
     */
    reset: RESET_1.default,
    /**
     * Returns the reverse rank of one or more values in a t-digest sketch (number of values that are higher than each value)
     * @param key - The name of the t-digest sketch
     * @param values - Array of values to get reverse ranks for
     */
    REVRANK: REVRANK_1.default,
    /**
     * Returns the reverse rank of one or more values in a t-digest sketch (number of values that are higher than each value)
     * @param key - The name of the t-digest sketch
     * @param values - Array of values to get reverse ranks for
     */
    revRank: REVRANK_1.default,
    /**
     * Returns the mean value from a t-digest sketch after trimming values at specified percentiles
     * @param key - The name of the t-digest sketch
     * @param lowCutPercentile - Lower percentile cutoff (between 0 and 100)
     * @param highCutPercentile - Higher percentile cutoff (between 0 and 100)
     */
    TRIMMED_MEAN: TRIMMED_MEAN_1.default,
    /**
     * Returns the mean value from a t-digest sketch after trimming values at specified percentiles
     * @param key - The name of the t-digest sketch
     * @param lowCutPercentile - Lower percentile cutoff (between 0 and 100)
     * @param highCutPercentile - Higher percentile cutoff (between 0 and 100)
     */
    trimmedMean: TRIMMED_MEAN_1.default
};
//# sourceMappingURL=index.js.map