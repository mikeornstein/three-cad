# Agent notes (Grok / automated dev)

Playbook for agents working on **three-cad**. Prefer these commands over asking the user to paste CI logs.

## Project at a glance

| Item | Value |
|------|--------|
| Repo | `mikeornstein/three-cad` |
| Intent | Text-first mechanical assembly workbench (Three.js, mesh-first) |
| Status | Phase 0 — architecture / process; app stack not scaffolded yet |
| Stack | TBD (update this table when Vite/TS/Three scaffold lands) |
| Git model | **Issues → branches → PRs** — never commit or push product work to `main` |

When the app is scaffolded, update this table and the Verification / CI sections with real commands.

## Hard rules for agents

1. **Never** commit product work on `main`.
2. **Never** `git push origin main` (or push new work on a branch named `main`).
3. **All work is done on branches** — implement, test, commit, and push only on the feature branch.
4. **Every branch references an issue** — branch name and PR body include the issue number.
5. Changes land on `main` **only via pull request** after checks (prefer **squash-merge**).
6. **Issues close when the work is complete** — use `Closes #N` only on the PR that fully meets acceptance criteria; partial work uses `Refs #N`.
7. **Do not** commit secrets, credentials, private keys, `.env` with real values, or large binaries.
8. Prefer machine-readable failure sources (`gh run view --log-failed`, local tests) over asking the user to paste logs.
9. Stay in scope of the ticket — no drive-by refactors or unrelated files.
10. Confirm with the user before destructive or hard-to-reverse git actions (force-push to shared branches, hard reset of published history, deleting remote branches they did not ask for).

## Tickets, branches, and pull requests

```text
Issue (ticket)  →  branch type/N-slug  →  one or more PRs  →  green CI  →  merge  →  issue closes
```

| Step | What agents do |
|------|----------------|
| **1. Pick or create a ticket** | Use an open issue, or `gh issue create` if the user asked for work with no ticket. |
| **2. Branch from up-to-date `main`** | Branch name **must** include the issue number. |
| **3. Implement only on that branch** | Commits stay off `main`. Link with `(#N)` when helpful. |
| **4. Open a PR into `main`** | Title/body **must** reference `#N`. Use the PR template sections. |
| **5. Resolve via PR(s)** | Full done → `Closes #N`. More work remains → `Refs #N`. |
| **6. After merge** | Pull `main`, delete the local feature branch, confirm issue state. |

### Branch naming

```text
type/<issue-number>-short-kebab-description
```

| Type | Use |
|------|-----|
| `feat/` | New capability |
| `fix/` | Bug fix |
| `docs/` | Documentation only |
| `chore/` | Tooling, deps, CI |
| `refactor/` | Structure without behavior change |
| `test/` | Tests only |

Examples: `docs/1-agent-contribution-guidelines`, `feat/12-viewport-measure`.

No issue yet? Create one first — do not invent `feat/wip-no-ticket` for real work.

### Issue ↔ PR linking

| Situation | PR body | Issue result |
|-----------|---------|--------------|
| This PR **fully** resolves the issue | `Closes #N` or `Fixes #N` | Closes on merge |
| Partial work; more PRs follow | `Refs #N` or `Part of #N` | Stays open |
| Multiple PRs | Only the **last** completing PR uses `Closes #N` | Closes on final merge |

Prefer the keyword in the **PR body**, not only the commit message. Do not manually close an issue while acceptance criteria remain unmet.

### Standard flow

```bash
# 0) Know the ticket
gh issue view <N>
# or: gh issue create --title "…" --body "…"

git fetch origin
git checkout main
git pull origin main
git checkout -b feat/<N>-short-kebab-description

# 1) implement + verify on the feature branch only

git add …
git commit -m "Describe change (#N)"
git push -u origin HEAD

gh pr create --base main --title "feat: short title (#N)" --body "$(cat <<'EOF'
## Summary
- …

## Issue
Closes #<N>
# or: Refs #<N>

## Test plan
- [ ] …
EOF
)"
```

After green checks:

```bash
gh pr merge --squash
git checkout main
git pull origin main
git branch -d feat/<N>-short-kebab-description
gh issue view <N>   # CLOSED if Closes was used and criteria met
```

### When the user says “commit and push”

Interpret as:

1. Ensure work is on a **feature branch tied to an issue** (create issue + branch if still on `main`).
2. Commit on **that branch**.
3. Push **that branch** to `origin`.
4. Open or update a **PR to `main`** that references the issue.
5. **Do not** push to `main`.

If already on `main` with dirty work:

```bash
N=$(gh issue create --title "…" --body "…" | grep -oE '[0-9]+$')
git fetch origin
git checkout -b feat/${N}-describe-change
git add … && git commit -m "… (#${N})"
git push -u origin HEAD
gh pr create --base main --title "… (#${N})" --body "Closes #${N}"
```

### PR checklist (agent)

- [ ] Branch is **not** `main`
- [ ] Branch name includes **issue number** (`type/N-slug`)
- [ ] PR body has `Closes #N` **or** `Refs #N`
- [ ] `Closes` only if acceptance criteria are fully met
- [ ] Local verification passed (see below)
- [ ] PR targets `main` with a clear summary
- [ ] No secrets, `node_modules/`, `dist/`, or other ignored junk committed
- [ ] Diff is focused — no unrelated cleanup

### Finding work

```bash
gh issue list --limit 20
gh issue view <N>
gh pr list
```

## Git hygiene

- Run `git status` / review the diff before every commit; stage only intentional paths.
- Prefer conventional, imperative subjects (`docs: …`, `feat: …`, `fix: …`, `chore: …`). One logical change per commit when practical.
- Never skip hooks with `--no-verify` unless the user explicitly allows it.
- **Do not force-push `main`.** Force-push a **feature branch** only when rewriting that branch’s history; prefer `git push --force-with-lease`.
- Do not amend commits already on the remote unless you intentionally rewrite that feature branch.
- When behind `main`, update the **feature branch** (rebase or merge); resolve conflicts there, never by committing product work on `main`.
- Prefer GitHub **noreply** author email if private-email push blocks apply:

  ```text
  10444033+mikeornstein@users.noreply.github.com
  ```

  If push fails with `GH007`: check `git log -1 --format='%ae %ce'`, rewrite **unpushed feature-branch** commits with noreply author/committer, push the feature branch again.

## Branch protection (`main`)

**Policy (enforce in GitHub when the plan allows):**

- Direct pushes to `main` blocked
- Changes only via pull request
- Force-push and branch deletion on `main` blocked
- Required status check: **CI** (workflow job `check`) once CI exists
- Approving reviews: **0** required (solo + agent workflow); raise later if desired

**Plan limits:** On **private** repos, branch protection and rulesets need **GitHub Pro** (or higher). On **public** Free repos, rulesets/protection work without Pro.

Setup script (run when Pro is enabled or the repo is public):

```bash
./scripts/setup-branch-protection.sh
```

Or manually:

```bash
gh api --method PUT repos/mikeornstein/three-cad/branches/main/protection \
  --input scripts/branch-protection.json
```

Agents must still follow the hard rules even if protection is not yet active.

## CI

Workflow: [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)

| Trigger | Behavior |
|---------|----------|
| PRs to `main` | Run CI |
| Pushes to non-`main` branches | Run CI |
| Push to `main` | Not required for app deploy yet (add later if needed) |

**Greenfield:** If `package.json` is missing, CI checks out the repo and reports “app jobs skipped”.  
**After scaffold:** CI runs `npm ci`, `npm test`, and `npm run build` when those scripts exist. Update this section and the workflow when the stack lands.

Debug CI yourself:

```bash
gh run list --limit 5
gh run view <run-id> --log-failed
gh pr checks
```

Deploy (when added) must run **only from `main` after merge**, never from feature branches.

## Verification before “done”

| Situation | Agent does |
|-----------|------------|
| Always | Review `git status` and the full diff; no accidental files |
| Docs-only | Proofread; keep `AGENTS.md` / `CONTRIBUTING.md` consistent |
| App code (after scaffold) | Install → test → lint/typecheck (if present) → build |
| PR open | `gh pr checks` green, or fix failures on the same branch |

Never use `Closes #N` if acceptance criteria remain unmet.

## Scope and safety

- Prefer small PRs; split large tickets (`Refs #N` until the final `Closes #N`).
- Do not invent long-lived branches without issues.
- Do not commit `.env` with secrets; `.env.example` only when documenting keys.
- Risky remote actions need explicit user confirmation.

## Full human summary

See [CONTRIBUTING.md](./CONTRIBUTING.md).
