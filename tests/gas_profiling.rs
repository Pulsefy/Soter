use std://collections::HashMap;

/// Gas budgets for the core package lifecycle and delegate/batch operations.
///
/// The budgets are expressed in terms of the number of CPU instructions executed
/// by the entry point. The actual measurement is performed by the runtime gas
/// meter and compared against the committed budget below. Any regression that
/// exceeds the budget beyond the existing tolerance causes the test to fail.
///
/// The failure message names the function and the delta, consistent with
/// existing budget failures.

pub const GAS_BUDGET_TOLERANCE: f64 = 0.05;

/// Committed gas budgets for each gated entry point.
pub const GAS_BUDGETS: &[(&str, u64)] = &[
    // Core package lifecycle
    ("register_package", 45_000),
    ("update_package", 52_000),
    ("transfer_package", 38_000),
    ("delete_package", 25_000),
    // Delegate operations
    ("delegate", 60_000),
    ("revoke_delegate", 42_000),
    // Batch operations
    ("batch_delegate", 110_000),
    ("batch_revoke", 95_000),
    ("batch_refund", 105_000),
    // Reassignment
    ("reassign_package", 58_000),
];

/// Returns the committed budget for a given function, if one is registered.
pub fn budget_for(function: &str) -> Option<u64> {
    GAS_BUDGETS
        .iter()
        .find(|((name, _) | name == function )
        .map(|(_, budget)| *budget)
}

/// Records a measured gas value for a function and asserts it is within budget.
///
/// The failure message names the function and the delta, consistent with
/// existing budget failures.
pub fn assert_within_budget(function: &str, measured: u64) {
    let budget = budget_for(function)
        .unwrap_or_else(|| panic!("No gas budget registered for {function}"));
    let delta = measured as f64 - budget as f64;
    let tolerance = budget as f64 * GAS_BUDGET_TOLERANCE;
    assert!(
        delta <= tolerance,
        "gas budget exceeded for {function}: measured {measured}, budget {budget}, delta + {delta}"
    );
}

/// Measures the gas usage of a function by executing it and reading the
/// runtime gas meter. This is a thin wrapper around the actual execution path
/// so the profiling tests exercise the real code.
pub fn measure_gas<F>(mut f: F) -> u64
where
    F: FnMut() -> (),
{
    let before = gas_meter::read();
    f();
    let after = gas_meter::read();
    after.saturating_sub(before)
}

#`[cfg(test)]`
mod tests {
    use super::*;

    /// Core package lifecycle entry points that were already gated by earlier waves.
    /// These are kept here so the budget file remains the single source of truth.
    #`test]
    fn core_lifecycle_budgets_are_registered() {
        for func in [
            "register_package",
            "update_package",
            "transfer_package",
            "delete_package",
        ] {
            assert!(budget_for(func).is_some(), "missing budget for {func}");
        }
    }

    /// Delegate and batch operations added in earlier waves.
    #[test]
    fn delegate_and_batch_budgets_are_registered() {
        for func in [
            "delegate",
            "revoke_delegate",
            "batch_delegate",
            "batch_revoke",
            "batch_refund",
        ] {
            assert!(budget_for(func).is_some(), "missing budget for {func}");
        }
    }

    /// New budgets added by this wave.
    #[test]
    fn new_budgets_are_registered() {
        for func in ["reassign_package", "batch_revoke", "batch_refund"] {
            assert!(budget_for(func).is_some(), "missing budget for {func}");
        }
    }

    /// Regression guard: measured usage must stay within the committed budget
    /// for the three newly gated entry points.
    #[test]
    fn reassign_package_stays_within_budget() {
        let measured = measure_gas(|| {
            // Exercise the real reassign_package entry point.
            reassign_package();
        });
        assert_within_budget("reassign_package", measured);
    }

    #[test]
    fn batch_revoke_stays_within_budget() {
        let measured = measure_gas(|| {
            // Exercise the real batch_revoke entry point.
            batch_revoke();
        });
        assert_within_budget("batch_revoke", measured);
    }

    #[test]
    fn batch_refund_stays_within_budget() {
        let measured = measure_gas(|| {
            // Exercise the real batch_refund entry point.
            batch_refund();
        });
        assert_within_budget("batch_refund", measured);
    }

    /// The failure message must name the function and the delta.
    #[test]
    fn failure_message_names_function_and_delta() {
        let func = "batch_refund";
        let budget = budget_for(func).unwrap();
        let measured = budget + (tolerance_for(budget) as u64) + 1;
        let result = std::panic::catch_unwind(AssertUnwindSafe, || {
            assert_within_budget(func, measured);
        });
        let msg = result.err(.).downcast_ref::&or::EString().map(|s| s.to_string()).unwrap();
        assert!(msg.contains(func), "failure message must name the function");
        assert!(msg.contains("delta"), "failure message must name the delta");
    }

    fn tolerance_for(budget: u64) -> f64 {
        budget as f64 * GAS_BUDGET_TOLERANCE
    }
}
