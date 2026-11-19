# Commitment Stakes program

The Anchor (Rust) program behind Moltivate. It escrows each member's stake,
computes every payout from the reported workout counts, and lets members claim.
Devnet only, with test SOL.

**Program ID (devnet):** `DhWeNpUmpxjSXdZ6iN1VCbP1WJVAYg9Yrprtx1LBPDum`

## Instructions

| Instruction | What it does |
| --- | --- |
| `initialize_group` | Creates a creator's persistent group pot (once per creator and group id) |
| `initialize` | Creates a challenge and its two teams with fixed house rules (alpha 20%, rake 3%) |
| `join_team` | Enrolls a wallet in one team and deposits its stake, atomically; one join per wallet |
| `settle` | Oracle-only, after the deadline, once: takes each member's count and computes all payouts |
| `claim` | Pays a member their computed payout, once |

The settlement rules are in the root [readme](../../readme.md#settlement-rules).

## Tests

- **Settlement math:** `programs/commitment-stakes/src/math.rs` has 10 unit
  tests (cap boundaries, odd-target precision, basis-point bounds, rounding,
  maximum inputs). They run in CI (`cargo test`).
- **Instructions:** `tests/commitment-stakes.ts` has 9 tests against a local
  validator: the worked example, both teams failing, both passing, double
  settle, claim before settle, double claim, settle by a non-oracle, settle
  before the deadline, and double join. Run them with `anchor test` on Linux or
  WSL2. They are **not** run in CI.

## Trust

The oracle (which reports counts to `settle`) and the program's upgrade
authority are single keys held by the maintainer. This is not a trustless
system, and the program's rules can change while an upgrade authority exists.

See also the [account contract](docs/account-contract.md). The
[recovery log](docs/recovery.md) is a historical record of how this workspace
was first recovered.
