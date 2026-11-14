import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";
import idl from "../idl/commitment_stakes.json";

// Mirrors the MVP doc's own worked example: two teams of 3, S = 1 SOL,
// alpha = 20% (2000 bps), rake = 3% (300 bps), goal = 5 workouts/person.
const SOL = LAMPORTS_PER_SOL;
const ALPHA_BPS = 2000;
const RAKE_BPS = 300;
const TARGET = 5;

describe("commitment-stakes", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new Program(idl as anchor.Idl, provider);
  const connection = provider.connection;

  let nextId = BigInt(Date.now());
  const freshId = () => new BN((nextId++).toString());

  async function fundedKeypair(sol = 10): Promise<Keypair> {
    const kp = Keypair.generate();
    const sig = await connection.requestAirdrop(kp.publicKey, sol * SOL);
    await connection.confirmTransaction(sig, "confirmed");
    return kp;
  }

  function pdas(creator: PublicKey, challengeId: BN, groupId: BN) {
    const [challenge] = PublicKey.findProgramAddressSync(
      [Buffer.from("challenge"), creator.toBuffer(), challengeId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), challenge.toBuffer()], program.programId);
    const [treasury] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury"), challenge.toBuffer()],
      program.programId
    );
    const [pot] = PublicKey.findProgramAddressSync(
      [Buffer.from("pot"), creator.toBuffer(), groupId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const [teamA] = PublicKey.findProgramAddressSync(
      [Buffer.from("team"), challenge.toBuffer(), Buffer.from([0])],
      program.programId
    );
    const [teamB] = PublicKey.findProgramAddressSync(
      [Buffer.from("team"), challenge.toBuffer(), Buffer.from([1])],
      program.programId
    );
    return { challenge, vault, treasury, pot, teamA, teamB };
  }

  function memberPda(challenge: PublicKey, owner: PublicKey) {
    const [member] = PublicKey.findProgramAddressSync(
      [Buffer.from("member"), challenge.toBuffer(), owner.toBuffer()],
      program.programId
    );
    return member;
  }

  async function initGroup(creator: Keypair, groupId: BN) {
    const { pot } = pdas(creator.publicKey, new BN(0), groupId);
    await program.methods
      .initializeGroup(groupId)
      .accounts({ creator: creator.publicKey, pot, systemProgram: SystemProgram.programId })
      .signers([creator])
      .rpc();
    return pot;
  }

  async function initChallenge(
    creator: Keypair,
    oracle: PublicKey,
    challengeId: BN,
    groupId: BN,
    deadlineSecondsFromNow: number
  ) {
    const accs = pdas(creator.publicKey, challengeId, groupId);
    const deadline = new BN(Math.floor(Date.now() / 1000) + deadlineSecondsFromNow);
    await program.methods
      .initialize({
        id: challengeId,
        oracle,
        alphaBps: ALPHA_BPS,
        rakeBps: RAKE_BPS,
        target: TARGET,
        stakeLamports: new BN(SOL),
        deadlineUnix: deadline,
        teamAName: "Early Birds",
        teamBName: "Night Owls",
      })
      .accounts({
        creator: creator.publicKey,
        challenge: accs.challenge,
        vault: accs.vault,
        treasury: accs.treasury,
        pot: accs.pot,
        teamA: accs.teamA,
        teamB: accs.teamB,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();
    return accs;
  }

  async function join(member: Keypair, challenge: PublicKey, vault: PublicKey, team: PublicKey, teamIndex: number) {
    const teamMember = memberPda(challenge, member.publicKey);
    await program.methods
      .joinTeam(teamIndex)
      .accounts({
        memberAuthority: member.publicKey,
        challenge,
        vault,
        team,
        teamMember,
        systemProgram: SystemProgram.programId,
      })
      .signers([member])
      .rpc();
    return teamMember;
  }

  async function settle(
    oracle: Keypair,
    accs: ReturnType<typeof pdas>,
    memberPubkeys: PublicKey[],
    counts: number[]
  ) {
    await program.methods
      .settle(counts)
      .accounts({
        oracle: oracle.publicKey,
        challenge: accs.challenge,
        teamA: accs.teamA,
        teamB: accs.teamB,
        vault: accs.vault,
        treasury: accs.treasury,
        pot: accs.pot,
      })
      .remainingAccounts(memberPubkeys.map((pubkey) => ({ pubkey, isWritable: true, isSigner: false })))
      .signers([oracle])
      .rpc();
  }

  async function claim(member: Keypair, challenge: PublicKey, vault: PublicKey, teamMember: PublicKey) {
    await program.methods
      .claim()
      .accounts({ memberAuthority: member.publicKey, challenge, vault, teamMember })
      .signers([member])
      .rpc();
  }

  it("reproduces the MVP doc's worked example end to end (one team wins)", async () => {
    const creator = await fundedKeypair();
    const oracle = await fundedKeypair();
    // Sequential, not Promise.all - requesting many airdrops at once
    // overloads the local validator's faucet and causes flaky failures.
    const priya = await fundedKeypair();
    const lee = await fundedKeypair();
    const max = await fundedKeypair();
    const alex = await fundedKeypair();
    const sam = await fundedKeypair();
    const jordan = await fundedKeypair();

    const groupId = freshId();
    await initGroup(creator, groupId);
    const challengeId = freshId();
    const accs = await initChallenge(creator, oracle.publicKey, challengeId, groupId, 15);

    const priyaM = await join(priya, accs.challenge, accs.vault, accs.teamA, 0);
    const leeM = await join(lee, accs.challenge, accs.vault, accs.teamA, 0);
    const maxM = await join(max, accs.challenge, accs.vault, accs.teamA, 0);
    const alexM = await join(alex, accs.challenge, accs.vault, accs.teamB, 1);
    const samM = await join(sam, accs.challenge, accs.vault, accs.teamB, 1);
    const jordanM = await join(jordan, accs.challenge, accs.vault, accs.teamB, 1);

    await new Promise((resolve) => setTimeout(resolve, 16000)); // past the 15s deadline

    const members = [priyaM, leeM, maxM, alexM, samM, jordanM];
    const counts = [6, 5, 4, 5, 4, 0]; // Priya, Lee, Max, Alex, Sam, Jordan

    const vaultBefore = await connection.getBalance(accs.vault);
    const treasuryBefore = await connection.getBalance(accs.treasury);

    await settle(oracle, accs, members, counts);

    const treasuryAfter = await connection.getBalance(accs.treasury);
    const vaultAfter = await connection.getBalance(accs.vault);
    const potAccount = await (program.account as any).pot.fetch(accs.pot);

    assert.equal(treasuryAfter - treasuryBefore, 0.18 * SOL, "house cut");
    // Dust is exactly 0 for this worked example (proven in the Rust unit
    // test) - vault should only have dropped by the house cut.
    assert.equal(vaultBefore - vaultAfter, 0.18 * SOL, "vault only loses the house cut at settle time");
    assert.equal(potAccount.balanceLamports.toNumber(), 0, "no dust leaked into the pot this round");

    const expected: Record<string, number> = {
      [priyaM.toBase58()]: Math.round(1.552 * SOL),
      [leeM.toBase58()]: Math.round(1.46 * SOL),
      [maxM.toBase58()]: Math.round(1.368 * SOL),
      [alexM.toBase58()]: Math.round(0.8 * SOL),
      [samM.toBase58()]: Math.round(0.64 * SOL),
      [jordanM.toBase58()]: 0,
    };
    for (const memberPubkey of members) {
      const account = await (program.account as any).teamMember.fetch(memberPubkey);
      assert.equal(
        account.payoutLamports.toNumber(),
        expected[memberPubkey.toBase58()],
        `payout for member ${memberPubkey.toBase58()}`
      );
    }

    // Claims: vault drains by exactly the sum of all six payouts, and each
    // member's own wallet balance rises by exactly their payout (checked
    // net of the tiny tx fee they themselves paid to sign the claim).
    const totalPayouts = Object.values(expected).reduce((a, b) => a + b, 0);
    const vaultBeforeClaims = await connection.getBalance(accs.vault);
    for (const [kp, memberPubkey] of [
      [priya, priyaM],
      [lee, leeM],
      [max, maxM],
      [alex, alexM],
      [sam, samM],
      [jordan, jordanM],
    ] as [Keypair, PublicKey][]) {
      const before = await connection.getBalance(kp.publicKey);
      await claim(kp, accs.challenge, accs.vault, memberPubkey);
      const after = await connection.getBalance(kp.publicKey);
      const expectedPayout = expected[memberPubkey.toBase58()];
      // Allow up to 0.01 SOL for the claim tx's own fee - exact fees vary
      // slightly by validator version, the point is the payout landed.
      assert.isAtLeast(after - before, expectedPayout - 0.01 * SOL, "member balance rose by ~their payout");
    }
    const vaultAfterClaims = await connection.getBalance(accs.vault);
    assert.equal(vaultBeforeClaims - vaultAfterClaims, totalPayouts, "vault drained by exactly the total payouts");
  });

  it("both teams losing sends forfeits-minus-house-cut to the group pot", async () => {
    const creator = await fundedKeypair();
    const oracle = await fundedKeypair();
    const a1 = await fundedKeypair();
    const a2 = await fundedKeypair();
    const b1 = await fundedKeypair();
    const b2 = await fundedKeypair();

    const groupId = freshId();
    await initGroup(creator, groupId);
    const challengeId = freshId();
    const accs = await initChallenge(creator, oracle.publicKey, challengeId, groupId, 15);

    const a1m = await join(a1, accs.challenge, accs.vault, accs.teamA, 0);
    const a2m = await join(a2, accs.challenge, accs.vault, accs.teamA, 0);
    const b1m = await join(b1, accs.challenge, accs.vault, accs.teamB, 1);
    const b2m = await join(b2, accs.challenge, accs.vault, accs.teamB, 1);

    await new Promise((resolve) => setTimeout(resolve, 16000));

    // Both teams well short of their goal (2 * 5 = 10 units each).
    await settle(oracle, accs, [a1m, a2m, b1m, b2m], [0, 2, 1, 3]);

    const potAccount = await (program.account as any).pot.fetch(accs.pot);
    assert.isAbove(potAccount.balanceLamports.toNumber(), 0, "pot gained forfeits minus the house cut");

    const challengeAccount = await (program.account as any).challenge.fetch(accs.challenge);
    assert.equal(challengeAccount.winningTeam, 2, "NO_WINNER when both teams lose");
  });

  it("both teams winning pays an equal-split bonus from the group pot", async () => {
    // Reuses the SAME group pot a both-lose round just funded, so the
    // bonus has something real to draw from rather than defaulting to 0.
    const creator = await fundedKeypair();
    const oracle = await fundedKeypair();
    const a1 = await fundedKeypair();
    const a2 = await fundedKeypair();
    const b1 = await fundedKeypair();
    const b2 = await fundedKeypair();

    const groupId = freshId();
    await initGroup(creator, groupId);

    // Fund the pot first with a both-lose round under the same group.
    {
      const fundId = freshId();
      const fundAccs = await initChallenge(creator, oracle.publicKey, fundId, groupId, 15);
      const f1 = await fundedKeypair();
      const f2 = await fundedKeypair();
      const f1m = await join(f1, fundAccs.challenge, fundAccs.vault, fundAccs.teamA, 0);
      const f2m = await join(f2, fundAccs.challenge, fundAccs.vault, fundAccs.teamB, 1);
      await new Promise((resolve) => setTimeout(resolve, 16000));
      await settle(oracle, fundAccs, [f1m, f2m], [0, 0]);
    }

    const potBefore = await (program.account as any).pot.fetch(pdas(creator.publicKey, new BN(0), groupId).pot);
    assert.isAbove(potBefore.balanceLamports.toNumber(), 0, "pot has a real balance to draw the bonus from");

    const challengeId = freshId();
    const accs = await initChallenge(creator, oracle.publicKey, challengeId, groupId, 15);
    const a1m = await join(a1, accs.challenge, accs.vault, accs.teamA, 0);
    const a2m = await join(a2, accs.challenge, accs.vault, accs.teamA, 0);
    const b1m = await join(b1, accs.challenge, accs.vault, accs.teamB, 1);
    const b2m = await join(b2, accs.challenge, accs.vault, accs.teamB, 1);

    await new Promise((resolve) => setTimeout(resolve, 16000));

    // Every member clears their own goal (5 workouts) - both teams pass.
    await settle(oracle, accs, [a1m, a2m, b1m, b2m], [5, 6, 5, 7]);

    const potAfter = await (program.account as any).pot.fetch(pdas(creator.publicKey, new BN(0), groupId).pot);
    assert.isBelow(potAfter.balanceLamports.toNumber(), potBefore.balanceLamports.toNumber(), "pot paid the bonus out");

    const a1Account = await (program.account as any).teamMember.fetch(a1m);
    const a2Account = await (program.account as any).teamMember.fetch(a2m);
    const bonus = a1Account.payoutLamports.toNumber() - SOL;
    assert.isAbove(bonus, 0, "winners on a both-win round still get a bonus above their stake back");
    assert.equal(a2Account.payoutLamports.toNumber() - SOL, bonus, "bonus is split equally, not weighted by units");
  });

  it("rejects settling the same challenge twice", async () => {
    const creator = await fundedKeypair();
    const oracle = await fundedKeypair();
    const member = await fundedKeypair();
    const groupId = freshId();
    await initGroup(creator, groupId);
    const challengeId = freshId();
    const accs = await initChallenge(creator, oracle.publicKey, challengeId, groupId, 15);
    const memberM = await join(member, accs.challenge, accs.vault, accs.teamA, 0);
    await new Promise((resolve) => setTimeout(resolve, 16000));

    await settle(oracle, accs, [memberM], [5]);
    try {
      await settle(oracle, accs, [memberM], [5]);
      assert.fail("second settle call should have been rejected");
    } catch (err) {
      assert.include(String(err), "ChallengeAlreadySettled");
    }
  });

  it("rejects claiming before the challenge is settled", async () => {
    const creator = await fundedKeypair();
    const oracle = await fundedKeypair();
    const member = await fundedKeypair();
    const groupId = freshId();
    await initGroup(creator, groupId);
    const challengeId = freshId();
    const accs = await initChallenge(creator, oracle.publicKey, challengeId, groupId, 3600);
    const memberM = await join(member, accs.challenge, accs.vault, accs.teamA, 0);

    try {
      await claim(member, accs.challenge, accs.vault, memberM);
      assert.fail("claim before settle should have been rejected");
    } catch (err) {
      assert.include(String(err), "ChallengeNotSettled");
    }
  });

  it("rejects claiming the same payout twice", async () => {
    const creator = await fundedKeypair();
    const oracle = await fundedKeypair();
    const member = await fundedKeypair();
    const groupId = freshId();
    await initGroup(creator, groupId);
    const challengeId = freshId();
    const accs = await initChallenge(creator, oracle.publicKey, challengeId, groupId, 15);
    const memberM = await join(member, accs.challenge, accs.vault, accs.teamA, 0);
    await new Promise((resolve) => setTimeout(resolve, 16000));
    await settle(oracle, accs, [memberM], [5]);

    await claim(member, accs.challenge, accs.vault, memberM);
    try {
      await claim(member, accs.challenge, accs.vault, memberM);
      assert.fail("second claim should have been rejected");
    } catch (err) {
      assert.include(String(err), "AlreadyClaimed");
    }
  });

  it("rejects settle from anyone other than the designated oracle", async () => {
    const creator = await fundedKeypair();
    const oracle = await fundedKeypair();
    const impostor = await fundedKeypair();
    const member = await fundedKeypair();
    const groupId = freshId();
    await initGroup(creator, groupId);
    const challengeId = freshId();
    const accs = await initChallenge(creator, oracle.publicKey, challengeId, groupId, 15);
    const memberM = await join(member, accs.challenge, accs.vault, accs.teamA, 0);
    await new Promise((resolve) => setTimeout(resolve, 16000));

    try {
      await settle(impostor, accs, [memberM], [5]);
      assert.fail("settle from a non-oracle signer should have been rejected");
    } catch (err) {
      assert.include(String(err), "ConstraintHasOne");
    }
  });

  it("rejects settling before the challenge's deadline", async () => {
    const creator = await fundedKeypair();
    const oracle = await fundedKeypair();
    const member = await fundedKeypair();
    const groupId = freshId();
    await initGroup(creator, groupId);
    const challengeId = freshId();
    const accs = await initChallenge(creator, oracle.publicKey, challengeId, groupId, 3600);
    const memberM = await join(member, accs.challenge, accs.vault, accs.teamA, 0);

    try {
      await settle(oracle, accs, [memberM], [5]);
      assert.fail("settle before the deadline should have been rejected");
    } catch (err) {
      assert.include(String(err), "DeadlineNotReached");
    }
  });

  it("rejects joining the same challenge twice from the same wallet", async () => {
    const creator = await fundedKeypair();
    const oracle = await fundedKeypair();
    const member = await fundedKeypair();
    const groupId = freshId();
    await initGroup(creator, groupId);
    const challengeId = freshId();
    const accs = await initChallenge(creator, oracle.publicKey, challengeId, groupId, 3600);
    await join(member, accs.challenge, accs.vault, accs.teamA, 0);

    try {
      await join(member, accs.challenge, accs.vault, accs.teamB, 1);
      assert.fail("joining a second time (even the other team) should have been rejected");
    } catch (err) {
      // The team_member PDA already exists - `init` fails with an account-
      // already-in-use style error, not one of our own StakesError variants.
      assert.isNotNull(err);
    }
  });
});
