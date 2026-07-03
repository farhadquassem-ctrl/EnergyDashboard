# Git & deploy workflow

The one long-lived branch is **`main`**. It is three things at once:

- **GitHub's default branch** — what PRs target, what clones check out, and (this
  one bites people) **the only branch GitHub schedules Actions from**.
- **Vercel's production branch** — every push to it auto-deploys the live site.
- **The single source of truth** — nothing else is durable.

Everything else is a short-lived `claude/<topic>` branch that exists only until it
merges into `main`.

---

## A normal change, start to finish

```bash
git checkout main && git pull origin main      # start from the truth
git checkout -b claude/<topic>                 # branch off it

# …edit…

npm run build                                  # sanity-check it compiles
git add -A && git commit -m "clear message"
git push -u origin claude/<topic>              # push the topic branch
```

Merging to `main` **is** the deploy. Which command depends on whether `main` moved
while you worked:

```bash
# Which case am I in?
git fetch origin main
git merge-base --is-ancestor origin/main claude/<topic> && echo "clean FF" || echo "rebase first"
```

**Case 1 — `main` didn't move (clean fast-forward):**

```bash
git push origin claude/<topic>:main            # fast-forward main to your commit
```

**Case 2 — `main` moved** (someone pushed to it — e.g. a forecast.json refresh):
replay your work on top of the new `main`, which turns it back into Case 1.

```bash
git fetch origin main
git rebase origin/main                         # replay your commits on the new main
git push --force-with-lease origin claude/<topic>   # update the topic branch
git push origin claude/<topic>:main                 # now a clean fast-forward
```

`--force-with-lease` is the *safe* force: it refuses if someone else changed your
topic branch out from under you. Never use plain `--force` on a shared branch.

After it's merged and deployed, the topic branch has done its job — retire it (see
below).

---

## Retiring branches

A remote branch is a ~40-byte pointer; stale ones cost nothing and never redeploy
unless something pushes to them. Clean them up when you like, not because you must.

The tidiest archive is a **git tag** (it doesn't clutter the branch list), **but
this repo's session token can't push tags or delete refs (both return 403).** So
the working split is:

- **Archive** a branch you want to preserve: create `archive/<topic>` at its tip.
  From a session, that's the GitHub MCP `create_branch` (App auth, which *can*
  create refs); by hand it's just `git branch archive/<topic> <branch> && git push`.
- **Delete** the original branch: **GitHub UI** → *Branches* → trash icon. (The
  session token can't delete refs.)

**You cannot delete the default branch.** Reassign the default first (below), then
delete.

---

## Changing the default branch

Repo settings can't be changed via the API/session token — this is a **UI action**:

`Settings` → `General` → **Default branch** → swap icon → pick the branch →
**Update**.

Do this whenever the default needs to move (it's currently `main`). Remember the
knock-on effect: **scheduled GitHub Actions only fire from the default branch**, and
a `workflow_dispatch` button only appears once its workflow file is on the default
branch. A workflow merged to a non-default branch is dormant.

---

## The forecast auto-refresh

`.github/workflows/refresh-forecast.yml` keeps `public/peak-forecast/forecast.json`
current without anyone running the pipeline by hand:

- **When:** daily at 06:00 ET (`cron: '0 10 * * *'`, UTC), plus **Actions → Refresh
  peak forecast → Run workflow** for an on-demand run.
- **What:** on a GitHub runner (which *can* reach IESO/ECCC, unlike the Claude
  sandbox) it runs `fetch:demand → fetch:weather → fetch:peaks → build →
  fetch:forecast → export:dashboard`, then commits `forecast.json` **only if it
  changed**. That push to `main` auto-deploys via Vercel.
- **Reading the result:** an *"unchanged — nothing to commit"* log line is success —
  it means the whole chain ran and the data was already current. A committed
  change means the forecast moved.
- **If it ever fails to push:** most likely `main` gained branch protection that
  blocks the `GITHUB_TOKEN`. Switch the final step to open a PR instead of pushing
  direct.

To regenerate the forecast by hand (e.g. debugging), run the same chain locally on a
networked machine: `cd pipeline && npm ci && npm run fetch:demand && … &&
npm run export:dashboard`, then commit the JSON.
