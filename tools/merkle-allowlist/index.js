const fs = require('fs');
const path = require('path');
const {
  buildMerkleTree,
  proofForAddress,
  verifyProof,
  bytesToHex,
} = require('./merkle');

function formatResult({ success, code, message, details }) {
  const out = { success: !!success };
  if (success) out.code = 'OK';
  else out.error = { code: code || 'UNKNOWN', message: message || '', details: details || null };
  return out;
}

function tamperHex(hex) {
  const last = hex.slice(-1);
  const flip = last === '0' ? '1' : '0';
  return hex.slice(0, -1) + flip;
}

function run() {
  const samplePath = path.resolve(__dirname, 'sample_allowlist.json');
  const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  const addresses = sample.map((entry) => entry.address);

  const tree = buildMerkleTree(addresses);
  const rootHex = bytesToHex(tree.root);
  console.log('ROOT:', rootHex);

  const entry = sample[0];
  const proof = proofForAddress(tree, entry.address);

  const valid = verifyProof(entry.address, proof, rootHex);
  console.log(
    JSON.stringify({
      scenario: 'valid',
      result: formatResult({
        success: valid,
        message: valid ? 'Proof valid' : 'Proof invalid',
      }),
      proof,
      root: rootHex,
    }),
  );

  const badProof = proof.slice();
  if (badProof.length > 0) {
    badProof[0] = tamperHex(badProof[0]);
  }
  const invalidPathValid = verifyProof(entry.address, badProof, rootHex);
  console.log(
    JSON.stringify({
      scenario: 'invalid_proof_path',
      result: formatResult({
        success: invalidPathValid,
        code: invalidPathValid ? 'OK' : 'INVALID_PROOF',
        message: invalidPathValid ? 'Unexpectedly valid' : 'Proof path invalid',
      }),
      proof: badProof,
      root: rootHex,
    }),
  );

  const wrongRecipient = sample[1].address;
  const wrongRecipientValid = verifyProof(wrongRecipient, proof, rootHex);
  console.log(
    JSON.stringify({
      scenario: 'wrong_recipient',
      result: formatResult({
        success: wrongRecipientValid,
        code: wrongRecipientValid ? 'OK' : 'WRONG_RECIPIENT',
        message: wrongRecipientValid ? 'Unexpectedly valid' : 'Proof does not match recipient',
      }),
      proof,
      root: rootHex,
    }),
  );

  const altTree = buildMerkleTree(addresses.slice().reverse());
  const altRootHex = bytesToHex(altTree.root);
  const mismatchedValid = verifyProof(entry.address, proof, altRootHex);
  console.log(
    JSON.stringify({
      scenario: 'mismatched_root',
      result: formatResult({
        success: mismatchedValid,
        code: mismatchedValid ? 'OK' : 'MISMATCHED_ROOT',
        message: mismatchedValid ? 'Unexpectedly valid' : 'Root mismatch',
      }),
      proof,
      root: rootHex,
      altRoot: altRootHex,
    }),
  );

  console.log('Merkle allowlist checks complete');
}

run();
