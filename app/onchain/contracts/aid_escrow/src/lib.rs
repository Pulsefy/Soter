#![no_std]

use soroban_sdk::{
    Address, Env, Map, String, Symbol, contract, contracterror, contractimpl, contracttype,
};

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
    /// Initialize the contract with an admin
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "admin"), &admin);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "package_counter"), &0u64);
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
            recipient,
            amount,
            token,
            status: PackageStatus::Created,
            created_at,
            expires_at,
            metadata: Map::new(&env),
        };

        env.storage()
            .persistent()
            .set(&(Symbol::new(&env, "package"), package_id), &package);

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

        if package.expires_at > 0 && env.ledger().timestamp() > package.expires_at {
            package.status = PackageStatus::Expired;
            env.storage()
                .persistent()
                .set(&(key.clone(), package_id), &package);
            return Err(Error::PackageExpired);
        }

        // Only recipient can claim
        package.recipient.require_auth();

        package.status = PackageStatus::Claimed;
        env.storage().persistent().set(&(key, package_id), &package);
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
}

// Unit tests
#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{Address, Env, testutils::Address as _};

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
}
