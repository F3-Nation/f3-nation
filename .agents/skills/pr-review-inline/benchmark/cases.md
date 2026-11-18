# Benchmark cases

Each case is a change to this repository as it stood when it was reviewed. `head` is the commit
to check out and review; `base` is the `DIFF_BASE`. Both can be fetched from `origin` by SHA.
[`README.md`](README.md) says how to run them. What each review must find is in `expected.md`,
which stays closed until the findings are final.

| Case                  | What it changes                                                         | `head`                                     | `base`                                     |
| --------------------- | ----------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------ |
| `map-error-boundary`  | A React error boundary in the map app, with its tests                   | `71cb03a02bb75cd5a2d05537749c214556589f54` | `77d2bc795220045ab55f2762807e8f6584f63878` |
| `issue-fields-script` | A shell script that sets fields on GitHub issues, with its test harness | `eb9cb92b5cb9a8cc42d7240fa39039050599c615` | `580fd276880e859ce1092eae41dc0d8f494eb862` |
| `staging-refresh-ci`  | A deploy workflow, its cloud setup script and the runbooks around them  | `8e34c482525c9a5c1c1942a83256dd28ead62e47` | `d2cd41f4c94f2da5eb3521cf3592ecb0cee02aaf` |
| `token-rotation-adr`  | An architecture decision record (prose only)                            | `1c9cd0f262d41a50ad5f3d211c0837abaabd1b86` | `77d2bc795220045ab55f2762807e8f6584f63878` |
