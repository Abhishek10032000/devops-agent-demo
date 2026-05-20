/**
 * Integration Tests — Items API
 *
 * Tests the full HTTP request/response cycle through Express.
 * Includes one INTENTIONALLY FLAKY test for demonstrating Scenario 2.
 *
 * ⚠️ DEMO NOTE: The test "should handle concurrent item creation without conflicts"
 * is FLAKY BY DESIGN. It uses a timing-sensitive race condition that fails
 * approximately 20-30% of the time in CI due to event loop scheduling variance.
 * This demonstrates how the DevOps Agent identifies and handles flaky tests:
 *   - Detects non-deterministic failure pattern across multiple runs
 *   - Uses GitHub MCP to check workflow run history for the same test
 *   - Suggests quarantining with jest.retryTimes() or @flaky annotation
 */

import request from 'supertest';
import { app } from '../../src/index';

describe('Items API Integration Tests', () => {
  describe('POST /api/v1/items', () => {
    it('should create a new item with valid input', async () => {
      const response = await request(app)
        .post('/api/v1/items')
        .send({
          name: 'Integration Test Widget',
          category: 'widget',
          price: 25.99,
          description: 'Created during integration testing',
        });

      expect(response.status).toBe(201);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.id).toBeDefined();
      expect(response.body.data.name).toBe('Integration Test Widget');
      expect(response.body.data.category).toBe('widget');
      expect(response.body.data.price).toBe(25.99);
    });

    it('should reject invalid input with 400', async () => {
      const response = await request(app)
        .post('/api/v1/items')
        .send({
          name: '', // Empty name — violates min(1)
          category: 'invalid_category',
          price: -5,
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('ValidationError');
      expect(response.body.details).toBeDefined();
      expect(Array.isArray(response.body.details)).toBe(true);
    });

    it('should reject request with missing required fields', async () => {
      const response = await request(app)
        .post('/api/v1/items')
        .send({ description: 'Missing name, category, and price' });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/v1/items', () => {
    it('should return paginated items list', async () => {
      const response = await request(app).get('/api/v1/items');

      expect(response.status).toBe(200);
      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.pagination).toBeDefined();
      expect(response.body.pagination.total).toBeGreaterThan(0);
    });

    it('should respect limit and offset parameters', async () => {
      const response = await request(app)
        .get('/api/v1/items')
        .query({ limit: 1, offset: 0 });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.pagination.limit).toBe(1);
      expect(response.body.pagination.offset).toBe(0);
    });

    it('should filter by category', async () => {
      // Create a known item first
      await request(app).post('/api/v1/items').send({
        name: 'Filter Test Gadget',
        category: 'gadget',
        price: 10.00,
      });

      const response = await request(app)
        .get('/api/v1/items')
        .query({ category: 'gadget' });

      expect(response.status).toBe(200);
      response.body.data.forEach((item: { category: string }) => {
        expect(item.category).toBe('gadget');
      });
    });
  });

  describe('GET /api/v1/items/:id', () => {
    it('should return 404 for non-existent item', async () => {
      const response = await request(app).get('/api/v1/items/non-existent-uuid');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('NotFound');
    });

    it('should return a specific item by id', async () => {
      // Create an item first
      const createResponse = await request(app)
        .post('/api/v1/items')
        .send({ name: 'Specific Item', category: 'component', price: 50.00 });

      const itemId = createResponse.body.data.id;

      const response = await request(app).get(`/api/v1/items/${itemId}`);

      expect(response.status).toBe(200);
      expect(response.body.data.id).toBe(itemId);
      expect(response.body.data.name).toBe('Specific Item');
    });
  });

  describe('PUT /api/v1/items/:id', () => {
    it('should update an existing item', async () => {
      // Create item
      const createResponse = await request(app)
        .post('/api/v1/items')
        .send({ name: 'Before Update', category: 'widget', price: 10.00 });

      const itemId = createResponse.body.data.id;

      // Update it
      const response = await request(app)
        .put(`/api/v1/items/${itemId}`)
        .send({ name: 'After Update', price: 20.00 });

      expect(response.status).toBe(200);
      expect(response.body.data.name).toBe('After Update');
      expect(response.body.data.price).toBe(20.00);
      expect(response.body.data.category).toBe('widget'); // unchanged
    });
  });

  describe('DELETE /api/v1/items/:id', () => {
    it('should delete an existing item', async () => {
      // Create item
      const createResponse = await request(app)
        .post('/api/v1/items')
        .send({ name: 'To Be Deleted', category: 'gadget', price: 5.00 });

      const itemId = createResponse.body.data.id;

      // Delete it
      const response = await request(app).delete(`/api/v1/items/${itemId}`);
      expect(response.status).toBe(204);

      // Verify it's gone
      const getResponse = await request(app).get(`/api/v1/items/${itemId}`);
      expect(getResponse.status).toBe(404);
    });
  });

  // ===========================================================================
  // ⚠️ INTENTIONALLY FLAKY TEST — SCENARIO 2 DEMO
  // ===========================================================================
  describe('Concurrent Operations (FLAKY BY DESIGN)', () => {
    /**
     * FLAKY TEST: This test creates multiple items concurrently and asserts
     * on exact timing-dependent ordering. It fails ~20-30% of the time because:
     *
     * 1. The createdAt timestamps can be identical at millisecond precision
     *    when the event loop processes promises in the same tick
     * 2. Array.sort() is not stable for equal elements in all engines
     * 3. The 50ms delay is insufficient to guarantee ordering in CI
     *
     * When this fails, the DevOps Agent:
     * - Recognizes the non-deterministic pattern (passes locally, fails in CI)
     * - Pulls the test file via GitHub MCP to inspect the assertion
     * - Checks GitHub Actions run history for intermittent pass/fail
     * - Recommends: add jest.retryTimes(3), use deterministic ordering,
     *   or quarantine with a @flaky tag
     */
    it('should handle concurrent item creation without conflicts', async () => {
      const items = Array.from({ length: 5 }, (_, i) => ({
        name: `Concurrent Item ${i}`,
        category: 'widget' as const,
        price: 10.00 + i,
      }));

      // Fire all creates concurrently
      const responses = await Promise.all(
        items.map((item) =>
          request(app).post('/api/v1/items').send(item)
        )
      );

      // All should succeed
      responses.forEach((res) => {
        expect(res.status).toBe(201);
      });

      // ⚠️ FLAKY ASSERTION: Assumes items are returned in exact creation order.
      // In practice, concurrent creates may have identical timestamps, making
      // the sort order non-deterministic. This is the intentional flake point.
      await new Promise((resolve) => setTimeout(resolve, 50)); // insufficient delay

      const listResponse = await request(app)
        .get('/api/v1/items')
        .query({ limit: 100 });

      const returnedNames = listResponse.body.data
        .filter((item: { name: string }) => item.name.startsWith('Concurrent Item'))
        .map((item: { name: string }) => item.name);

      // This assertion expects a specific order that isn't guaranteed
      // when items have the same millisecond-precision timestamp
      expect(returnedNames).toEqual(
        expect.arrayContaining([
          'Concurrent Item 4', // Most recent should be first (desc sort)
          'Concurrent Item 3',
          'Concurrent Item 2',
          'Concurrent Item 1',
          'Concurrent Item 0',
        ])
      );

      // ⚠️ FLAKY: Strict ordering assertion — fails when timestamps collide
      const firstItem = listResponse.body.data.find(
        (item: { name: string }) => item.name === 'Concurrent Item 4'
      );
      const lastItem = listResponse.body.data.find(
        (item: { name: string }) => item.name === 'Concurrent Item 0'
      );

      // This comparison fails when both items get the same createdAt timestamp
      expect(new Date(firstItem.createdAt).getTime())
        .toBeGreaterThan(new Date(lastItem.createdAt).getTime());
    });
  });
});
