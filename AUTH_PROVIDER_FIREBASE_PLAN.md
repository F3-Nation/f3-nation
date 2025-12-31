# Auth-Provider Firebase Secrets - Prod/Staging Split

Implementation plan to split auth-provider's Firebase App Hosting configuration into separate prod and staging variants.

---

## Phase 1: Create Environment-Specific Apphosting Files

### 1.1 Create `apps/auth-provider/apphosting.prod.yaml`

```yaml
# Settings for Backend (on Cloud Run) - PRODUCTION
# See https://firebase.google.com/docs/app-hosting/configure#cloud-run
runConfig:
  minInstances: 0

# Environment variables and secrets (prod uses "provider-*" prefix)
env:
  - variable: DATABASE_URL
    secret: provider-database-url
    availability:
      - BUILD
      - RUNTIME
  - variable: NEXTAUTH_SECRET
    secret: provider-nextauth-secret
    availability:
      - BUILD
      - RUNTIME
  - variable: NEXTAUTH_URL
    secret: provider-nextauth-url
    availability:
      - BUILD
      - RUNTIME
  - variable: NEXT_PUBLIC_NEXTAUTH_URL
    secret: provider-next-public-nextauth-url
    availability:
      - BUILD
      - RUNTIME
  - variable: TWILIO_SENDGRID_API_KEY
    secret: provider-twilio-sendgrid-api-key
    availability:
      - BUILD
      - RUNTIME
  - variable: TWILIO_SENDGRID_TEMPLATE_ID
    secret: provider-twilio-sendgrid-template-id
    availability:
      - BUILD
      - RUNTIME
  - variable: EMAIL_VERIFICATION_SENDER
    secret: provider-email-verification-sender
    availability:
      - BUILD
      - RUNTIME
  - variable: NODE_ENV
    secret: provider-node-env
    availability:
      - BUILD
      - RUNTIME
  - variable: ALLOWED_ORIGINS
    secret: provider-allowed-origins
    availability:
      - BUILD
      - RUNTIME
```

### 1.2 Create `apps/auth-provider/apphosting.staging.yaml`

Same structure but with `staging-provider-*` prefix for all secrets.

### 1.3 Delete `apps/auth-provider/apphosting.yaml`

Remove the old single-environment file.

---

## Phase 2: Update Firebase Secrets Script

### 2.1 Update `apps/auth-provider/scripts/firebase-secrets.sh`

Change the `get_backend_id_for_env` function:

```bash
# FROM:
get_backend_id_for_env() {
  local env="$1"
  if [[ "$env" == "staging" ]]; then
    echo "auth-provider-staging"
  else
    echo "f3-nation-auth-provider"  # OLD
  fi
}

# TO:
get_backend_id_for_env() {
  local env="$1"
  if [[ "$env" == "staging" ]]; then
    echo "auth-provider-staging"
  else
    echo "auth-provider-prod"  # NEW
  fi
}
```

---

## Phase 3: Register Prune Script in Package.json

### 3.1 Update `apps/auth-provider/package.json`

Add these scripts:

```json
{
  "scripts": {
    "prune:secrets": "scripts/prune-old-secrets.sh",
    "prune:secrets:dry-run": "scripts/prune-old-secrets.sh --dry-run"
  }
}
```

---

## Phase 4: Update Prune Script with Orphan Detection

### 4.1 Update `apps/auth-provider/scripts/prune-old-secrets.sh`

**Changes needed:**

1. Update `DEFAULT_APPS` to only include `"auth-provider"`:

   ```bash
   DEFAULT_APPS=("auth-provider")
   ```

2. Add `--check-orphans` flag to usage and argument parsing

3. Add function to parse secrets from apphosting yaml files:

   ```bash
   get_expected_secrets_from_yaml() {
     local yaml_file="$1"
     grep -E "^\s+secret:" "$yaml_file" | sed 's/.*secret:\s*//' | tr -d ' '
   }
   ```

4. Add orphan detection function:

   ```bash
   check_orphaned_secrets() {
     local project_id="$1"
     local script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
     local app_dir="$(dirname "$script_dir")"

     # Get expected secrets from yaml files
     local expected_secrets=()
     for yaml in "$app_dir"/apphosting.*.yaml; do
       while IFS= read -r secret; do
         expected_secrets+=("$secret")
       done < <(get_expected_secrets_from_yaml "$yaml")
     done

     # Get actual secrets from GCP
     local actual_secrets
     actual_secrets=$(gcloud secrets list --project="$project_id" \
       --filter="name~provider-" --format="value(name)")

     # Find orphans
     local orphans=()
     while IFS= read -r secret; do
       if [[ ! " ${expected_secrets[*]} " =~ " ${secret} " ]]; then
         orphans+=("$secret")
       fi
     done <<< "$actual_secrets"

     # Prompt to delete
     if [[ ${#orphans[@]} -gt 0 ]]; then
       log_warning "Found ${#orphans[@]} orphaned secrets:"
       for orphan in "${orphans[@]}"; do
         echo "  - $orphan"
       done
       read -p "Delete these orphaned secrets? [y/N] " -n 1 -r
       echo
       if [[ $REPLY =~ ^[Yy]$ ]]; then
         for orphan in "${orphans[@]}"; do
           gcloud secrets delete "$orphan" --project="$project_id" --quiet
           log_success "Deleted: $orphan"
         done
       fi
     else
       log_info "No orphaned secrets found"
     fi
   }
   ```

---

## Phase 5: Firebase Backend Configuration (Manual)

These steps must be done manually in Firebase Console or via CLI:

### 5.1 Create/Update Prod Backend

```bash
# If backend doesn't exist:
firebase apphosting:backends:create auth-provider-prod \
  --project f3-nation-auth \
  --location us-central1 \
  --app-directory apps/auth-provider

# Configure to watch main branch
```

### 5.2 Verify Staging Backend

```bash
# Verify auth-provider-staging exists and is configured for:
# - Branch: staging
# - App directory: apps/auth-provider
# - Config file: apphosting.staging.yaml
```

### 5.3 Re-run Secrets Script

After backend changes:

```bash
cd apps/auth-provider
npm run firebase:secrets
```

---

## Reference: Secret Naming Convention

| Environment | Secret Prefix        | Backend ID              |
| ----------- | -------------------- | ----------------------- |
| Production  | `provider-*`         | `auth-provider-prod`    |
| Staging     | `staging-provider-*` | `auth-provider-staging` |

## Reference: All Secrets (9 per environment)

| Env Variable                | Prod Secret                          | Staging Secret                               |
| --------------------------- | ------------------------------------ | -------------------------------------------- |
| DATABASE_URL                | provider-database-url                | staging-provider-database-url                |
| NEXTAUTH_SECRET             | provider-nextauth-secret             | staging-provider-nextauth-secret             |
| NEXTAUTH_URL                | provider-nextauth-url                | staging-provider-nextauth-url                |
| NEXT_PUBLIC_NEXTAUTH_URL    | provider-next-public-nextauth-url    | staging-provider-next-public-nextauth-url    |
| TWILIO_SENDGRID_API_KEY     | provider-twilio-sendgrid-api-key     | staging-provider-twilio-sendgrid-api-key     |
| TWILIO_SENDGRID_TEMPLATE_ID | provider-twilio-sendgrid-template-id | staging-provider-twilio-sendgrid-template-id |
| EMAIL_VERIFICATION_SENDER   | provider-email-verification-sender   | staging-provider-email-verification-sender   |
| NODE_ENV                    | provider-node-env                    | staging-provider-node-env                    |
| ALLOWED_ORIGINS             | provider-allowed-origins             | staging-provider-allowed-origins             |

---

## Notes

- Leave `apps/map` and `apps/api` auth implementations untouched
- Firebase App Hosting automatically deploys on branch push (no GitHub Actions needed)
- Consider using separate databases for staging vs prod if not already
