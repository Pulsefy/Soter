"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ADD_1 = __importDefault(require("./ADD"));
const ADDNX_1 = __importDefault(require("./ADDNX"));
const COUNT_1 = __importDefault(require("./COUNT"));
const DEL_1 = __importDefault(require("./DEL"));
const EXISTS_1 = __importDefault(require("./EXISTS"));
const INFO_1 = __importDefault(require("./INFO"));
const INSERT_1 = __importDefault(require("./INSERT"));
const INSERTNX_1 = __importDefault(require("./INSERTNX"));
const LOADCHUNK_1 = __importDefault(require("./LOADCHUNK"));
const RESERVE_1 = __importDefault(require("./RESERVE"));
const SCANDUMP_1 = __importDefault(require("./SCANDUMP"));
exports.default = {
    /**
     * Adds an item to a Cuckoo Filter, creating the filter if it does not exist
     * @param key - The name of the Cuckoo filter
     * @param item - The item to add to the filter
     */
    ADD: ADD_1.default,
    /**
     * Adds an item to a Cuckoo Filter, creating the filter if it does not exist
     * @param key - The name of the Cuckoo filter
     * @param item - The item to add to the filter
     */
    add: ADD_1.default,
    /**
     * Adds an item to a Cuckoo Filter only if it does not exist
     * @param key - The name of the Cuckoo filter
     * @param item - The item to add to the filter if it doesn't exist
     */
    ADDNX: ADDNX_1.default,
    /**
     * Adds an item to a Cuckoo Filter only if it does not exist
     * @param key - The name of the Cuckoo filter
     * @param item - The item to add to the filter if it doesn't exist
     */
    addNX: ADDNX_1.default,
    /**
     * Returns the number of times an item appears in a Cuckoo Filter
     * @param key - The name of the Cuckoo filter
     * @param item - The item to count occurrences of
     */
    COUNT: COUNT_1.default,
    /**
     * Returns the number of times an item appears in a Cuckoo Filter
     * @param key - The name of the Cuckoo filter
     * @param item - The item to count occurrences of
     */
    count: COUNT_1.default,
    /**
     * Removes an item from a Cuckoo Filter if it exists
     * @param key - The name of the Cuckoo filter
     * @param item - The item to remove from the filter
     */
    DEL: DEL_1.default,
    /**
     * Removes an item from a Cuckoo Filter if it exists
     * @param key - The name of the Cuckoo filter
     * @param item - The item to remove from the filter
     */
    del: DEL_1.default,
    /**
     * Checks if an item exists in a Cuckoo Filter
     * @param key - The name of the Cuckoo filter
     * @param item - The item to check for existence
     */
    EXISTS: EXISTS_1.default,
    /**
     * Checks if an item exists in a Cuckoo Filter
     * @param key - The name of the Cuckoo filter
     * @param item - The item to check for existence
     */
    exists: EXISTS_1.default,
    /**
     * Returns detailed information about a Cuckoo Filter including size, buckets, filters count, items statistics and configuration
     * @param key - The name of the Cuckoo filter to get information about
     */
    INFO: INFO_1.default,
    /**
     * Returns detailed information about a Cuckoo Filter including size, buckets, filters count, items statistics and configuration
     * @param key - The name of the Cuckoo filter to get information about
     */
    info: INFO_1.default,
    /**
     * Adds one or more items to a Cuckoo Filter, creating it if it does not exist
     * @param key - The name of the Cuckoo filter
     * @param items - One or more items to add to the filter
     * @param options - Optional parameters for filter creation
     * @param options.CAPACITY - The number of entries intended to be added to the filter
     * @param options.NOCREATE - If true, prevents automatic filter creation
     */
    INSERT: INSERT_1.default,
    /**
     * Adds one or more items to a Cuckoo Filter, creating it if it does not exist
     * @param key - The name of the Cuckoo filter
     * @param items - One or more items to add to the filter
     * @param options - Optional parameters for filter creation
     * @param options.CAPACITY - The number of entries intended to be added to the filter
     * @param options.NOCREATE - If true, prevents automatic filter creation
     */
    insert: INSERT_1.default,
    /**
     * Adds one or more items to a Cuckoo Filter only if they do not exist yet, creating the filter if needed
     * @param key - The name of the Cuckoo filter
     * @param items - One or more items to add to the filter
     * @param options - Optional parameters for filter creation
     * @param options.CAPACITY - The number of entries intended to be added to the filter
     * @param options.NOCREATE - If true, prevents automatic filter creation
     */
    INSERTNX: INSERTNX_1.default,
    /**
     * Adds one or more items to a Cuckoo Filter only if they do not exist yet, creating the filter if needed
     * @param key - The name of the Cuckoo filter
     * @param items - One or more items to add to the filter
     * @param options - Optional parameters for filter creation
     * @param options.CAPACITY - The number of entries intended to be added to the filter
     * @param options.NOCREATE - If true, prevents automatic filter creation
     */
    insertNX: INSERTNX_1.default,
    /**
     * Restores a Cuckoo Filter chunk previously saved using SCANDUMP
     * @param key - The name of the Cuckoo filter to restore
     * @param iterator - Iterator value from the SCANDUMP command
     * @param chunk - Data chunk from the SCANDUMP command
     */
    LOADCHUNK: LOADCHUNK_1.default,
    /**
     * Restores a Cuckoo Filter chunk previously saved using SCANDUMP
     * @param key - The name of the Cuckoo filter to restore
     * @param iterator - Iterator value from the SCANDUMP command
     * @param chunk - Data chunk from the SCANDUMP command
     */
    loadChunk: LOADCHUNK_1.default,
    /**
     * Creates an empty Cuckoo Filter with specified capacity and parameters
     * @param key - The name of the Cuckoo filter to create
     * @param capacity - The number of entries intended to be added to the filter
     * @param options - Optional parameters to tune the filter
     * @param options.BUCKETSIZE - Number of items in each bucket
     * @param options.MAXITERATIONS - Maximum number of iterations before declaring filter full
     * @param options.EXPANSION - Number of additional buckets per expansion
     */
    RESERVE: RESERVE_1.default,
    /**
     * Creates an empty Cuckoo Filter with specified capacity and parameters
     * @param key - The name of the Cuckoo filter to create
     * @param capacity - The number of entries intended to be added to the filter
     * @param options - Optional parameters to tune the filter
     * @param options.BUCKETSIZE - Number of items in each bucket
     * @param options.MAXITERATIONS - Maximum number of iterations before declaring filter full
     * @param options.EXPANSION - Number of additional buckets per expansion
     */
    reserve: RESERVE_1.default,
    /**
     * Begins an incremental save of a Cuckoo Filter. This is useful for large filters that can't be saved at once
     * @param key - The name of the Cuckoo filter to save
     * @param iterator - Iterator value; Start at 0, and use the iterator from the response for the next chunk
     */
    SCANDUMP: SCANDUMP_1.default,
    /**
     * Begins an incremental save of a Cuckoo Filter. This is useful for large filters that can't be saved at once
     * @param key - The name of the Cuckoo filter to save
     * @param iterator - Iterator value; Start at 0, and use the iterator from the response for the next chunk
     */
    scanDump: SCANDUMP_1.default
};
//# sourceMappingURL=index.js.map