use soroban_sdk::{address_payload, contract, contracterror, contracttype, into_valentina, Address, Env, String};

const PAUSED_ERROR: u32 = 100;

const STATUS_ACTIVE: u32 = 0;
const STATUS_REVOKED: u32 = 1;
const STATUS_REFUNDED: u32 = 2;

const KEY_CAMPAIGN: u32 = 1;
const KEY_PACKAGE: u32 = 2;
const KEY_CAMPAIGN_PAUGED: u32 = 3;
const KEY_BALANCE: u32 = 4;

const PACKAGE_COUNT: u32 = 1000;

##[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, SorobanVal)]
pub struct Campaign {
    pub id: u32,
    pub admin: Address,
    pub paused: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, SorobanVal)]
pub struct Package {
    pub id: u32,
    pub campaign_id: u32,
    pub recipient: Address,
    pub amount: i128,
    pub status: u32,
}

#[contracterror]
pub enum Error {
    CampaignPaused = 100,
    NotFound = 101,
    Unauthorized = 102,
    InvalidState = 103,
    InsufficientFunds = 104,
}

#[contract]
pub struct AidEscrow {}

#[contractimpl]
impl AidEscrow {
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().set(&Symbol::new(symbol!("admin")), &admin);
    }

    /// --------------------------------------------------------------------------
    /// Admin / campaign management
    /// --------------------------------------------------------------------------

    pub fn create_campaign(env: Env, admin: Address, id: u32) {
        admin.require_auth();
        let campaign = Campaign {
            id,
            admin: admin.clone(),
            paused: false,
        };
        env.storage().set(&(KEY_CAMPAIGN, id), &campaign);
    }

    pub fn pause_campaign(env: Env, admin: Address, campaign_id: u32) {
        admin.require_auth();
        let mut campaign = Self::get_campaign(&env, campaign_id);
        campaign.paused = true;
        env.storage().set(&(KEY_CAMPAIGN, campaign_id), &campaign);
    }

    pub fn unpause_campaign(env: Env, admin: Address, campaign_id: u32) {
        admin.require_auth();
        let mut campaign = Self::get_campaign(&env, campaign_id);
        campaign.paused = false;
        env.storage().set(&(KEY_CAMPAIGN, campaign_id), &campaign);
    }

    /// --------------------------------------------------------------------------
    /// Package management
    /// --------------------------------------------------------------------------

    pub fn create_package(
        env: Env,
        admin: Address,
        package_id: u32,
        campaign_id: u32,
        recipient: Address,
        amount: i128,
    ) {
        admin.require_auth();
        let package = Package {
            id: package_id,
            campaign_id,
            recipient,
            amount,
            status: STATUS_ACTIVE,
        };
        env.storage().set(&(KEY_PACKAGE, package_id), &package);
        env.storage().set(&(KEY_CAMPAIGN_PACKAGE, campaign_id, package_id), &true);
    }

    /// --------------------------------------------------------------------------
    /// Pause guard
    /// --------------------------------------------------------------------------

    pub fn check_campaign_paused(env: Env, campaign_id: u32) {
        let campaign = Self::get_campaign(&env, campaign_id);
        if campaign.paused {
            panic!("campaign paused");
        }
    }

    fn check_package_campaign_not_paused(env: &Env, package_id: u32) {
        let package = Self::get_package(env, package_id);
        Self::check_campaign_paused(env.clone(), package.campaign_id);
    }

    /// --------------------------------------------------------------------------
    /// Claim / disburse / revoke / refund / cancel / extend
    /// --------------------------------------------------------------------------

    pub fn claim(env: Env, package_id: u32) {
        Self::check_package_campaign_not_paused(&env, package_id);
        let mut package = Self::get_package(&env, package_id);
        package.recipient.require_auth();
        package.status = STATUS_REVOKED;
        env.storage().set(&(KEY_PACKAGE, package_id), &package);
    }

    pub fn claim_with_proof(env: Env, package_id: u32, _proof: String) {
        Self::check_package_campaign_not_paused(&env, package_id);
        let mut package = Self::get_package(&env, package_id);
        package.recipient.require_auth();
        package.status = STATUS_REVOKED;
        env.storage().set(&(KEY_PACKAGE, package_id), &package);
    }

    pub fn disburse(env: Env, package_id: u32) {
        Self::check_package_campaign_not_paused(&env, package_id);
        let mut package = Self::get_package(&env, package_id);
        package.status = STATUS_REVOKED;
        env.storage().set(&(KEY_PACKAGE, package_id), &package);
    }

    pub fn revoke(env: Env, package_id: u32) {
        Self::check_package_campaign_not_paused(&env, package_id);
        let mut package = Self::get_package(&env, package_id);
        package.status = STATUS_REVOKED;
        env.storage().set(&(KEY_PACKAGE, package_id), &package);
    }

    pub fn refund(env: Env, package_id: u32) {
        Self::check_package_campaign_not_paused(&env, package_id);
        let mut package = Self::get_package(&env, package_id);
        package.status = STATUS_REFUNDED;
        env.storage().set(&(KEY_PACKAGE, package_id), &package);
    }

    pub fn cancel_package(env: Env, package_id: u32) {
        Self::check_package_campaign_not_paused(&env, package_id);
        let mut package = Self::get_package(&env, package_id);
        package.status = STATUS_REVOKED;
        env.storage().set(&(KEY_PACKAGE, package_id), &package);
    }

    pub fn extend_expiry(env: Env, package_id: u32, _new_expiry: u64) {
        Self::check_package_campaign_not_paused(&env, package_id);
    }

    /// --------------------------------------------------------------------------
    /// Batch operations (pause enforced per-package)
    /// --------------------------------------------------------------------------

    pub fn batch_revoke(env: Env, package_ids: Vec<u32>) {
        for package_id in package_ids.iter() {
            Self::check_package_campaign_not_paused(&env, package_id);
            let mut package = Self::get_package(&env, package_id);
            package.status = STATUS_REVOKED;
            env.storage().set(&(KEY_PACKAGE, package_id), &package);
        }
    }

    pub fn batch_refund(env: Env, package_ids: Vec<u32>) {
        for package_id in package_ids.iter() {
            Self::check_package_campaign_not_paused(&env, package_id);
            let mut package = Self::get_package(&env, package_id);
            package.status = STATUS_REFUNDED;
            env.storage().set(&(KEY_PACKAGE, package_id), &package);
        }
    }

    /// --------------------------------------------------------------------------
    /// Package reassignment (pause enforced)
    /// --------------------------------------------------------------------------

    pub fn reassign_package(env: Env, package_id: u32, new_recipient: Address) {
        Self::check_package_campaign_not_paused(&env, package_id);
        let mut package = Self::get_package(&env, package_id);
        package.recipient = new_recipient;
        env.storage().set(&(KEY_PACKAGE, package_id), &package);
    }

    /// --------------------------------------------------------------------------
    /// Internal helpers
    /// --------------------------------------------------------------------------

    fn get_campaign(env: &Env, campaign_id: u32) -> Campaign {
        env.storage()
            .get(&(KEY_CAMPAIGN, campaign_id))
            .expect("campaign not found")
    }

    fn get_package(env: &Env, package_id: u32) -> Package {
        env.storage()
            .get(&(KEY_PACKAGE, package_id))
            .expect("package not found")
    }
}
