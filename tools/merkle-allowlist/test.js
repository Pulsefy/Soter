const assert = require('assert');
const {
  buildMerkleTree,
  proofForAddress,
  verifyProof,
  bytesToHex,
} = require('./merkle');

const addresses = [
  'GA5TBSBGERHVMEFBJGEM3KYMRLWO73Y2QRAV6P66GPEBOJ5ZMJUT7LLY',
  'GBBO4ZDDZTSM2IUKQYBAST3CFHNPFXECGEFTGWTA2WELRBDUX6253M7M',
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
];

const tree = buildMerkleTree(addresses);
const rootHex = bytesToHex(tree.root);

const proof = proofForAddress(tree, addresses[1]);
assert(verifyProof(addresses[1], proof, rootHex), 'valid proof should verify');

const badProof = proof.slice();
badProof[0] = badProof[0].slice(0, -1) + (badProof[0].slice(-1) === '0' ? '1' : '0');
assert(!verifyProof(addresses[1], badProof, rootHex), 'tampered proof should fail');

assert(!verifyProof(addresses[2], proof, rootHex), 'proof for wrong recipient should fail');

console.log('merkle-allowlist tool tests passed');
