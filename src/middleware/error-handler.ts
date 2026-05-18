/**
 * Global Error Handler Middleware
 *
 * Catches all unhandled errors, formats them consistently,
 * and logs structured error details for observability.
 */

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../config';

interface ErrorResponse {
  error: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

/**
 * Express error handling middleware.
 * Must have 4 parameters for Express to recognize it as error handler.
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = req.headers['x-request-id'] as string | undefined;

  // Zod validation errors → 400 Bad Request
  if (err instanceof ZodError) {
    const response: ErrorResponse = {
      error: 'ValidationError',
      message: 'Request validation failed',
      details: err.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      })),
      requestId,
    };

    logger.warn({ err, path: req.path }, 'Validation error');
    res.status(400).json(response);
    return;
  }

  // Known application errors
  if (err.name === 'NotFoundError') {
    res.status(404).json({
      error: 'NotFound',
      message: err.message,
      requestId,
    });
    return;
  }

  if (err.name === 'ConflictError') {
    res.status(409).json({
      error: 'Conflict',
      message: err.message,
      requestId,
    });
    return;
  }

  // AWS SDK errors
  if ('$metadata' in err) {
    logger.error({ err, service: 'aws-sdk', path: req.path }, 'AWS SDK error');
    res.status(502).json({
      error: 'UpstreamError',
      message: 'An upstream service error occurred',
      requestId,
    });
    return;
  }

  // Unexpected errors → 500 Internal Server Error
  logger.error(
    {
      err,
      method: req.method,
      path: req.path,
      query: req.query,
    },
    'Unhandled error'
  );

  res.status(500).json({
    error: 'InternalServerError',
    message: process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred'
      : err.message,
    requestId,
  });
}
