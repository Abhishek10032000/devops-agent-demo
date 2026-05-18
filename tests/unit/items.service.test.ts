/**
 * Unit Tests — ItemsService
 *
 * Tests the business logic layer in isolation.
 * These tests are deterministic and always pass.
 */

import { ItemsService, CreateItemInput } from '../../src/services/items.service';

describe('ItemsService', () => {
  let service: ItemsService;

  beforeEach(() => {
    service = new ItemsService();
  });

  describe('listItems', () => {
    it('should return seeded items with pagination', async () => {
      const result = await service.listItems({ limit: 10, offset: 0 });

      expect(result.items).toHaveLength(3); // 3 seed items
      expect(result.total).toBe(3);
    });

    it('should respect limit parameter', async () => {
      const result = await service.listItems({ limit: 1, offset: 0 });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(3);
    });

    it('should respect offset parameter', async () => {
      const result = await service.listItems({ limit: 10, offset: 2 });

      expect(result.items).toHaveLength(1);
    });

    it('should filter by category', async () => {
      const result = await service.listItems({
        limit: 10,
        offset: 0,
        category: 'widget',
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].category).toBe('widget');
    });

    it('should return empty array for unknown category offset', async () => {
      const result = await service.listItems({ limit: 10, offset: 100 });

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(3);
    });
  });

  describe('createItem', () => {
    it('should create an item with generated id and timestamps', async () => {
      const input: CreateItemInput = {
        name: 'Test Item',
        category: 'widget',
        price: 19.99,
        description: 'A test widget',
      };

      const item = await service.createItem(input);

      expect(item.id).toBeDefined();
      expect(item.id).toHaveLength(36); // UUID format
      expect(item.name).toBe('Test Item');
      expect(item.category).toBe('widget');
      expect(item.price).toBe(19.99);
      expect(item.description).toBe('A test widget');
      expect(item.createdAt).toBeDefined();
      expect(item.updatedAt).toBeDefined();
    });

    it('should increment item count after creation', async () => {
      const initialCount = service.getCount();

      await service.createItem({
        name: 'New Item',
        category: 'gadget',
        price: 49.99,
      });

      expect(service.getCount()).toBe(initialCount + 1);
    });

    it('should handle optional metadata', async () => {
      const item = await service.createItem({
        name: 'Tagged Item',
        category: 'component',
        price: 99.99,
        metadata: { color: 'blue', size: 'large' },
      });

      expect(item.metadata).toEqual({ color: 'blue', size: 'large' });
    });
  });

  describe('getItem', () => {
    it('should return item by id', async () => {
      const created = await service.createItem({
        name: 'Findable Item',
        category: 'widget',
        price: 9.99,
      });

      const found = await service.getItem(created.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.name).toBe('Findable Item');
    });

    it('should return null for non-existent id', async () => {
      const found = await service.getItem('non-existent-id');
      expect(found).toBeNull();
    });
  });

  describe('updateItem', () => {
    it('should update specified fields only', async () => {
      const created = await service.createItem({
        name: 'Original Name',
        category: 'widget',
        price: 10.00,
      });

      const updated = await service.updateItem(created.id, {
        name: 'Updated Name',
        price: 15.00,
      });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Updated Name');
      expect(updated!.price).toBe(15.00);
      expect(updated!.category).toBe('widget'); // unchanged
    });

    it('should update the updatedAt timestamp', async () => {
      const created = await service.createItem({
        name: 'Time Test',
        category: 'gadget',
        price: 5.00,
      });

      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = await service.updateItem(created.id, { price: 6.00 });

      expect(updated!.updatedAt).not.toBe(created.createdAt);
    });

    it('should return null for non-existent id', async () => {
      const result = await service.updateItem('non-existent', { name: 'X' });
      expect(result).toBeNull();
    });
  });

  describe('deleteItem', () => {
    it('should delete existing item and return true', async () => {
      const created = await service.createItem({
        name: 'Deletable',
        category: 'component',
        price: 1.00,
      });

      const result = await service.deleteItem(created.id);
      expect(result).toBe(true);

      const found = await service.getItem(created.id);
      expect(found).toBeNull();
    });

    it('should return false for non-existent id', async () => {
      const result = await service.deleteItem('non-existent');
      expect(result).toBe(false);
    });

    it('should decrement item count after deletion', async () => {
      const created = await service.createItem({
        name: 'Will Delete',
        category: 'gadget',
        price: 2.00,
      });

      const countBefore = service.getCount();
      await service.deleteItem(created.id);

      expect(service.getCount()).toBe(countBefore - 1);
    });
  });
});
