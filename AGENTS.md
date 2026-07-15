# OpenClaw Agent Instructions

You are maintaining the CRM Avito app in this repository.

Work style:
- Be concise. Do not spend tokens on long explanations unless asked.
- Before editing, run `git status --short` and treat existing changes as user-owned.
- Do not revert user changes unless explicitly asked.
- Prefer small, targeted fixes over broad refactors.
- For UI changes, keep the existing Next.js/Tailwind/component style.
- After meaningful code changes, run focused tests first, then broader checks when relevant.

Default verification:
- `npm test -- --run`
- `npm run build`
- Use narrower test commands when the task is small, but mention what was and was not run.

Deployment:
- Deploy only after tests/build pass, unless the user explicitly asks to deploy despite failures.
- The server SSH alias is `crmavito-server-win`; it uses a local SSH key and does not require a password.
- Preferred deploy command from this repo:
  `powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:/crmavito/scripts/openclaw-deploy.ps1`
- The deploy script runs the server-side `/var/www/crmavito/deploy.sh`.
- If code must reach the server through git, commit/push first or clearly report that deploy would not include local unpushed changes.

Token discipline:
- Keep plans short.
- Avoid loading large files unless needed.
- Prefer `rg`, targeted file reads, and focused diffs.
- Use subagents only when the task is clearly parallel and worth the extra tokens.
