/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/my_project.json`.
 */
export type MyProject = {
  "address": "4VgPkuQSgqvaBaE7X5ZyUFeMPRMj7yAa8cgsi22ZTvik",
  "metadata": {
    "name": "myProject",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
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
    }
  ],
  "types": [
    {
      "name": "strategyAllocation",
      "docs": [
        "StrategyAllocation — metadata for a single strategy.",
        "",
        "Seeds: [\"strategy\", vault_state.key(), &strategy_id.to_le_bytes()]",
        "Each strategy = one \"pocket\" where the vault can delegate tokens to an external protocol.",
        "",
        "This is the workaround for Solana's 1-delegate-per-account limitation:",
        "instead of one account with multiple delegates (impossible),",
        "we create multiple accounts each with one delegate.",
        "",
        "Think of it like: you can't give 3 people a key to the same safe,",
        "but you CAN create 3 safes and give one key each."
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
              "The external protocol address approved as delegate on this strategy's token account.",
              "This protocol can spend tokens up to the account balance.",
              "Like calling IERC20.approve(protocol, amount) in Solidity."
            ],
            "type": "pubkey"
          },
          {
            "name": "allocatedAmount",
            "docs": [
              "How many tokens are currently allocated to this strategy.",
              "Tracked separately because the delegate might have spent some."
            ],
            "type": "u64"
          },
          {
            "name": "tokenAccount",
            "docs": [
              "The PDA token account holding this strategy's tokens.",
              "Seeds: [\"strategy_token\", vault_state, strategy_id].",
              "Owned by vault PDA, with delegate set to the external protocol."
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
              "Target allocation weight in basis points (0-10000). E.g., 5000 = 50% of total_deposited.",
              "Used by rebalance_strategy to automatically calculate target allocation.",
              "Weights across all strategies do NOT need to sum to 10000 — the remainder stays in reserve."
            ],
            "type": "u16"
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
      "name": "vaultState",
      "docs": [
        "VaultState — the main configuration account for a vault.",
        "",
        "Seeds: [\"vault\", token_mint.key()]",
        "One vault per token mint — a USDC vault and a USDT vault get separate PDAs.",
        "",
        "Seeds derive a unique address, bump is stored for efficient re-derivation."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "docs": [
              "The admin — can create/deactivate strategies and change delegates.",
              "Set to whoever calls initialize_vault. Like Ownable's owner in Solidity."
            ],
            "type": "pubkey"
          },
          {
            "name": "authority",
            "docs": [
              "The operational authority — can allocate/deallocate funds between reserve and strategies.",
              "Separated from admin so a bot can rebalance without admin privileges."
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenMint",
            "docs": [
              "The accepted deposit token mint (e.g. USDC).",
              "The vault only accepts this token — like a single-asset ERC-4626 vault."
            ],
            "type": "pubkey"
          },
          {
            "name": "shareMint",
            "docs": [
              "The vault's share token mint (created as a PDA during initialize_vault).",
              "Only this program can mint/burn shares (vault PDA = mint authority)."
            ],
            "type": "pubkey"
          },
          {
            "name": "vaultId",
            "docs": [
              "Unique vault ID — allows multiple vaults for the same token mint.",
              "Included in the PDA seeds: [\"vault\", token_mint, vault_id]."
            ],
            "type": "u64"
          },
          {
            "name": "totalDeposited",
            "docs": [
              "Total underlying tokens in the vault (reserve + all strategies).",
              "This is the ACCOUNTING total — doesn't change when funds move to strategies.",
              "Only changes on deposit (+) and withdraw (-).",
              "Tracks total vault assets."
            ],
            "type": "u64"
          },
          {
            "name": "strategyCount",
            "docs": [
              "Auto-incrementing strategy ID counter (0, 1, 2, ...).",
              "Only goes up — deactivated strategies keep their IDs to prevent seed collisions."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump. Stored so we don't recalculate it every time we need PDA signing."
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
