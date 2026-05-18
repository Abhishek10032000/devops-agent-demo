#!/usr/bin/env node
/**
 * CDK App Entry Point — Items Service Infrastructure
 *
 * Deploys a complete ECS Fargate service with:
 * - VPC (2 AZs, public + private subnets)
 * - ECS Cluster + Fargate Service + ALB
 * - Secrets Manager + KMS encryption
 *
 * Environment is determined by CDK context:
 *   cdk deploy --context environment=dev
 */

import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { VpcStack } from '../lib/vpc-stack';
import { SecretsStack } from '../lib/secrets-stack';
import { EcsStack } from '../lib/ecs-stack';

const app = new cdk.App();

// Read environment from context (defaults to 'dev')
const environment = app.node.tryGetContext('environment') || 'dev';
const imageTag = app.node.tryGetContext('imageTag') || 'latest';

// Stack naming convention: {service}-{resource}-{environment}
const stackPrefix = `items-service-${environment}`;

// Account and region from environment or CDK defaults
const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

// --- VPC Stack ---
const vpcStack = new VpcStack(app, `${stackPrefix}-vpc`, {
  env,
  environment,
  description: `VPC for Items Service (${environment})`,
  tags: {
    Service: 'items-service',
    Environment: environment,
    ManagedBy: 'cdk',
  },
});

// --- Secrets + KMS Stack ---
const secretsStack = new SecretsStack(app, `${stackPrefix}-secrets`, {
  env,
  environment,
  description: `Secrets Manager + KMS for Items Service (${environment})`,
  tags: {
    Service: 'items-service',
    Environment: environment,
    ManagedBy: 'cdk',
  },
});

// --- ECS Fargate Stack ---
const ecsStack = new EcsStack(app, `${stackPrefix}-ecs`, {
  env,
  environment,
  imageTag,
  vpc: vpcStack.vpc,
  secret: secretsStack.secret,
  kmsKey: secretsStack.kmsKey,
  description: `ECS Fargate Service for Items Service (${environment})`,
  tags: {
    Service: 'items-service',
    Environment: environment,
    ManagedBy: 'cdk',
  },
});

// Explicit dependencies
ecsStack.addDependency(vpcStack);
ecsStack.addDependency(secretsStack);

app.synth();
