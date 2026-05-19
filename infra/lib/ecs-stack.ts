/**
 * ECS Stack — Fargate Service + Application Load Balancer
 *
 * Deploys the Items Service container on ECS Fargate behind an ALB.
 * Includes auto-scaling, health checks, and proper IAM task roles.
 */

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';

export interface EcsStackProps extends cdk.StackProps {
  environment: string;
  imageTag: string;
  vpc: ec2.IVpc;
  secret: secretsmanager.ISecret;
  kmsKey: kms.IKey;
}

export class EcsStack extends cdk.Stack {
  public readonly service: ecs.FargateService;
  public readonly alb: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: EcsStackProps) {
    super(scope, id, props);

    const accountId = cdk.Stack.of(this).account;
    const region = cdk.Stack.of(this).region;

    // =========================================================================
    // ECS Cluster
    // =========================================================================
    const cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: `items-service-${props.environment}`,
      vpc: props.vpc,
      containerInsights: true,
    });

    // =========================================================================
    // Task Execution Role — used by ECS agent to pull images, push logs
    // =========================================================================
    const executionRole = new iam.Role(this, 'TaskExecutionRole', {
      roleName: `items-service-${props.environment}-execution-role`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonECSTaskExecutionRolePolicy'
        ),
      ],
    });

    // Allow execution role to read the secret (for container secrets injection)
    props.secret.grantRead(executionRole);
    props.kmsKey.grantDecrypt(executionRole);

    // =========================================================================
    // Task Role — assumed by the running container for app-level AWS calls
    // ⚠️ NOTE: This role name must match the KMS key policy in secrets-stack.ts
    // If the role name changes or the key policy drifts, Scenario 3 triggers.
    // =========================================================================
    const taskRole = new iam.Role(this, 'TaskRole', {
      roleName: `items-service-${props.environment}-task-role`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });


    // =========================================================================
    // Task Definition
    // =========================================================================
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      family: `items-service-${props.environment}`,
      memoryLimitMiB: props.environment === 'production' ? 1024 : 512,
      cpu: props.environment === 'production' ? 512 : 256,
      executionRole,
      taskRole,
    });

    // ECR Repository reference
    const repository = ecr.Repository.fromRepositoryName(
      this, 'Repo', 'items-service'
    );

    // Log group for container output
    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: `/ecs/items-service/${props.environment}`,
      retention: props.environment === 'production'
        ? logs.RetentionDays.THREE_MONTHS
        : logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Container definition
    const container = taskDefinition.addContainer('items-service', {
      image: ecs.ContainerImage.fromEcrRepository(repository, props.imageTag),
      logging: ecs.LogDrivers.awsLogs({
        logGroup,
        streamPrefix: 'ecs',
      }),
      environment: {
        NODE_ENV: props.environment === 'production' ? 'production' : 'staging',
        PORT: '3000',
        AWS_REGION: region,
        SECRET_NAME: `${props.environment}/items-service/config`,
        LOG_LEVEL: props.environment === 'production' ? 'info' : 'debug',
      },
      healthCheck: {
        command: ['CMD-SHELL', 'wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(15),
      },
    });

    container.addPortMappings({
      containerPort: 3000,
      protocol: ecs.Protocol.TCP,
    });

    // =========================================================================
    // Application Load Balancer
    // =========================================================================
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      loadBalancerName: `items-svc-${props.environment}`,
      vpc: props.vpc,
      internetFacing: true,
      securityGroup: new ec2.SecurityGroup(this, 'AlbSg', {
        vpc: props.vpc,
        allowAllOutbound: true,
        description: 'ALB security group for Items Service',
      }),
    });

    // Allow inbound HTTP (in production, you'd use HTTPS with ACM cert)
    this.alb.connections.allowFromAnyIpv4(ec2.Port.tcp(80));

    const listener = this.alb.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
    });

    // =========================================================================
    // Fargate Service
    // =========================================================================
    this.service = new ecs.FargateService(this, 'Service', {
      serviceName: `items-service-${props.environment}`,
      cluster,
      taskDefinition,
      desiredCount: props.environment === 'production' ? 3 : 1,
      assignPublicIp: false, // Private subnets only
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      circuitBreaker: { rollback: true },
      enableExecuteCommand: true, // For ECS Exec debugging
    });

    // Register with ALB target group
    const targetGroup = listener.addTargets('EcsTarget', {
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [this.service],
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        healthyHttpCodes: '200',
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    // =========================================================================
    // Auto Scaling
    // =========================================================================
    if (props.environment === 'production') {
      const scaling = this.service.autoScaleTaskCount({
        minCapacity: 2,
        maxCapacity: 10,
      });

      scaling.scaleOnCpuUtilization('CpuScaling', {
        targetUtilizationPercent: 70,
        scaleInCooldown: cdk.Duration.seconds(60),
        scaleOutCooldown: cdk.Duration.seconds(30),
      });

      scaling.scaleOnRequestCount('RequestScaling', {
        requestsPerTarget: 1000,
        targetGroup,
        scaleInCooldown: cdk.Duration.seconds(60),
        scaleOutCooldown: cdk.Duration.seconds(30),
      });
    }

    // Allow ECS tasks to access ALB
    this.service.connections.allowFrom(this.alb, ec2.Port.tcp(3000));

    // =========================================================================
    // Outputs
    // =========================================================================
    new cdk.CfnOutput(this, 'AlbEndpoint', {
      value: `http://${this.alb.loadBalancerDnsName}`,
      description: 'Application Load Balancer endpoint',
      exportName: `${props.environment}-alb-endpoint`,
    });

    new cdk.CfnOutput(this, 'ServiceArn', {
      value: this.service.serviceArn,
      description: 'ECS Service ARN',
      exportName: `${props.environment}-service-arn`,
    });

    new cdk.CfnOutput(this, 'ClusterName', {
      value: cluster.clusterName,
      description: 'ECS Cluster name',
      exportName: `${props.environment}-cluster-name`,
    });
  }
}
