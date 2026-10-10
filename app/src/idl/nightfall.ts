/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/nightfall.json`.
 */
export type Nightfall = {
  "address": "Ccu5SMkkNDj2sBE3mpFhWeUGujQg29aQZ2BKS7CRXbDB",
  "metadata": {
    "name": "nightfall",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Real-time battle royale with true fog of war on MagicBlock Private Ephemeral Rollups"
  },
  "instructions": [
    {
      "name": "act",
      "docs": [
        "One action: move / sword / bow in a direction. Remaining accounts: every Vision PDA in",
        "slot order, so every player's fog of war updates in the same transaction."
      ],
      "discriminator": [
        114,
        158,
        229,
        112,
        242,
        50,
        227,
        5
      ],
      "accounts": [
        {
          "name": "arena",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "arena.arena_id",
                "account": "arena"
              }
            ]
          }
        },
        {
          "name": "world",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  111,
                  114,
                  108,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "arena.arena_id",
                "account": "arena"
              }
            ]
          }
        },
        {
          "name": "player",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "action",
          "type": "u8"
        },
        {
          "name": "dir",
          "type": "u8"
        }
      ]
    },
    {
      "name": "claim",
      "docs": [
        "Base layer: the vault pays the whole pot to the last one standing."
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
          "name": "arena",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "arena.arena_id",
                "account": "arena"
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
                "path": "arena.arena_id",
                "account": "arena"
              }
            ]
          }
        },
        {
          "name": "winner",
          "writable": true
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "createArena",
      "docs": [
        "Host opens an arena and takes slot 0. Every PDA is pre-funded with the rent its",
        "ephemeral permission will need once it lives on the TEE."
      ],
      "discriminator": [
        174,
        236,
        45,
        61,
        197,
        215,
        149,
        169
      ],
      "accounts": [
        {
          "name": "arena",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97
                ]
              },
              {
                "kind": "arg",
                "path": "arenaId"
              }
            ]
          }
        },
        {
          "name": "world",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  111,
                  114,
                  108,
                  100
                ]
              },
              {
                "kind": "arg",
                "path": "arenaId"
              }
            ]
          }
        },
        {
          "name": "vision",
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
                "kind": "arg",
                "path": "arenaId"
              }
            ]
          }
        },
        {
          "name": "host",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "arenaId",
          "type": "u64"
        },
        {
          "name": "stake",
          "type": "u64"
        },
        {
          "name": "maxPlayers",
          "type": "u8"
        },
        {
          "name": "name",
          "type": {
            "array": [
              "u8",
              12
            ]
          }
        },
        {
          "name": "skin",
          "type": "u8"
        }
      ]
    },
    {
      "name": "delegatePda",
      "docs": [
        "Hand an arena PDA to the TEE validator."
      ],
      "discriminator": [
        248,
        217,
        193,
        46,
        124,
        191,
        64,
        135
      ],
      "accounts": [
        {
          "name": "bufferPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                172,
                162,
                196,
                129,
                73,
                73,
                40,
                132,
                251,
                32,
                22,
                63,
                46,
                5,
                52,
                241,
                139,
                75,
                75,
                110,
                234,
                88,
                152,
                74,
                31,
                176,
                164,
                24,
                227,
                74,
                111,
                154
              ]
            }
          }
        },
        {
          "name": "delegationRecordPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "pda",
          "writable": true
        },
        {
          "name": "payer",
          "signer": true
        },
        {
          "name": "validator",
          "optional": true
        },
        {
          "name": "ownerProgram",
          "address": "Ccu5SMkkNDj2sBE3mpFhWeUGujQg29aQZ2BKS7CRXbDB"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "accountType",
          "type": {
            "defined": {
              "name": "accountType"
            }
          }
        }
      ]
    },
    {
      "name": "initPermission",
      "docs": [
        "Create the ephemeral permission for a delegated PDA. The program — never the caller —",
        "decides who may read: the Arena is public, the World has no readers at all, and a",
        "Vision is readable only by the wallet that owns that slot."
      ],
      "discriminator": [
        66,
        14,
        153,
        250,
        187,
        36,
        179,
        236
      ],
      "accounts": [
        {
          "name": "permissionedAccount",
          "writable": true
        },
        {
          "name": "permission",
          "writable": true
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "permissionProgram",
          "address": "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
        },
        {
          "name": "ephemeralVault",
          "writable": true,
          "address": "MagicVau1t999999999999999999999999999999999"
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "accountType",
          "type": {
            "defined": {
              "name": "accountType"
            }
          }
        }
      ]
    },
    {
      "name": "joinArena",
      "docs": [
        "Take the next free slot and match the host's stake."
      ],
      "discriminator": [
        135,
        217,
        203,
        200,
        93,
        181,
        131,
        47
      ],
      "accounts": [
        {
          "name": "arena",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "arena.arena_id",
                "account": "arena"
              }
            ]
          }
        },
        {
          "name": "vision",
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
                "path": "arena.arena_id",
                "account": "arena"
              }
            ]
          }
        },
        {
          "name": "player",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "name",
          "type": {
            "array": [
              "u8",
              12
            ]
          }
        },
        {
          "name": "skin",
          "type": "u8"
        }
      ]
    },
    {
      "name": "processUndelegation",
      "discriminator": [
        196,
        28,
        41,
        206,
        48,
        37,
        51,
        167
      ],
      "accounts": [
        {
          "name": "baseAccount",
          "writable": true
        },
        {
          "name": "buffer",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  110,
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  101,
                  45,
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "baseAccount"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                181,
                183,
                0,
                225,
                242,
                87,
                58,
                192,
                204,
                6,
                34,
                1,
                52,
                74,
                207,
                151,
                184,
                53,
                6,
                235,
                140,
                229,
                25,
                152,
                204,
                98,
                126,
                24,
                147,
                128,
                167,
                62
              ]
            }
          }
        },
        {
          "name": "payer",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "accountSeeds",
          "type": {
            "vec": "bytes"
          }
        }
      ]
    },
    {
      "name": "requestSpawn",
      "docs": [
        "Ask MagicBlock's VRF oracle where everyone spawns. The randomness is delivered straight",
        "into the sealed World, so even the oracle's output can't be used to locate a player."
      ],
      "discriminator": [
        244,
        36,
        216,
        74,
        253,
        220,
        154,
        4
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "arena",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "arena.arena_id",
                "account": "arena"
              }
            ]
          }
        },
        {
          "name": "world",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  111,
                  114,
                  108,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "arena.arena_id",
                "account": "arena"
              }
            ]
          }
        },
        {
          "name": "oracleQueue",
          "writable": true
        },
        {
          "name": "programIdentity",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vrfProgram",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "clientSeed",
          "type": "u8"
        }
      ]
    },
    {
      "name": "reveal",
      "docs": [
        "After the last player falls, unseal the World so everyone can see how it played out."
      ],
      "discriminator": [
        9,
        35,
        59,
        190,
        167,
        249,
        76,
        115
      ],
      "accounts": [
        {
          "name": "arena",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "arena.arena_id",
                "account": "arena"
              }
            ]
          }
        },
        {
          "name": "world",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  111,
                  114,
                  108,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "arena.arena_id",
                "account": "arena"
              }
            ]
          }
        },
        {
          "name": "permission",
          "writable": true
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "permissionProgram",
          "address": "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
        },
        {
          "name": "ephemeralVault",
          "writable": true,
          "address": "MagicVau1t999999999999999999999999999999999"
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "scheduleTicks",
      "docs": [
        "Schedule `tick` on the ER's own scheduler so the border closes in even if nobody moves."
      ],
      "discriminator": [
        243,
        206,
        0,
        155,
        207,
        136,
        85,
        251
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "arena",
          "writable": true
        },
        {
          "name": "world",
          "writable": true
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "taskId",
          "type": "i64"
        },
        {
          "name": "intervalMs",
          "type": "i64"
        },
        {
          "name": "iterations",
          "type": "i64"
        }
      ]
    },
    {
      "name": "settle",
      "docs": [
        "Commit the final result to Solana and release the arena from the rollup."
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
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "arena",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "arena.arena_id",
                "account": "arena"
              }
            ]
          }
        },
        {
          "name": "world",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  111,
                  114,
                  108,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "arena.arena_id",
                "account": "arena"
              }
            ]
          }
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "spawnCallback",
      "discriminator": [
        142,
        99,
        143,
        42,
        241,
        38,
        135,
        189
      ],
      "accounts": [
        {
          "name": "vrfProgramIdentity",
          "docs": [
            "Scoped VRF identity PDA, bound to this program. Its presence as a signer proves",
            "the callback was issued by the VRF program for this program."
          ],
          "signer": true
        },
        {
          "name": "arena",
          "writable": true
        },
        {
          "name": "world",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "randomness",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "spawnFallback",
      "docs": [
        "If the oracle hasn't answered, the host can start from entropy mixed inside the TEE."
      ],
      "discriminator": [
        146,
        86,
        4,
        239,
        188,
        62,
        57,
        11
      ],
      "accounts": [
        {
          "name": "arena",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "arena.arena_id",
                "account": "arena"
              }
            ]
          }
        },
        {
          "name": "world",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  111,
                  114,
                  108,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "arena.arena_id",
                "account": "arena"
              }
            ]
          }
        },
        {
          "name": "host",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "tick",
      "docs": [
        "Advance the world border. Permissionless and idempotent; scheduled as a MagicBlock crank."
      ],
      "discriminator": [
        92,
        79,
        44,
        8,
        101,
        80,
        63,
        15
      ],
      "accounts": [
        {
          "name": "arena",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "arena.arena_id",
                "account": "arena"
              }
            ]
          }
        },
        {
          "name": "world",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  111,
                  114,
                  108,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "arena.arena_id",
                "account": "arena"
              }
            ]
          }
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "arena",
      "discriminator": [
        243,
        215,
        44,
        44,
        231,
        211,
        232,
        168
      ]
    },
    {
      "name": "vision",
      "discriminator": [
        59,
        167,
        1,
        52,
        90,
        91,
        80,
        141
      ]
    },
    {
      "name": "world",
      "discriminator": [
        145,
        45,
        170,
        174,
        122,
        32,
        155,
        124
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "notInLobby",
      "msg": "Arena is no longer in the lobby"
    },
    {
      "code": 6001,
      "name": "arenaFull",
      "msg": "Arena is full"
    },
    {
      "code": 6002,
      "name": "alreadyJoined",
      "msg": "Already in this arena"
    },
    {
      "code": 6003,
      "name": "notHost",
      "msg": "Only the host can do that"
    },
    {
      "code": 6004,
      "name": "alreadyStarted",
      "msg": "Match already started"
    },
    {
      "code": 6005,
      "name": "tooEarly",
      "msg": "Wait for the VRF oracle a little longer"
    },
    {
      "code": 6006,
      "name": "notLive",
      "msg": "Match is not live"
    },
    {
      "code": 6007,
      "name": "notAPlayer",
      "msg": "Not a player in this arena"
    },
    {
      "code": 6008,
      "name": "dead",
      "msg": "You are dead"
    },
    {
      "code": 6009,
      "name": "cooldown",
      "msg": "Weapon is cooling down"
    },
    {
      "code": 6010,
      "name": "noArrows",
      "msg": "Out of arrows"
    },
    {
      "code": 6011,
      "name": "badVisionList",
      "msg": "Vision accounts must be passed for every player in slot order"
    },
    {
      "code": 6012,
      "name": "badAccount",
      "msg": "Unexpected account"
    },
    {
      "code": 6013,
      "name": "notEnded",
      "msg": "Match has not ended"
    },
    {
      "code": 6014,
      "name": "noWinner",
      "msg": "No winner recorded"
    },
    {
      "code": 6015,
      "name": "notWinner",
      "msg": "That is not the winner"
    },
    {
      "code": 6016,
      "name": "notSealed",
      "msg": "World and every Vision must be sealed inside the TEE before spawning"
    }
  ],
  "types": [
    {
      "name": "accountType",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "arena",
            "fields": [
              {
                "name": "arenaId",
                "type": "u64"
              }
            ]
          },
          {
            "name": "world",
            "fields": [
              {
                "name": "arenaId",
                "type": "u64"
              }
            ]
          },
          {
            "name": "vision",
            "fields": [
              {
                "name": "arenaId",
                "type": "u64"
              },
              {
                "name": "slot",
                "type": "u8"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "arena",
      "docs": [
        "Public match state. Never contains a position — only what a scoreboard would show."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "arenaId",
            "type": "u64"
          },
          {
            "name": "host",
            "type": "pubkey"
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "maxPlayers",
            "type": "u8"
          },
          {
            "name": "playerCount",
            "type": "u8"
          },
          {
            "name": "stake",
            "type": "u64"
          },
          {
            "name": "players",
            "type": {
              "array": [
                "pubkey",
                6
              ]
            }
          },
          {
            "name": "names",
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    12
                  ]
                },
                6
              ]
            }
          },
          {
            "name": "skins",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "alive",
            "docs": [
              "Bitmask of living players."
            ],
            "type": "u8"
          },
          {
            "name": "kills",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "spawnRequestedTs",
            "type": "i64"
          },
          {
            "name": "startTs",
            "type": "i64"
          },
          {
            "name": "endTs",
            "type": "i64"
          },
          {
            "name": "lastZoneTick",
            "type": "i64"
          },
          {
            "name": "zone",
            "docs": [
              "World-border half-size in tiles (Chebyshev distance from the map centre)."
            ],
            "type": "u8"
          },
          {
            "name": "winner",
            "type": "u8"
          },
          {
            "name": "feed",
            "docs": [
              "Kill feed ring buffer: [killer, victim, cause]. killer = NONE means the border."
            ],
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    3
                  ]
                },
                5
              ]
            }
          },
          {
            "name": "feedSeq",
            "type": "u16"
          },
          {
            "name": "tick",
            "type": "u32"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "vision",
      "docs": [
        "What one player is allowed to know. Readable only by that player's wallet."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "arenaId",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u8"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "version",
            "type": "u32"
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "zone",
            "type": "u8"
          },
          {
            "name": "me",
            "docs": [
              "[x, y, hp, facing, weapon, arrows, alive]"
            ],
            "type": {
              "array": [
                "u8",
                7
              ]
            }
          },
          {
            "name": "hitDir",
            "type": "u8"
          },
          {
            "name": "hitSeq",
            "type": "u8"
          },
          {
            "name": "seenCount",
            "type": "u8"
          },
          {
            "name": "seen",
            "docs": [
              "[slot, x, y, hp, facing, weapon]"
            ],
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    6
                  ]
                },
                5
              ]
            }
          },
          {
            "name": "chestCount",
            "type": "u8"
          },
          {
            "name": "chests",
            "docs": [
              "[x, y, kind]"
            ],
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    3
                  ]
                },
                6
              ]
            }
          },
          {
            "name": "shots",
            "docs": [
              "[shooter, x0, y0, x1, y1, seq]"
            ],
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    6
                  ]
                },
                4
              ]
            }
          },
          {
            "name": "heard",
            "docs": [
              "Hearing: bit k set = an unseen enemy is somewhere in compass octant k (0 = N, clockwise).",
              "A direction, never a position."
            ],
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "world",
      "docs": [
        "The ground truth: every position, every heart. Sealed inside the TEE with no readers."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "arenaId",
            "type": "u64"
          },
          {
            "name": "x",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "y",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "hp",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "facing",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "weapon",
            "docs": [
              "1 wooden sword, 2 diamond sword"
            ],
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "arrows",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "hitDir",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "hitSeq",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "lastAttackSlot",
            "type": {
              "array": [
                "u64",
                6
              ]
            }
          },
          {
            "name": "chests",
            "docs": [
              "[x, y, kind, opened]"
            ],
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    4
                  ]
                },
                6
              ]
            }
          },
          {
            "name": "shots",
            "docs": [
              "[shooter, x0, y0, x1, y1, seq]"
            ],
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    6
                  ]
                },
                4
              ]
            }
          },
          {
            "name": "shotSeq",
            "type": "u8"
          },
          {
            "name": "spawned",
            "type": "bool"
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
