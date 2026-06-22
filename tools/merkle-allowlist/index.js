const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { MerkleTree } = require('merkletreejs');
const keccak256 = require('keccak256');

const RPC_URL = process.env.TESTNET_RPC_URL;
const CONTRACT_ADDRESS = process.env.MERKLE_CONTRACT_ADDRESS;
const CONTRACT_ABI_PATH = process.env.MERKLE_CONTRACT_ABI_PATH; // optional
const VERIFY_METHOD = process.env.MERKLE_VERIFY_METHOD || 'verify';
const RETRIES = parseInt(process.env.MERKLE_RETRIES || '3', 10);
const RETRY_DELAY_MS = parseInt(process.env.MERKLE_RETRY_DELAY_MS || '2000', 10);
const OP_TIMEOUT_MS = parseInt(process.env.MERKLE_OP_TIMEOUT_MS || '60000', 10);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function withRetry(fn, desc) {
  let lastErr;
  for (let i = 0; i < RETRIES; i++) {
    try {
      const res = await Promise.race([
        fn(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), OP_TIMEOUT_MS)),
      ]);
      return res;
    } catch (err) {
      lastErr = err;
      console.error(`Attempt ${i + 1}/${RETRIES} failed for ${desc}: ${err.message}`);
      if (i < RETRIES - 1) await sleep(RETRY_DELAY_MS);
    }
  }
  throw lastErr;
}

function makeLeaf(entry) {
  // Standard leaf encoding: keccak256(abi.encodePacked(address, amount))
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(['address', 'uint256'], [entry.address.toLowerCase(), ethers.BigNumber.from(entry.amount).toString()])
  );
}

function formatResult({ success, code, message, details }) {
  const out = { success: !!success };
  if (success) out.code = 'OK';
  else out.error = { code: code || 'UNKNOWN', message: message || '', details: details || null };
  return out;
}

async function maybeCallOnchain(proof, leaf, root) {
  if (!RPC_URL || !CONTRACT_ADDRESS || !CONTRACT_ABI_PATH) return { skipped: true };
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const abiRaw = fs.readFileSync(path.resolve(CONTRACT_ABI_PATH), 'utf8');
  let abi;
  try { abi = JSON.parse(abiRaw); } catch (e) { throw new Error('Invalid ABI JSON'); }
  const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);
  if (typeof contract[VERIFY_METHOD] !== 'function') throw new Error('Verify method not found on contract ABI');
  try {
    const res = await withRetry(() => contract[VERIFY_METHOD](proof, leaf, root), 'contract.verify');
    return { skipped: false, onchainResult: res };
  } catch (err) {
    return { skipped: false, onchainError: err.message };
  }
}

async function run() {
  const sample = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'sample_allowlist.json')));
  const leaves = sample.map((e) => Buffer.from(ethers.utils.arrayify(makeLeaf(e))));
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  const root = tree.getHexRoot();
  console.log('ROOT:', root);

  // Pick a valid entry
  const entry = sample[0];
  const leafHex = makeLeaf(entry);
  const leafBuf = Buffer.from(ethers.utils.arrayify(leafHex));
  const proof = tree.getHexProof(leafBuf);

  // 1) Valid proof
  const valid = tree.verify(proof, leafBuf, root);
  console.log(JSON.stringify({ scenario: 'valid', result: formatResult({ success: valid, message: valid ? 'Proof valid' : 'Proof invalid' }), proof, leaf: leafHex, root }));

  // Optionally call on-chain verify
  if (CONTRACT_ADDRESS && CONTRACT_ABI_PATH) {
    const onchain = await maybeCallOnchain(proof, leafHex, root);
    console.log(JSON.stringify({ scenario: 'valid_onchain', onchain }));
  }

  // 2) Invalid proof path (tamper one proof element)
  const badProofPath = proof.slice();
  if (badProofPath.length > 0) {
    const first = badProofPath[0];
    // flip last hex nibble deterministically
    const tampered = first.slice(0, -1) + (first.slice(-1) === '0' ? '1' : '0');
    badProofPath[0] = tampered;
  }
  const invalidPathValid = tree.verify(badProofPath, leafBuf, root);
  console.log(JSON.stringify({ scenario: 'invalid_proof_path', result: formatResult({ success: invalidPathValid, code: invalidPathValid ? 'OK' : 'INVALID_PROOF', message: invalidPathValid ? 'Unexpectedly valid' : 'Proof path invalid' }), proof: badProofPath, leaf: leafHex, root }));

  // 3) Wrong recipient (use a different address in leaf)
  const wrongRecipient = { address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', amount: entry.amount };
  const wrongLeaf = makeLeaf(wrongRecipient);
  const wrongLeafBuf = Buffer.from(ethers.utils.arrayify(wrongLeaf));
  const wrongRecipientValid = tree.verify(proof, wrongLeafBuf, root);
  console.log(JSON.stringify({ scenario: 'wrong_recipient', result: formatResult({ success: wrongRecipientValid, code: wrongRecipientValid ? 'OK' : 'WRONG_RECIPIENT', message: wrongRecipientValid ? 'Unexpectedly valid' : 'Proof does not match recipient' }), proof, leaf: wrongLeaf, root }));

  // 4) Wrong leaf (modify amount)
  const wrongAmount = { address: entry.address, amount: (Number(entry.amount) + 99).toString() };
  const wrongLeaf2 = makeLeaf(wrongAmount);
  const wrongLeaf2Buf = Buffer.from(ethers.utils.arrayify(wrongLeaf2));
  const wrongLeafValid = tree.verify(proof, wrongLeaf2Buf, root);
  console.log(JSON.stringify({ scenario: 'wrong_leaf', result: formatResult({ success: wrongLeafValid, code: wrongLeafValid ? 'OK' : 'WRONG_LEAF', message: wrongLeafValid ? 'Unexpectedly valid' : 'Leaf data mismatch' }), proof, leaf: wrongLeaf2, root }));

  // 5) Mismatched root (use a root from a different tree)
  const altSample = sample.slice().reverse();
  const altLeaves = altSample.map((e) => Buffer.from(ethers.utils.arrayify(makeLeaf(e))));
  const altTree = new MerkleTree(altLeaves, keccak256, { sortPairs: true });
  const altRoot = altTree.getHexRoot();
  const mismatchedValid = tree.verify(proof, leafBuf, altRoot);
  console.log(JSON.stringify({ scenario: 'mismatched_root', result: formatResult({ success: mismatchedValid, code: mismatchedValid ? 'OK' : 'MISMATCHED_ROOT', message: mismatchedValid ? 'Unexpectedly valid' : 'Root mismatch' }), proof, leaf: leafHex, altRoot }));

  console.log('Merkle allowlist checks complete');
}

run().catch((err) => {
  console.error('Unhandled error:', err.message);
  process.exitCode = 1;
});
