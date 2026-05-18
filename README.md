# Items Service — AWS DevOps Agent Demo Application

> **Level 300** | A production-ready Node.js microservice deployed to AWS ECS Fargate via CDK, designed to demonstrate the AWS DevOps Agent + GitHub + GitHub MCP Server integration.

## Overview

This repository is a fully functional microservice that serves as the demo application for the [AWS DevOps Agent blog post](https://aws.amazon.com/blogs/devops/). It demonstrates how an AI-powered DevOps Agent can automatically diagnose and remediate CI/CD pipeline failures by integrating with GitHub Actions and the GitHub MCP Server.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     GitHub Actions CI/CD                      │
│  ┌──────────┐     ┌──────────┐     ┌──────────────────────┐ │
│  │  Build   │────▶│   Test   │────▶│  Deploy (CDK)        │ │
│  │ npm ci   │     │  Jest    │     │  dev→staging→prod    │ │
│  │ Docker   │     │  unit+   │     │  (environment gates) │ │
│  │ ECR push │     │  integ   │     │                      │ │
│  └──────────┘     └──────────┘     └──────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │   AWS DevOps Agent  │
                    │  + GitHub MCP Server│
                    └─────────┬──────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐
  │ Scenario 1:  │   │ Scenario 2:  │   │ Scenario 3:      │
  │ Build Failure│   │ Flaky Test   │   │ Deploy Failure    │
  │ (dep conflict)   │ (timing race)│   │ (KMS key drift)  │
  └──────────────┘   └──────────────┘   └──────────────────┘
```

### AWS Services Used

| Service | Purpose |
|---------|---------|
| **ECS Fargate** | Container orchestration (serverless compute) |
| **ECR** | Docker image registry |
| **Application Load Balancer** | Traffic routing + health checks |
| **Secrets Manager** | Database credentials + service config |
| **KMS** | Encryption at rest (CMK with key policy) |
| **VPC** | Network isolation (public + private subnets) |
| **CloudWatch Logs** | Centralized logging |
| **IAM** | OIDC federation for GitHub Actions (no long-lived keys) |

---

## Prerequisites

- **Node.js 20+** — [Download](https://nodejs.org/)
- **Docker** — [Download](https://www.docker.com/get-started)
- **AWS CLI v2** — [Install](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
- **AWS CDK v2** — `npm install -g aws-cdk`
- **AWS Account** with appropriate permissions

---

## Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Start with hot reload
npm run dev

# Or use Docker Compose (includes LocalStack for Secrets Manager)
docker-compose up
```

The API is available at `http://localhost:3000`:

```bash
# Health check
curl http://localhost:3000/health

# Create an item
curl -X POST http://localhost:3000/api/v1/items \
  -H "Content-Type: application/json" \
  -d '{"name": "Demo Widget", "category": "widget", "price": 19.99}'

# List items
curl http://localhost:3000/api/v1/items
```

### Running Tests

```bash
# All tests with coverage
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration
```

### Deploying to AWS

```bash
# Bootstrap CDK (first time only)
cd infra && npx cdk bootstrap

# Deploy to dev
npx cdk deploy --all --context environment=dev

# Deploy to production
npx cdk deploy --all --context environment=production
```

---

## Demo Failure Scenarios

This repo is designed to demonstrate three CI/CD failure modes that the AWS DevOps Agent can diagnose:

### Scenario 1: Build Failure (Dependency Conflict)

**Trigger:** Add `"aws-xray-sdk-core": "^3.6.0"` to `package.json` dependencies.

**What happens:** `npm ci --strict-peer-deps` fails with `ERESOLVE unable to resolve dependency tree` because `aws-xray-sdk-core` internally pins `@aws-sdk/client-kms@3.400.0`, conflicting with our `@aws-sdk/client-kms@^3.525.0`.

**DevOps Agent action:**
1. Reads the GitHub Actions build log via workflow run API
2. Opens `package.json` via GitHub MCP Server to inspect dependency tree
3. Identifies the semver conflict between direct and transitive dependencies
4. Suggests: use `overrides` field, pin compatible version, or remove X-Ray SDK

### Scenario 2: Flaky Test (Timing Race)

**Trigger:** Run the integration test suite multiple times — the "concurrent operations" test fails ~20-30% of the time.

**What happens:** A test asserts on creation order of concurrently-created items, but items created in the same event loop tick get identical timestamps, making sort order non-deterministic.

**DevOps Agent action:**
1. Detects non-deterministic test failure pattern across workflow runs
2. Uses GitHub MCP to read the test file and identify the timing-sensitive assertion
3. Checks workflow run history for intermittent pass/fail on the same test
4. Suggests: add `jest.retryTimes(3)`, use deterministic ordering (by ID), or quarantine

### Scenario 3: Deployment Failure (KMS Key Policy Drift)

**Trigger:** Manually modify the KMS key policy in the AWS Console (remove the ECS task role principal from the `AllowEcsTaskRoleDecrypt` statement).

**What happens:** CDK deploy succeeds (key policy isn't changed by CDK since it detects no diff in the template), but the ECS task fails to start because it can't decrypt the Secrets Manager secret.

**DevOps Agent action:**
1. Reads the ECS task failure from CloudWatch or deployment logs
2. Uses GitHub MCP to inspect `infra/lib/secrets-stack.ts` for the expected key policy
3. Compares expected policy (in code) with actual AWS resource state
4. Recommends: re-align the key policy by running `cdk deploy --force`, or import the drift

---

## Project Structure

```
├── .github/workflows/     # CI/CD pipeline definitions
├── src/                   # Application source code
│   ├── config/            # Configuration loader (Secrets Manager)
│   ├── routes/            # Express route handlers
│   ├── services/          # Business logic layer
│   └── middleware/        # Error handling, logging
├── tests/                 # Test suites
│   ├── unit/              # Deterministic unit tests
│   └── integration/       # API integration tests (includes flaky test)
├── infra/                 # CDK infrastructure code
│   ├── bin/               # CDK app entry point
│   └── lib/               # Stack definitions (VPC, ECS, Secrets)
├── Dockerfile             # Multi-stage production build
└── docker-compose.yml     # Local development environment
```

---

## How This Connects to the DevOps Agent Blog Post

This sample application demonstrates the end-to-end workflow described in the blog:

1. **Developer pushes code** → GitHub Actions pipeline runs
2. **Pipeline fails** → GitHub webhook triggers the DevOps Agent
3. **Agent investigates** → Uses GitHub MCP Server to read repo files, workflow logs, and run history
4. **Agent diagnoses** → Correlates error patterns with code context
5. **Agent remediates** → Opens a PR with the fix, or suggests manual steps

The GitHub MCP Server enables the agent to:
- Read file contents (`GET /repos/{owner}/{repo}/contents/{path}`)
- List workflow runs and their status
- Read workflow run logs for error details
- Create issues or PRs with suggested fixes
- Access commit history for change correlation

---

## License

MIT — See [LICENSE](LICENSE) for details.
