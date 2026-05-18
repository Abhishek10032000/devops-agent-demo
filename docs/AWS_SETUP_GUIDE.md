# AWS Setup Guide — Items Service Demo Application

> **End-to-end guide** for setting up the AWS infrastructure and GitHub Actions pipeline to deploy this demo application. Follow these steps in order.

---

## Table of Contents

1. [Overview](#overview)
2. [Step 1: AWS Account Prerequisites](#step-1-aws-account-prerequisites)
3. [Step 2: Create the ECR Repository](#step-2-create-the-ecr-repository)
4. [Step 3: Set Up GitHub OIDC Identity Provider](#step-3-set-up-github-oidc-identity-provider)
5. [Step 4: Create the IAM Roles for GitHub Actions](#step-4-create-the-iam-roles-for-github-actions)
6. [Step 5: Bootstrap CDK in Your AWS Account](#step-5-bootstrap-cdk-in-your-aws-account)
7. [Step 6: Create the GitHub Repository](#step-6-create-the-github-repository)
8. [Step 7: Configure GitHub Environments and Secrets](#step-7-configure-github-environments-and-secrets)
9. [Step 8: Deploy the Infrastructure](#step-8-deploy-the-infrastructure)
10. [Step 9: Verify the Pipeline](#step-9-verify-the-pipeline)
11. [Troubleshooting](#troubleshooting)
12. [Cost Estimate](#cost-estimate)

---

## Overview

### What gets deployed

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Your AWS Account                                    │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  VPC (10.0.0.0/16) — 2 AZs                                          │   │
│  │                                                                      │   │
│  │  ┌─────────────────────┐    ┌─────────────────────┐                  │   │
│  │  │  Public Subnet (AZ1)│    │  Public Subnet (AZ2)│                  │   │
│  │  │  • NAT Gateway      │    │  • NAT Gateway      │                  │   │
│  │  │  • ALB              │    │  • ALB              │                  │   │
│  │  └─────────────────────┘    └─────────────────────┘                  │   │
│  │                                                                      │   │
│  │  ┌─────────────────────┐    ┌─────────────────────┐                  │   │
│  │  │ Private Subnet (AZ1)│    │ Private Subnet (AZ2)│                  │   │
│  │  │  • ECS Fargate Tasks│    │  • ECS Fargate Tasks│                  │   │
│  │  └─────────────────────┘    └─────────────────────┘                  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌────────────┐   │
│  │  ECR          │  │ Secrets Mgr   │  │  KMS (CMK)    │  │ CloudWatch │   │
│  │  (container   │  │ (app config)  │  │ (encryption)  │  │ (logs)     │   │
│  │   registry)   │  │               │  │               │  │            │   │
│  └───────────────┘  └───────────────┘  └───────────────┘  └────────────┘   │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  IAM                                                                 │   │
│  │  • OIDC Identity Provider (GitHub Actions)                           │   │
│  │  • GitHubActionsRole-dev / -staging / -prod                          │   │
│  │  • items-service-{env}-execution-role                                │   │
│  │  • items-service-{env}-task-role                                     │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Prerequisites checklist

| Tool | Version | Check Command |
|------|---------|---------------|
| AWS CLI | v2.x | `aws --version` |
| Node.js | 20.x | `node --version` |
| CDK CLI | 2.x | `cdk --version` |
| Docker | 24.x+ | `docker --version` |
| GitHub CLI | 2.x | `gh --version` |
| jq | 1.6+ | `jq --version` |

---

## Step 1: AWS Account Prerequisites

### 1.1 Configure your AWS CLI profile

```bash
# If you haven't configured yet
aws configure --profile devops-agent-demo

# Verify access
aws sts get-caller-identity --profile devops-agent-demo
```

Expected output:
```json
{
    "UserId": "<your-user-id>",
    "Account": "123456789012",
    "Arn": "arn:aws:iam::123456789012:user/your-username"
}
```

### 1.2 Set environment variables

Create a `.env.deploy` file (add to `.gitignore` — already included):

```bash
export AWS_ACCOUNT_ID="123456789012"     # ← Replace with your account
export AWS_REGION="us-east-1"            # ← Your preferred region
export AWS_PROFILE="devops-agent-demo"
export GITHUB_ORG="your-github-org"      # ← Your GitHub org or username
export GITHUB_REPO="devops-agent-demo"   # ← Repository name
```

Source it:
```bash
source .env.deploy
```

---

## Step 2: Create the ECR Repository

The pipeline pushes Docker images to ECR. Create the repository first:

```bash
# Create the ECR repository
aws ecr create-repository \
  --repository-name items-service \
  --image-scanning-configuration scanOnPush=true \
  --encryption-configuration encryptionType=KMS \
  --region ${AWS_REGION}
```

### Set lifecycle policy (keep last 10 images, expire untagged after 1 day):

```bash
aws ecr put-lifecycle-policy \
  --repository-name items-service \
  --lifecycle-policy-text '{
    "rules": [
      {
        "rulePriority": 1,
        "description": "Expire untagged images after 1 day",
        "selection": {
          "tagStatus": "untagged",
          "countType": "sinceImagePushed",
          "countUnit": "days",
          "countNumber": 1
        },
        "action": { "type": "expire" }
      },
      {
        "rulePriority": 2,
        "description": "Keep last 10 tagged images",
        "selection": {
          "tagStatus": "tagged",
          "tagPrefixList": ["main-", "pr-"],
          "countType": "imageCountMoreThan",
          "countNumber": 10
        },
        "action": { "type": "expire" }
      }
    ]
  }' \
  --region ${AWS_REGION}
```

---

## Step 3: Set Up GitHub OIDC Identity Provider

GitHub Actions uses OpenID Connect (OIDC) to assume AWS IAM roles — **no long-lived access keys needed**.

### 3.1 Create the OIDC provider

```bash
# Get the current GitHub Actions OIDC thumbprint
# (This may change — verify at https://github.blog/changelog/2023-06-27-github-actions-update-on-oidc-integration-with-aws/)
THUMBPRINT="6938fd4d98bab03faadb97b34396831e3780aea1"

aws iam create-open-id-connect-provider \
  --url "https://token.actions.githubusercontent.com" \
  --client-id-list "sts.amazonaws.com" \
  --thumbprint-list "${THUMBPRINT}" \
  --region ${AWS_REGION}
```

### 3.2 Verify the provider was created

```bash
aws iam list-open-id-connect-providers
```

You should see:
```json
{
    "OpenIDConnectProviderList": [
        {
            "Arn": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
        }
    ]
}
```

> **⚠️ Note:** If the OIDC provider already exists (e.g., from another project), skip this step. Only one provider per issuer URL is needed per account.

---

## Step 4: Create the IAM Roles for GitHub Actions

We create **three environment-scoped roles** (dev, staging, prod) following least-privilege principles.

### 4.1 Trust policy template

Create `github-actions-trust-policy.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:${GITHUB_ORG}/${GITHUB_REPO}:environment:${ENVIRONMENT}"
        }
      }
    }
  ]
}
```

> **Key security feature:** The `sub` condition restricts which GitHub environment can assume the role. The `prod` role can ONLY be assumed from the `prod` environment (which requires approval).

### 4.2 Create the roles

```bash
for ENV in dev staging prod; do
  # Generate the trust policy with environment-specific sub
  cat > /tmp/trust-policy-${ENV}.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:${GITHUB_ORG}/${GITHUB_REPO}:environment:${ENV}"
        }
      }
    }
  ]
}
EOF

  # Create the role
  aws iam create-role \
    --role-name "GitHubActionsRole-${ENV}" \
    --assume-role-policy-document "file:///tmp/trust-policy-${ENV}.json" \
    --description "GitHub Actions role for items-service ${ENV} environment" \
    --max-session-duration 3600

  echo "✅ Created GitHubActionsRole-${ENV}"
done
```

### 4.3 Attach permissions policies

```bash
# Create the permissions policy
cat > /tmp/github-actions-permissions.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ECRAccess",
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload"
      ],
      "Resource": "*"
    },
    {
      "Sid": "CDKDeploy",
      "Effect": "Allow",
      "Action": [
        "cloudformation:*",
        "ecs:*",
        "ec2:*",
        "elasticloadbalancing:*",
        "iam:*",
        "logs:*",
        "kms:*",
        "secretsmanager:*",
        "ssm:*",
        "s3:*",
        "sts:AssumeRole"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "aws:RequestedRegion": "${AWS_REGION}"
        }
      }
    },
    {
      "Sid": "CDKBootstrapAccess",
      "Effect": "Allow",
      "Action": [
        "sts:AssumeRole"
      ],
      "Resource": [
        "arn:aws:iam::*:role/cdk-*"
      ]
    }
  ]
}
EOF

for ENV in dev staging prod; do
  # Create environment-specific policy
  aws iam put-role-policy \
    --role-name "GitHubActionsRole-${ENV}" \
    --policy-name "GitHubActionsDeployPolicy" \
    --policy-document "file:///tmp/github-actions-permissions.json"

  echo "✅ Attached policy to GitHubActionsRole-${ENV}"
done
```

> **⚠️ Production note:** The policy above is broad for demo purposes. For production, scope to specific resources and use separate policies per environment (e.g., prod role can't modify dev resources).

---

## Step 5: Bootstrap CDK in Your AWS Account

CDK bootstrap creates the required S3 bucket and IAM roles for deployments:

```bash
cd infra

# Install CDK dependencies
npm install

# Bootstrap (creates CDKToolkit stack)
npx cdk bootstrap aws://${AWS_ACCOUNT_ID}/${AWS_REGION} \
  --profile ${AWS_PROFILE} \
  --trust ${AWS_ACCOUNT_ID} \
  --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess
```

Expected output:
```
 ⏳  Bootstrapping environment aws://123456789012/us-east-1...
 ✅  Environment aws://123456789012/us-east-1 bootstrapped
```

### Verify bootstrap:

```bash
aws cloudformation describe-stacks \
  --stack-name CDKToolkit \
  --query 'Stacks[0].StackStatus' \
  --output text
```

Should return: `CREATE_COMPLETE` or `UPDATE_COMPLETE`

---

## Step 6: Create the GitHub Repository

### 6.1 Create and initialize the repo

```bash
# Navigate to the sample-app directory
cd /path/to/sample-app

# Initialize git
git init

# Create the GitHub repo
gh repo create ${GITHUB_ORG}/${GITHUB_REPO} \
  --public \
  --description "AWS DevOps Agent Demo: ECS Fargate microservice with CI/CD" \
  --source . \
  --remote origin

# Verify
gh repo view ${GITHUB_ORG}/${GITHUB_REPO}
```

### 6.2 Create the initial commit

```bash
git add -A
git commit -m "feat: initial scaffold — ECS Fargate Items Service

- Express.js TypeScript API with CRUD endpoints
- CDK infrastructure (VPC, ECS Fargate, ALB, KMS, Secrets Manager)
- GitHub Actions CI/CD pipeline (build → test → deploy)
- Unit + integration test suite
- Multi-stage Dockerfile with non-root user

This repo demonstrates AWS DevOps Agent + GitHub MCP Server integration
for automated CI/CD troubleshooting."

# Don't push yet — set up secrets first
```

---

## Step 7: Configure GitHub Environments and Secrets

### 7.1 Set repository variables

```bash
# These are non-sensitive and stored as variables (not secrets)
gh variable set AWS_ACCOUNT_ID --body "${AWS_ACCOUNT_ID}"
gh variable set AWS_REGION --body "${AWS_REGION}"
```

### 7.2 Create GitHub Environments

```bash
# Create environments (dev auto-deploys, staging auto-deploys, prod requires approval)
for ENV in dev staging prod; do
  gh api repos/${GITHUB_ORG}/${GITHUB_REPO}/environments/${ENV} \
    --method PUT \
    --field wait_timer=0
done

# Add protection rules to production environment
gh api repos/${GITHUB_ORG}/${GITHUB_REPO}/environments/prod \
  --method PUT \
  --field "reviewers[][type]=User" \
  --field "reviewers[][id]=$(gh api user --jq '.id')" \
  --field prevent_self_review=false
```

> **Prod approval gate:** The `prod` environment requires a reviewer to approve the deployment. This is the "human-in-the-loop" control discussed in the blog post.

### 7.3 Verify environment setup

```bash
gh api repos/${GITHUB_ORG}/${GITHUB_REPO}/environments --jq '.environments[].name'
```

Should output:
```
dev
staging
prod
```

---

## Step 8: Deploy the Infrastructure

### 8.1 First deployment (manual, creates base resources)

Before pushing to trigger the pipeline, do an initial CDK deploy to create the VPC, ECS cluster, and supporting resources:

```bash
cd infra

# Deploy to dev first
npx cdk deploy --all \
  --context environment=dev \
  --context imageTag=latest \
  --require-approval broadening \
  --profile ${AWS_PROFILE}
```

CDK will show you the changes and ask for confirmation:

```
Do you wish to deploy these changes (y/n)? y
```

Expected stacks created:
```
 ✅  items-service-dev-vpc
 ✅  items-service-dev-secrets
 ✅  items-service-dev-ecs
```

### 8.2 Note the outputs

```bash
# Get the ALB endpoint
aws cloudformation describe-stacks \
  --stack-name items-service-dev-ecs \
  --query 'Stacks[0].Outputs[?OutputKey==`AlbEndpoint`].OutputValue' \
  --output text
```

### 8.3 Build and push an initial Docker image

The ECS service needs an image to start. Push one manually first:

```bash
cd ..  # Back to project root

# Login to ECR
aws ecr get-login-password --region ${AWS_REGION} | \
  docker login --username AWS --password-stdin \
  ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

# Build the image
docker build -t items-service .

# Tag and push
docker tag items-service:latest \
  ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/items-service:latest

docker push \
  ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/items-service:latest
```

### 8.4 Force a new ECS deployment

```bash
aws ecs update-service \
  --cluster items-service-dev \
  --service items-service-dev \
  --force-new-deployment \
  --region ${AWS_REGION}
```

### 8.5 Wait for service stability

```bash
aws ecs wait services-stable \
  --cluster items-service-dev \
  --services items-service-dev \
  --region ${AWS_REGION}

echo "✅ Service is stable and healthy"
```

---

## Step 9: Verify the Pipeline

### 9.1 Push to trigger the pipeline

```bash
git push origin main
```

### 9.2 Watch the workflow

```bash
# Open the Actions tab
gh run watch

# Or check in browser
gh run list --limit 5
```

### 9.3 Verify the deployment

```bash
# Get the ALB DNS name
ALB_URL=$(aws cloudformation describe-stacks \
  --stack-name items-service-dev-ecs \
  --query 'Stacks[0].Outputs[?OutputKey==`AlbEndpoint`].OutputValue' \
  --output text \
  --region ${AWS_REGION})

echo "Testing: ${ALB_URL}"

# Health check
curl -s ${ALB_URL}/health | jq .

# Create an item
curl -s -X POST ${ALB_URL}/api/v1/items \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Widget", "category": "electronics", "price": 29.99}' | jq .

# List items
curl -s ${ALB_URL}/api/v1/items | jq .
```

Expected health response:
```json
{
  "status": "healthy",
  "timestamp": "2026-05-18T12:00:00.000Z",
  "version": "1.0.0",
  "uptime": 120.5
}
```

---

## Troubleshooting

### Pipeline fails at "Configure AWS credentials"

**Error:** `Could not assume role with OIDC`

**Cause:** Trust policy mismatch. The OIDC `sub` claim doesn't match.

**Fix:**
```bash
# Check what sub claim GitHub is sending
# Look in the workflow run logs for the token subject

# Update trust policy if the subject format changed
aws iam update-assume-role-policy \
  --role-name GitHubActionsRole-dev \
  --policy-document file:///tmp/trust-policy-dev.json
```

### CDK deploy fails with "CDKToolkit stack not found"

**Fix:** Re-run bootstrap (Step 5). Ensure you're using the same account/region.

### ECS tasks keep failing to start

**Common causes:**
1. Image not in ECR → Push image (Step 8.3)
2. Secrets Manager secret doesn't exist → CDK creates it but might be empty
3. KMS key policy drift → This is Scenario 3! Check key policy:

```bash
# Get the KMS key ID
KEY_ID=$(aws kms list-aliases \
  --query "Aliases[?AliasName=='alias/items-service-dev-key'].TargetKeyId" \
  --output text)

# Check key policy
aws kms get-key-policy --key-id ${KEY_ID} --policy-name default | jq -r '.Policy' | jq .
```

### Docker build fails locally

```bash
# Check Docker is running
docker info

# Build with verbose output
docker build --no-cache --progress=plain -t items-service .
```

---

## Cost Estimate

Running this demo in `us-east-1` with 1 Fargate task (dev environment):

| Service | Monthly Cost (approx.) |
|---------|----------------------|
| ECS Fargate (0.25 vCPU, 0.5GB, 24/7) | ~$9.50 |
| ALB (idle) | ~$16.20 |
| NAT Gateway (2 AZs) | ~$64.80 |
| KMS (1 CMK) | ~$1.00 |
| Secrets Manager (1 secret) | ~$0.40 |
| ECR (< 1GB stored) | ~$0.10 |
| CloudWatch Logs (< 5GB) | ~$2.50 |
| **Total (dev only)** | **~$94.50/month** |

> **💡 Cost optimization:** For demo/testing only, use a single NAT Gateway (`natGateways: 1` in vpc-stack.ts) to cut costs by ~$32/month.

### Cleanup

To destroy all resources and stop incurring costs:

```bash
cd infra

# Destroy all stacks
npx cdk destroy --all --context environment=dev --force

# Delete ECR images
aws ecr batch-delete-image \
  --repository-name items-service \
  --image-ids "$(aws ecr list-images --repository-name items-service --query 'imageIds[*]' --output json)"

# Delete ECR repo
aws ecr delete-repository --repository-name items-service --force

# Remove IAM roles
for ENV in dev staging prod; do
  aws iam delete-role-policy --role-name GitHubActionsRole-${ENV} --policy-name GitHubActionsDeployPolicy
  aws iam delete-role --role-name GitHubActionsRole-${ENV}
done

# Delete OIDC provider (only if no other repos use it!)
aws iam delete-open-id-connect-provider \
  --open-id-connect-provider-arn \
  "arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"

echo "✅ All resources cleaned up"
```

---

## Next Steps

Once the pipeline is running end-to-end:

1. **Connect AWS DevOps Agent** → Follow the blog post section "Configure GitHub App for AWS DevOps Agent"
2. **Trigger Scenario 1** → Add `aws-xray-sdk-core` to `package.json` and push
3. **Trigger Scenario 2** → Run the pipeline 5+ times and observe intermittent test failures
4. **Trigger Scenario 3** → Manually edit the KMS key policy in the AWS Console, then re-deploy

See the [main README](../README.md) for detailed scenario descriptions.
