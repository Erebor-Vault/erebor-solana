/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/my_project.json`.
 */
export type MyProject = {
  "address": "FuAJhyS6ZB9RbVEoeUVhezbWQz7g7k71QqVD6TWFYEDo",
  "metadata": {
    "name": "myProject",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "acceptAdmin",
      "discriminator": [
        112,
        42,
        45,
        90,
        116,
        181,
        13,
        170
      ],
      "accounts": [
        {
          "name": "newAdmin",
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
      "args": []
    },
    {
      "name": "acceptAuthority",
      "discriminator": [
        107,
        86,
        198,
        91,
        33,
        12,
        107,
        160
      ],
      "accounts": [
        {
          "name": "newAuthority",
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
      "args": []
    },
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
                "kind": "arg",
                "path": "strategyId"
              }
            ]
          }
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
                "kind": "arg",
                "path": "targetProgram"
              },
              {
                "kind": "arg",
                "path": "discriminator"
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
          "name": "strategyId",
          "type": "u64"
        },
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
        },
        {
          "name": "expectedRecipientIndex",
          "type": "u16"
        },
        {
          "name": "outputMintIndex",
          "type": {
            "option": "u16"
          }
        },
        {
          "name": "lossPerCallBpsCap",
          "type": "u16"
        },
        {
          "name": "cooldownSecs",
          "type": "u32"
        }
      ]
    },
    {
      "name": "addAllowedToken",
      "discriminator": [
        251,
        246,
        10,
        17,
        107,
        5,
        197,
        69
      ],
      "accounts": [
        {
          "name": "governance",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocolConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "allowedToken",
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
                  116,
                  111,
                  107,
                  101,
                  110
                ]
              },
              {
                "kind": "arg",
                "path": "mint"
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
          "name": "mint",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "addValueSource",
      "docs": [
        "Admin-only. Registers a `ValueSource` slot for a strategy. `kind`",
        "0 = SplAtaBalance (read u64 at offset 64..72 of `target_account`);",
        "1 = AccountU64 (read u64 at `offset..offset+8`). The raw read is",
        "scaled by `scale_num/scale_den` to convert into underlying-token",
        "units (e.g. cToken → underlying via the protocol's exchange rate)."
      ],
      "discriminator": [
        129,
        233,
        79,
        215,
        94,
        55,
        20,
        191
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
                "kind": "arg",
                "path": "strategyId"
              }
            ]
          }
        },
        {
          "name": "valueSource",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "strategyId",
          "type": "u64"
        },
        {
          "name": "index",
          "type": "u8"
        },
        {
          "name": "kind",
          "type": "u8"
        },
        {
          "name": "targetAccount",
          "type": "pubkey"
        },
        {
          "name": "offset",
          "type": "u32"
        },
        {
          "name": "scaleNum",
          "type": "u64"
        },
        {
          "name": "scaleDen",
          "type": "u64"
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
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
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
                "path": "vaultAuthority"
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
      "name": "clearAutoActionConfig",
      "docs": [
        "Admin-only. Closes the AutoActionConfig PDA, returning rent to the",
        "admin. Call before re-issuing `set_auto_action_config` for the",
        "same `(strategy, kind)` to update the recorded intent."
      ],
      "discriminator": [
        180,
        224,
        220,
        250,
        58,
        71,
        222,
        231
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
                "kind": "arg",
                "path": "strategyId"
              }
            ]
          }
        },
        {
          "name": "autoActionConfig",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "strategyId",
          "type": "u64"
        },
        {
          "name": "kind",
          "type": "u8"
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
          "name": "strategyAuthority",
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
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
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
          "name": "strategyAuthority",
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
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vaultState"
              },
              {
                "kind": "account",
                "path": "strategy.strategy_id",
                "account": "strategyAllocation"
              }
            ]
          }
        },
        {
          "name": "tokenMint"
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
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
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
          "name": "strategy",
          "writable": true
        },
        {
          "name": "strategyAuthority",
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
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vaultState"
              },
              {
                "kind": "account",
                "path": "strategy.strategy_id",
                "account": "strategyAllocation"
              }
            ]
          }
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
                "path": "vaultAuthority"
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
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
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
                "path": "vaultAuthority"
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
      "name": "executeAction",
      "discriminator": [
        246,
        137,
        105,
        113,
        247,
        6,
        223,
        174
      ],
      "accounts": [
        {
          "name": "caller",
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
                "kind": "arg",
                "path": "strategyId"
              }
            ]
          }
        },
        {
          "name": "strategyAuthority",
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
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vaultState"
              },
              {
                "kind": "arg",
                "path": "strategyId"
              }
            ]
          }
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
                "kind": "arg",
                "path": "targetProgram"
              },
              {
                "kind": "arg",
                "path": "discriminator"
              }
            ]
          }
        },
        {
          "name": "callerTokenAta",
          "docs": [
            "Caller's wallet ATA — anti-theft snapshot point."
          ],
          "writable": true
        },
        {
          "name": "delegateTokenAta",
          "docs": [
            "Delegate's wallet ATA — also snapshotted (audit #30 revised). When the",
            "authority is the caller this catches \"authority routes funds to the",
            "agent\" attacks; when caller == delegate, both ATAs point to the same",
            "account and the second check is redundant but safe."
          ],
          "writable": true
        },
        {
          "name": "targetProgramAccount"
        },
        {
          "name": "allowedOutputToken",
          "docs": [
            "be the `[\"allowed_token\", remaining_accounts[index].key()]` PDA",
            "owned by this program. When `None`, the account is unused. Caller",
            "passes any account (e.g. SystemProgram::id) as a placeholder."
          ]
        },
        {
          "name": "instructionsSysvar",
          "docs": [
            "introspection to ensure no other instruction in the same",
            "transaction touches the strategy ATA."
          ],
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "strategyId",
          "type": "u64"
        },
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
        },
        {
          "name": "ixData",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "initializeProtocolConfig",
      "discriminator": [
        28,
        50,
        43,
        233,
        244,
        98,
        123,
        118
      ],
      "accounts": [
        {
          "name": "governance",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocolConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
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
          "name": "treasury",
          "type": "pubkey"
        },
        {
          "name": "protocolFeeBps",
          "type": "u16"
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
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
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
                "path": "vaultAuthority"
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
      "name": "proposeAdmin",
      "discriminator": [
        121,
        214,
        199,
        212,
        87,
        39,
        117,
        234
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
      "name": "proposeAuthority",
      "discriminator": [
        20,
        148,
        236,
        198,
        76,
        119,
        99,
        142
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
      "name": "rebalanceStrategy",
      "docs": [
        "Rebalance is now authority-only (audit #5). The two transfer legs sign",
        "as different PDAs: in-leg (reserve → strategy) signs as",
        "`vault_authority`; out-leg signs as `strategy_authority[i]`."
      ],
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
          "name": "authority",
          "docs": [
            "Audit #5: rebalance is now authority-only."
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
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
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
          "name": "strategy",
          "writable": true
        },
        {
          "name": "strategyAuthority",
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
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vaultState"
              },
              {
                "kind": "account",
                "path": "strategy.strategy_id",
                "account": "strategyAllocation"
              }
            ]
          }
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
                "path": "vaultAuthority"
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
      "name": "rebalanceWithDelta",
      "docs": [
        "Phase-5: explicit signed-delta rebalance. Authority-only. Pushes",
        "`delta` if positive (reserve → strategy) and pulls if negative",
        "(strategy → reserve). Reverts on overflow / under-flow / when the",
        "reserve can't cover a positive delta."
      ],
      "discriminator": [
        69,
        173,
        38,
        184,
        82,
        238,
        227,
        222
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
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
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
          "name": "strategy",
          "writable": true
        },
        {
          "name": "strategyAuthority",
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
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vaultState"
              },
              {
                "kind": "account",
                "path": "strategy.strategy_id",
                "account": "strategyAllocation"
              }
            ]
          }
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
                "path": "vaultAuthority"
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
          "name": "delta",
          "type": "i64"
        }
      ]
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
                "kind": "arg",
                "path": "strategyId"
              }
            ]
          }
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
                "kind": "arg",
                "path": "targetProgram"
              },
              {
                "kind": "arg",
                "path": "discriminator"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "strategyId",
          "type": "u64"
        },
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
      "name": "removeAllowedToken",
      "discriminator": [
        109,
        15,
        23,
        186,
        219,
        68,
        215,
        200
      ],
      "accounts": [
        {
          "name": "governance",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocolConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "allowedToken",
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
                  116,
                  111,
                  107,
                  101,
                  110
                ]
              },
              {
                "kind": "arg",
                "path": "mint"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "mint",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "removeValueSource",
      "docs": [
        "Admin-only. Closes a `ValueSource` PDA, returning rent."
      ],
      "discriminator": [
        79,
        214,
        185,
        84,
        66,
        177,
        112,
        66
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
                "kind": "arg",
                "path": "strategyId"
              }
            ]
          }
        },
        {
          "name": "valueSource",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "strategyId",
          "type": "u64"
        },
        {
          "name": "index",
          "type": "u8"
        }
      ]
    },
    {
      "name": "reportLoss",
      "docs": [
        "Authority reports a realized loss on a strategy. Decrements both",
        "`strategy.allocated_amount` and `vault_state.total_deposited` by the",
        "loss. Reverts if the loss exceeds either tracked total. Audit #6."
      ],
      "discriminator": [
        120,
        239,
        28,
        252,
        98,
        214,
        150,
        219
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
        }
      ],
      "args": [
        {
          "name": "lossAmount",
          "type": "u64"
        }
      ]
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
          "name": "strategyTokenAccount",
          "docs": [
            "Audit #14: pin the ATA's mint to the vault's underlying mint."
          ]
        }
      ],
      "args": []
    },
    {
      "name": "setAutoActionConfig",
      "docs": [
        "Admin-only. Records the curator's intended `(target, disc, ix_data)`",
        "for what this strategy should do when funds enter (kind=0) or",
        "leave (kind=1). Read off-chain by the agent; on-chain auto-CPI",
        "invocation is a future phase."
      ],
      "discriminator": [
        158,
        124,
        99,
        174,
        255,
        136,
        157,
        166
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
                "kind": "arg",
                "path": "strategyId"
              }
            ]
          }
        },
        {
          "name": "autoActionConfig",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "strategyId",
          "type": "u64"
        },
        {
          "name": "kind",
          "type": "u8"
        },
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
        },
        {
          "name": "ixData",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "setGovernance",
      "discriminator": [
        34,
        71,
        128,
        245,
        179,
        42,
        140,
        137
      ],
      "accounts": [
        {
          "name": "governance",
          "signer": true
        },
        {
          "name": "protocolConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newGovernance",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "setPaused",
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
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
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setPerformanceFeeBps",
      "discriminator": [
        52,
        124,
        56,
        71,
        240,
        184,
        6,
        176
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
          "name": "protocolConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "setProtocolFeeBps",
      "discriminator": [
        110,
        125,
        138,
        144,
        71,
        228,
        139,
        51
      ],
      "accounts": [
        {
          "name": "governance",
          "signer": true
        },
        {
          "name": "protocolConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newBps",
          "type": "u16"
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
      "name": "setTreasury",
      "discriminator": [
        57,
        97,
        196,
        95,
        195,
        206,
        106,
        136
      ],
      "accounts": [
        {
          "name": "governance",
          "signer": true
        },
        {
          "name": "protocolConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newTreasury",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "settleStrategyValue",
      "docs": [
        "Authority-only. Computes a strategy's live total (idle ATA balance",
        "plus the sum of registered ValueSources, scaled into underlying",
        "units) and settles `strategy.allocated_amount` + `vault.total_deposited`",
        "to match. Pause-gated. Caller passes",
        "`[value_source_pda, target_account]` pairs in `remaining_accounts`."
      ],
      "discriminator": [
        243,
        126,
        139,
        108,
        162,
        202,
        200,
        177
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
                "kind": "arg",
                "path": "strategyId"
              }
            ]
          }
        },
        {
          "name": "strategyTokenAccount"
        }
      ],
      "args": [
        {
          "name": "strategyId",
          "type": "u64"
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
          "name": "strategyAuthority",
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
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vaultState"
              },
              {
                "kind": "account",
                "path": "strategy.strategy_id",
                "account": "strategyAllocation"
              }
            ]
          }
        },
        {
          "name": "strategyTokenAccount",
          "writable": true
        },
        {
          "name": "newDelegate"
        },
        {
          "name": "tokenProgram"
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
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
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
                "path": "vaultAuthority"
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
          "name": "adminTokenAccount",
          "docs": [
            "Audit #11: program creates this on-demand if it doesn't exist so a",
            "withdrawer never gets blocked by a missing admin ATA."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "adminWallet"
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
          "name": "adminWallet",
          "docs": [
            "account. Pubkey validated by constraint."
          ]
        },
        {
          "name": "treasuryTokenAccount",
          "docs": [
            "Treasury's underlying-token ATA — receives the protocol cut."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "treasuryWallet"
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
          "name": "treasuryWallet"
        },
        {
          "name": "protocolConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
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
      "name": "allowedToken",
      "discriminator": [
        248,
        231,
        202,
        176,
        102,
        84,
        97,
        187
      ]
    },
    {
      "name": "autoActionConfig",
      "discriminator": [
        57,
        184,
        253,
        193,
        176,
        74,
        8,
        35
      ]
    },
    {
      "name": "protocolConfig",
      "discriminator": [
        207,
        91,
        250,
        28,
        152,
        179,
        215,
        209
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
      "name": "valueSource",
      "discriminator": [
        98,
        73,
        220,
        46,
        214,
        234,
        72,
        162
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
  "events": [
    {
      "name": "actionExecuted",
      "discriminator": [
        116,
        101,
        146,
        36,
        160,
        153,
        182,
        233
      ]
    },
    {
      "name": "adminProposed",
      "discriminator": [
        129,
        249,
        226,
        227,
        199,
        82,
        110,
        243
      ]
    },
    {
      "name": "adminTransferred",
      "discriminator": [
        255,
        147,
        182,
        5,
        199,
        217,
        38,
        179
      ]
    },
    {
      "name": "allowedActionAdded",
      "discriminator": [
        191,
        208,
        225,
        235,
        176,
        193,
        131,
        98
      ]
    },
    {
      "name": "allowedActionRemoved",
      "discriminator": [
        153,
        147,
        229,
        103,
        95,
        128,
        162,
        48
      ]
    },
    {
      "name": "allowedTokenAdded",
      "discriminator": [
        87,
        108,
        199,
        208,
        65,
        78,
        222,
        70
      ]
    },
    {
      "name": "allowedTokenRemoved",
      "discriminator": [
        128,
        230,
        23,
        47,
        65,
        121,
        2,
        213
      ]
    },
    {
      "name": "authorityProposed",
      "discriminator": [
        244,
        117,
        94,
        112,
        53,
        151,
        35,
        89
      ]
    },
    {
      "name": "authoritySet",
      "discriminator": [
        122,
        178,
        145,
        44,
        172,
        30,
        25,
        16
      ]
    },
    {
      "name": "autoActionConfigCleared",
      "discriminator": [
        254,
        230,
        35,
        248,
        200,
        93,
        144,
        198
      ]
    },
    {
      "name": "autoActionConfigSet",
      "discriminator": [
        5,
        28,
        221,
        73,
        106,
        160,
        191,
        176
      ]
    },
    {
      "name": "delegateUpdated",
      "discriminator": [
        103,
        221,
        114,
        118,
        109,
        141,
        48,
        134
      ]
    },
    {
      "name": "deposited",
      "discriminator": [
        111,
        141,
        26,
        45,
        161,
        35,
        100,
        57
      ]
    },
    {
      "name": "governanceSet",
      "discriminator": [
        207,
        240,
        29,
        177,
        239,
        184,
        74,
        88
      ]
    },
    {
      "name": "lossReported",
      "discriminator": [
        171,
        113,
        81,
        216,
        21,
        218,
        20,
        91
      ]
    },
    {
      "name": "pausedToggled",
      "discriminator": [
        77,
        42,
        45,
        184,
        47,
        55,
        187,
        17
      ]
    },
    {
      "name": "performanceFeeCharged",
      "discriminator": [
        49,
        48,
        6,
        229,
        13,
        85,
        211,
        144
      ]
    },
    {
      "name": "performanceFeeSet",
      "discriminator": [
        152,
        94,
        131,
        175,
        169,
        117,
        70,
        216
      ]
    },
    {
      "name": "protocolConfigInitialized",
      "discriminator": [
        243,
        69,
        27,
        238,
        111,
        169,
        87,
        231
      ]
    },
    {
      "name": "protocolFeeBpsSet",
      "discriminator": [
        113,
        121,
        161,
        194,
        117,
        15,
        78,
        189
      ]
    },
    {
      "name": "rebalanced",
      "discriminator": [
        74,
        101,
        57,
        244,
        181,
        179,
        52,
        182
      ]
    },
    {
      "name": "strategyAllocated",
      "discriminator": [
        1,
        49,
        26,
        48,
        152,
        168,
        152,
        43
      ]
    },
    {
      "name": "strategyCreated",
      "discriminator": [
        182,
        139,
        220,
        116,
        163,
        176,
        161,
        223
      ]
    },
    {
      "name": "strategyDeactivated",
      "discriminator": [
        203,
        160,
        84,
        106,
        53,
        184,
        194,
        9
      ]
    },
    {
      "name": "strategyDeallocated",
      "discriminator": [
        31,
        160,
        136,
        75,
        82,
        37,
        10,
        139
      ]
    },
    {
      "name": "strategyValueSettled",
      "discriminator": [
        207,
        89,
        207,
        188,
        173,
        31,
        49,
        18
      ]
    },
    {
      "name": "strategyWeightSet",
      "discriminator": [
        7,
        1,
        151,
        234,
        144,
        128,
        203,
        78
      ]
    },
    {
      "name": "treasurySet",
      "discriminator": [
        69,
        231,
        163,
        135,
        254,
        194,
        109,
        166
      ]
    },
    {
      "name": "valueSourceAdded",
      "discriminator": [
        3,
        207,
        161,
        211,
        39,
        216,
        201,
        53
      ]
    },
    {
      "name": "valueSourceRemoved",
      "discriminator": [
        205,
        178,
        87,
        45,
        77,
        186,
        183,
        79
      ]
    },
    {
      "name": "vaultInitialized",
      "discriminator": [
        180,
        43,
        207,
        2,
        18,
        71,
        3,
        75
      ]
    },
    {
      "name": "withdrawn",
      "discriminator": [
        20,
        89,
        223,
        198,
        194,
        124,
        219,
        13
      ]
    },
    {
      "name": "yieldReported",
      "discriminator": [
        242,
        231,
        216,
        146,
        115,
        147,
        55,
        10
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
      "name": "vaultPaused",
      "msg": "Vault is paused"
    },
    {
      "code": 6010,
      "name": "strategyStillHoldsFunds",
      "msg": "Strategy still holds funds — deallocate to zero before deactivating"
    },
    {
      "code": 6011,
      "name": "callerNotDelegateOrAuthority",
      "msg": "Unauthorized: caller is neither delegate nor authority"
    },
    {
      "code": 6012,
      "name": "targetProgramMismatch",
      "msg": "Target program account does not match requested target"
    },
    {
      "code": 6013,
      "name": "actionNotAllowed",
      "msg": "Action not allowed for this strategy"
    },
    {
      "code": 6014,
      "name": "recipientIndexOutOfRange",
      "msg": "Expected recipient index is out of range"
    },
    {
      "code": 6015,
      "name": "recipientMismatch",
      "msg": "Recipient at expected index is not the strategy token account"
    },
    {
      "code": 6016,
      "name": "antiTheft",
      "msg": "Anti-theft: caller or delegate ATA balance grew during execute_action"
    },
    {
      "code": 6017,
      "name": "feeExceedsMax",
      "msg": "Fee bps exceeds protocol cap"
    },
    {
      "code": 6018,
      "name": "lossExceedsDeposited",
      "msg": "Reported loss exceeds tracked deposit total"
    },
    {
      "code": 6019,
      "name": "notPendingAdmin",
      "msg": "Caller is not the pending admin"
    },
    {
      "code": 6020,
      "name": "notPendingAuthority",
      "msg": "Caller is not the pending authority"
    },
    {
      "code": 6021,
      "name": "weightSumExceedsMax",
      "msg": "Sum of active strategy weights would exceed 10000 bps"
    },
    {
      "code": 6022,
      "name": "mintHasTransferHook",
      "msg": "Token mint carries a TransferHook extension; not supported"
    },
    {
      "code": 6023,
      "name": "mintHasPermanentDelegate",
      "msg": "Token mint carries a PermanentDelegate extension; not supported"
    },
    {
      "code": 6024,
      "name": "duplicateDelegate",
      "msg": "Delegate is already used by another active strategy in this vault"
    },
    {
      "code": 6025,
      "name": "mathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6026,
      "name": "unauthorizedGovernance",
      "msg": "Caller is not the protocol governance"
    },
    {
      "code": 6027,
      "name": "treasuryMismatch",
      "msg": "Treasury account mismatch with protocol_config.treasury"
    },
    {
      "code": 6028,
      "name": "performanceFeeBelowProtocolFee",
      "msg": "performance_fee_bps cannot be set below the protocol cut"
    },
    {
      "code": 6029,
      "name": "insufficientLiquidity",
      "msg": "Reserve plus available strategy ATAs cannot cover the requested withdrawal"
    },
    {
      "code": 6030,
      "name": "outputMintNotAllowed",
      "msg": "Output mint is not on the protocol allow-list"
    },
    {
      "code": 6031,
      "name": "outputMintIndexOutOfRange",
      "msg": "Output mint index is out of range of remaining_accounts"
    },
    {
      "code": 6032,
      "name": "actionCooldownActive",
      "msg": "Allowed-action cooldown has not elapsed"
    },
    {
      "code": 6033,
      "name": "actionLossExceedsCap",
      "msg": "Loss booked by execute_action exceeds the per-action cap"
    },
    {
      "code": 6034,
      "name": "lossCapTooHigh",
      "msg": "Per-action loss cap exceeds protocol maximum"
    },
    {
      "code": 6035,
      "name": "siblingInstructionForbidden",
      "msg": "Sibling instruction in this transaction is forbidden by introspection guard"
    },
    {
      "code": 6036,
      "name": "deltaOutOfRange",
      "msg": "Signed delta would push allocated_amount negative or overflow"
    },
    {
      "code": 6037,
      "name": "invalidAutoActionKind",
      "msg": "AutoActionConfig kind must be 0 (Deposit) or 1 (Withdraw)"
    },
    {
      "code": 6038,
      "name": "autoActionDataTooLarge",
      "msg": "AutoActionConfig ix_data exceeds the 256-byte cap"
    },
    {
      "code": 6039,
      "name": "invalidValueSourceKind",
      "msg": "ValueSource kind must be 0 (SplAtaBalance) or 1 (AccountU64)"
    },
    {
      "code": 6040,
      "name": "valueSourceIndexOutOfBounds",
      "msg": "ValueSource index exceeds MAX_VALUE_SOURCES_PER_STRATEGY"
    },
    {
      "code": 6041,
      "name": "invalidValueSourceScale",
      "msg": "ValueSource scale_den must be non-zero"
    },
    {
      "code": 6042,
      "name": "valueSourceTargetMismatch",
      "msg": "ValueSource target account passed in remaining_accounts does not match the registered target"
    },
    {
      "code": 6043,
      "name": "valueSourceTargetTooSmall",
      "msg": "ValueSource target account data is shorter than required offset+8"
    },
    {
      "code": 6044,
      "name": "accountMismatch",
      "msg": "Account passed in remaining_accounts does not match the expected key/owner/layout"
    },
    {
      "code": 6045,
      "name": "valueSourceTargetIsStrategyAta",
      "msg": "ValueSource target_account must not equal the strategy's own ATA (would double-count)"
    },
    {
      "code": 6046,
      "name": "fanOutExceedsDeposit",
      "msg": "Cumulative fan-out from a single deposit cannot exceed the deposit amount"
    }
  ],
  "types": [
    {
      "name": "actionExecuted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "strategy",
            "type": "pubkey"
          },
          {
            "name": "strategyId",
            "type": "u64"
          },
          {
            "name": "caller",
            "type": "pubkey"
          },
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
          },
          {
            "name": "ixDataLen",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "adminProposed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "currentAdmin",
            "type": "pubkey"
          },
          {
            "name": "pendingAdmin",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "adminTransferred",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "previousAdmin",
            "type": "pubkey"
          },
          {
            "name": "newAdmin",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "allowedAction",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "strategy",
            "type": "pubkey"
          },
          {
            "name": "strategyId",
            "type": "u64"
          },
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
          },
          {
            "name": "expectedRecipientIndex",
            "docs": [
              "Audit #8: index in remaining_accounts that must equal",
              "`strategy.token_account`. No longer optional."
            ],
            "type": "u16"
          },
          {
            "name": "outputMintIndex",
            "docs": [
              "Phase-4d: when `Some`, the mint at",
              "`remaining_accounts[output_mint_index]` must be on the protocol",
              "allow-list (an `AllowedToken` PDA must exist). Used to gate",
              "swap-style actions (Jupiter route, Drift open-position) so a",
              "compromised agent can't pivot the strategy into a worthless asset."
            ],
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "lossPerCallBpsCap",
            "docs": [
              "Phase-5: max loss this single call may book against the strategy",
              "ATA, in basis points of `strategy.allocated_amount` at call time.",
              "`0` disables the check. Capped at `MAX_LOSS_PER_CALL_BPS`."
            ],
            "type": "u16"
          },
          {
            "name": "cooldownSecs",
            "docs": [
              "Phase-5: minimum seconds between successful invocations of this",
              "allowed action. `0` disables. Combined with `last_executed_at` to",
              "rate-limit a compromised agent."
            ],
            "type": "u32"
          },
          {
            "name": "lastExecutedAt",
            "docs": [
              "Phase-5: unix timestamp of last successful `execute_action` for",
              "this `(strategy, target, discriminator)` triple. Set inside the",
              "instruction handler."
            ],
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "docs": [
              "Forward-compatibility cushion. See `VaultState._reserved`."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "allowedActionAdded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "strategy",
            "type": "pubkey"
          },
          {
            "name": "strategyId",
            "type": "u64"
          },
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
          },
          {
            "name": "expectedRecipientIndex",
            "type": "u16"
          },
          {
            "name": "outputMintIndex",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "lossPerCallBpsCap",
            "type": "u16"
          },
          {
            "name": "cooldownSecs",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "allowedActionRemoved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "strategy",
            "type": "pubkey"
          },
          {
            "name": "strategyId",
            "type": "u64"
          },
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
      }
    },
    {
      "name": "allowedToken",
      "docs": [
        "Per-mint protocol-level allow-list entry. Existence of the PDA at",
        "`[\"allowed_token\", mint]` is the whitelist check; the data carries",
        "just the mint pubkey (for off-chain `program.account.allowedToken.all()`",
        "queries) and the bump."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
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
      "name": "allowedTokenAdded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "allowedTokenRemoved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "authorityProposed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "currentAuthority",
            "type": "pubkey"
          },
          {
            "name": "pendingAuthority",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "authoritySet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "previousAuthority",
            "type": "pubkey"
          },
          {
            "name": "newAuthority",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "autoActionConfig",
      "docs": [
        "Phase-5: declarative \"what should this strategy do when funds enter",
        "(kind = 0) or leave (kind = 1)\" record. Read off-chain by the agent;",
        "the agent then calls `execute_action` with this `(target_program,",
        "discriminator, ix_data)` tuple. Frontend reads it to display",
        "auto-deploy intent. Auto-CPI from inside `deposit` / `rebalance` is",
        "not yet wired — admin-curated declaration today, on-chain enforcement",
        "later."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "strategy",
            "type": "pubkey"
          },
          {
            "name": "strategyId",
            "type": "u64"
          },
          {
            "name": "kind",
            "docs": [
              "0 = Deposit, 1 = Withdraw. Anything else is rejected at set time."
            ],
            "type": "u8"
          },
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
          },
          {
            "name": "ixData",
            "docs": [
              "Phase-5: bytes appended after the `discriminator` to form the",
              "inner CPI's `data`. Capped at 256 to bound rent + compute. Most",
              "adapters fit in <64 bytes (a single `u64` amount + a few flags)."
            ],
            "type": "bytes"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "autoActionConfigCleared",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "strategy",
            "type": "pubkey"
          },
          {
            "name": "strategyId",
            "type": "u64"
          },
          {
            "name": "kind",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "autoActionConfigSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "strategy",
            "type": "pubkey"
          },
          {
            "name": "strategyId",
            "type": "u64"
          },
          {
            "name": "kind",
            "docs": [
              "0 = Deposit, 1 = Withdraw."
            ],
            "type": "u8"
          },
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
          },
          {
            "name": "ixDataLen",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "delegateUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "strategy",
            "type": "pubkey"
          },
          {
            "name": "strategyId",
            "type": "u64"
          },
          {
            "name": "newDelegate",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "deposited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "sharesMinted",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "governanceSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "previous",
            "type": "pubkey"
          },
          {
            "name": "newGovernance",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "lossReported",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "strategy",
            "type": "pubkey"
          },
          {
            "name": "strategyId",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "newTotalDeposited",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "pausedToggled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "paused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "performanceFeeCharged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "grossAmount",
            "type": "u64"
          },
          {
            "name": "feeAmount",
            "type": "u64"
          },
          {
            "name": "treasuryFee",
            "type": "u64"
          },
          {
            "name": "curatorFee",
            "type": "u64"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "protocolFeeBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "performanceFeeSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "previousBps",
            "type": "u16"
          },
          {
            "name": "newBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "protocolConfig",
      "docs": [
        "Global protocol configuration. Single PDA at seeds `[\"protocol_config\"]`.",
        "`governance` gates `set_treasury`, `set_protocol_fee_bps`, and",
        "`set_governance`. `protocol_fee_bps` is the constant slice carved from",
        "every vault's `performance_fee_bps` and routed to `treasury`'s",
        "underlying ATA at withdraw time."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "governance",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "protocolFeeBps",
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
      "name": "protocolConfigInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "governance",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "protocolFeeBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "protocolFeeBpsSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "previousBps",
            "type": "u16"
          },
          {
            "name": "newBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "rebalanced",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "strategy",
            "type": "pubkey"
          },
          {
            "name": "strategyId",
            "type": "u64"
          },
          {
            "name": "deltaSigned",
            "type": "i64"
          },
          {
            "name": "newAllocated",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "strategyAllocated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "strategy",
            "type": "pubkey"
          },
          {
            "name": "strategyId",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "strategyAllocation",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "strategyId",
            "type": "u64"
          },
          {
            "name": "delegate",
            "type": "pubkey"
          },
          {
            "name": "allocatedAmount",
            "type": "u64"
          },
          {
            "name": "tokenAccount",
            "type": "pubkey"
          },
          {
            "name": "isActive",
            "type": "bool"
          },
          {
            "name": "targetWeightBps",
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "authorityBump",
            "docs": [
              "Stored bump for the strategy_authority PDA."
            ],
            "type": "u8"
          },
          {
            "name": "reserved",
            "docs": [
              "Phase-5: forward-compatibility cushion. See `VaultState._reserved`."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "strategyCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "strategy",
            "type": "pubkey"
          },
          {
            "name": "strategyId",
            "type": "u64"
          },
          {
            "name": "delegate",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "strategyDeactivated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "strategy",
            "type": "pubkey"
          },
          {
            "name": "strategyId",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "strategyDeallocated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "strategy",
            "type": "pubkey"
          },
          {
            "name": "strategyId",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "strategyValueSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "strategy",
            "type": "pubkey"
          },
          {
            "name": "strategyId",
            "type": "u64"
          },
          {
            "name": "previousAllocated",
            "docs": [
              "Strategy's `allocated_amount` before the settle."
            ],
            "type": "u64"
          },
          {
            "name": "computedValue",
            "docs": [
              "Computed live value as the sum across the strategy's value sources."
            ],
            "type": "u64"
          },
          {
            "name": "deltaSigned",
            "docs": [
              "Signed delta booked into both `strategy.allocated_amount` and",
              "`vault.total_deposited`. Positive = yield, negative = loss."
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "strategyWeightSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "strategy",
            "type": "pubkey"
          },
          {
            "name": "strategyId",
            "type": "u64"
          },
          {
            "name": "weightBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "treasurySet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "previous",
            "type": "pubkey"
          },
          {
            "name": "newTreasury",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "valueSource",
      "docs": [
        "Phase-5: per-strategy value-source registry entry. A strategy can have",
        "up to `MAX_VALUE_SOURCES_PER_STRATEGY` sources; the live value of the",
        "strategy is the sum across them. Source kinds:",
        "- kind = 0 (SplAtaBalance): read the SPL Token Account `amount` at",
        "offset 64..72 of `target_account.data`. `offset` is ignored.",
        "- kind = 1 (AccountU64): read the u64 at `target_account.data[offset..offset+8]`.",
        "",
        "`scale_num / scale_den` is then applied to convert the raw read into",
        "underlying-token units (e.g. cToken → underlying via the protocol's",
        "exchange rate). Both default to 1."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "strategy",
            "type": "pubkey"
          },
          {
            "name": "strategyId",
            "type": "u64"
          },
          {
            "name": "index",
            "docs": [
              "Per-strategy slot index, 0..MAX_VALUE_SOURCES_PER_STRATEGY-1."
            ],
            "type": "u8"
          },
          {
            "name": "kind",
            "docs": [
              "0 = SplAtaBalance, 1 = AccountU64."
            ],
            "type": "u8"
          },
          {
            "name": "targetAccount",
            "type": "pubkey"
          },
          {
            "name": "offset",
            "docs": [
              "Byte offset for `AccountU64`. Ignored for `SplAtaBalance`."
            ],
            "type": "u32"
          },
          {
            "name": "scaleNum",
            "type": "u64"
          },
          {
            "name": "scaleDen",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "valueSourceAdded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "strategy",
            "type": "pubkey"
          },
          {
            "name": "strategyId",
            "type": "u64"
          },
          {
            "name": "index",
            "type": "u8"
          },
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "targetAccount",
            "type": "pubkey"
          },
          {
            "name": "offset",
            "type": "u32"
          },
          {
            "name": "scaleNum",
            "type": "u64"
          },
          {
            "name": "scaleDen",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "valueSourceRemoved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "strategy",
            "type": "pubkey"
          },
          {
            "name": "strategyId",
            "type": "u64"
          },
          {
            "name": "index",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "vaultInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "tokenMint",
            "type": "pubkey"
          },
          {
            "name": "shareMint",
            "type": "pubkey"
          },
          {
            "name": "vaultId",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "vaultState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "tokenMint",
            "type": "pubkey"
          },
          {
            "name": "shareMint",
            "type": "pubkey"
          },
          {
            "name": "vaultId",
            "type": "u64"
          },
          {
            "name": "totalDeposited",
            "type": "u64"
          },
          {
            "name": "strategyCount",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "shareMintBump",
            "type": "u8"
          },
          {
            "name": "vaultAuthorityBump",
            "docs": [
              "Audit refactor: stored bump for the vault_authority PDA so signing",
              "CPIs doesn't recompute it every call."
            ],
            "type": "u8"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "performanceFeeBps",
            "type": "u16"
          },
          {
            "name": "totalActiveWeightBps",
            "docs": [
              "Audit #18: invariant `sum(target_weight_bps for active strategies) ≤ 10_000`."
            ],
            "type": "u16"
          },
          {
            "name": "pendingAdmin",
            "docs": [
              "Audit #21: two-step admin transfer. `Pubkey::default()` means no pending."
            ],
            "type": "pubkey"
          },
          {
            "name": "pendingAuthority",
            "type": "pubkey"
          },
          {
            "name": "reserved",
            "docs": [
              "Phase-5: forward-compatibility cushion so future fields can be",
              "added by re-binarising existing accounts via `realloc` rather than",
              "orphaning live state. Keep zeroed."
            ],
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "withdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "sharesBurned",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "yieldReported",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "strategy",
            "type": "pubkey"
          },
          {
            "name": "strategyId",
            "type": "u64"
          },
          {
            "name": "yieldAmount",
            "type": "u64"
          },
          {
            "name": "newTotalDeposited",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
