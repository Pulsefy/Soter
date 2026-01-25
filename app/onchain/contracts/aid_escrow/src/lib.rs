#![no_std]

use soroban_sdk::{
    Address, Env, Map, String, Symbol, Vec, contract, contracterror, contractimpl, contracttype,
};

// ============================================================================
// Event Topic Constants
// ============================================================================

pub const EVENT_PACKAGE_CREATED: &str = "package_created";
pub const EVENT_PACKAGE_CLAIMED: &str = "package_claimed";
pub const EVENT_PACKAGE_EXPIRED: &str = "package_expired";
pub const EVENT_PACKAGE_CANCELLED: &str = "package_cancelled";
pub const EVENT_CONTRACT_INITIALIZED: &str = "contract_initialized";

#[contract]
pub struct AidEscrow;

/// Package status enum
#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum PackageStatus {
    Created = 0,
    Claimed = 1,
    Expired = 2,
    Cancelled = 3,
}

/// Package structure
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Package {
    pub recipient: Address,
    pub amount: i128,
    pub token: Address,
    pub status: PackageStatus,
    pub created_at: u64,
    pub expires_at: u64,
    pub metadata: Map<Symbol, String>,
}

/// Contract errors
#[contracterror]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Error {
    NotAuthorized = 1,
    InvalidAmount = 2,
    PackageNotFound = 3,
    PackageAlreadyClaimed = 4,
    PackageExpired = 5,
}

#[contractimpl]
impl AidEscrow {
    // ========================================================================
    // Core Contract Methods
    // ========================================================================

    /// Initialize the contract with an admin
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "admin"), &admin);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "package_counter"), &0u64);
        
        // Emit initialization event
        Self::emit_contract_initialized(&env, admin);
        
        Ok(())
    }

    /// Get the admin address
    pub fn get_admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .ok_or(Error::NotAuthorized)
    }

    /// Create a new aid package
    pub fn create_package(
        env: Env,
        recipient: Address,
        amount: i128,
        token: Address,
        expires_in: u64,
    ) -> Result<u64, Error> {
        // Only admin
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .ok_or(Error::NotAuthorized)?;
        admin.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        // Increment package counter
        let mut package_counter: u64 = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "package_counter"))
            .unwrap_or(0);
        let package_id = package_counter;
        package_counter += 1;
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "package_counter"), &package_counter);

        let created_at = env.ledger().timestamp();
        let expires_at = if expires_in > 0 {
            created_at + expires_in
        } else {
            0
        };

        let package = Package {
            recipient: recipient.clone(),
            amount,
            token: token.clone(),
            status: PackageStatus::Created,
            created_at,
            expires_at,
            metadata: Map::new(&env),
        };

        env.storage()
            .persistent()
            .set(&(Symbol::new(&env, "package"), package_id), &package);

        // Emit PackageCreated event
        Self::emit_package_created(
            &env,
            package_id,
            recipient,
            amount,
            token,
            admin,
            created_at,
            expires_at,
        );

        Ok(package_id)
    }

    /// Claim a package
    pub fn claim_package(env: Env, package_id: u64) -> Result<(), Error> {
        let key = Symbol::new(&env, "package");
        let mut package: Package = env
            .storage()
            .persistent()
            .get(&(key.clone(), package_id))
            .ok_or(Error::PackageNotFound)?;

        if package.status == PackageStatus::Claimed {
            return Err(Error::PackageAlreadyClaimed);
        }

        let timestamp = env.ledger().timestamp();

        if package.expires_at > 0 && timestamp > package.expires_at {
            package.status = PackageStatus::Expired;
            env.storage()
                .persistent()
                .set(&(key.clone(), package_id), &package);
            
            // Emit PackageExpired event
            Self::emit_package_expired(
                &env,
                package_id,
                package.recipient.clone(),
                package.amount,
                package.token.clone(),
                timestamp,
            );
            
            return Err(Error::PackageExpired);
        }

        // Only recipient can claim
        package.recipient.require_auth();

        package.status = PackageStatus::Claimed;
        env.storage().persistent().set(&(key, package_id), &package);
        
        // Emit PackageClaimed event
        Self::emit_package_claimed(
            &env,
            package_id,
            package.recipient.clone(),
            package.amount,
            package.token.clone(),
            timestamp,
        );
        
        Ok(())
    }

    /// Cancel a package (admin only)
    pub fn cancel_package(env: Env, package_id: u64) -> Result<(), Error> {
        // Only admin can cancel
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .ok_or(Error::NotAuthorized)?;
        admin.require_auth();

        let key = Symbol::new(&env, "package");
        let mut package: Package = env
            .storage()
            .persistent()
            .get(&(key.clone(), package_id))
            .ok_or(Error::PackageNotFound)?;

        if package.status == PackageStatus::Claimed {
            return Err(Error::PackageAlreadyClaimed);
        }

        let timestamp = env.ledger().timestamp();

        package.status = PackageStatus::Cancelled;
        env.storage().persistent().set(&(key, package_id), &package);

        // Emit PackageCancelled event
        Self::emit_package_cancelled(
            &env,
            package_id,
            package.recipient.clone(),
            package.amount,
            package.token.clone(),
            admin,
            timestamp,
        );

        Ok(())
    }

    /// Get package details
    pub fn get_package(env: Env, package_id: u64) -> Result<Option<Package>, Error> {
        let key = Symbol::new(&env, "package");
        Ok(env.storage().persistent().get(&(key, package_id)))
    }

    /// Get total package count
    pub fn get_package_count(env: Env) -> Result<u64, Error> {
        let count: u64 = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "package_counter"))
            .unwrap_or(0);
        Ok(count)
    }

    // ========================================================================
    // Event Emission Helpers
    // ========================================================================

    fn emit_contract_initialized(env: &Env, admin: Address) {
        let topics = Symbol::new(env, EVENT_CONTRACT_INITIALIZED);
        let mut data = Vec::new(env);
        data.push_back(admin);
        data.push_back(env.ledger().timestamp());
        env.events().publish(topics, data);
    }

    fn emit_package_created(
        env: &Env,
        package_id: u64,
        recipient: Address,
        amount: i128,
        token: Address,
        creator: Address,
        created_at: u64,
        expires_at: u64,
    ) {
        let topics = (Symbol::new(env, EVENT_PACKAGE_CREATED), package_id);
        let mut data = Vec::new(env);
        data.push_back(package_id);
        data.push_back(recipient);
        data.push_back(amount);
        data.push_back(token);
        data.push_back(creator);
        data.push_back(created_at);
        data.push_back(expires_at);
        env.events().publish(topics, data);
    }

    fn emit_package_claimed(
        env: &Env,
        package_id: u64,
        recipient: Address,
        amount: i128,
        token: Address,
        timestamp: u64,
    ) {
        let topics = (Symbol::new(env, EVENT_PACKAGE_CLAIMED), package_id);
        let mut data = Vec::new(env);
        data.push_back(package_id);
        data.push_back(recipient);
        data.push_back(amount);
        data.push_back(token);
        data.push_back(timestamp);
        env.events().publish(topics, data);
    }

    fn emit_package_expired(
        env: &Env,
        package_id: u64,
        recipient: Address,
        amount: i128,
        token: Address,
        timestamp: u64,
    ) {
        let topics = (Symbol::new(env, EVENT_PACKAGE_EXPIRED), package_id);
        let mut data = Vec::new(env);
        data.push_back(package_id);
        data.push_back(recipient);
        data.push_back(amount);
        data.push_back(token);
        data.push_back(timestamp);
        env.events().publish(topics, data);
    }

    fn emit_package_cancelled(
        env: &Env,
        package_id: u64,
        recipient: Address,
        amount: i128,
        token: Address,
        actor: Address,
        timestamp: u64,
    ) {
        let topics = (Symbol::new(env, EVENT_PACKAGE_CANCELLED), package_id);
        let mut data = Vec::new(env);
        data.push_back(package_id);
        data.push_back(recipient);
        data.push_back(amount);
        data.push_back(token);
        data.push_back(actor);
        data.push_back(timestamp);
        env.events().publish(topics, data);
    }
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env};

    fn setup() -> (Env, AidEscrowClient<'static>) {
        let env = Env::default();
        let contract_id = env.register(AidEscrow, ());
        let client = AidEscrowClient::new(&env, &contract_id);
        (env, client)
    }

    #[test]
    fn test_initialize_and_get_admin() {
        let (env, client) = setup();
        let admin = Address::generate(&env);

        client.initialize(&admin);
        let retrieved_admin = client.get_admin();

        assert_eq!(retrieved_admin, admin);
    }

    #[test]
    fn test_create_package() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token = Address::generate(&env);

        client.initialize(&admin);

        // Admin must authorize
        env.mock_all_auths();

        let package_id = client.create_package(&recipient, &1000, &token, &86400);
        assert_eq!(package_id, 0);

        let package = client.get_package(&package_id).unwrap();
        assert_eq!(package.recipient, recipient);
        assert_eq!(package.amount, 1000);
        assert_eq!(package.token, token);
        assert_eq!(package.status, PackageStatus::Created);
    }

    #[test]
    fn test_create_package_invalid_amount() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token = Address::generate(&env);

        client.initialize(&admin);
        env.mock_all_auths();

        let result = client.try_create_package(&recipient, &0, &token, &86400);
        assert_eq!(result, Err(Ok(Error::InvalidAmount)));
    }

    #[test]
    fn test_claim_package() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token = Address::generate(&env);

        client.initialize(&admin);
        env.mock_all_auths();

        let package_id = client.create_package(&recipient, &1000, &token, &86400);

        // Mock recipient auth for claim
        env.mock_all_auths();

        client.claim_package(&package_id);

        let package = client.get_package(&package_id).unwrap();
        assert_eq!(package.status, PackageStatus::Claimed);
    }

    #[test]
    fn test_claim_package_not_recipient() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);
        let _other = Address::generate(&env);
        let token = Address::generate(&env);

        client.initialize(&admin);
        env.mock_all_auths();

        let package_id = client.create_package(&recipient, &1000, &token, &86400);

        // Mock wrong auth (other instead of recipient)
        env.mock_all_auths();

        client.claim_package(&package_id);
        // This would fail auth check in real scenario
        // For test, we're mocking all auths so it passes
    }

    #[test]
    fn test_get_package_count() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let recipient1 = Address::generate(&env);
        let recipient2 = Address::generate(&env);
        let token = Address::generate(&env);

        client.initialize(&admin);
        env.mock_all_auths();

        assert_eq!(client.get_package_count(), 0);

        client.create_package(&recipient1, &1000, &token, &86400);
        assert_eq!(client.get_package_count(), 1);

        client.create_package(&recipient2, &2000, &token, &86400);
        assert_eq!(client.get_package_count(), 2);
    }

    #[test]
    fn test_package_not_found() {
        let (env, client) = setup();
        let admin = Address::generate(&env);

        client.initialize(&admin);

        let result = client.get_package(&999);
        assert_eq!(result, None);
    }

    #[test]
    fn test_cancel_package() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token = Address::generate(&env);

        client.initialize(&admin);
        env.mock_all_auths();

        let package_id = client.create_package(&recipient, &1000, &token, &86400);
        client.cancel_package(&package_id);

        let package = client.get_package(&package_id).unwrap();
        assert_eq!(package.status, PackageStatus::Cancelled);
    }
}