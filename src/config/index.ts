/**
 * Configuration Module
 *
 * Loads application configuration from AWS Secrets Manager in production,
 * or falls back to environment variables for local development.
 * Validates all config values using Zod schemas.
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { z } from 'zod';
import pino from 'pino';

// Structured logger — uses JSON in production, pretty-print in dev
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  base: {
    service: 'items-service',
    version: process.env.npm_package_version || '1.0.0',
  },
});

// Configuration schema — validates all required values
const ConfigSchema = z.object({
  database: z.object({
    host: z.string().min(1),
    port: z.number().int().positive().default(5432),
    name: z.string().min(1),
    username: z.string().min(1),
    password: z.string().min(1),
  }),
  encryption: z.object({
    kmsKeyId: z.string().min(1),
  }),
  service: z.object({
    port: z.number().int().positive().default(3000),
    environment: z.enum(['development', 'staging', 'production']).default('development'),
  }),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

let _config: AppConfig | null = null;

/**
 * Load configuration from Secrets Manager or environment variables.
 * Caches the result for subsequent calls.
 */
export async function loadConfig(): Promise<AppConfig> {
  if (_config) return _config;

  const secretName = process.env.SECRET_NAME;
  const environment = process.env.NODE_ENV || 'development';

  if (secretName && environment !== 'development') {
    // Production path: load from Secrets Manager
    logger.info({ secretName }, 'Loading config from Secrets Manager');

    const client = new SecretsManagerClient({
      region: process.env.AWS_REGION || 'us-east-1',
      ...(process.env.AWS_ENDPOINT_URL && {
        endpoint: process.env.AWS_ENDPOINT_URL,
      }),
    });

    const response = await client.send(
      new GetSecretValueCommand({ SecretId: secretName })
    );

    if (!response.SecretString) {
      throw new Error(`Secret ${secretName} has no string value`);
    }

    const raw = JSON.parse(response.SecretString) as Record<string, unknown>;
    _config = ConfigSchema.parse(raw);
  } else {
    // Development fallback: use environment variables
    logger.info('Loading config from environment variables');

    _config = ConfigSchema.parse({
      database: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        name: process.env.DB_NAME || 'items_dev',
        username: process.env.DB_USERNAME || 'postgres',
        password: process.env.DB_PASSWORD || 'localdev',
      },
      encryption: {
        kmsKeyId: process.env.KMS_KEY_ID || 'alias/items-service-dev',
      },
      service: {
        port: parseInt(process.env.PORT || '3000', 10),
        environment: 'development',
      },
    });
  }

  return _config;
}

/**
 * Get the current configuration (throws if not loaded yet)
 */
export function getConfig(): AppConfig {
  if (!_config) {
    throw new Error('Configuration not loaded. Call loadConfig() first.');
  }
  return _config;
}
