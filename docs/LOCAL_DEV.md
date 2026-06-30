# Running & syncing the dashboard locally (saved for later)

> 📌 **Reminder note:** This is the "run it on my own PC" guide we deferred.
> For now the project is deployed online via Vercel — come back here when you
> want to run/edit it locally on your machine.

## Prerequisites (install once)

- **Git** — https://git-scm.com/download/win · verify: `git --version`
- **Node.js (LTS)** — https://nodejs.org (includes `npm`) · verify: `node --version`

All commands below go in **Command Prompt / PowerShell** — **not** the Python
console. (`npm` is a command-line program; a `>>>` Python prompt won't know it.)

## First-time setup

```cmd
cd %USERPROFILE%\Documents
git clone https://github.com/farhadquassem-ctrl/EnergyDashboard.git
cd EnergyDashboard
git checkout claude/ieso-lmp-dashboard-scaffold-2j6b2j
npm install
npm run dev
```

Then open the printed URL: **http://localhost:5173**

You're in the right folder when `dir` shows `package.json`.

## How syncing works (it is NOT automatic like Dropbox)

Git only moves changes when you run commands:

| Goal | Command |
| --- | --- |
| Get latest changes **from** GitHub | `git pull` |
| Save a snapshot locally | `git add -A` then `git commit -m "message"` |
| Send your commits **to** GitHub | `git push` |

**Get-the-latest one-liner** (run when Claude has pushed new changes):

```cmd
git checkout claude/ieso-lmp-dashboard-scaffold-2j6b2j && git pull && npm install
```

(`npm install` is only strictly needed when dependencies changed, but running it
is harmless and keeps things in sync.)

## Notes

- `node_modules/` is intentionally **not** in git (see `.gitignore`). That's why
  you run `npm install` locally — it rebuilds from `package.json`.
- If `git pull` reports a **merge conflict**, it means the same file changed in
  two places — ask Claude to help resolve it.
