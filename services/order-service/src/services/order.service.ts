import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { withTransaction } from '../config/database';
import { orderRepository, ListOrdersFilter } from '../repositories/order.repository';
import { outboxRepository } from '../repositories/outbox.repository';
import { idempotencyRepository } from '../repositories/idempotency.repository';
import { Order, OrderItem, OrderStatus, OrderStatusHistory } from '../types/order.types';
import { CreateOrderInput, UpdateOrderInput, CancelOrderInput } from '../validators/order.validator';
import { calculateOrderTotals, formatQuantity } from '../utils/money';
import {
  NotFoundError,
  ConflictError,
  StaleVersionError,
  IdempotencyConflictError
} from '../utils/errors';
import { PaginationParams, PaginationMeta, buildPaginationMeta } from '../utils/pagination';
import { computeSha256, canonicalizeJson } from '../utils/hash';
import { env } from '../config/env';

export class OrderService {
  /**
   * Generates a unique, human-readable order number: ORD-YYYYMMDD-<HEX>
   */
  private generateOrderNumber(): string {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `ORD-${yyyy}${mm}${dd}-${randomHex}`;
  }

  /**
   * Creates a new order atomically within a database transaction.
   * Includes order, items, initial status history, outbox event, and idempotency record.
   */
  async createOrder(
    input: CreateOrderInput,
    idempotencyKey?: string,
    requestId?: string
  ): Promise<{ order: Order; isReplay: boolean }> {
    const requestHash = computeSha256(canonicalizeJson(input));

    // 1. Check idempotency if key is provided
    if (idempotencyKey) {
      const existing = await idempotencyRepository.findByKey(idempotencyKey);
      if (existing) {
        const isExpired = new Date(existing.expiresAt).getTime() <= Date.now();
        if (!isExpired) {
          if (existing.requestHash !== requestHash) {
            throw new IdempotencyConflictError(
              'The provided Idempotency-Key was previously used with a different request payload.'
            );
          }
          if (existing.responseStatus !== null && existing.orderId) {
            const replayedOrder = await this.getOrderById(existing.orderId);
            return { order: replayedOrder, isReplay: true };
          }
          throw new ConflictError(
            'A request with this Idempotency-Key is currently being processed.'
          );
        }
      }
    }

    // 2. Perform monetary calculations safely on server
    const totals = calculateOrderTotals(
      input.items,
      input.taxAmount,
      input.shippingAmount,
      input.discountAmount
    );

    const orderId = uuidv4();
    const orderNumber = this.generateOrderNumber();
    const nowIso = new Date().toISOString();

    const order: Order = {
      id: orderId,
      orderNumber,
      customerId: input.customerId,
      customerReference: input.customerReference || null,
      origin: input.origin,
      destination: input.destination,
      currencyCode: input.currencyCode,
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      shippingAmount: totals.shippingAmount,
      discountAmount: totals.discountAmount,
      totalAmount: totals.totalAmount,
      status: 'PENDING',
      notes: input.notes || null,
      requestedPickupAt: input.requestedPickupAt || null,
      requestedDeliveryAt: input.requestedDeliveryAt || null,
      createdAt: nowIso,
      updatedAt: nowIso,
      version: 1
    };

    const orderItems: OrderItem[] = input.items.map((item, index) => ({
      id: uuidv4(),
      orderId,
      lineNumber: index + 1,
      itemName: item.itemName,
      sku: item.sku || null,
      description: item.description || null,
      quantity: formatQuantity(item.quantity),
      unitOfMeasure: item.unitOfMeasure,
      unitPrice: totals.calculatedLineTotals[index]
        ? (Number(totals.calculatedLineTotals[index]) / item.quantity).toFixed(2)
        : Number(item.unitPrice).toFixed(2),
      lineTotal: totals.calculatedLineTotals[index],
      weightKg: item.weightKg !== undefined && item.weightKg !== null ? formatQuantity(item.weightKg) : null,
      lengthCm: item.lengthCm !== undefined && item.lengthCm !== null ? Number(item.lengthCm).toFixed(2) : null,
      widthCm: item.widthCm !== undefined && item.widthCm !== null ? Number(item.widthCm).toFixed(2) : null,
      heightCm: item.heightCm !== undefined && item.heightCm !== null ? Number(item.heightCm).toFixed(2) : null,
      createdAt: nowIso,
      updatedAt: nowIso
    }));

    const historyRecord: OrderStatusHistory = {
      id: uuidv4(),
      orderId,
      previousStatus: null,
      newStatus: 'PENDING',
      changedBy: input.customerId,
      reason: 'Order created',
      createdAt: nowIso
    };

    const outboxEvent = {
      id: uuidv4(),
      aggregateType: 'Order',
      aggregateId: orderId,
      eventType: 'order.created.v1',
      eventVersion: 1,
      payload: {
        eventId: uuidv4(),
        eventType: 'order.created.v1',
        eventVersion: 1,
        occurredAt: nowIso,
        producer: 'order-service',
        aggregateId: orderId,
        correlationId: requestId || null,
        orderId,
        orderNumber,
        customerId: input.customerId,
        customerReference: input.customerReference || null,
        currencyCode: input.currencyCode,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        shippingAmount: totals.shippingAmount,
        discountAmount: totals.discountAmount,
        totalAmount: totals.totalAmount,
        status: 'PENDING',
        origin: {
          address: input.origin.addressLine1,
          addressLine1: input.origin.addressLine1,
          addressLine2: input.origin.addressLine2 || null,
          city: input.origin.city,
          state: input.origin.state || null,
          postalCode: input.origin.postalCode || null,
          countryCode: input.origin.countryCode
        },
        destination: {
          address: input.destination.addressLine1,
          addressLine1: input.destination.addressLine1,
          addressLine2: input.destination.addressLine2 || null,
          city: input.destination.city,
          state: input.destination.state || null,
          postalCode: input.destination.postalCode || null,
          countryCode: input.destination.countryCode
        },
        itemCount: orderItems.length,
        items: orderItems.map((item) => ({
          lineNumber: item.lineNumber,
          itemName: item.itemName,
          sku: item.sku,
          quantity: item.quantity,
          unitOfMeasure: item.unitOfMeasure,
          lineTotal: item.lineTotal
        }))
      }
    };

    const expiresAt = new Date(Date.now() + env.IDEMPOTENCY_KEY_TTL_HOURS * 3600 * 1000);

    // 3. Atomically write order, items, status history, outbox event, and idempotency key
    await withTransaction(async (conn) => {
      // Create idempotency reservation if key supplied
      if (idempotencyKey) {
        await idempotencyRepository.createInitialKey(
          {
            id: uuidv4(),
            key: idempotencyKey,
            requestHash,
            expiresAt
          },
          conn
        );
      }

      await orderRepository.createOrder(order, conn);
      await orderRepository.createOrderItems(orderItems, conn);
      await orderRepository.addStatusHistory(historyRecord, conn);
      await outboxRepository.insertEvent(outboxEvent, conn);
    });

    order.items = orderItems;
    return { order, isReplay: false };
  }

  /**
   * Saves the final response body in the idempotency record after commit.
   */
  async cacheIdempotentResponse(
    key: string,
    statusCode: number,
    responseBody: unknown,
    orderId: string
  ): Promise<void> {
    try {
      await idempotencyRepository.saveResponse(key, statusCode, responseBody, orderId);
    } catch (err) {
      // Non-fatal if caching response fails after successful order creation
    }
  }

  /**
   * Retrieves an order by its ID with all child items.
   */
  async getOrderById(id: string): Promise<Order> {
    const order = await orderRepository.findById(id);
    if (!order) {
      throw new NotFoundError(`Order with ID '${id}' was not found.`);
    }

    order.items = await orderRepository.findItemsByOrderId(id);
    return order;
  }

  /**
   * Retrieves an order by its human-readable order number with items.
   */
  async getOrderByOrderNumber(orderNumber: string): Promise<Order> {
    const order = await orderRepository.findByOrderNumber(orderNumber);
    if (!order) {
      throw new NotFoundError(`Order with order number '${orderNumber}' was not found.`);
    }

    order.items = await orderRepository.findItemsByOrderId(order.id);
    return order;
  }

  /**
   * Lists orders with filters and safe pagination.
   */
  async listOrders(
    filters: ListOrdersFilter,
    pagination: PaginationParams
  ): Promise<{ orders: Order[]; meta: PaginationMeta }> {
    const { orders, total } = await orderRepository.listOrders(filters, pagination);
    const meta = buildPaginationMeta(pagination.page, pagination.limit, total);

    return { orders, meta };
  }

  /**
   * Updates explicitly permitted fields with optimistic concurrency locking.
   */
  async updateOrder(id: string, input: UpdateOrderInput): Promise<Order> {
    const existing = await orderRepository.findById(id);
    if (!existing) {
      throw new NotFoundError(`Order with ID '${id}' was not found.`);
    }

    if (existing.status === 'CANCELLED') {
      throw new ConflictError('Cannot update an order that is CANCELLED.');
    }

    if (input.version !== undefined && input.version !== existing.version) {
      throw new StaleVersionError(
        `Version conflict: provided version ${input.version} does not match current version ${existing.version}.`
      );
    }

    await withTransaction(async (conn) => {
      const result = await orderRepository.updatePermittedFields(
        id,
        input.version,
        {
          customerReference: input.customerReference,
          origin: input.origin,
          destination: input.destination,
          notes: input.notes,
          requestedPickupAt: input.requestedPickupAt,
          requestedDeliveryAt: input.requestedDeliveryAt
        },
        conn
      );

      if (!result.updated) {
        throw new StaleVersionError(
          `Version conflict: the order was modified concurrently (current version: ${result.currentVersion}).`
        );
      }
    });

    return this.getOrderById(id);
  }

  /**
   * Transition order from PENDING -> CONFIRMED
   */
  async confirmOrder(id: string, actorId?: string, requestId?: string): Promise<Order> {
    const existing = await orderRepository.findById(id);
    if (!existing) {
      throw new NotFoundError(`Order with ID '${id}' was not found.`);
    }

    if (existing.status !== 'PENDING') {
      throw new ConflictError(
        `Invalid status transition: cannot confirm order with current status '${existing.status}'. Only PENDING orders can be confirmed.`
      );
    }

    const nowIso = new Date().toISOString();

    await withTransaction(async (conn) => {
      const updateResult = await orderRepository.updateStatus(id, 'PENDING', 'CONFIRMED', conn);
      if (!updateResult.updated) {
        throw new ConflictError('Order status transition conflict. Please reload and retry.');
      }

      await orderRepository.addStatusHistory(
        {
          id: uuidv4(),
          orderId: id,
          previousStatus: 'PENDING',
          newStatus: 'CONFIRMED',
          changedBy: actorId || 'system',
          reason: 'Order confirmed by operator or client request',
          createdAt: nowIso
        },
        conn
      );

      await outboxRepository.insertEvent(
        {
          id: uuidv4(),
          aggregateType: 'Order',
          aggregateId: id,
          eventType: 'order.confirmed.v1',
          eventVersion: 1,
          payload: {
            eventId: uuidv4(),
            eventType: 'order.confirmed.v1',
            eventVersion: 1,
            occurredAt: nowIso,
            producer: 'order-service',
            aggregateId: id,
            correlationId: requestId || null,
            orderId: id,
            orderNumber: existing.orderNumber,
            customerId: existing.customerId,
            previousStatus: 'PENDING',
            status: 'CONFIRMED',
            version: updateResult.newVersion,
            origin: existing.origin,
            destination: existing.destination
          }
        },
        conn
      );
    });

    return this.getOrderById(id);
  }

  /**
   * Transition order to CANCELLED (from PENDING, or CONFIRMED if permitted)
   */
  async cancelOrder(
    id: string,
    input: CancelOrderInput,
    actorId?: string,
    requestId?: string
  ): Promise<Order> {
    const existing = await orderRepository.findById(id);
    if (!existing) {
      throw new NotFoundError(`Order with ID '${id}' was not found.`);
    }

    if (existing.status === 'CANCELLED') {
      throw new ConflictError('Order is already cancelled.');
    }

    // Business policy for cancellation:
    // PENDING: allowed immediately.
    // CONFIRMED: allowed with recorded reason (and shipment integration check point).
    if (existing.status !== 'PENDING' && existing.status !== 'CONFIRMED') {
      throw new ConflictError(
        `Invalid status transition: cannot cancel order with current status '${existing.status}'.`
      );
    }

    const nowIso = new Date().toISOString();
    const reason = input.reason || 'Order cancelled by customer/operator request';

    await withTransaction(async (conn) => {
      const updateResult = await orderRepository.updateStatus(id, existing.status, 'CANCELLED', conn);
      if (!updateResult.updated) {
        throw new ConflictError('Order status transition conflict. Please reload and retry.');
      }

      await orderRepository.addStatusHistory(
        {
          id: uuidv4(),
          orderId: id,
          previousStatus: existing.status,
          newStatus: 'CANCELLED',
          changedBy: actorId || 'system',
          reason,
          createdAt: nowIso
        },
        conn
      );

      await outboxRepository.insertEvent(
        {
          id: uuidv4(),
          aggregateType: 'Order',
          aggregateId: id,
          eventType: 'order.cancelled.v1',
          eventVersion: 1,
          payload: {
            eventId: uuidv4(),
            eventType: 'order.cancelled.v1',
            eventVersion: 1,
            occurredAt: nowIso,
            producer: 'order-service',
            aggregateId: id,
            correlationId: requestId || null,
            orderId: id,
            orderNumber: existing.orderNumber,
            customerId: existing.customerId,
            previousStatus: existing.status,
            status: 'CANCELLED',
            reason,
            version: updateResult.newVersion
          }
        },
        conn
      );
    });

    return this.getOrderById(id);
  }

  /**
   * Retrieves full chronological status transition history.
   */
  async getOrderHistory(id: string): Promise<OrderStatusHistory[]> {
    const existing = await orderRepository.findById(id);
    if (!existing) {
      throw new NotFoundError(`Order with ID '${id}' was not found.`);
    }

    return orderRepository.findHistoryByOrderId(id);
  }
}

export const orderService = new OrderService();
