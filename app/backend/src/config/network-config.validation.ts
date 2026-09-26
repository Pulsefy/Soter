import { NETWORK_PROFILES, NetworkName, isNetworkName } from './network.config';

/**
 * Validates SOROBAN_NETWORK / STELLAR_RPC_URL / STELLAR_NETWORK_PASSPHRASE
 * consistency at startup. Passed as `validate` to ConfigModule.forRoot so a
 * bad or cross-network config (e.g. a mainnet passphrase under a testnet
 * network) fails application bootstrap immediately instead of surfacing
 * later as an obscure Soroban RPC error.
 */
export function validateNetworkConfig(
  env: Record<string, unknown>,
): Record<string, unknown> {
  const rawNetwork = (env.SOROBAN_NETWORK as string | undefined)?.trim();
  const network = (rawNetwork || 'testnet').toLowerCase();

  if (!isNetworkName(network)) {
    throw new Error(
      `Invalid SOROBAN_NETWORK "${rawNetwork}". Must be one of: ${Object.keys(NETWORK_PROFILES).join(', ')}.`,
    );
  }

  const profile = NETWORK_PROFILES[network];

  const passphrase =
    (env.STELLAR_NETWORK_PASSPHRASE as string | undefined) ||
    profile.passphrase;
  if (passphrase !== profile.passphrase) {
    const owningNetwork = (
      Object.entries(NETWORK_PROFILES) as [NetworkName, typeof profile][]
    ).find(([, p]) => p.passphrase === passphrase)?.[0];
    throw new Error(
      `STELLAR_NETWORK_PASSPHRASE does not match SOROBAN_NETWORK="${network}". ` +
        `Expected "${profile.passphrase}"` +
        (owningNetwork
          ? `, but got the ${owningNetwork} passphrase instead.`
          : `, but got "${passphrase}".`),
    );
  }

  const rpcUrl =
    (env.STELLAR_RPC_URL as string | undefined) || profile.defaultRpcUrl;
  const lowerRpcUrl = rpcUrl.toLowerCase();
  const conflictingKeyword = profile.foreignRpcKeywords.find(keyword =>
    lowerRpcUrl.includes(keyword),
  );
  if (conflictingKeyword) {
    throw new Error(
      `STELLAR_RPC_URL ("${rpcUrl}") looks like a ${conflictingKeyword} endpoint, ` +
        `but SOROBAN_NETWORK is set to "${network}". Update STELLAR_RPC_URL or ` +
        `SOROBAN_NETWORK so they refer to the same network.`,
    );
  }

  return env;
}
