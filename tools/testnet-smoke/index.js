/**
 * Testnet Integration Harness
 *
 * Validates the backend's Soroban integration against the real Stellar Testnet.
 * Runs a minimal read flow (get_admin, get_version, get_config) and optionally
 * a write flow (fund → create_package → claim → verify) when SOROBAN_ADMIN_SECRET_KEY
 * and SOROBAN_TOKEN_ADDRESS are provided.
 *
 * ── Usage ──
 *
 *   # Read-only (just queries):
 *   SOROBAN_CONTRACT_ID=CC... node index.js
 *
 *   # Full read + write flow:
 *   SOROBAN_RPC_URL=https://soroban-testnet.stellar.org \
 *   SOROBAN_CONTRACT_ID=CC... \
 *   SOROBAN_ADMIN_SECRET_KEY=SC... \
 *   SOROBAN_TOKEN_ADDRESS=CD... \
 *   node index.js
 *
 * ── How to get a test token address ──
 *
 *   Option 1 — Deploy the native XLM SAC (Stellar Asset Contract):
 *     soroban contract asset deploy --asset native \
 *       --source <secret-key> --network testnet
 *     # Returns a C-prefixed contract ID — use that as SOROBAN_TOKEN_ADDRESS
 *
 *   Option 2 — Deploy a custom test token:
 *     # First create a Stellar asset, then deploy its SAC:
 *     soroban contract asset deploy --asset TEST:GB... \
 *       --source <secret-key> --network testnet
 *
 *   Option 3 — Use an existing deployed test token on testnet.
 *     Known test token: the native XLM SAC on testnet has a
 *     deterministic contract ID (ask the team or compute via
 *     stellar-sdk's nativeToScVal + hash).
 *
 * ── Env Vars ──
 *
 *   SOROBAN_RPC_URL              - Soroban RPC endpoint (default: https://soroban-testnet.stellar.org)
 *   SOROBAN_CONTRACT_ID          - Deployed AidEscrow contract ID (C-prefixed, 56 chars)
 *   SOROBAN_ADMIN_SECRET_KEY     - Stellar secret key with admin/distributor privileges
 *   SOROBAN_TOKEN_ADDRESS        - Token contract address to use for fund/create/claim flow
 *   SOROBAN_NETWORK_PASSPHRASE   - Network passphrase (default: testnet)
 *   SMOKE_RETRIES                - Max retries per op (default: 3)
 *   SMOKE_RETRY_DELAY_MS         - Base backoff delay (default: 2000)
 *   SMOKE_OP_TIMEOUT_MS          - Per-op timeout (default: 120000)
 */
const { rpc: SorobanRpc, Contract, nativeToScVal, scValToNative, TransactionBuilder, Keypair, BASE_FEE } = require('@stellar/stellar-sdk');

// ── Configuration ──────────────────────────────────────────────────────────
const RPC_URL = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const CONTRACT_ID = process.env.SOROBAN_CONTRACT_ID || '';
const ADMIN_SECRET = process.env.SOROBAN_ADMIN_SECRET_KEY || '';
const TOKEN_ADDRESS = process.env.SOROBAN_TOKEN_ADDRESS || '';
const NETWORK_PASSPHRASE = process.env.SOROBAN_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';
const RETRIES = parseInt(process.env.SMOKE_RETRIES || '3', 10);
const RETRY_DELAY_MS = parseInt(process.env.SMOKE_RETRY_DELAY_MS || '2000', 10);
const OP_TIMEOUT_MS = parseInt(process.env.SMOKE_OP_TIMEOUT_MS || '120000', 10);

const FUND_AMOUNT = '10000000000'; // 1000 * 10^7 (7-decimal token)
const PACKAGE_AMOUNT = '1000000000'; // 100 * 10^7
const RECIPIENT_SECRET = process.env.SOROBAN_RECIPIENT_SECRET_KEY || '';
const PACKAGE_EXPIRY_SEC = 3600; // 1 hour

let exitCode = 0;
const server = new SorobanRpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith('http://') });

// ── Helpers ────────────────────────────────────────────────────────────────

function correlationId() {
  return `harn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry(fn, desc, cid) {
  let lastErr;
  for (let i = 0; i <= RETRIES; i++) {
    try {
      const res = await Promise.race([
        fn(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Timed out after ${OP_TIMEOUT_MS}ms`)), OP_TIMEOUT_MS)
        ),
      ]);
      return res;
    } catch (err) {
      lastErr = err;
      console.error(`  [${cid}] ${desc} attempt ${i + 1}/${RETRIES + 1} failed: ${err.message}`);
      if (i < RETRIES) {
        const delay = Math.min(RETRY_DELAY_MS * Math.pow(2, i) + Math.random() * 1000, 30000);
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}

function scvAddress(addr) {
  return nativeToScVal(addr, { type: 'address' });
}

function scvU64(val) {
  return nativeToScVal(Number(val), { type: 'u64' });
}

function scvI128(val) {
  return nativeToScVal(String(val), { type: 'i128' });
}

function scvSymbol(val) {
  return nativeToScVal(val, { type: 'symbol' });
}

function scvString(val) {
  return nativeToScVal(val, { type: 'string' });
}

function scvMap(entries) {
  return nativeToScVal(entries);
}

function printBanner(label) {
  console.log(`\n━━━ ${label} ━━━`);
}

function getKeypairFromSecret(secret) {
  try {
    return Keypair.fromSecret(secret);
  } catch {
    return null;
  }
}

// ── Soroban Interaction ────────────────────────────────────────────────────

async function simulateReadOnly(method, args, cid, keypair) {
  const pubKey = keypair.publicKey();
  const contract = new Contract(CONTRACT_ID);

  return withRetry(async () => {
    const account = await server.getAccount(pubKey);
    const operation = contract.call(method, ...args);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(operation)
      .setTimeout(300)
      .build();

    const simulation = await server.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationError(simulation)) {
      throw new Error(`Simulation error: ${simulation.error}`);
    }
    if (SorobanRpc.Api.isSimulationSuccess(simulation) && simulation.result?.retval) {
      return scValToNative(simulation.result.retval);
    }
    return null;
  }, `${method}()`, cid);
}

async function submitContractOp(method, args, cid, keypair) {
  const pubKey = keypair.publicKey();
  const contract = new Contract(CONTRACT_ID);

  return withRetry(async () => {
    const account = await server.getAccount(pubKey);
    const operation = contract.call(method, ...args);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(operation)
      .setTimeout(300)
      .build();

    const simulation = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simulation)) {
      throw new Error(`Simulation error: ${simulation.error}`);
    }

    const preparedTx = SorobanRpc.assembleTransaction(tx, simulation).build();
    preparedTx.sign(keypair);

    const sendResult = await server.sendTransaction(preparedTx);
    if (sendResult.status !== 'PENDING' && sendResult.status !== 'DUPLICATE') {
      throw new Error(`Send failed: ${sendResult.status}`);
    }

    const txHash = sendResult.hash;
    console.log(`    tx: ${txHash}`);

    for (let poll = 0; poll < 20; poll++) {
      const getResult = await server.getTransaction(txHash);
      if (getResult.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
        const retval = getResult.returnValue ? scValToNative(getResult.returnValue) : null;
        return { hash: txHash, result: retval };
      }
      if (getResult.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
        const errMsg = getResult.resultXdr
          ? `tx failed: ${getResult.resultXdr.result().switch().name}`
          : 'Transaction FAILED';
        throw new Error(errMsg);
      }
      await sleep(2000);
    }
    throw new Error(`Transaction ${txHash} not confirmed after polling`);
  }, `${method}(submit)`, cid);
}

// ── Read-Only Flow ─────────────────────────────────────────────────────────

async function runReadOnlyTests(cid, kp) {
  printBanner('Read-Only Contract Queries');

  console.log('  Checking RPC health...');
  const health = await withRetry(() => server.getHealth(), 'getHealth', cid);
  console.log(`  RPC: ${JSON.stringify(health)}`);

  console.log('  get_version()...');
  const version = await simulateReadOnly('get_version', [], cid, kp);
  console.log(`  version: ${version}`);

  console.log('  get_admin()...');
  const admin = await simulateReadOnly('get_admin', [], cid, kp);
  console.log(`  admin: ${admin}`);

  console.log('  get_config()...');
  const config = await simulateReadOnly('get_config', [], cid, kp);
  if (config) {
    console.log(`  min_amount: ${config.min_amount}`);
    console.log(`  max_expires_in: ${config.max_expires_in}`);
    console.log(`  allowed_tokens: ${JSON.stringify(config.allowed_tokens)}`);
  }

  console.log('  is_paused()...');
  const paused = await simulateReadOnly('is_paused', [], cid, kp);
  console.log(`  paused: ${paused}`);

  console.log('  get_total_locked()...');
  const locked = await simulateReadOnly('get_total_locked', [scvAddress(TOKEN_ADDRESS)], cid, kp);
  console.log(`  locked for token: ${locked}`);

  return { admin };
}

// ── Write Flow ─────────────────────────────────────────────────────────────

async function runWriteFlow(cid, adminKp) {
  printBanner('Write Flow: fund → create_package → claim → verify');

  const adminPub = adminKp.publicKey();

  // If recipient secret is provided, create a separate recipient keypair
  let recipientKp = adminKp;
  let recipientPub = adminPub;
  if (RECIPIENT_SECRET) {
    const rkp = getKeypairFromSecret(RECIPIENT_SECRET);
    if (rkp) {
      recipientKp = rkp;
      recipientPub = rkp.publicKey();
      console.log(`  Recipient: ${recipientPub}`);
    }
  }

  // ── Step 1: Fund the contract pool ──
  // fund(token, from, amount) — transfers tokens from admin to contract
  console.log('\n  1/4  fund() — depositing tokens into escrow pool...');
  const fundResult = await submitContractOp(
    'fund',
    [scvAddress(TOKEN_ADDRESS), scvAddress(adminPub), scvI128(FUND_AMOUNT)],
    cid + '-fund',
    adminKp,
  );
  console.log(`  ✔ funded ${FUND_AMOUNT} tokens from ${adminPub}`);

  // ── Step 2: Create package ──
  // create_package(operator, id, recipient, amount, token, expires_at, metadata)
  const pkgId = Math.floor(Date.now() / 1000);
  const expiresAt = Math.floor(Date.now() / 1000) + PACKAGE_EXPIRY_SEC;

  console.log(`\n  2/4  create_package(id=${pkgId})...`);
  const createResult = await submitContractOp(
    'create_package',
    [
      scvAddress(adminPub),
      scvU64(pkgId),
      scvAddress(recipientPub),
      scvI128(PACKAGE_AMOUNT),
      scvAddress(TOKEN_ADDRESS),
      scvU64(expiresAt),
      scvMap({ source: 'integration-harness' }),
    ],
    cid + '-create',
    adminKp,
  );
  console.log(`  ✔ created package ${pkgId}, result: ${createResult.result}`);

  // ── Step 3: Claim the package ──
  // claim(id) — requires recipient.require_auth()
  console.log(`\n  3/4  claim(id=${pkgId})...`);
  const claimResult = await submitContractOp(
    'claim',
    [scvU64(pkgId)],
    cid + '-claim',
    recipientKp,
  );
  console.log(`  ✔ claimed package ${pkgId}`);

  // ── Step 4: Verify ──
  // get_package(id) to check status
  console.log(`\n  4/4  verifying package ${pkgId} status...`);
  const pkg = await simulateReadOnly('get_package', [scvU64(pkgId)], cid + '-verify', adminKp);
  if (pkg) {
    const statusMap = { 0: 'Created', 1: 'Claimed', 2: 'Expired', 3: 'Cancelled', 4: 'Refunded' };
    const status = statusMap[pkg.status] || pkg.status;
    console.log(`  package status: ${status}`);
    console.log(`  recipient:      ${pkg.recipient}`);
    console.log(`  amount:         ${pkg.amount}`);

    if (Number(pkg.status) === 1 || status === 'Claimed') {
      console.log('  ✔ Package successfully created and claimed!');
    } else {
      console.error(`  ✘ Unexpected status: ${status}`);
      exitCode = 5;
    }
  } else {
    console.error('  ✘ Package not found after creation');
    exitCode = 6;
  }

  // ── Verify aggregates ──
  console.log('\n  Checking aggregates...');
  const aggregates = await simulateReadOnly('get_aggregates', [scvAddress(TOKEN_ADDRESS)], cid + '-agg', adminKp);
  if (aggregates) {
    console.log(`  total_committed:          ${aggregates.total_committed}`);
    console.log(`  total_claimed:            ${aggregates.total_claimed}`);
    console.log(`  total_expired_cancelled:  ${aggregates.total_expired_cancelled}`);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function run() {
  const cid = correlationId();
  console.log(`═══ Testnet Integration Harness ═══`);
  console.log(`RPC:         ${RPC_URL}`);
  console.log(`Contract:    ${CONTRACT_ID}`);
  console.log(`Token:       ${TOKEN_ADDRESS || '(not set — read-only only)'}`);
  console.log(`Correlation: ${cid}`);
  console.log(`Retries:     ${RETRIES}`);
  console.log(`Timeout:     ${OP_TIMEOUT_MS}ms`);

  // ── Validation ──
  if (!CONTRACT_ID || !CONTRACT_ID.startsWith('C') || CONTRACT_ID.length !== 56) {
    console.error('ERROR: SOROBAN_CONTRACT_ID missing or invalid. Must be a 56-char C-prefixed ID.');
    exitCode = 2;
    return;
  }

  const hasAdminKey = !!ADMIN_SECRET;
  const hasToken = !!TOKEN_ADDRESS;

  const adminKp = hasAdminKey ? getKeypairFromSecret(ADMIN_SECRET) : null;
  if (hasAdminKey && !adminKp) {
    console.error('ERROR: SOROBAN_ADMIN_SECRET_KEY is not a valid Stellar secret key.');
    exitCode = 7;
    return;
  }

  if (!hasAdminKey) {
    console.log('\n⚠  SOROBAN_ADMIN_SECRET_KEY not set — read-only queries only');
  }

  // ── Read-Only Tests ──
  const readKp = adminKp || Keypair.random();
  try {
    const { admin } = await runReadOnlyTests(cid, readKp);
    if (admin) {
      console.log(`\nℹ  Contract admin is ${admin}`);
      if (hasAdminKey && adminKp && admin !== adminKp.publicKey()) {
        console.error('ERROR: SOROBAN_ADMIN_SECRET_KEY does not match the contract admin.');
        exitCode = 8;
        return;
      }
    }
  } catch (err) {
    console.error(`\nRead-only tests failed: ${err.message}`);
    exitCode = 3;
    return;
  }

  // ── Write Flow (optional) ──
  if (hasAdminKey && hasToken) {
    try {
      await runWriteFlow(cid, adminKp);
    } catch (err) {
      console.error(`\nWrite flow failed: ${err.message}`);
      exitCode = 4;
      return;
    }
  } else if (hasAdminKey && !hasToken) {
    console.log('\n⚠  SOROBAN_TOKEN_ADDRESS not set — skipping write flow');
    console.log('   To run the full fund → create → claim flow, set:');
    console.log('   SOROBAN_TOKEN_ADDRESS=<token-contract-id>');
  }

  // ── Summary ──
  const status = exitCode === 0 ? 'PASSED' : 'FAILED';
  console.log(`\n═══ Integration harness ${status} ═══`);
}

run().catch((err) => {
  console.error('Unhandled error:', err);
  exitCode = 1;
}).finally(() => {
  process.exit(exitCode);
});
