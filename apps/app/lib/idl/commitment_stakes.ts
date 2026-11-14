/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/commitment_stakes.json`.
 */
export type CommitmentStakes = {
  "address": "DhWeNpUmpxjSXdZ6iN1VCbP1WJVAYg9Yrprtx1LBPDum",
  "metadata": {
    "name": "commitmentStakes",
    "version": "0.1.0",
    "spec": "0.1.0"
  },
  "instructions": [
    {
      "name": "claim",
      "docs": [
        "Pays one already-settled member's recorded outcome. Separate from",
        "`settle` on purpose - moving lamports to every member in a single",
        "instruction doesn't scale with roster size the way this does."
      ],
      "discriminator": [
        62,
        198,
        214,
        193,
        213,
        159,
        108,
        210
      ],
      "accounts": [
        {
          "name": "memberAuthority",
          "writable": true,
          "signer": true
        },
        {
          "name": "challenge",
          "relations": [
            "teamMember"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "challenge"
              }
            ]
          }
        },
        {
          "name": "teamMember",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  109,
                  98,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "challenge"
              },
              {
                "kind": "account",
                "path": "memberAuthority"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "initialize",
      "docs": [
        "Creates the challenge and both of its teams atomically - a challenge",
        "can never exist with zero, one, or more than two teams."
      ],
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true,
          "relations": [
            "pot"
          ]
        },
        {
          "name": "challenge",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  104,
                  97,
                  108,
                  108,
                  101,
                  110,
                  103,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "arg",
                "path": "args.id"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "challenge"
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "challenge"
              }
            ]
          }
        },
        {
          "name": "pot",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "account",
                "path": "pot.id",
                "account": "pot"
              }
            ]
          }
        },
        {
          "name": "teamA",
          "writable": true
        },
        {
          "name": "teamB",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "initializeArgs"
            }
          }
        }
      ]
    },
    {
      "name": "initializeGroup",
      "docs": [
        "A separate group pot can be shared by later challenges of this creator."
      ],
      "discriminator": [
        191,
        73,
        34,
        229,
        233,
        213,
        189,
        173
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "pot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "arg",
                "path": "groupId"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "groupId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "joinTeam",
      "docs": [
        "Joins one of the challenge's two teams and deposits the fixed stake",
        "straight into the program-owned vault - money never passes through",
        "any off-chain hop."
      ],
      "discriminator": [
        244,
        30,
        215,
        53,
        96,
        145,
        4,
        206
      ],
      "accounts": [
        {
          "name": "memberAuthority",
          "writable": true,
          "signer": true
        },
        {
          "name": "challenge",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "challenge"
              }
            ]
          }
        },
        {
          "name": "team",
          "writable": true
        },
        {
          "name": "teamMember",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  109,
                  98,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "challenge"
              },
              {
                "kind": "account",
                "path": "memberAuthority"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "teamIndex",
          "type": "u8"
        }
      ]
    },
    {
      "name": "settle",
      "docs": [
        "Oracle-reported final counts, one call, once. Computes every",
        "member's payout and the aggregate house/pot flows; does not pay",
        "individual members out (see `claim`) - only the fixed-size flows",
        "(house cut, pot delta) move lamports here, keeping this instruction",
        "O(1) in the accounts it must transfer regardless of roster size."
      ],
      "discriminator": [
        175,
        42,
        185,
        87,
        144,
        131,
        102,
        212
      ],
      "accounts": [
        {
          "name": "oracle",
          "signer": true,
          "relations": [
            "challenge"
          ]
        },
        {
          "name": "challenge",
          "writable": true
        },
        {
          "name": "teamA"
        },
        {
          "name": "teamB"
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "challenge"
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "challenge"
              }
            ]
          }
        },
        {
          "name": "pot",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "counts",
          "type": {
            "vec": "u32"
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "challenge",
      "discriminator": [
        119,
        250,
        161,
        121,
        119,
        81,
        22,
        208
      ]
    },
    {
      "name": "pot",
      "discriminator": [
        238,
        118,
        60,
        175,
        178,
        191,
        59,
        58
      ]
    },
    {
      "name": "team",
      "discriminator": [
        140,
        218,
        177,
        140,
        193,
        241,
        199,
        106
      ]
    },
    {
      "name": "teamMember",
      "discriminator": [
        45,
        32,
        135,
        109,
        75,
        252,
        204,
        244
      ]
    },
    {
      "name": "treasury",
      "discriminator": [
        238,
        239,
        123,
        238,
        89,
        1,
        168,
        253
      ]
    },
    {
      "name": "vault",
      "discriminator": [
        211,
        8,
        232,
        43,
        2,
        152,
        117,
        119
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidBps",
      "msg": "Basis points must be between 0 and 10000 inclusive"
    },
    {
      "code": 6001,
      "name": "invalidTarget",
      "msg": "Workout target must be positive"
    },
    {
      "code": 6002,
      "name": "invalidStake",
      "msg": "Stake amount must be positive"
    },
    {
      "code": 6003,
      "name": "invalidOracle",
      "msg": "Oracle must be a nonzero public key"
    },
    {
      "code": 6004,
      "name": "nameTooLong",
      "msg": "Team name exceeds the maximum length"
    },
    {
      "code": 6005,
      "name": "deadlineInPast",
      "msg": "Deadline must be in the future"
    },
    {
      "code": 6006,
      "name": "invalidTeamIndex",
      "msg": "Team index must be 0 or 1"
    },
    {
      "code": 6007,
      "name": "challengeAlreadySettled",
      "msg": "Challenge has already been settled"
    },
    {
      "code": 6008,
      "name": "deadlinePassed",
      "msg": "Challenge's join/deposit deadline has passed"
    },
    {
      "code": 6009,
      "name": "deadlineNotReached",
      "msg": "Challenge's deadline has not been reached yet"
    },
    {
      "code": 6010,
      "name": "memberCountMismatch",
      "msg": "Number of accounts/counts does not match the challenge's actual roster"
    },
    {
      "code": 6011,
      "name": "duplicateMember",
      "msg": "The same member was included more than once"
    },
    {
      "code": 6012,
      "name": "memberMismatch",
      "msg": "A provided account is not a member of this challenge"
    },
    {
      "code": 6013,
      "name": "challengeNotSettled",
      "msg": "Challenge has not been settled yet"
    },
    {
      "code": 6014,
      "name": "alreadyClaimed",
      "msg": "This member has already claimed their payout"
    },
    {
      "code": 6015,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    }
  ],
  "types": [
    {
      "name": "challenge",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "oracle",
            "type": "pubkey"
          },
          {
            "name": "group",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "alphaBps",
            "type": "u16"
          },
          {
            "name": "rakeBps",
            "type": "u16"
          },
          {
            "name": "target",
            "type": "u32"
          },
          {
            "name": "stakeLamports",
            "type": "u64"
          },
          {
            "name": "deadlineUnix",
            "type": "i64"
          },
          {
            "name": "totalStakedLamports",
            "type": "u64"
          },
          {
            "name": "winningTeam",
            "type": "u8"
          },
          {
            "name": "rulesVersion",
            "type": "u16"
          },
          {
            "name": "settled",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "initializeArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "oracle",
            "type": "pubkey"
          },
          {
            "name": "alphaBps",
            "type": "u16"
          },
          {
            "name": "rakeBps",
            "type": "u16"
          },
          {
            "name": "target",
            "type": "u32"
          },
          {
            "name": "stakeLamports",
            "type": "u64"
          },
          {
            "name": "deadlineUnix",
            "type": "i64"
          },
          {
            "name": "teamAName",
            "type": "string"
          },
          {
            "name": "teamBName",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "pot",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "balanceLamports",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "team",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "challenge",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u8"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "memberCount",
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "teamMember",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "challenge",
            "type": "pubkey"
          },
          {
            "name": "team",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "stakeLamports",
            "type": "u64"
          },
          {
            "name": "countedUnits",
            "type": "u64"
          },
          {
            "name": "payoutLamports",
            "type": "u64"
          },
          {
            "name": "claimed",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "treasury",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "challenge",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "vault",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "challenge",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
