/**
 * Secrets Stack — KMS + Secrets Manager
 *
 * Creates a Customer Managed Key (CMK) and a Secrets Manager secret
 * for storing database credentials and service configuration.
 *
 * ⚠️ SCENARIO 3 — DEPLOYMENT FAILURE (KMS Key Policy Drift):
 * The KMS key policy includes a specific principal ARN for the ECS task role.
 * If this principal is modified outside of CDK (e.g., someone manually updates
 * the key policy in the AWS Console to add/remove a principal), the next CDK
 * deploy will fail with:
 *
 *   "AccessDeniedException: The ciphertext refers to a customer master key
 *    that does not exist, does not exist in this region, or you are not
 *    allowed to access."
 *
 * The DevOps Agent detects this by:
 * 1. Reading the CDK deploy error in GitHub Actions logs
 * 2. Using GitHub MCP to inspect this file and identify the key policy definition
 * 3. Comparing the expected policy (in code) with the actual policy (in AWS)
 * 4. Recommending: re-import the key policy via CDK, or fix the manual drift
 */

import * as cdk from 'aws-cdk-lib';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface SecretsStackProps extends cdk.StackProps {
  environment: string;
}

export class SecretsStack extends cdk.Stack {
  public readonly secret: secretsmanager.ISecret;
  public readonly kmsKey: kms.IKey;

  constructor(scope: Construct, id: string, props: SecretsStackProps) {
    super(scope, id, props);

    const accountId = cdk.Stack.of(this).account;
    const region = cdk.Stack.of(this).region;

    // =========================================================================
    // KMS Customer Managed Key
    // ⚠️ DRIFT POINT: The key policy references a specific role ARN.
    // If someone modifies this policy in the AWS Console (removing the ECS
    // task role, or changing conditions), CDK deploy fails because the
    // Fargate task can no longer decrypt the secret.
    // =========================================================================
    this.kmsKey = new kms.Key(this, 'ItemsServiceKey', {
      alias: `alias/items-service-${props.environment}`,
      description: `Encryption key for Items Service secrets (${props.environment})`,
      enableKeyRotation: true,
      removalPolicy: props.environment === 'production'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      // Key policy — controls who can use/manage this key
      policy: new iam.PolicyDocument({
        statements: [
          // Allow account root full management (standard best practice)
          new iam.PolicyStatement({
            sid: 'AllowRootAccountFullAccess',
            effect: iam.Effect.ALLOW,
            principals: [new iam.AccountRootPrincipal()],
            actions: ['kms:*'],
            resources: ['*'],
          }),
          // Allow the GitHub Actions deploy role to manage the key
          new iam.PolicyStatement({
            sid: 'AllowDeployRoleKeyManagement',
            effect: iam.Effect.ALLOW,
            principals: [
              new iam.ArnPrincipal(
                `arn:aws:iam::${accountId}:role/GitHubActionsRole-${props.environment}`
              ),
            ],
            actions: [
              'kms:Create*',
              'kms:Describe*',
              'kms:Enable*',
              'kms:List*',
              'kms:Put*',
              'kms:Update*',
              'kms:Revoke*',
              'kms:Disable*',
              'kms:Get*',
              'kms:Delete*',
              'kms:TagResource',
              'kms:UntagResource',
              'kms:ScheduleKeyDeletion',
              'kms:CancelKeyDeletion',
            ],
            resources: ['*'],
          }),
          // ⚠️ DRIFT-PRONE STATEMENT: This principal ARN is the one that
          // gets modified manually, causing Scenario 3 failures.
          // The ECS task role needs Decrypt + GenerateDataKey to read secrets.
          new iam.PolicyStatement({
            sid: 'AllowEcsTaskRoleDecrypt',
            effect: iam.Effect.ALLOW,
            principals: [
              new iam.ArnPrincipal(
                `arn:aws:iam::${accountId}:role/items-service-${props.environment}-task-role`
              ),
            ],
            actions: [
              'kms:Decrypt',
              'kms:GenerateDataKey',
              'kms:GenerateDataKeyWithoutPlaintext',
              'kms:DescribeKey',
            ],
            resources: ['*'],
            conditions: {
              StringEquals: {
                'kms:ViaService': `secretsmanager.${region}.amazonaws.com`,
              },
            },
          }),
          // Allow Secrets Manager service to use the key
          new iam.PolicyStatement({
            sid: 'AllowSecretsManagerUse',
            effect: iam.Effect.ALLOW,
            principals: [
              new iam.ServicePrincipal('secretsmanager.amazonaws.com'),
            ],
            actions: [
              'kms:Decrypt',
              'kms:GenerateDataKey',
              'kms:GenerateDataKeyWithoutPlaintext',
              'kms:CreateGrant',
              'kms:DescribeKey',
            ],
            resources: ['*'],
            conditions: {
              StringEquals: {
                'kms:CallerAccount': accountId,
              },
            },
          }),
        ],
      }),
    });

    // =========================================================================
    // Secrets Manager Secret — stores DB credentials and service config
    // =========================================================================
    this.secret = new secretsmanager.Secret(this, 'ItemsServiceSecret', {
      secretName: `${props.environment}/items-service/config`,
      description: `Configuration for Items Service (${props.environment})`,
      encryptionKey: this.kmsKey,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          database: {
            host: `items-db.${props.environment}.internal`,
            port: 5432,
            name: `items_${props.environment}`,
            username: 'items_service',
          },
          encryption: {
            kmsKeyId: `alias/items-service-${props.environment}`,
          },
          service: {
            port: 3000,
            environment: props.environment === 'production' ? 'production' : 'staging',
          },
        }),
        generateStringKey: 'database.password',
        excludePunctuation: true,
        passwordLength: 32,
      },
      removalPolicy: props.environment === 'production'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    // Outputs
    new cdk.CfnOutput(this, 'SecretArn', {
      value: this.secret.secretArn,
      description: 'Secret ARN for Items Service configuration',
      exportName: `${props.environment}-secret-arn`,
    });

    new cdk.CfnOutput(this, 'KmsKeyArn', {
      value: this.kmsKey.keyArn,
      description: 'KMS Key ARN for Items Service encryption',
      exportName: `${props.environment}-kms-key-arn`,
    });
  }
}
