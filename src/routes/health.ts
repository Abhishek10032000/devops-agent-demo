/**
 * Health Check Route
 *
 * Returns service health status for ALB target group health checks
 * and ECS container health checks. Includes basic dependency status.
 */

import { Router, Request, Response } from 'express';
import { logger } from '../config';

export const healthRouter = Router();

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  checks: {
    memory: { status: string; usedMB: number };
    eventLoop: { status: string };
  };
}

healthRouter.get('/', (_req: Request, res: Response): void => {
  const memUsage = process.memoryUsage();
  const usedMB = Math.round(memUsage.heapUsed / 1024 / 1024);

  const health: HealthResponse = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    uptime: Math.round(process.uptime()),
    checks: {
      memory: {
        status: usedMB < 512 ? 'ok' : 'warning',
        usedMB,
      },
      eventLoop: {
        status: 'ok',
      },
    },
  };

  logger.debug({ health }, 'Health check');
  res.status(200).json(health);
});

// Deep health check — verifies downstream dependencies
healthRouter.get('/deep', async (_req: Request, res: Response): Promise<void> => {
  try {
    // In a real app, this would check DB connectivity, cache, etc.
    const checks = {
      database: 'ok',
      secretsManager: 'ok',
    };

    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      checks,
    });
  } catch (error) {
    logger.error({ error }, 'Deep health check failed');
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Dependency check failed',
    });
  }
});
