# Admin Key Policy for Testnet Deployments

## Overview

This policy defines the security requirements, operational procedures, and best practices for managing admin keys in Soter's Stellar testnet deployments. Admin keys control critical contract operations including package creation, disbursement, revocation, and contract configuration.

## Scope

This policy applies to:
- Soroban smart contract deployments on Stellar testnet
- Admin key management for `aid_escrow` contracts
- Testnet deployment operations
- Development and staging environments

## Policy Principles

### 1. Key Separation
- **Testnet keys must never be used on mainnet**
- Separate admin keys for each environment (testnet, futurenet, standalone)
- Deployer keys should be distinct from admin keys where possible
- Distributor keys should be separate from admin keys

### 2. Key Generation & Storage
- Use Stellar's standard keypair generation (Ed25519)
- Generate keys using `soroban keys generate` or Stellar SDK
- Store secret keys in environment variables (`.env` files)
- Never commit `.env` files or secret keys to version control
- Add `.env` to `.gitignore` in all relevant directories

### 3. Key Access Control
- Admin keys should only be accessible to authorized team members
- Use secret management services for production (e.g., AWS Secrets Manager, HashiCorp Vault)
- For testnet development, local `.env` files are acceptable with proper `.gitignore`
- Limit key distribution to necessary personnel only
- Rotate keys if compromise is suspected

### 4. Key Lifecycle Management

#### Generation
```bash
# Generate a new keypair
soroban keys generate

# Or derive public key from secret
soroban keys address "SBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
```

#### Initialization
- Admin key is set during contract initialization via `init` function
- This is a one-time operation per contract deployment
- The admin address cannot be changed after initialization (requires contract upgrade)

#### Rotation
- Testnet keys can be rotated by deploying a new contract instance
- Update all dependent systems with new contract ID and admin key
- Follow the redeployment checklist in `DEPLOY_TESTNET_RUNBOOK.md`

#### Decommissioning
- When decommissioning a testnet contract, revoke all distributor permissions
- Document the final contract state and archive records
- Consider pausing the contract before decommissioning

## Operational Procedures

### Testnet Deployment

#### Prerequisites
1. Generate or retrieve testnet admin key
2. Fund the admin account with testnet XLM via Friendbot
3. Verify the key is not used on mainnet
4. Ensure `.env` file is properly configured

#### Deployment Steps
1. Build the contract: `make build`
2. Deploy contract: `./scripts/deploy.sh --network testnet`
3. Initialize with admin key: `./scripts/initialize.sh --contract "$CONTRACT_ID" --admin "$PUBLIC_KEY" --network testnet`
4. Verify admin: `./scripts/testnet-invoke.sh get-admin --contract-id "$CONTRACT_ID" --source "$SECRET_KEY"`

#### Post-Deployment
- Update `app/backend/.env` with new `CONTRACT_ID`
- Restart backend services
- Verify admin permissions work correctly
- Document deployment in team communication channel

### Admin Key Usage

#### Authorized Operations
The admin key can perform the following operations on the `aid_escrow` contract:
- `migrate` - Perform version migrations
- `add_distributor` - Grant distributor privileges
- `remove_distributor` - Revoke distributor privileges
- `set_config` - Update contract configuration
- `pause` / `unpause` - Pause/unpause contract
- `disburse` - Manually disburse packages
- `revoke` - Revoke packages
- `refund` - Refund expired/cancelled packages
- `cancel_package` - Cancel packages
- `withdraw_surplus` - Withdraw surplus tokens

#### Operator vs Admin Distinction
- **Admin**: Full control over contract, can modify configuration and manage distributors
- **Distributor**: Can create packages and extend expiration, but cannot modify contract config
- **Operator**: Used in package creation, can be admin or distributor

### Security Best Practices

#### Development Environment
- Use dedicated testnet wallets for development
- Never reuse personal wallet keys for contract admin
- Keep testnet keys separate from any mainnet keys
- Use meaningful key labels in wallet management tools

#### Key Protection
- Never share secret keys in chat, email, or tickets
- Use secure channels for key handoff (encrypted messaging, in-person)
- Regularly audit who has access to testnet admin keys
- Implement key rotation schedule (e.g., quarterly for testnet)

#### Monitoring & Auditing
- Log all admin operations in backend systems
- Monitor contract events for admin activity
- Review distributor permissions regularly
- Set up alerts for unauthorized admin operations

## Environment-Specific Requirements

### Testnet
- Use Friendbot for funding accounts
- Keys can be less restrictive than mainnet but still follow security principles
- Regular key rotation recommended (monthly/quarterly)
- Multiple team members may have access for development

### Futurenet
- Similar to testnet but for future Soroban features
- Follow same security practices as testnet
- Document any experimental features being tested

### Standalone (Local)
- Use for local development and testing
- Keys can be ephemeral/regenerated frequently
- No real funds at risk, but maintain good practices

## Incident Response

### Compromised Key
If a testnet admin key is compromised:
1. Immediately pause the contract using the compromised key
2. Deploy a new contract instance with a new admin key
3. Revoke all distributor permissions on old contract
4. Update all dependent systems with new contract ID
5. Notify team of the incident
6. Document the incident and lessons learned

### Lost Key
If a testnet admin key is lost:
1. Deploy a new contract instance with a new admin key
2. Migrate any necessary state from old contract (if possible)
3. Update all dependent systems
4. Document the incident

### Unauthorized Operations
If unauthorized admin operations are detected:
1. Immediately investigate the source
2. Pause the contract if ongoing
3. Revoke distributor permissions if needed
4. Rotate the admin key
5. Review access logs and audit trails

## Compliance & Documentation

### Documentation Requirements
- Maintain a deployment log for each testnet contract
- Record admin key changes with timestamps and reasons
- Document all distributor grants/revocations
- Keep incident reports for security events

### Team Communication
- Announce new testnet deployments in team chat
- Share contract IDs and versions via secure channels
- Document admin key holders and access levels
- Regular security reviews in team meetings

## References

- [Soroban Testnet Deployment Runbook](../app/onchain/DEPLOY_TESTNET_RUNBOOK.md)
- [AidEscrow Contract Documentation](../app/onchain/contracts/aid_escrow/README.md)
- [Stellar Security Best Practices](https://developers.stellar.org/docs/security/)
- [Soroban Documentation](https://soroban.stellar.org/)

## Appendix

### Environment Variable Template

```bash
# Network Configuration
NETWORK=testnet

# Admin Account (DO NOT COMMIT)
SECRET_KEY=SBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
PUBLIC_KEY=GBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Contract Configuration
CONTRACT_ID=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
CONTRACT_VERSION=0.1.0

# RPC Configuration
TESTNET_RPC_URL=https://soroban-testnet.stellar.org:443
```

### Quick Reference Commands

```bash
# Generate new keypair
soroban keys generate

# Get public key from secret
soroban keys address "$SECRET_KEY"

# Fund account via Friendbot
curl "https://friendbot.stellar.org?addr=<PUBLIC_KEY>"

# Check admin on contract
./scripts/testnet-invoke.sh get-admin --contract-id "$CONTRACT_ID"

# Initialize contract with admin
./scripts/testnet-invoke.sh initialize --admin "$PUBLIC_KEY" --contract-id "$CONTRACT_ID"

# For advanced admin operations (pause, add_distributor, etc.), use invoke.sh:
./scripts/invoke.sh pause
./scripts/invoke.sh add_distributor <DISTRIBUTOR_ADDRESS>
```

### Contact & Support

For questions about this policy or to report security incidents:
- Team Discord: https://discord.gg/gBmApTNVV
- GitHub Issues: https://github.com/jaynomyaro/Soter/issues

---

**Policy Version**: 1.0  
**Last Updated**: 2026-05-29  
**Next Review**: 2026-08-29
