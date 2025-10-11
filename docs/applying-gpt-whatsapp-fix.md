## Applying the GPT WhatsApp Interactive Fix

Follow these steps to pull the latest changes that stabilize GPT interactive message sending and deploy them to your environment.

## 1. Update your local branch
1. Fetch the latest code:
   ```bash
   git fetch origin
   ```
2. Switch to the target branch (replace `work` with your branch if different):
   ```bash
   git checkout work
   ```
3. Merge or rebase the latest upstream changes:
   ```bash
   git pull --rebase origin work
   ```

## 2. Install dependencies
If you have not already installed the project's dependencies, or if the lockfile changed, run:
```bash
npm install
```

## 3. Run validation checks
Execute the validation commands used for the fix to ensure everything passes locally:
```bash
npm run typecheck
npx vitest run tests/interactive_labels.spec.ts
```

## 4. Deploy or restart your service
After the checks pass, deploy the updated build or restart the service that consumes the WhatsApp GPT flows so the new fallback logic takes effect. The exact deployment steps depend on your environment (e.g., Vercel, Docker, Kubernetes). Ensure the service is restarted with the new build output.

## 5. Monitor WhatsApp flow behaviour
Once deployed, monitor the WhatsApp GPT flows. If interactive sends still fail, the new logic automatically falls back to the legacy button builder, so users should continue receiving responses. Review logs to confirm no unexpected errors remain.

## 6. Roll back if necessary
If you encounter regressions, roll back to the previous release (`git reset --hard <previous_commit>` followed by a redeploy) and open an issue with logs from the failed interactive attempts so the team can investigate further.
# Applying the GPT WhatsApp Interactive Fix

Follow these steps to pull the latest changes that stabilize GPT interactive message sending and deploy them to your environment.

## 1. Update your local branch
1. Fetch the latest code:
   ```bash
   git fetch origin
   ```
2. Switch to the target branch (replace `work` with your branch if different):
   ```bash
   git checkout work
   ```
3. Merge or rebase the latest upstream changes:
   ```bash
   git pull --rebase origin work
   ```

## 2. Install dependencies
If you have not already installed the project's dependencies, or if the lockfile changed, run:
```bash
npm install
```

## 3. Run validation checks
Execute the validation commands used for the fix to ensure everything passes locally:
```bash
npm run typecheck
npx vitest run tests/interactive_labels.spec.ts
```

## 4. Deploy or restart your service
After the checks pass, deploy the updated build or restart the service that consumes the WhatsApp GPT flows so the new fallback logic takes effect. The exact deployment steps depend on your environment (e.g., Vercel, Docker, Kubernetes). Ensure the service is restarted with the new build output.

## 5. Monitor WhatsApp flow behaviour
Once deployed, monitor the WhatsApp GPT flows. If interactive sends still fail, the new logic automatically falls back to the legacy button builder, so users should continue receiving responses. Review logs to confirm no unexpected errors remain.

