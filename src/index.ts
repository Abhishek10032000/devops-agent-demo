/**
 * Items Service — Entry Point
 *
 * A lightweight REST API demonstrating a production-ready Node.js
 * microservice deployed to AWS ECS Fargate. Uses structured logging,
 * graceful shutdown, and configuration from AWS Secrets Manager.
 */

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { logger } from './config';
import { loadConfig } from './config';
import { healthRouter } from './routes/health';
import { itemsRouter } from './routes/items';
import { errorHandler } from './middleware/error-handler';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp({ logger }));

// Routes
app.use('/health', healthRouter);
app.use('/api/v1/items', itemsRouter);

// Global error handler (must be last)
app.use(errorHandler);

/**
 * Bootstrap the application:
 * 1. Load configuration from Secrets Manager
 * 2. Start HTTP server
 * 3. Register graceful shutdown handlers
 */
async function bootstrap(): Promise<void> {
  try {
    // Load config from AWS Secrets Manager (or env vars in dev)
    await loadConfig();
    logger.info('Configuration loaded successfully');

    const server = app.listen(PORT, () => {
      logger.info({ port: PORT }, '🚀 Items Service is running');
    });

    // Graceful shutdown for ECS SIGTERM
    const shutdown = (signal: string): void => {
      logger.info({ signal }, 'Received shutdown signal, draining connections...');
      server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
      });

      // Force exit if connections don't drain within 10s
      setTimeout(() => {
        logger.warn('Forcing shutdown after timeout');
        process.exit(1);
      }, 10_000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.fatal({ error }, 'Failed to start application');
    process.exit(1);
  }
}

// Only start if this is the main module (not imported in tests)
if (require.main === module) {
  void bootstrap();
}

export { app };
