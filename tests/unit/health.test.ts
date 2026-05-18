/**
 * Unit Tests — Health Check Endpoint
 *
 * Tests the /health route returns correct status and structure.
 */

import request from 'supertest';
import express from 'express';
import { healthRouter } from '../../src/routes/health';

const app = express();
app.use('/health', healthRouter);

describe('GET /health', () => {
  it('should return 200 with healthy status', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('healthy');
  });

  it('should include version information', async () => {
    const response = await request(app).get('/health');

    expect(response.body.version).toBeDefined();
    expect(typeof response.body.version).toBe('string');
  });

  it('should include timestamp in ISO format', async () => {
    const response = await request(app).get('/health');

    expect(response.body.timestamp).toBeDefined();
    // Verify ISO 8601 format
    const parsed = new Date(response.body.timestamp);
    expect(parsed.toISOString()).toBe(response.body.timestamp);
  });

  it('should include uptime as a non-negative number', async () => {
    const response = await request(app).get('/health');

    expect(response.body.uptime).toBeDefined();
    expect(typeof response.body.uptime).toBe('number');
    expect(response.body.uptime).toBeGreaterThanOrEqual(0);
  });

  it('should include memory and event loop checks', async () => {
    const response = await request(app).get('/health');

    expect(response.body.checks).toBeDefined();
    expect(response.body.checks.memory).toBeDefined();
    expect(response.body.checks.memory.status).toBe('ok');
    expect(response.body.checks.memory.usedMB).toBeGreaterThan(0);
    expect(response.body.checks.eventLoop.status).toBe('ok');
  });
});

describe('GET /health/deep', () => {
  it('should return 200 with dependency checks', async () => {
    const response = await request(app).get('/health/deep');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('healthy');
    expect(response.body.checks).toBeDefined();
  });
});
