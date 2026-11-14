//! Integer-only building blocks for Commitment Stakes settlement, matching
//! the source MVP's worked example exactly (two teams of 3, S = 1 SOL,
//! alpha = 2000 bps, rake = 300 bps). All amounts are lamports; all ratios
//! are computed as one widened (u128) floor division rather than rounding
//! an intermediate fraction, to keep rounding error to a single floor per
//! value rather than compounding it.

pub const BPS: u16 = 10_000;

/// Fixed bonus rate for a both-teams-pass outcome: min(5% of total staked,
/// the group pot's balance). Not configurable per challenge in the MVP.
pub const BOTH_WIN_BONUS_BPS: u16 = 500;

/// A team's goal in half-workout units: every member owes `target` whole
/// workouts, so the team's combined goal is `member_count * target * 2`.
pub fn team_goal_units(member_count: u16, target: u32) -> Option<u64> {
    (u64::from(member_count)).checked_mul(u64::from(target))?.checked_mul(2)
}

/// A team passes when its members' combined (capped) units reach its
/// combined goal - individual shortfalls can be carried by teammates.
pub fn team_passes(team_units_sum: u64, member_count: u16, target: u32) -> Option<bool> {
    Some(team_units_sum >= team_goal_units(member_count, target)?)
}

/// A losing-team member's personal loss:
/// `stake * (alpha + (1 - alpha) * shortfall_ratio)`, where
/// `shortfall_ratio = max(0, goal - completed) / goal`, computed as one
/// floor division so a member who exactly meets their goal loses exactly
/// `alpha * stake` and a member who does nothing loses the full stake.
/// `member_units` is expected already capped (via `capped_workout_units`),
/// though the cap can never actually bind here since it only matters above
/// 100% of goal, where shortfall is already zero.
pub fn member_loss_lamports(stake: u64, alpha_bps: u16, goal_units: u64, member_units: u64) -> Option<u64> {
    if alpha_bps > BPS || goal_units == 0 {
        return None;
    }
    let shortfall_units = goal_units.saturating_sub(member_units);
    let alpha = u128::from(alpha_bps);
    let complement = u128::from(BPS).checked_sub(alpha)?;
    let numerator = alpha
        .checked_mul(u128::from(goal_units))?
        .checked_add(complement.checked_mul(u128::from(shortfall_units))?)?;
    let denominator = u128::from(BPS).checked_mul(u128::from(goal_units))?;
    u64::try_from(u128::from(stake).checked_mul(numerator)?.checked_div(denominator)?).ok()
}

/// The house's cut of a settlement: a fixed rate of everything staked this
/// round, but never more than the forfeits actually being collected - a
/// round where nobody fails never tops up the house from winners' principal.
pub fn house_cut_lamports(rake_bps: u16, total_staked: u64, total_forfeits: u64) -> Option<u64> {
    Some(floor_bps(total_staked, rake_bps)?.min(total_forfeits))
}

/// One winner's share of the leftover forfeit pool, weighted by their own
/// (capped) workout units among all winners' units. Zero-unit winners (a
/// teammate carried the team) correctly get zero share and fall out of the
/// denominator - they still keep their full stake, just no bonus share.
pub fn winner_share_lamports(share_pool: u64, winner_units: u64, total_winner_units: u64) -> Option<u64> {
    if total_winner_units == 0 {
        return Some(0);
    }
    u64::try_from(
        u128::from(share_pool)
            .checked_mul(u128::from(winner_units))?
            .checked_div(u128::from(total_winner_units))?,
    )
    .ok()
}

/// The group pot's both-teams-pass bonus pool: a fixed rate of this round's
/// total stake, capped by whatever the pot actually holds - the bonus can
/// only ever be funded by the group's own accumulated past forfeits.
pub fn bonus_pool_lamports(total_staked: u64, pot_balance: u64) -> Option<u64> {
    Some(floor_bps(total_staked, BOTH_WIN_BONUS_BPS)?.min(pot_balance))
}

/// Contribution in half-workout units, avoiding fractional-workout truncation.
/// For target 3, the cap is exactly 4.5 workouts (9 half units).
pub fn capped_workout_units(accepted: u32, target: u32) -> Option<u64> {
    if target == 0 {
        return None;
    }
    Some((u64::from(accepted) * 2).min(u64::from(target) * 3))
}

/// Floor a basis-point proportion using a wide intermediate.
pub fn floor_bps(amount: u64, bps: u16) -> Option<u64> {
    if bps > BPS {
        return None;
    }
    u64::try_from(u128::from(amount) * u128::from(bps) / u128::from(BPS)).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cap_preserves_odd_target_precision() {
        assert_eq!(capped_workout_units(4, 3), Some(8));
        assert_eq!(capped_workout_units(5, 3), Some(9));
        assert_eq!(capped_workout_units(u32::MAX, 3), Some(9));
        assert_eq!(capped_workout_units(0, 3), Some(0));
        assert_eq!(capped_workout_units(1, 0), None);
    }

    #[test]
    fn cap_handles_maximum_input() {
        assert_eq!(capped_workout_units(u32::MAX, u32::MAX), Some(u64::from(u32::MAX) * 2));
    }

    #[test]
    fn basis_points_floor_and_reject_out_of_range() {
        assert_eq!(floor_bps(101, 300), Some(3));
        assert_eq!(floor_bps(100, 2000), Some(20));
        assert_eq!(floor_bps(u64::MAX, BPS), Some(u64::MAX));
        assert_eq!(floor_bps(u64::MAX, 0), Some(0));
        assert_eq!(floor_bps(1, BPS + 1), None);
    }

    const SOL: u64 = 1_000_000_000;
    const ALPHA_BPS: u16 = 2_000;
    const RAKE_BPS: u16 = 300;
    const TARGET: u32 = 5;

    fn units(completed: u32) -> u64 {
        capped_workout_units(completed, TARGET).unwrap()
    }

    /// The MVP doc's own worked example, reproduced exactly: two teams of
    /// 3, S = 1 SOL, alpha = 20%, goal = 5 workouts each. Team A (Priya 6,
    /// Lee 5, Max 4) passes 15/15; Team B (Alex 5, Sam 4, Jordan 0) fails
    /// 9/15. Every lamport figure here is the MVP doc's own expected value.
    #[test]
    fn worked_example_one_team_wins() {
        // Per-member goal (what member_loss_lamports expects) vs. the
        // team's combined goal (what team_passes checks) are different
        // numbers - 10 vs. 30 here - and must not be confused.
        let member_goal = u64::from(TARGET) * 2;
        assert_eq!(member_goal, 10);
        let team_goal = team_goal_units(3, TARGET).unwrap();
        assert_eq!(team_goal, 30);

        assert_eq!(team_passes(units(6) + units(5) + units(4), 3, TARGET), Some(true));
        assert_eq!(team_passes(units(5) + units(4) + units(0), 3, TARGET), Some(false));

        let alex_loss = member_loss_lamports(SOL, ALPHA_BPS, member_goal, units(5)).unwrap();
        let sam_loss = member_loss_lamports(SOL, ALPHA_BPS, member_goal, units(4)).unwrap();
        let jordan_loss = member_loss_lamports(SOL, ALPHA_BPS, member_goal, units(0)).unwrap();
        assert_eq!(alex_loss, 200_000_000); // 0.20 SOL - floor only, met goal exactly
        assert_eq!(sam_loss, 360_000_000); // 0.36 SOL
        assert_eq!(jordan_loss, SOL); // whole stake

        let total_staked = SOL * 6;
        let total_forfeits = alex_loss + sam_loss + jordan_loss;
        assert_eq!(total_forfeits, 1_560_000_000);

        let house_cut = house_cut_lamports(RAKE_BPS, total_staked, total_forfeits).unwrap();
        assert_eq!(house_cut, 180_000_000); // 0.18 SOL = 3% of 6 SOL, well under forfeits

        let share_pool = total_forfeits - house_cut;
        assert_eq!(share_pool, 1_380_000_000);

        let total_winner_units = units(6) + units(5) + units(4);
        let priya_share = winner_share_lamports(share_pool, units(6), total_winner_units).unwrap();
        let lee_share = winner_share_lamports(share_pool, units(5), total_winner_units).unwrap();
        let max_share = winner_share_lamports(share_pool, units(4), total_winner_units).unwrap();

        assert_eq!(SOL + priya_share, 1_552_000_000);
        assert_eq!(SOL + lee_share, 1_460_000_000);
        assert_eq!(SOL + max_share, 1_368_000_000);
        assert_eq!(SOL - alex_loss, 800_000_000);
        assert_eq!(SOL - sam_loss, 640_000_000);
        assert_eq!(SOL - jordan_loss, 0);

        // Conservation: every lamport staked is accounted for somewhere.
        let distributed_to_winners = priya_share + lee_share + max_share;
        let dust = share_pool - distributed_to_winners;
        let total_paid_out =
            (SOL + priya_share) + (SOL + lee_share) + (SOL + max_share) + (SOL - alex_loss) + (SOL - sam_loss) + (SOL - jordan_loss);
        assert_eq!(total_paid_out + house_cut + dust, total_staked);
        assert_eq!(dust, 0); // this example happens to divide evenly
    }

    /// Both teams fail: nobody wins, so there's no one to split forfeits
    /// with - the house still takes its cut, and everything left over goes
    /// to the persistent group pot rather than vanishing.
    #[test]
    fn both_teams_lose_forfeits_go_to_pot() {
        let member_goal = u64::from(TARGET) * 2;
        let a1 = member_loss_lamports(SOL, ALPHA_BPS, member_goal, units(0)).unwrap();
        let a2 = member_loss_lamports(SOL, ALPHA_BPS, member_goal, units(2)).unwrap();
        let b1 = member_loss_lamports(SOL, ALPHA_BPS, member_goal, units(1)).unwrap();
        let b2 = member_loss_lamports(SOL, ALPHA_BPS, member_goal, units(3)).unwrap();
        let total_staked = SOL * 4;
        let total_forfeits = a1 + a2 + b1 + b2;
        let house_cut = house_cut_lamports(RAKE_BPS, total_staked, total_forfeits).unwrap();
        let to_pot = total_forfeits - house_cut;

        // No winners exist in this outcome, so there's nothing to call
        // winner_share_lamports for; the whole remainder is the pot's gain.
        assert!(to_pot > 0);
        assert_eq!(house_cut + to_pot, total_forfeits);
    }

    /// Both teams pass: no forfeits, no rake - the only money that moves is
    /// an equal-split bonus funded from the group's own past forfeits,
    /// capped by both a per-round rate and the pot's actual balance.
    #[test]
    fn both_teams_win_bonus_capped_by_pot_balance() {
        let total_staked = SOL * 4;

        // Pot flush: bonus is the full 5% rate.
        let flush_pot = SOL * 10;
        let bonus_pool = bonus_pool_lamports(total_staked, flush_pot).unwrap();
        assert_eq!(bonus_pool, SOL / 20 * 4); // 5% of 4 SOL
        let per_member = bonus_pool / 4;
        assert_eq!(per_member * 4, bonus_pool); // divides evenly here

        // Pot nearly empty: bonus is capped by the pot, not the 5% rate.
        let thin_pot = 1_000;
        let bonus_pool_thin = bonus_pool_lamports(total_staked, thin_pot).unwrap();
        assert_eq!(bonus_pool_thin, thin_pot);
    }

    #[test]
    fn zero_weight_winner_gets_zero_share_not_a_crash() {
        // A winning team where one member did literally nothing - the team
        // still passed because a teammate carried it.
        let share = winner_share_lamports(1_000_000, 0, 20).unwrap();
        assert_eq!(share, 0);
    }

    #[test]
    fn no_winners_at_all_never_divides_by_zero() {
        assert_eq!(winner_share_lamports(1_000_000, 0, 0), Some(0));
    }

    #[test]
    fn member_loss_rejects_invalid_alpha_and_zero_goal() {
        assert_eq!(member_loss_lamports(SOL, BPS + 1, 10, 5), None);
        assert_eq!(member_loss_lamports(SOL, ALPHA_BPS, 0, 0), None);
    }

    #[test]
    fn member_loss_never_exceeds_stake() {
        // Shortfall can't exceed goal (saturating_sub floors at 0), so even
        // a wildly out-of-range member_units can't produce a loss > stake.
        let goal = 10;
        let loss = member_loss_lamports(SOL, ALPHA_BPS, goal, 0).unwrap();
        assert!(loss <= SOL);
        assert_eq!(loss, SOL);
    }
}
