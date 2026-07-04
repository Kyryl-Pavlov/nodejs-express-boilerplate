# CI/CD Pipeline

Three GitHub Actions workflows live in `.github/workflows/`, plus a fourth that publishes this wiki (see the last section).

## `ci.yml` — every push and pull request

Three parallel jobs:

| Job    | What it does                                                                            | Docker needed                                                                                  |
| ------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `lint` | `eslint .` + `prettier --check .`                                                       | No                                                                                             |
| `test` | `vitest run tests/app/unit tests/app/integration --coverage`                            | Yes (integration tier's testcontainer — GitHub-hosted `ubuntu-latest` has Docker preinstalled) |
| `e2e`  | Spins up `docker-compose.ci.yml`, runs `vitest run tests/app/e2e`, tears down with `-v` | Yes                                                                                            |

The CI stack uses `.env.ci` (committed, fake test credentials only) and sets `APP_ENV=production` to exercise the production code path. LocalStack provides S3 and SQS — no real AWS credentials needed.

## `deploy-dev.yml` and `deploy-prod.yml`

Targets the `dev` and `production` GitHub environments respectively; both trigger manually (`workflow_dispatch`) by default. To enable automatic deploys:

```yaml
# deploy-dev.yml
on:
  push:
    branches: [develop]

# deploy-prod.yml
on:
  push:
    branches: [main]
```

The two files are intentionally separate — no branch conditionals, one purpose each. They are structurally identical; the only differences are the branch image tag (`develop` vs `main`) and the `environment:` value. The production approval gate is on the `migrate` job — approving it unlocks `deploy` and `deploy-workers` for the same run (a native GitHub feature: create a `production` environment in **Settings → Environments** with required reviewers).

### Job graph

```
build  (all images in parallel)
  ├── migrate-dev          (develop branch — runs ALL migrations before any deploy)
  │     ├── deploy-dev         (needs: [build, migrate-dev] — services in tier order)
  │     └── deploy-workers-dev (needs: [build, migrate-dev] — Lambda workers, parallel with services)
  └── migrate-prod         (main branch — approval gate; approving unlocks entire prod pipeline)
        ├── deploy-prod
        └── deploy-workers-prod
```

Migrations run as one-off ECS Fargate tasks (`npx prisma migrate deploy`). If any migration fails, the entire pipeline stops — schema is always ahead of code. Services deploy in dependency tier order within the job; workers are independent and run in parallel.

### Backward-compatible migrations rule

During a rolling ECS update, old and new task instances run **simultaneously** against the same database. Every migration must be backward-compatible with the currently-deployed code:

- **Safe**: add a nullable column, add an index, add a table
- **Unsafe**: drop a column the old code still reads, rename a column, change a type non-compatibly

Use a two-phase approach for breaking changes: first deploy adds the new column (old code ignores it), second deploy removes the old column once all instances run the new code.

### Required GitHub configuration

**Repository secret** (Settings → Secrets → Actions):

| Secret         | Value                                                                             |
| -------------- | --------------------------------------------------------------------------------- |
| `AWS_ROLE_ARN` | IAM role for OIDC authentication, from `terraform output github_actions_role_arn` |

**Per-environment variables** (Settings → Environments → `dev` / `production`):

| Variable                                        | Source                                         |
| ----------------------------------------------- | ---------------------------------------------- |
| `ECS_CLUSTER`, `ECS_SERVICE`, `APP_TASK_FAMILY` | `terraform output`                             |
| `VPC_SUBNETS`, `VPC_SECURITY_GROUPS`            | `terraform output` (migration task networking) |
| `LAMBDA_FUNCTION_NAME`                          | `terraform output`                             |

### Adding a new microservice

1. Add a build step to `build` with `context: .` and `file: services/<name>/Dockerfile`.
2. Add a `run_migration` call (`'["npx","prisma","migrate","deploy"]'`) in both `migrate-*` jobs, if it has its own DB.
3. Add a deploy step at the correct tier in both `deploy-*` jobs (or `deploy-workers-*` for Lambda).
4. Add its ECR repo (`terraform/modules/ecr/main.tf`) and ECS service/task definition in `terraform/`.

## `deploy-wiki.yml` — publishing this wiki

Source pages live in the `wiki/` directory in this repo, not directly in the GitHub Wiki UI — the wiki git repo (`<owner>/<repo>.wiki.git`) is treated as a build artifact, not a source of truth.

**Trigger:** push to `main` touching `wiki/**`, or manual `workflow_dispatch`.

**What it does:**

1. Checks out this repo and the wiki's own git repo (`https://github.com/<owner>/<repo>.wiki.git`) side by side.
2. If the wiki repo doesn't exist yet (no page has ever been created), initializes a fresh local repo instead of failing — this is the expected state the very first time the workflow runs.
3. Mirrors `wiki/*.md` into the wiki repo with `rsync --delete`, so removing a page here removes it from the published wiki too.
4. Commits and pushes only if the sync produced a diff.

**One manual prerequisite:** the repository's **Wiki** feature must be enabled once (Settings → General → Features → Wikis) — GitHub doesn't provision the underlying `.wiki.git` storage until either a page is created via the UI or a push against it succeeds with the feature enabled.

To edit a page: edit the corresponding file under `wiki/` in a normal PR, same review process as any other change. Do not edit pages directly in the GitHub Wiki UI — that repo is overwritten (`--delete`) on every sync, so UI edits are silently lost on the next push to `main`.
