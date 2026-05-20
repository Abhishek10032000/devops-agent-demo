/**
 * Items Service — Business Logic Layer
 *
 * Manages CRUD operations for items. In this demo, uses an in-memory store.
 * In production, this would interface with DynamoDB or RDS via the config
 * loaded from Secrets Manager.
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../config';

export interface Item {
  id: string;
  name: string;
  description?: string;
  category: 'widget' | 'gadget' | 'component';
  price: number;
  metadata?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateItemInput {
  name: string;
  description?: string;
  category: 'widget' | 'gadget' | 'component';
  price: number;
  metadata?: Record<string, string>;
}

export interface UpdateItemInput {
  name?: string;
  description?: string;
  category?: 'widget' | 'gadget' | 'component';
  price?: number;
  metadata?: Record<string, string>;
}

export interface ListItemsQuery {
  limit: number;
  offset: number;
  category?: 'widget' | 'gadget' | 'component';
}

export interface ListItemsResult {
  items: Item[];
  total: number;
}

/**
 * In-memory item store for demo purposes.
 * Replace with DynamoDB/RDS client in production.
 */
export class ItemsService {
  private items: Map<string, Item> = new Map();

  constructor() {
    // Seed with sample data
    this.seed();
  }

  private seed(): void {
    const seedItems: CreateItemInput[] = [
      { name: 'Flux Capacitor', category: 'component', price: 149.99 },
      { name: 'Quantum Widget', category: 'widget', price: 29.99, description: 'A widget that exists in superposition' },
      { name: 'Turbo Gadget', category: 'gadget', price: 79.99 },
    ];

    for (const input of seedItems) {
      const item: Item = {
        id: uuidv4(),
        ...input,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.items.set(item.id, item);
    }

    logger.debug({ count: this.items.size }, 'Seeded items store');
  }

  async listItems(query: ListItemsQuery): Promise<ListItemsResult> {
    let items = Array.from(this.items.values());

    // Filter by category if specified
    if (query.category) {
      items = items.filter((item) => item.category === query.category);
    }

    // Sort by createdAt descending
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = items.length;
    const paged = items.slice(query.offset, query.offset + query.limit);

    return { items: paged, total };
  }

  async getItem(id: string): Promise<Item | null> {
    return this.items.get(id) || null;
  }

  async createItem(input: CreateItemInput): Promise<Item> {
    const now = new Date().toISOString();
    const item: Item = {
      id: uuidv4(),
      ...input,
      createdAt: now,
      updatedAt: now,
      invalidField: 123,
    };

    this.items.set(item.id, item);
    logger.info({ itemId: item.id, name: item.name }, 'Created item');

    return item;
  }

  async updateItem(id: string, input: UpdateItemInput): Promise<Item | null> {
    const existing = this.items.get(id);
    if (!existing) return null;

    const updated: Item = {
      ...existing,
      ...input,
      updatedAt: new Date().toISOString(),
    };

    this.items.set(id, updated);
    logger.info({ itemId: id }, 'Updated item');

    return updated;
  }

  async deleteItem(id: string): Promise<boolean> {
    if (!this.items.has(id)) return false;

    this.items.delete(id);
    logger.info({ itemId: id }, 'Deleted item');

    return true;
  }

  /**
   * Get total count — used for testing and monitoring
   */
  getCount(): number {
    return this.items.size;
  }
}
