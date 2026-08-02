# Contributing to three-cad

Thank you for contributing. This project is **ticket-driven**: every change ships through a GitHub issue, a feature branch, and a pull request into `main`.

**Agents (Grok and others):** follow **[AGENTS.md](./AGENTS.md)** as the full playbook. This file is the short human summary of the same model.

## Rules of the road

1. Do **not** commit or push product work directly to `main`.
2. Open or use a **GitHub issue** for the work.
3. Branch from up-to-date `main` using:

   ```text
   type/<issue-number>-short-kebab-description
   ```

   Types: `feat/`, `fix/`, `docs/`, `chore/`, `refactor/`, `test/`.

4. Open a **PR into `main`** with:
   - A clear summary
   - `Closes #N` if the PR fully finishes the issue, or `Refs #N` if more work remains
   - A test plan (use the PR template)

5. Prefer **squash-merge** after CI is green.

6. Keep PRs focused. Split large work into multiple PRs against the same issue.

## Local checklist

- [ ] On a feature branch (not `main`)
- [ ] Branch name includes the issue number
- [ ] Diff is intentional (no secrets, no `node_modules/` / `dist/`)
- [ ] Verification appropriate to the change (docs proofread; app tests/build when stack exists)
- [ ] PR body links the issue

## CI

PRs run the **CI** workflow (`.github/workflows/ci.yml`). While there is no app yet, CI still runs a greenfield-safe check. After a Node app is scaffolded, CI will install, test, and build when those scripts exist.

Inspect failures with:

```bash
gh pr checks
gh run list --limit 5
gh run view <run-id> --log-failed
```

## Protecting `main`

GitHub branch protection on `main` is enabled:

- No direct pushes (including admins)
- Pull requests required
- Status check **`check`** required
- No force-push / no deleting `main`
- Linear history (squash-merge friendly)
- Zero required approving reviews (solo + agent workflow)

Re-apply if settings drift:

```bash
./scripts/setup-branch-protection.sh
```

## Questions

Open a GitHub issue, or see [AGENTS.md](./AGENTS.md) for agent-oriented detail (commit email, force-push rules, “commit and push” interpretation, multi-PR tickets).
