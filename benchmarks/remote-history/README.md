# Remote history acceptance

This sequential gate checks the remote Bash history produced by `ssh-direct`,
not Pi's final prose. It covers deterministic nested sudo/loop mutations, a
real Pi health inspection, real Pi bulk account creation, and a real Pi atomic
configuration deployment. It independently verifies resulting host state and
fails on missing changes, unresolved variables, shell scaffolding, output-only
pipeline stages, temporary paths, heredoc launchers, or credential values.

```sh
lab benchmark remote-history --run-id candidate
```
