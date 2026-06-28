const crypto = require('crypto');

/** sha256(stellar address string) — matches aid_escrow::hash_address */
function hashAddress(address) {
  return crypto.createHash('sha256').update(String(address), 'utf8').digest();
}

/** sha256(left || right) with canonical sorted ordering — matches aid_escrow::hash_pair */
function hashPair(left, right) {
  const [a, b] = Buffer.compare(left, right) <= 0 ? [left, right] : [right, left];
  return crypto.createHash('sha256').update(Buffer.concat([a, b])).digest();
}

function bytesToHex(buf) {
  return Buffer.from(buf).toString('hex');
}

function buildMerkleTree(addresses) {
  if (!addresses.length) {
    throw new Error('allowlist must contain at least one address');
  }

  let leaves = addresses.map((address) => hashAddress(address));
  leaves.sort(Buffer.compare);

  const layers = [leaves.map((leaf) => Buffer.from(leaf))];

  let current = layers[0];
  while (current.length > 1) {
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      if (i + 1 < current.length) {
        next.push(hashPair(current[i], current[i + 1]));
      } else {
        next.push(hashPair(current[i], current[i]));
      }
    }
    layers.push(next);
    current = next;
  }

  const leafIndex = new Map();
  layers[0].forEach((leaf, idx) => {
    leafIndex.set(bytesToHex(leaf), idx);
  });

  return { layers, leafIndex, root: current[0] };
}

function proofForAddress(tree, address) {
  const leaf = hashAddress(address);
  const leafHex = bytesToHex(leaf);
  let index = tree.leafIndex.get(leafHex);
  if (index === undefined) {
    throw new Error(`address not in allowlist: ${address}`);
  }

  const proof = [];
  for (let layerIdx = 0; layerIdx < tree.layers.length - 1; layerIdx += 1) {
    const layer = tree.layers[layerIdx];
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
    const sibling = siblingIndex < layer.length ? layer[siblingIndex] : layer[index];
    proof.push(bytesToHex(sibling));
    index = Math.floor(index / 2);
  }

  return proof;
}

function verifyProof(address, proofHex, rootHex) {
  let current = hashAddress(address);
  const expectedRoot = Buffer.from(rootHex, 'hex');

  for (const siblingHex of proofHex) {
    const sibling = Buffer.from(siblingHex, 'hex');
    if (sibling.length !== 32) {
      return false;
    }
    current = hashPair(current, sibling);
  }

  return Buffer.compare(current, expectedRoot) === 0;
}

module.exports = {
  hashAddress,
  hashPair,
  bytesToHex,
  buildMerkleTree,
  proofForAddress,
  verifyProof,
};
