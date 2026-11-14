use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

pub mod math;

// Development placeholder, NOT a deployment address. Replace and synchronize
// with the generated local program identity before any future deployment.
declare_id!("DhWeNpUmpxjSXdZ6iN1VCbP1WJVAYg9Yrprtx1LBPDum");

#[program]
pub mod commitment_stakes {
    use super::*;

    /// Creates the challenge and both of its teams atomically - a challenge
    /// can never exist with zero, one, or more than two teams.
    pub fn initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
        require!(args.alpha_bps <= math::BPS && args.rake_bps <= math::BPS, StakesError::InvalidBps);
        require!(args.target > 0, StakesError::InvalidTarget);
        require!(args.stake_lamports > 0, StakesError::InvalidStake);
        require_keys_neq!(args.oracle, Pubkey::default(), StakesError::InvalidOracle);
        require!(args.team_a_name.len() <= Team::MAX_NAME_LEN, StakesError::NameTooLong);
        require!(args.team_b_name.len() <= Team::MAX_NAME_LEN, StakesError::NameTooLong);
        require!(args.deadline_unix > Clock::get()?.unix_timestamp, StakesError::DeadlineInPast);

        let challenge = &mut ctx.accounts.challenge;
        challenge.creator = ctx.accounts.creator.key();
        challenge.oracle = args.oracle;
        challenge.group = ctx.accounts.pot.key();
        challenge.id = args.id;
        challenge.alpha_bps = args.alpha_bps;
        challenge.rake_bps = args.rake_bps;
        challenge.target = args.target;
        challenge.stake_lamports = args.stake_lamports;
        challenge.deadline_unix = args.deadline_unix;
        challenge.total_staked_lamports = 0;
        challenge.winning_team = NO_WINNER;
        challenge.rules_version = 1;
        challenge.settled = false;
        challenge.bump = ctx.bumps.challenge;

        ctx.accounts.vault.challenge = challenge.key();
        ctx.accounts.vault.bump = ctx.bumps.vault;
        ctx.accounts.treasury.challenge = challenge.key();
        ctx.accounts.treasury.bump = ctx.bumps.treasury;

        ctx.accounts.team_a.challenge = challenge.key();
        ctx.accounts.team_a.index = 0;
        ctx.accounts.team_a.name = args.team_a_name;
        ctx.accounts.team_a.member_count = 0;
        ctx.accounts.team_a.bump = ctx.bumps.team_a;

        ctx.accounts.team_b.challenge = challenge.key();
        ctx.accounts.team_b.index = 1;
        ctx.accounts.team_b.name = args.team_b_name;
        ctx.accounts.team_b.member_count = 0;
        ctx.accounts.team_b.bump = ctx.bumps.team_b;
        Ok(())
    }

    /// A separate group pot can be shared by later challenges of this creator.
    pub fn initialize_group(ctx: Context<InitializeGroup>, group_id: u64) -> Result<()> {
        ctx.accounts.pot.creator = ctx.accounts.creator.key();
        ctx.accounts.pot.id = group_id;
        ctx.accounts.pot.balance_lamports = 0;
        ctx.accounts.pot.bump = ctx.bumps.pot;
        Ok(())
    }

    /// Joins one of the challenge's two teams and deposits the fixed stake
    /// straight into the program-owned vault - money never passes through
    /// any off-chain hop.
    pub fn join_team(ctx: Context<JoinTeam>, team_index: u8) -> Result<()> {
        require!(team_index == 0 || team_index == 1, StakesError::InvalidTeamIndex);
        require!(!ctx.accounts.challenge.settled, StakesError::ChallengeAlreadySettled);
        require!(
            Clock::get()?.unix_timestamp < ctx.accounts.challenge.deadline_unix,
            StakesError::DeadlinePassed
        );

        let stake_lamports = ctx.accounts.challenge.stake_lamports;
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer { from: ctx.accounts.member_authority.to_account_info(), to: ctx.accounts.vault.to_account_info() },
            ),
            stake_lamports,
        )?;

        ctx.accounts.team.member_count = ctx.accounts.team.member_count.checked_add(1).ok_or(StakesError::Overflow)?;
        ctx.accounts.challenge.total_staked_lamports = ctx
            .accounts
            .challenge
            .total_staked_lamports
            .checked_add(stake_lamports)
            .ok_or(StakesError::Overflow)?;

        let member = &mut ctx.accounts.team_member;
        member.challenge = ctx.accounts.challenge.key();
        member.team = ctx.accounts.team.key();
        member.owner = ctx.accounts.member_authority.key();
        member.stake_lamports = stake_lamports;
        member.counted_units = 0;
        member.payout_lamports = 0;
        member.claimed = false;
        member.bump = ctx.bumps.team_member;
        Ok(())
    }

    /// Oracle-reported final counts, one call, once. Computes every
    /// member's payout and the aggregate house/pot flows; does not pay
    /// individual members out (see `claim`) - only the fixed-size flows
    /// (house cut, pot delta) move lamports here, keeping this instruction
    /// O(1) in the accounts it must transfer regardless of roster size.
    pub fn settle<'info>(ctx: Context<'_, '_, 'info, 'info, Settle<'info>>, counts: Vec<u32>) -> Result<()> {
        let challenge_key = ctx.accounts.challenge.key();
        require!(!ctx.accounts.challenge.settled, StakesError::ChallengeAlreadySettled);
        require!(
            Clock::get()?.unix_timestamp >= ctx.accounts.challenge.deadline_unix,
            StakesError::DeadlineNotReached
        );
        let expected_members = u32::from(ctx.accounts.team_a.member_count)
            .checked_add(u32::from(ctx.accounts.team_b.member_count))
            .ok_or(StakesError::Overflow)?;
        require!(ctx.remaining_accounts.len() as u32 == expected_members, StakesError::MemberCountMismatch);
        require!(counts.len() == ctx.remaining_accounts.len(), StakesError::MemberCountMismatch);

        let team_a_key = ctx.accounts.team_a.key();
        let team_b_key = ctx.accounts.team_b.key();
        let target = ctx.accounts.challenge.target;
        let member_goal = math::team_goal_units(1, target).ok_or(StakesError::Overflow)?;

        let mut seen = Vec::with_capacity(ctx.remaining_accounts.len());
        let mut loaded: Vec<(Account<'info, TeamMember>, u8, u64)> = Vec::with_capacity(ctx.remaining_accounts.len());
        let mut team_a_units: u64 = 0;
        let mut team_b_units: u64 = 0;
        for (info, &completed) in ctx.remaining_accounts.iter().zip(counts.iter()) {
            require!(!seen.contains(info.key), StakesError::DuplicateMember);
            seen.push(*info.key);

            let member: Account<'info, TeamMember> = Account::try_from(info)?;
            require_keys_eq!(member.challenge, challenge_key, StakesError::MemberMismatch);
            let team_index = if member.team == team_a_key {
                0u8
            } else if member.team == team_b_key {
                1u8
            } else {
                return err!(StakesError::MemberMismatch);
            };

            let units = math::capped_workout_units(completed, target).ok_or(StakesError::Overflow)?;
            if team_index == 0 {
                team_a_units = team_a_units.checked_add(units).ok_or(StakesError::Overflow)?;
            } else {
                team_b_units = team_b_units.checked_add(units).ok_or(StakesError::Overflow)?;
            }
            loaded.push((member, team_index, units));
        }

        let team_a_passes = math::team_passes(team_a_units, ctx.accounts.team_a.member_count, target).ok_or(StakesError::Overflow)?;
        let team_b_passes = math::team_passes(team_b_units, ctx.accounts.team_b.member_count, target).ok_or(StakesError::Overflow)?;
        let alpha_bps = ctx.accounts.challenge.alpha_bps;
        let rake_bps = ctx.accounts.challenge.rake_bps;
        let total_staked = ctx.accounts.challenge.total_staked_lamports;

        let pot_delta: i64; // net lamports moved INTO the pot (negative = paid out of it)
        let mut house_cut: u64 = 0;
        let winning_team: u8;

        if team_a_passes && team_b_passes {
            winning_team = NO_WINNER;
            let bonus_pool = math::bonus_pool_lamports(total_staked, ctx.accounts.pot.balance_lamports).ok_or(StakesError::Overflow)?;
            let per_member = if expected_members == 0 { 0 } else { bonus_pool / u64::from(expected_members) };
            let distributed = per_member.checked_mul(u64::from(expected_members)).ok_or(StakesError::Overflow)?;
            for (member, _team_index, units) in loaded.iter_mut() {
                member.counted_units = *units;
                member.payout_lamports = member.stake_lamports.checked_add(per_member).ok_or(StakesError::Overflow)?;
            }
            pot_delta = -i64::try_from(distributed).map_err(|_| StakesError::Overflow)?;
            if distributed > 0 {
                move_lamports(&ctx.accounts.pot.to_account_info(), &ctx.accounts.vault.to_account_info(), distributed)?;
            }
        } else if !team_a_passes && !team_b_passes {
            winning_team = NO_WINNER;
            let mut total_forfeits: u64 = 0;
            for (member, _team_index, units) in loaded.iter_mut() {
                member.counted_units = *units;
                let loss = math::member_loss_lamports(member.stake_lamports, alpha_bps, member_goal, *units).ok_or(StakesError::Overflow)?;
                member.payout_lamports = member.stake_lamports.checked_sub(loss).ok_or(StakesError::Overflow)?;
                total_forfeits = total_forfeits.checked_add(loss).ok_or(StakesError::Overflow)?;
            }
            house_cut = math::house_cut_lamports(rake_bps, total_staked, total_forfeits).ok_or(StakesError::Overflow)?;
            let to_pot = total_forfeits.checked_sub(house_cut).ok_or(StakesError::Overflow)?;
            pot_delta = i64::try_from(to_pot).map_err(|_| StakesError::Overflow)?;
            if house_cut > 0 {
                move_lamports(&ctx.accounts.vault.to_account_info(), &ctx.accounts.treasury.to_account_info(), house_cut)?;
            }
            if to_pot > 0 {
                move_lamports(&ctx.accounts.vault.to_account_info(), &ctx.accounts.pot.to_account_info(), to_pot)?;
            }
        } else {
            winning_team = if team_a_passes { 0 } else { 1 };
            let mut total_forfeits: u64 = 0;
            let mut total_winner_units: u64 = 0;
            for (member, team_index, units) in loaded.iter_mut() {
                member.counted_units = *units;
                if *team_index == winning_team {
                    total_winner_units = total_winner_units.checked_add(*units).ok_or(StakesError::Overflow)?;
                } else {
                    let loss = math::member_loss_lamports(member.stake_lamports, alpha_bps, member_goal, *units).ok_or(StakesError::Overflow)?;
                    member.payout_lamports = member.stake_lamports.checked_sub(loss).ok_or(StakesError::Overflow)?;
                    total_forfeits = total_forfeits.checked_add(loss).ok_or(StakesError::Overflow)?;
                }
            }
            house_cut = math::house_cut_lamports(rake_bps, total_staked, total_forfeits).ok_or(StakesError::Overflow)?;
            let share_pool = total_forfeits.checked_sub(house_cut).ok_or(StakesError::Overflow)?;
            let mut distributed_to_winners: u64 = 0;
            for (member, team_index, units) in loaded.iter_mut() {
                if *team_index == winning_team {
                    let share = math::winner_share_lamports(share_pool, *units, total_winner_units).ok_or(StakesError::Overflow)?;
                    member.payout_lamports = member.stake_lamports.checked_add(share).ok_or(StakesError::Overflow)?;
                    distributed_to_winners = distributed_to_winners.checked_add(share).ok_or(StakesError::Overflow)?;
                }
            }
            let dust = share_pool.checked_sub(distributed_to_winners).ok_or(StakesError::Overflow)?;
            pot_delta = i64::try_from(dust).map_err(|_| StakesError::Overflow)?;
            if house_cut > 0 {
                move_lamports(&ctx.accounts.vault.to_account_info(), &ctx.accounts.treasury.to_account_info(), house_cut)?;
            }
            if dust > 0 {
                move_lamports(&ctx.accounts.vault.to_account_info(), &ctx.accounts.pot.to_account_info(), dust)?;
            }
        }

        if pot_delta > 0 {
            ctx.accounts.pot.balance_lamports =
                ctx.accounts.pot.balance_lamports.checked_add(pot_delta as u64).ok_or(StakesError::Overflow)?;
        } else if pot_delta < 0 {
            ctx.accounts.pot.balance_lamports = ctx
                .accounts
                .pot
                .balance_lamports
                .checked_sub(pot_delta.unsigned_abs())
                .ok_or(StakesError::Overflow)?;
        }

        for (member, _team_index, _units) in loaded.iter_mut() {
            member.exit(&crate::ID)?;
        }

        let challenge = &mut ctx.accounts.challenge;
        challenge.settled = true;
        challenge.winning_team = winning_team;
        let _ = house_cut; // recorded via the treasury transfer above; nothing else reads it
        Ok(())
    }

    /// Pays one already-settled member's recorded outcome. Separate from
    /// `settle` on purpose - moving lamports to every member in a single
    /// instruction doesn't scale with roster size the way this does.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        require!(ctx.accounts.challenge.settled, StakesError::ChallengeNotSettled);
        require!(!ctx.accounts.team_member.claimed, StakesError::AlreadyClaimed);

        let amount = ctx.accounts.team_member.payout_lamports;
        ctx.accounts.team_member.claimed = true;
        if amount > 0 {
            move_lamports(&ctx.accounts.vault.to_account_info(), &ctx.accounts.member_authority.to_account_info(), amount)?;
        }
        Ok(())
    }
}

/// Direct lamport debit/credit between two accounts this program owns -
/// valid without a System Program CPI because both balances are mutated
/// in the same instruction by their own owning program.
fn move_lamports<'info>(from: &AccountInfo<'info>, to: &AccountInfo<'info>, amount: u64) -> Result<()> {
    **from.try_borrow_mut_lamports()? =
        from.lamports().checked_sub(amount).ok_or(StakesError::Overflow)?;
    **to.try_borrow_mut_lamports()? = to.lamports().checked_add(amount).ok_or(StakesError::Overflow)?;
    Ok(())
}

pub const NO_WINNER: u8 = 2;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeArgs {
    pub id: u64,
    pub oracle: Pubkey,
    pub alpha_bps: u16,
    pub rake_bps: u16,
    pub target: u32,
    pub stake_lamports: u64,
    pub deadline_unix: i64,
    pub team_a_name: String,
    pub team_b_name: String,
}

#[derive(Accounts)]
#[instruction(args: InitializeArgs)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(init, payer = creator, space = 8 + Challenge::INIT_SPACE,
        seeds = [b"challenge", creator.key().as_ref(), &args.id.to_le_bytes()], bump)]
    pub challenge: Account<'info, Challenge>,
    #[account(init, payer = creator, space = 8 + Vault::INIT_SPACE,
        seeds = [b"vault", challenge.key().as_ref()], bump)]
    pub vault: Account<'info, Vault>,
    #[account(init, payer = creator, space = 8 + Treasury::INIT_SPACE,
        seeds = [b"treasury", challenge.key().as_ref()], bump)]
    pub treasury: Account<'info, Treasury>,
    #[account(seeds = [b"pot", creator.key().as_ref(), &pot.id.to_le_bytes()],
        bump = pot.bump, has_one = creator)]
    pub pot: Account<'info, Pot>,
    #[account(init, payer = creator, space = 8 + Team::INIT_SPACE,
        seeds = [b"team", challenge.key().as_ref(), &[0u8]], bump)]
    pub team_a: Account<'info, Team>,
    #[account(init, payer = creator, space = 8 + Team::INIT_SPACE,
        seeds = [b"team", challenge.key().as_ref(), &[1u8]], bump)]
    pub team_b: Account<'info, Team>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(group_id: u64)]
pub struct InitializeGroup<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(init, payer = creator, space = 8 + Pot::INIT_SPACE,
        seeds = [b"pot", creator.key().as_ref(), &group_id.to_le_bytes()], bump)]
    pub pot: Account<'info, Pot>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(team_index: u8)]
pub struct JoinTeam<'info> {
    #[account(mut)]
    pub member_authority: Signer<'info>,
    #[account(mut)]
    pub challenge: Account<'info, Challenge>,
    #[account(mut, seeds = [b"vault", challenge.key().as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [b"team", challenge.key().as_ref(), &[team_index]], bump = team.bump)]
    pub team: Account<'info, Team>,
    // Seeds don't include team_index - a member can only ever have one
    // TeamMember per challenge, so joining twice (even onto the other team)
    // is rejected by `init` finding the address already taken.
    #[account(init, payer = member_authority, space = 8 + TeamMember::INIT_SPACE,
        seeds = [b"member", challenge.key().as_ref(), member_authority.key().as_ref()], bump)]
    pub team_member: Account<'info, TeamMember>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    pub oracle: Signer<'info>,
    #[account(mut, has_one = oracle)]
    pub challenge: Account<'info, Challenge>,
    #[account(seeds = [b"team", challenge.key().as_ref(), &[0u8]], bump = team_a.bump)]
    pub team_a: Account<'info, Team>,
    #[account(seeds = [b"team", challenge.key().as_ref(), &[1u8]], bump = team_b.bump)]
    pub team_b: Account<'info, Team>,
    #[account(mut, seeds = [b"vault", challenge.key().as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [b"treasury", challenge.key().as_ref()], bump = treasury.bump)]
    pub treasury: Account<'info, Treasury>,
    #[account(mut, address = challenge.group)]
    pub pot: Account<'info, Pot>,
    // The challenge's full TeamMember roster, one per joined member, in the
    // same order as the `counts` instruction argument.
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub member_authority: Signer<'info>,
    pub challenge: Account<'info, Challenge>,
    #[account(mut, seeds = [b"vault", challenge.key().as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    // Deriving with member_authority's own key as a seed is already proof
    // of ownership - only the real owner's pubkey reconstructs this address.
    #[account(mut, has_one = challenge,
        seeds = [b"member", challenge.key().as_ref(), member_authority.key().as_ref()], bump = team_member.bump)]
    pub team_member: Account<'info, TeamMember>,
}

#[account]
#[derive(InitSpace)]
pub struct Challenge {
    pub creator: Pubkey,
    pub oracle: Pubkey,
    pub group: Pubkey,
    pub id: u64,
    pub alpha_bps: u16,
    pub rake_bps: u16,
    pub target: u32,
    pub stake_lamports: u64,
    pub deadline_unix: i64,
    pub total_staked_lamports: u64,
    // NO_WINNER (2) until settled; otherwise the winning team's index (0/1).
    // Both-teams-pass and both-teams-fail outcomes also leave this at
    // NO_WINNER - "winner" only ever means "the other side forfeited to me".
    pub winning_team: u8,
    pub rules_version: u16,
    pub settled: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub challenge: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Treasury {
    pub challenge: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Pot {
    pub creator: Pubkey,
    pub id: u64,
    // Real lamports backing this always sit in the Pot account itself
    // (rent-exempt minimum aside); this field is the ledger's view of that
    // balance for settlement math, kept in lockstep with actual transfers.
    pub balance_lamports: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Team {
    pub challenge: Pubkey,
    pub index: u8,
    #[max_len(32)]
    pub name: String,
    pub member_count: u16,
    pub bump: u8,
}

impl Team {
    pub const MAX_NAME_LEN: usize = 32;
}

#[account]
#[derive(InitSpace)]
pub struct TeamMember {
    pub challenge: Pubkey,
    pub team: Pubkey,
    pub owner: Pubkey,
    pub stake_lamports: u64,
    // Half-workout units from settle() - see math::capped_workout_units.
    // Zero until settled.
    pub counted_units: u64,
    // Computed at settle(), paid out at claim(). Zero until settled.
    pub payout_lamports: u64,
    pub claimed: bool,
    pub bump: u8,
}

#[error_code]
pub enum StakesError {
    #[msg("Basis points must be between 0 and 10000 inclusive")]
    InvalidBps,
    #[msg("Workout target must be positive")]
    InvalidTarget,
    #[msg("Stake amount must be positive")]
    InvalidStake,
    #[msg("Oracle must be a nonzero public key")]
    InvalidOracle,
    #[msg("Team name exceeds the maximum length")]
    NameTooLong,
    #[msg("Deadline must be in the future")]
    DeadlineInPast,
    #[msg("Team index must be 0 or 1")]
    InvalidTeamIndex,
    #[msg("Challenge has already been settled")]
    ChallengeAlreadySettled,
    #[msg("Challenge's join/deposit deadline has passed")]
    DeadlinePassed,
    #[msg("Challenge's deadline has not been reached yet")]
    DeadlineNotReached,
    #[msg("Number of accounts/counts does not match the challenge's actual roster")]
    MemberCountMismatch,
    #[msg("The same member was included more than once")]
    DuplicateMember,
    #[msg("A provided account is not a member of this challenge")]
    MemberMismatch,
    #[msg("Challenge has not been settled yet")]
    ChallengeNotSettled,
    #[msg("This member has already claimed their payout")]
    AlreadyClaimed,
    #[msg("Arithmetic overflow")]
    Overflow,
}
