/**
 * typeRoots entry so ts-node loads Express.Request.user.
 * Unimported .d.ts files under `include` are skipped by ts-node (files: false).
 */
/// <reference path="../../src/types/express.d.ts" />
