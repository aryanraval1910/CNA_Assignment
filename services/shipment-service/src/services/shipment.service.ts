import { v4 as uuidv4 } from 'uuid';
import { withTransaction } from '../config/database';
import { shipmentRepository } from '../repositories/shipment.repository';
import { Shipment, ShipmentStatus, ShipmentStatusHistory, OutboxEvent } from '../types/shipment.types';
import {
  CreateShipmentInput,
  UpdateShipmentStatusInput,
  UpdateShipmentAssignmentInput,
  ListShipmentsQuery
} from '../validators/shipment.validator';

const VALID_TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  PENDING: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['PICKED_UP', 'CANCELLED'],
  PICKED_UP: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['DELIVERED', 'FAILED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
  FAILED: ['ASSIGNED', 'CANCELLED']
};

export class ShipmentService {
  private generateTrackingNumber(): string {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `TRK-${dateStr}-${rand}`;
  }

  async createShipment(input: CreateShipmentInput): Promise<Shipment> {
    // Idempotency check: if a shipment already exists for this orderId, return it directly
    const existing = await shipmentRepository.findByOrderId(input.orderId);
    if (existing) {
      return existing;
    }

    const shipmentId = uuidv4();
    const trackingNumber = input.trackingNumber || this.generateTrackingNumber();
    const now = new Date().toISOString();

    const shipment: Shipment = {
      id: shipmentId,
      trackingNumber,
      orderId: input.orderId,
      carrierName: input.carrierName || null,
      truckNumber: input.truckNumber || null,
      driverName: input.driverName || null,
      driverPhone: input.driverPhone || null,
      origin: input.origin,
      destination: input.destination,
      scheduledPickup: input.scheduledPickup || null,
      scheduledDelivery: input.scheduledDelivery || null,
      status: input.carrierName ? 'ASSIGNED' : 'PENDING',
      notes: input.notes || null,
      createdAt: now,
      updatedAt: now,
      version: 1
    };

    return await withTransaction(async (client) => {
      const created = await shipmentRepository.create(shipment, client);

      const history: ShipmentStatusHistory = {
        id: uuidv4(),
        shipmentId,
        previousStatus: null,
        newStatus: shipment.status,
        changedBy: 'SYSTEM',
        reason: 'Shipment created',
        createdAt: now
      };
      await shipmentRepository.insertHistory(history, client);

      const outboxEvent: OutboxEvent = {
        id: uuidv4(),
        aggregateType: 'SHIPMENT',
        aggregateId: shipmentId,
        eventType: 'shipment.created.v1',
        eventVersion: 1,
        payload: {
          shipmentId: created.id,
          trackingNumber: created.trackingNumber,
          orderId: created.orderId,
          status: created.status,
          carrierName: created.carrierName,
          origin: created.origin,
          destination: created.destination,
          scheduledPickup: created.scheduledPickup,
          scheduledDelivery: created.scheduledDelivery,
          createdAt: created.createdAt
        },
        status: 'PENDING',
        attempts: 0,
        createdAt: now
      };
      await shipmentRepository.insertOutbox(outboxEvent, client);

      return created;
    });
  }

  async getShipmentById(id: string): Promise<{ shipment: Shipment; history: ShipmentStatusHistory[] } | null> {
    const shipment = await shipmentRepository.findById(id);
    if (!shipment) return null;
    const history = await shipmentRepository.getHistory(id);
    return { shipment, history };
  }

  async listShipments(query: ListShipmentsQuery): Promise<{ shipments: Shipment[]; total: number; page: number; limit: number }> {
    const { shipments, total } = await shipmentRepository.list(query);
    return {
      shipments,
      total,
      page: query.page || 1,
      limit: query.limit || 20
    };
  }

  async updateStatus(id: string, input: UpdateShipmentStatusInput): Promise<Shipment> {
    const current = await shipmentRepository.findById(id);
    if (!current) {
      throw new Error(`Shipment with id ${id} not found.`);
    }

    const allowed = VALID_TRANSITIONS[current.status] || [];
    if (!allowed.includes(input.status)) {
      throw new Error(`Invalid status transition from ${current.status} to ${input.status}. Allowed: ${allowed.join(', ') || 'None'}`);
    }

    const now = new Date().toISOString();

    return await withTransaction(async (client) => {
      const updated = await shipmentRepository.updateStatus(id, input.status, client);
      if (!updated) {
        throw new Error('Failed to update shipment status.');
      }

      const history: ShipmentStatusHistory = {
        id: uuidv4(),
        shipmentId: id,
        previousStatus: current.status,
        newStatus: input.status,
        changedBy: input.changedBy || 'OPERATOR',
        reason: input.notes || `Transitioned to ${input.status}`,
        createdAt: now
      };
      await shipmentRepository.insertHistory(history, client);

      const outboxEvent: OutboxEvent = {
        id: uuidv4(),
        aggregateType: 'SHIPMENT',
        aggregateId: id,
        eventType: 'shipment.status_changed.v1',
        eventVersion: 1,
        payload: {
          shipmentId: id,
          orderId: current.orderId,
          previousStatus: current.status,
          newStatus: input.status,
          carrierName: current.carrierName,
          truckNumber: current.truckNumber,
          driverName: current.driverName,
          timestamp: now
        },
        status: 'PENDING',
        attempts: 0,
        createdAt: now
      };
      await shipmentRepository.insertOutbox(outboxEvent, client);

      return updated;
    });
  }

  async updateAssignment(id: string, input: UpdateShipmentAssignmentInput): Promise<Shipment> {
    const current = await shipmentRepository.findById(id);
    if (!current) {
      throw new Error(`Shipment with id ${id} not found.`);
    }

    const now = new Date().toISOString();

    return await withTransaction(async (client) => {
      const updated = await shipmentRepository.updateAssignment(
        id,
        input.carrierName,
        input.truckNumber,
        input.driverName,
        input.driverPhone,
        client
      );
      if (!updated) {
        throw new Error('Failed to update carrier assignment.');
      }

      const history: ShipmentStatusHistory = {
        id: uuidv4(),
        shipmentId: id,
        previousStatus: current.status,
        newStatus: updated.status,
        changedBy: 'DISPATCHER',
        reason: `Assigned carrier ${input.carrierName} (Truck: ${input.truckNumber || 'N/A'})`,
        createdAt: now
      };
      await shipmentRepository.insertHistory(history, client);

      const outboxEvent: OutboxEvent = {
        id: uuidv4(),
        aggregateType: 'SHIPMENT',
        aggregateId: id,
        eventType: 'shipment.status_changed.v1',
        eventVersion: 1,
        payload: {
          shipmentId: id,
          orderId: current.orderId,
          previousStatus: current.status,
          newStatus: updated.status,
          carrierName: updated.carrierName,
          truckNumber: updated.truckNumber,
          driverName: updated.driverName,
          timestamp: now
        },
        status: 'PENDING',
        attempts: 0,
        createdAt: now
      };
      await shipmentRepository.insertOutbox(outboxEvent, client);

      return updated;
    });
  }
}

export const shipmentService = new ShipmentService();
