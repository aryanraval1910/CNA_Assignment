import amqp from 'amqplib';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { shipmentService } from './shipment.service';
import { shipmentRepository } from '../repositories/shipment.repository';

// Default coordinates for known demo cities
const CITY_COORDINATES: Record<string, { lat: number; lon: number }> = {
  seattle: { lat: 47.6062, lon: -122.3321 },
  portland: { lat: 45.5152, lon: -122.6784 },
  sanfrancisco: { lat: 37.7749, lon: -122.4194 },
  losangeles: { lat: 34.0522, lon: -118.2437 },
  chicago: { lat: 41.8781, lon: -87.6298 },
  newyork: { lat: 40.7128, lon: -74.006 },
  mumbai: { lat: 19.076, lon: 72.8777 },
  delhi: { lat: 28.6139, lon: 77.209 },
  bangalore: { lat: 12.9716, lon: 77.5946 }
};

function getCoordinates(city: string, countryCode: string): { lat: number; lon: number } {
  const normalized = city.toLowerCase().replace(/[^a-z]/g, '');
  if (CITY_COORDINATES[normalized]) {
    return CITY_COORDINATES[normalized];
  }
  // Fallback defaults
  if (countryCode.toUpperCase() === 'IN') {
    return { lat: 19.076, lon: 72.8777 };
  }
  return { lat: 47.6062, lon: -122.3321 };
}

export class RabbitMQConsumer {
  private connection: any = null;
  private channel: any = null;
  private isRunning = false;

  async start(): Promise<void> {
    if (!env.RABBITMQ_ENABLED || this.isRunning) return;
    this.isRunning = true;

    try {
      this.connection = await amqp.connect(env.RABBITMQ_URL);
      this.channel = await this.connection.createChannel();

      // Ensure dead-letter exchange and queue exist
      try {
        await this.channel.assertExchange('logistics.dlx', 'direct', { durable: true });
        await this.channel.assertQueue('logistics.dlq', { durable: true });
        await this.channel.bindQueue('logistics.dlq', 'logistics.dlx', 'dead-letter');
      } catch (dlxErr) {
        logger.warn({ dlxErr }, 'Could not assert DLX/DLQ; proceeding with setup');
      }

      // Assert the main topic exchange
      const exchangeName = env.RABBITMQ_EXCHANGE || 'logistics.events';
      await this.channel.assertExchange(exchangeName, 'topic', { durable: true });

      const queueName = 'shipment.order_confirmed.queue';
      await this.channel.assertQueue(queueName, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': 'logistics.dlx',
          'x-dead-letter-routing-key': 'dead-letter'
        }
      });

      // Bind to both order.created and order.confirmed events
      await this.channel.bindQueue(queueName, exchangeName, 'order.confirmed.v1');
      await this.channel.bindQueue(queueName, exchangeName, 'order.created.v1');

      await this.channel.prefetch(5);

      this.channel.consume(queueName, async (msg: any) => {
        if (!msg) return;

        try {
          const content = JSON.parse(msg.content.toString());
          logger.info({ eventType: content.eventType, orderId: content.orderId }, 'Received order event in shipment consumer');

          const orderId = content.orderId || content.payload?.orderId || content.payload?.id;
          if (!orderId) {
            logger.warn('Received order event missing orderId; ACKing without processing');
            this.channel.ack(msg);
            return;
          }

          // Idempotency check: has a shipment already been staged for this order?
          const existing = await shipmentRepository.findByOrderId(orderId);
          if (existing) {
            logger.info({ orderId, shipmentId: existing.id }, 'Shipment already exists for order. ACKing.');
            this.channel.ack(msg);
            return;
          }

          const originData = content.origin || content.payload?.origin || {};
          const destData = content.destination || content.payload?.destination || {};

          const originCoords = getCoordinates(originData.city || 'Seattle', originData.countryCode || 'US');
          const destCoords = getCoordinates(destData.city || 'Portland', destData.countryCode || 'US');

          const orderNumber = content.orderNumber || content.payload?.orderNumber || '';

          await shipmentService.createShipment({
            orderId,
            origin: {
              name: originData.name || originData.addressLine1 || originData.address || `${originData.city || 'Origin'} Hub`,
              address: originData.addressLine1 || originData.address || '100 Industrial Pkwy',
              city: originData.city || 'Seattle',
              state: originData.state || null,
              postalCode: originData.postalCode || null,
              countryCode: originData.countryCode || 'US',
              latitude: originCoords.lat,
              longitude: originCoords.lon
            },
            destination: {
              name: destData.name || destData.addressLine1 || destData.address || `${destData.city || 'Destination'} Depot`,
              address: destData.addressLine1 || destData.address || '500 Commercial Way',
              city: destData.city || 'Portland',
              state: destData.state || null,
              postalCode: destData.postalCode || null,
              countryCode: destData.countryCode || 'US',
              latitude: destCoords.lat,
              longitude: destCoords.lon
            },
            notes: `Auto-generated from order ${orderNumber}`.trim()
          });

          this.channel.ack(msg);
        } catch (error: any) {
          logger.error({ err: error.message }, 'Error processing order event in shipment consumer');
          // Reject to dead-letter exchange without requeueing endlessly
          this.channel.nack(msg, false, false);
        }
      });

      logger.info('Shipment Consumer listening to shipment.order_confirmed.queue (order.confirmed.v1, order.created.v1)');
    } catch (err) {
      logger.warn({ err }, 'Failed to start Shipment RabbitMQ consumer. Will retry on reconnect.');
      this.isRunning = false;
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    try {
      if (this.channel) await this.channel.close();
      if (this.connection) await this.connection.close();
    } catch (err) {
      // Ignore cleanup error
    }
  }
}

export const rabbitMQConsumer = new RabbitMQConsumer();
