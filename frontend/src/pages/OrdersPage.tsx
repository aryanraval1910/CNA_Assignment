import React, { useState, useEffect } from 'react';
import { orderApi, shipmentApi } from '../api/client';
import { Order, OrderStatus } from '../types';
import {
  Plus,
  Search,
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw,
  Clock,
  Package,
  ArrowRight
} from 'lucide-react';

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

function getCityCoords(city: string, countryCode: string): { lat: number; lon: number } {
  const norm = (city || '').toLowerCase().replace(/[^a-z]/g, '');
  if (CITY_COORDINATES[norm]) return CITY_COORDINATES[norm];
  if ((countryCode || '').toUpperCase() === 'IN') return { lat: 19.076, lon: 72.8777 };
  return { lat: 47.6062, lon: -122.3321 };
}

export const OrdersPage: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // New order form state
  const [formData, setFormData] = useState({
    customerId: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
    customerReference: 'PO-2026-X1',
    currencyCode: 'USD',
    originCity: 'Seattle',
    originAddress: '100 Industrial Pkwy',
    originCountry: 'US',
    destCity: 'Portland',
    destAddress: '500 Commercial Way',
    destCountry: 'US',
    itemName: 'Industrial Servo Actuator',
    quantity: 5,
    unitPrice: 120.50
  });

  const loadOrders = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await orderApi.list({
        status: statusFilter || undefined,
        limit: 50
      });
      setOrders(res.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch orders from MS1');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, [statusFilter]);

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading('create');
    setError(null);
    try {
      const idempotencyKey = `web-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      const payload = {
        customerId: formData.customerId,
        customerReference: formData.customerReference,
        currencyCode: formData.currencyCode,
        origin: {
          addressLine1: formData.originAddress,
          city: formData.originCity,
          countryCode: formData.originCountry
        },
        destination: {
          addressLine1: formData.destAddress,
          city: formData.destCity,
          countryCode: formData.destCountry
        },
        items: [
          {
            itemName: formData.itemName,
            quantity: Number(formData.quantity),
            unitOfMeasure: 'EA',
            unitPrice: Number(formData.unitPrice)
          }
        ]
      };

      const createdOrder = await orderApi.create(payload, idempotencyKey);

      // Proactively stage the corresponding shipment in MS2 so it is immediately visible in Shipments
      try {
        const originCoords = getCityCoords(payload.origin.city, payload.origin.countryCode);
        const destCoords = getCityCoords(payload.destination.city, payload.destination.countryCode);
        await shipmentApi.create({
          orderId: createdOrder.id,
          origin: {
            name: `${payload.origin.city} Hub`,
            address: payload.origin.addressLine1 || '100 Industrial Pkwy',
            city: payload.origin.city || 'Seattle',
            countryCode: (payload.origin.countryCode || 'US').toUpperCase(),
            latitude: originCoords.lat,
            longitude: originCoords.lon
          },
          destination: {
            name: `${payload.destination.city} Depot`,
            address: payload.destination.addressLine1 || '500 Commercial Way',
            city: payload.destination.city || 'Portland',
            countryCode: (payload.destination.countryCode || 'US').toUpperCase(),
            latitude: destCoords.lat,
            longitude: destCoords.lon
          },
          notes: `Auto-staged for order ${createdOrder.orderNumber}`
        });
      } catch (shipmentErr) {
        console.warn('Direct shipment staging note:', shipmentErr);
      }

      setSuccessMsg(`Order ${createdOrder.orderNumber} created & shipment staged! Check the Shipments page.`);
      setShowCreateModal(false);
      loadOrders();
      setTimeout(() => setSuccessMsg(null), 7000);
    } catch (err: any) {
      alert(`Order creation failed: ${err.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleConfirmOrder = async (orderId: string) => {
    setActionLoading(orderId);
    try {
      const confirmedOrder = await orderApi.confirm(orderId);
      // Ensure shipment is staged in MS2 if not already staged
      try {
        const originCoords = getCityCoords(confirmedOrder.origin.city, confirmedOrder.origin.countryCode);
        const destCoords = getCityCoords(confirmedOrder.destination.city, confirmedOrder.destination.countryCode);
        await shipmentApi.create({
          orderId: confirmedOrder.id,
          origin: {
            name: `${confirmedOrder.origin.city} Hub`,
            address: confirmedOrder.origin.addressLine1 || '100 Industrial Pkwy',
            city: confirmedOrder.origin.city,
            countryCode: (confirmedOrder.origin.countryCode || 'US').toUpperCase(),
            latitude: originCoords.lat,
            longitude: originCoords.lon
          },
          destination: {
            name: `${confirmedOrder.destination.city} Depot`,
            address: confirmedOrder.destination.addressLine1 || '500 Commercial Way',
            city: confirmedOrder.destination.city,
            countryCode: (confirmedOrder.destination.countryCode || 'US').toUpperCase(),
            latitude: destCoords.lat,
            longitude: destCoords.lon
          },
          notes: `Confirmed order ${confirmedOrder.orderNumber}`
        });
      } catch (shipmentErr) {
        // already staged or background consumer handled it
      }
      setSuccessMsg(`Order confirmed and shipment staged!`);
      loadOrders();
      setTimeout(() => setSuccessMsg(null), 5000);
    } catch (err: any) {
      alert(`Order confirmation failed: ${err.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    if (!confirm('Are you sure you want to cancel this order?')) return;
    setActionLoading(orderId);
    try {
      await orderApi.cancel(orderId, 'Cancelled via Control Tower Web');
      loadOrders();
    } catch (err: any) {
      alert(`Order cancellation failed: ${err.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const filteredOrders = orders.filter((o) => {
    const q = searchQuery.toLowerCase();
    return (
      o.orderNumber.toLowerCase().includes(q) ||
      (o.customerReference && o.customerReference.toLowerCase().includes(q)) ||
      o.origin.city.toLowerCase().includes(q) ||
      o.destination.city.toLowerCase().includes(q)
    );
  });

  const getStatusBadge = (status: OrderStatus) => {
    switch (status) {
      case 'CONFIRMED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-950 text-emerald-400 border border-emerald-800">
            <CheckCircle className="w-3 h-3 mr-1" /> Confirmed
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-950 text-rose-400 border border-rose-800">
            <XCircle className="w-3 h-3 mr-1" /> Cancelled
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-950 text-amber-400 border border-amber-800">
            <Clock className="w-3 h-3 mr-1" /> Pending
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Orders Management</h1>
          <p className="text-sm text-slate-400">
            Customer order lifecycle, decimal financial integrity, and outbox event publishing (MS1).
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={loadOrders}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition"
            title="Refresh Orders"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-medium text-sm transition shadow-lg shadow-cyan-600/20"
          >
            <Plus className="w-4 h-4" />
            <span>Create Order</span>
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-800/60 p-4 rounded-xl border border-slate-700/60">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            placeholder="Search by order #, PO, city..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-cyan-500 placeholder-slate-500"
          />
        </div>

        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <span className="text-xs text-slate-400">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
          >
            <option value="">All Statuses</option>
            <option value="PENDING">PENDING</option>
            <option value="CONFIRMED">CONFIRMED</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 bg-rose-950/60 border border-rose-800 text-rose-200 rounded-xl flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
          <button
            onClick={loadOrders}
            className="px-3 py-1 bg-rose-800 hover:bg-rose-700 text-white text-xs rounded-lg transition"
          >
            Retry
          </button>
        </div>
      )}

      {/* Success notification */}
      {successMsg && (
        <div className="p-4 bg-emerald-950/70 border border-emerald-700 text-emerald-200 rounded-xl flex items-center justify-between animate-fadeIn">
          <div className="flex items-center space-x-3">
            <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0" />
            <span className="text-sm font-medium">{successMsg}</span>
          </div>
          <button
            onClick={() => setSuccessMsg(null)}
            className="text-emerald-400 hover:text-white text-xs ml-4"
          >
            ✕
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && orders.length === 0 ? (
        <div className="p-12 text-center bg-slate-800/40 rounded-xl border border-slate-700/40">
          <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-400">Querying Order Service database...</p>
        </div>
      ) : filteredOrders.length === 0 ? (
        /* Empty State */
        <div className="p-12 text-center bg-slate-800/40 rounded-xl border border-slate-700/40">
          <Package className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-white mb-1">No orders found</h3>
          <p className="text-sm text-slate-400 mb-4">
            Create an order or adjust your status filters.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm transition"
          >
            Create First Order
          </button>
        </div>
      ) : (
        /* Orders Table */
        <div className="bg-slate-800/80 rounded-xl border border-slate-700/60 overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-900/60 text-slate-400 uppercase text-[11px] font-semibold border-b border-slate-700">
                <tr>
                  <th className="px-6 py-3.5">Order Number</th>
                  <th className="px-6 py-3.5">Route</th>
                  <th className="px-6 py-3.5">Items / Total</th>
                  <th className="px-6 py-3.5">Status</th>
                  <th className="px-6 py-3.5">Created</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60 text-slate-200">
                {filteredOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-slate-750 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-mono font-medium text-cyan-400">{order.orderNumber}</div>
                      <div className="text-xs text-slate-400">{order.customerReference || 'No PO Ref'}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2 text-slate-300">
                        <span>{order.origin.city}</span>
                        <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                        <span>{order.destination.city}</span>
                      </div>
                      <div className="text-xs text-slate-400">
                        {order.origin.countryCode} to {order.destination.countryCode}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-semibold text-white">
                        {order.currencyCode} {Number(order.totalAmount).toFixed(2)}
                      </div>
                      <div className="text-xs text-slate-400">
                        {order.items?.length || 1} line item(s)
                      </div>
                    </td>
                    <td className="px-6 py-4">{getStatusBadge(order.status)}</td>
                    <td className="px-6 py-4 text-xs text-slate-400">
                      {new Date(order.createdAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      {order.status === 'PENDING' && (
                        <>
                          <button
                            onClick={() => handleConfirmOrder(order.id)}
                            disabled={actionLoading === order.id}
                            className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-medium transition"
                          >
                            {actionLoading === order.id ? 'Confirming...' : 'Confirm'}
                          </button>
                          <button
                            onClick={() => handleCancelOrder(order.id)}
                            disabled={actionLoading === order.id}
                            className="px-3 py-1 bg-slate-700 hover:bg-rose-700 text-slate-300 hover:text-white rounded text-xs font-medium transition"
                          >
                            Cancel
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create Order Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-xl p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-700 pb-3">
              <h2 className="text-lg font-bold text-white">Create New Order</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateOrder} className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400">Customer Reference (PO)</label>
                  <input
                    type="text"
                    value={formData.customerReference}
                    onChange={(e) => setFormData({ ...formData, customerReference: e.target.value })}
                    className="w-full mt-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Currency</label>
                  <input
                    type="text"
                    value={formData.currencyCode}
                    onChange={(e) => setFormData({ ...formData, currencyCode: e.target.value })}
                    className="w-full mt-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white"
                    required
                  />
                </div>
              </div>

              {/* Origin */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400">Origin City</label>
                  <input
                    type="text"
                    value={formData.originCity}
                    onChange={(e) => setFormData({ ...formData, originCity: e.target.value })}
                    className="w-full mt-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Origin Address</label>
                  <input
                    type="text"
                    value={formData.originAddress}
                    onChange={(e) => setFormData({ ...formData, originAddress: e.target.value })}
                    className="w-full mt-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white"
                    required
                  />
                </div>
              </div>

              {/* Destination */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400">Destination City</label>
                  <input
                    type="text"
                    value={formData.destCity}
                    onChange={(e) => setFormData({ ...formData, destCity: e.target.value })}
                    className="w-full mt-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Destination Address</label>
                  <input
                    type="text"
                    value={formData.destAddress}
                    onChange={(e) => setFormData({ ...formData, destAddress: e.target.value })}
                    className="w-full mt-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white"
                    required
                  />
                </div>
              </div>

              {/* Item Line */}
              <div className="p-3 bg-slate-900/60 rounded border border-slate-700/60 space-y-2">
                <span className="text-xs font-semibold text-slate-300 uppercase">Item Line</span>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-1">
                    <label className="text-[11px] text-slate-400">Item Name</label>
                    <input
                      type="text"
                      value={formData.itemName}
                      onChange={(e) => setFormData({ ...formData, itemName: e.target.value })}
                      className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-white text-xs"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400">Quantity</label>
                    <input
                      type="number"
                      min="1"
                      value={formData.quantity}
                      onChange={(e) => setFormData({ ...formData, quantity: Number(e.target.value) })}
                      className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-white text-xs"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400">Unit Price ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.unitPrice}
                      onChange={(e) => setFormData({ ...formData, unitPrice: Number(e.target.value) })}
                      className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-white text-xs"
                      required
                    />
                  </div>
                </div>
                <div className="text-right text-xs text-cyan-400 font-mono">
                  Calculated Line Total: ${(formData.quantity * formData.unitPrice).toFixed(2)}
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-3 border-t border-slate-700">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading === 'create'}
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs font-medium transition"
                >
                  {actionLoading === 'create' ? 'Saving...' : 'Submit Idempotent Order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
