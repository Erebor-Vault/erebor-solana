/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/my_project.json`.
 */
export type MyProject = {
  "address": "B7EUo8ipi5xNuTtjbrG6enXymac1bD4b6NijYAEFB45z",
  "metadata": {
    "name": "myProject",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "addAllowedAction",
      "discriminator": [
        3,
        85,
        56,
        106,
        26,
        200,
        135,
        38
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "vaultState",
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
                "path": "vault_state.token_mint",
                "account": "vaultState"
              },
              {
                "kind": "account",
                "path": "vault_state.vault_id",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "strategy",
          "writable": true
        },
        {
          "name": "allowedAction",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  108,
                  108,
                  111,
                  119,
                  101,
                  100,
                  95,
                  97,
                  99,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "strategy"
              },
              {
                "kind": "account",
                "path": "strategy.action_count",
                "account": "strategyAllocation"
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
          "name": "targetProgram",
          "type": "pubkey"
        },
        {
          "name": "discriminator",
          "type": {
            "array": [
              "u8",
              8
            ]
          }
        }
      ]
    },
    {
      "name": "allocateToStrategy",
      "discriminator": [
        167,
        33,
        255,
        61,
        211,
        127,
        50,
        201
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "vaultState",
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
                "path": "vault_state.token_mint",
                "account": "vaultState"
              },
              {
                "kind": "account",
                "path": "vault_state.vault_id",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "strategy",
          "writable": true
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "reserveAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vaultState"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "strategyTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createStrategy",
      "discriminator": [
        152,
        160,
        107,
        148,
        245,
        190,
        127,
        224
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "vaultState",
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
                "path": "vault_state.token_mint",
                "account": "vaultState"
              },
              {
                "kind": "account",
                "path": "vault_state.vault_id",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "strategy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  114,
                  97,
                  116,
                  101,
                  103,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vaultState"
              },
              {
                "kind": "account",
                "path": "vault_state.strategy_count",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "strategyTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  114,
                  97,
                  116,
                  101,
                  103,
                  121,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "vaultState"
              },
              {
                "kind": "account",
                "path": "vault_state.strategy_count",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "delegate"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "deactivateStrategy",
      "discriminator": [
        170,
        186,
        42,
        64,
        235,
        220,
        95,
        138
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "vaultState",
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
                "path": "vault_state.token_mint",
                "account": "vaultState"
              },
              {
                "kind": "account",
                "path": "vault_state.vault_id",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "strategy",
          "writable": true
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "strategyTokenAccount",
          "writable": true
        },
        {
          "name": "reserveAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vaultState"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "deallocateFromStrategy",
      "discriminator": [
        53,
        79,
        217,
        44,
        2,
        140,
        246,
        244
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "vaultState",
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
                "path": "vault_state.token_mint",
                "account": "vaultState"
              },
              {
                "kind": "account",
                "path": "vault_state.vault_id",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "strategy",
          "writable": true
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "reserveAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vaultState"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "strategyTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "deposit",
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "vaultState",
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
                "path": "vault_state.token_mint",
                "account": "vaultState"
              },
              {
                "kind": "account",
                "path": "vault_state.vault_id",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "shareMint",
          "writable": true
        },
        {
          "name": "userTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "reserveAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vaultState"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "userShareToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "shareMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "executeStrategyAction",
      "discriminator": [
        253,
        178,
        172,
        207,
        109,
        222,
        59,
        223
      ],
      "accounts": [
        {
          "name": "caller",
          "docs": [
            "The caller — must be either the strategy's delegate or the vault's authority."
          ],
          "signer": true
        },
        {
          "name": "vaultState",
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
                "path": "vault_state.token_mint",
                "account": "vaultState"
              },
              {
                "kind": "account",
                "path": "vault_state.vault_id",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "strategy",
          "writable": true
        },
        {
          "name": "allowedAction"
        },
        {
          "name": "targetProgram"
        }
      ],
      "args": [
        {
          "name": "instructionData",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "initializeVault",
      "discriminator": [
        48,
        191,
        163,
        44,
        71,
        129,
        63,
        164
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "vaultState",
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
                "path": "tokenMint"
              },
              {
                "kind": "arg",
                "path": "vaultId"
              }
            ]
          }
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "shareMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  104,
                  97,
                  114,
                  101,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "vaultState"
              }
            ]
          }
        },
        {
          "name": "reserveAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vaultState"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        }
      ],
      "args": [
        {
          "name": "vaultId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "migrateStrategy",
      "discriminator": [
        188,
        181,
        251,
        24,
        6,
        65,
        160,
        157
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "vaultState",
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
                "path": "vault_state.token_mint",
                "account": "vaultState"
              },
              {
                "kind": "account",
                "path": "vault_state.vault_id",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "strategy",
          "writable": true
        },
        {
          "name": "strategyTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "rebalanceStrategy",
      "discriminator": [
        30,
        155,
        42,
        104,
        11,
        207,
        14,
        117
      ],
      "accounts": [
        {
          "name": "payer",
          "signer": true
        },
        {
          "name": "vaultState",
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
                "path": "vault_state.token_mint",
                "account": "vaultState"
              },
              {
                "kind": "account",
                "path": "vault_state.vault_id",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "strategy",
          "writable": true
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "reserveAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vaultState"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "strategyTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "removeAllowedAction",
      "discriminator": [
        241,
        128,
        231,
        244,
        121,
        179,
        157,
        26
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "vaultState",
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
                "path": "vault_state.token_mint",
                "account": "vaultState"
              },
              {
                "kind": "account",
                "path": "vault_state.vault_id",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "strategy"
        },
        {
          "name": "allowedAction",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  108,
                  108,
                  111,
                  119,
                  101,
                  100,
                  95,
                  97,
                  99,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "strategy"
              },
              {
                "kind": "account",
                "path": "allowed_action.action_id",
                "account": "allowedAction"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "reportYield",
      "discriminator": [
        151,
        68,
        246,
        135,
        121,
        226,
        232,
        146
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "vaultState",
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
                "path": "vault_state.token_mint",
                "account": "vaultState"
              },
              {
                "kind": "account",
                "path": "vault_state.vault_id",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "strategy",
          "writable": true
        },
        {
          "name": "strategyTokenAccount"
        }
      ],
      "args": []
    },
    {
      "name": "setAuthority",
      "discriminator": [
        133,
        250,
        37,
        21,
        110,
        163,
        26,
        121
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "vaultState",
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
                "path": "vault_state.token_mint",
                "account": "vaultState"
              },
              {
                "kind": "account",
                "path": "vault_state.vault_id",
                "account": "vaultState"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newAuthority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "setStrategyWeight",
      "discriminator": [
        188,
        231,
        7,
        116,
        100,
        202,
        214,
        222
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "vaultState",
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
                "path": "vault_state.token_mint",
                "account": "vaultState"
              },
              {
                "kind": "account",
                "path": "vault_state.vault_id",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "strategy",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "weightBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "transferAdmin",
      "discriminator": [
        42,
        242,
        66,
        106,
        228,
        10,
        111,
        156
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "vaultState",
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
                "path": "vault_state.token_mint",
                "account": "vaultState"
              },
              {
                "kind": "account",
                "path": "vault_state.vault_id",
                "account": "vaultState"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newAdmin",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "updateStrategyDelegate",
      "discriminator": [
        98,
        124,
        149,
        237,
        96,
        72,
        42,
        247
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "vaultState",
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
                "path": "vault_state.token_mint",
                "account": "vaultState"
              },
              {
                "kind": "account",
                "path": "vault_state.vault_id",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "strategy",
          "writable": true
        },
        {
          "name": "newDelegate"
        }
      ],
      "args": []
    },
    {
      "name": "withdraw",
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "vaultState",
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
                "path": "vault_state.token_mint",
                "account": "vaultState"
              },
              {
                "kind": "account",
                "path": "vault_state.vault_id",
                "account": "vaultState"
              }
            ]
          }
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "shareMint",
          "writable": true
        },
        {
          "name": "userTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "reserveAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vaultState"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "userShareToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "shareMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "sharesToBurn",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "allowedAction",
      "discriminator": [
        9,
        21,
        14,
        155,
        239,
        201,
        5,
        93
      ]
    },
    {
      "name": "strategyAllocation",
      "discriminator": [
        74,
        22,
        11,
        227,
        76,
        240,
        142,
        117
      ]
    },
    {
      "name": "vaultState",
      "discriminator": [
        228,
        196,
        82,
        165,
        98,
        210,
        235,
        152
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "insufficientBalance",
      "msg": "Insufficient balance in source account"
    },
    {
      "code": 6001,
      "name": "insufficientReserve",
      "msg": "Insufficient reserve for withdrawal"
    },
    {
      "code": 6002,
      "name": "strategyInactive",
      "msg": "Strategy is not active"
    },
    {
      "code": 6003,
      "name": "unauthorizedAdmin",
      "msg": "Unauthorized: not admin"
    },
    {
      "code": 6004,
      "name": "unauthorizedAuthority",
      "msg": "Unauthorized: not authority"
    },
    {
      "code": 6005,
      "name": "invalidMint",
      "msg": "Invalid token mint"
    },
    {
      "code": 6006,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6007,
      "name": "weightExceedsMax",
      "msg": "Weight exceeds maximum of 10000 basis points"
    },
    {
      "code": 6008,
      "name": "insufficientReserveForRebalance",
      "msg": "Insufficient reserve for rebalance allocation"
    },
    {
      "code": 6009,
      "name": "unauthorizedCaller",
      "msg": "Unauthorized: not delegate or authority"
    },
    {
      "code": 6010,
      "name": "actionNotAllowed",
      "msg": "Action is not in the allowed list for this strategy"
    },
    {
      "code": 6011,
      "name": "actionNotActive",
      "msg": "Action is not active"
    },
    {
      "code": 6012,
      "name": "invalidStrategy",
      "msg": "Invalid strategy reference"
    },
    {
      "code": 6013,
      "name": "invalidInstructionData",
      "msg": "Instruction data too short or invalid"
    },
    {
      "code": 6014,
      "name": "unauthorizedDestination",
      "msg": "Writable token account belongs to caller — funds must flow to vault-owned accounts"
    },
    {
      "code": 6015,
      "name": "invalidPositionAccount",
      "msg": "Invalid protocol position account"
    }
  ],
  "types": [
    {
      "name": "allowedAction",
      "docs": [
        "AllowedAction — a whitelisted (program, instruction) pair for a strategy.",
        "",
        "Seeds: [\"allowed_action\", strategy.key(), &action_id.to_le_bytes()]",
        "Each strategy has its own independent whitelist of allowed actions.",
        "The delegate (or authority) can only execute CPI calls that match an active AllowedAction."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "strategy",
            "docs": [
              "Back-reference to the StrategyAllocation this action belongs to."
            ],
            "type": "pubkey"
          },
          {
            "name": "targetProgram",
            "docs": [
              "The external program to CPI into (e.g. Lulo, Kamino, Drift)."
            ],
            "type": "pubkey"
          },
          {
            "name": "discriminator",
            "docs": [
              "Anchor instruction discriminator (first 8 bytes of instruction data)."
            ],
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          },
          {
            "name": "actionId",
            "docs": [
              "Sequential ID within the strategy."
            ],
            "type": "u16"
          },
          {
            "name": "isActive",
            "docs": [
              "Whether this action is active. Can be deactivated without closing."
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "strategyAllocation",
      "docs": [
        "StrategyAllocation — metadata for a single strategy.",
        "",
        "Seeds: [\"strategy\", vault_state.key(), &strategy_id.to_le_bytes()]",
        "Each strategy = one \"pocket\" where the vault can delegate tokens to an external protocol."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "docs": [
              "Back-reference to the VaultState this strategy belongs to."
            ],
            "type": "pubkey"
          },
          {
            "name": "strategyId",
            "docs": [
              "Unique sequential ID (0, 1, 2, ...). Part of the PDA seeds."
            ],
            "type": "u64"
          },
          {
            "name": "delegate",
            "docs": [
              "The external protocol address approved as delegate on this strategy's token account."
            ],
            "type": "pubkey"
          },
          {
            "name": "allocatedAmount",
            "docs": [
              "How many tokens are currently allocated to this strategy."
            ],
            "type": "u64"
          },
          {
            "name": "tokenAccount",
            "docs": [
              "The PDA token account holding this strategy's tokens."
            ],
            "type": "pubkey"
          },
          {
            "name": "isActive",
            "docs": [
              "Whether this strategy is active. Once deactivated, it's permanent."
            ],
            "type": "bool"
          },
          {
            "name": "targetWeightBps",
            "docs": [
              "Target allocation weight in basis points (0-10000)."
            ],
            "type": "u16"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump."
            ],
            "type": "u8"
          },
          {
            "name": "actionCount",
            "docs": [
              "Count of AllowedAction PDAs for this strategy."
            ],
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "vaultState",
      "docs": [
        "VaultState — the main configuration account for a vault.",
        "",
        "Seeds: [\"vault\", token_mint.key(), vault_id]",
        "Multiple vaults can exist per token type using different vault_id values."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "docs": [
              "The admin — can create/deactivate strategies and change delegates."
            ],
            "type": "pubkey"
          },
          {
            "name": "authority",
            "docs": [
              "The operational authority — can allocate/deallocate funds between reserve and strategies."
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenMint",
            "docs": [
              "The accepted deposit token mint (e.g. USDC)."
            ],
            "type": "pubkey"
          },
          {
            "name": "shareMint",
            "docs": [
              "The vault's share token mint (created as a PDA during initialize_vault)."
            ],
            "type": "pubkey"
          },
          {
            "name": "vaultId",
            "docs": [
              "Unique vault ID — allows multiple vaults for the same token mint."
            ],
            "type": "u64"
          },
          {
            "name": "totalDeposited",
            "docs": [
              "Total underlying tokens in the vault (reserve + all strategies)."
            ],
            "type": "u64"
          },
          {
            "name": "strategyCount",
            "docs": [
              "Auto-incrementing strategy ID counter (0, 1, 2, ...)."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump."
            ],
            "type": "u8"
          },
          {
            "name": "shareMintBump",
            "docs": [
              "PDA bump for the share_mint account."
            ],
            "type": "u8"
          }
        ]
      }
    }
  ]
};
