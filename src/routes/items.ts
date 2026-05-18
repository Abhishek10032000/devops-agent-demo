/**
 * Items Routes
 *
 * CRUD endpoints for demo "items" resource.
 * Validates input with Zod, delegates to service layer.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ItemsService } from '../services/items.service';
import { logger } from '../config';

export const itemsRouter = Router();
const service = new ItemsService();

// Request validation schemas
const CreateItemSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  category: z.enum(['widget', 'gadget', 'component']),
  price: z.number().positive().max(99999.99),
  metadata: z.record(z.string()).optional(),
});

const UpdateItemSchema = CreateItemSchema.partial();

const PaginationSchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  category: z.enum(['widget', 'gadget', 'component']).optional(),
});

// GET /api/v1/items — List items with pagination
itemsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query = PaginationSchema.parse(req.query);
    const result = await service.listItems(query);

    res.status(200).json({
      data: result.items,
      pagination: {
        total: result.total,
        limit: query.limit,
        offset: query.offset,
        hasMore: query.offset + query.limit < result.total,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/items/:id — Get single item
itemsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const item = await service.getItem(req.params.id);

    if (!item) {
      res.status(404).json({
        error: 'NotFound',
        message: `Item ${req.params.id} not found`,
      });
      return;
    }

    res.status(200).json({ data: item });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/items — Create item
itemsRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = CreateItemSchema.parse(req.body);
    const item = await service.createItem(body);

    logger.info({ itemId: item.id }, 'Item created');
    res.status(201).json({ data: item });
  } catch (error) {
    next(error);
  }
});

// PUT /api/v1/items/:id — Update item
itemsRouter.put('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = UpdateItemSchema.parse(req.body);
    const item = await service.updateItem(req.params.id, body);

    if (!item) {
      res.status(404).json({
        error: 'NotFound',
        message: `Item ${req.params.id} not found`,
      });
      return;
    }

    logger.info({ itemId: item.id }, 'Item updated');
    res.status(200).json({ data: item });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/v1/items/:id — Delete item
itemsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const deleted = await service.deleteItem(req.params.id);

    if (!deleted) {
      res.status(404).json({
        error: 'NotFound',
        message: `Item ${req.params.id} not found`,
      });
      return;
    }

    logger.info({ itemId: req.params.id }, 'Item deleted');
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
