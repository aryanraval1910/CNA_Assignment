import React, { useState, useEffect } from 'react';
import { shipmentApi, orderApi } from '../api/client';
import { Shipment, ShipmentStatus, Order } from '../types';
import {
  Search,
  Truck,
  ArrowRight,
  Clock,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  UserCheck,
  Eye,
  Plus,
  Layers,
  Sparkles
} from 'lucide-react';

interface ShipmentsPageProps {
  onSelectShipment: (shipment: Shipment) => void;
}

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

export const ShipmentsPage: React.FC<ShipmentsPageProps> = ({ onSelectShipment }) => {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedShipmentForAssign, setSelectedShipmentForAssign] = useState<Shipment | null>(null);
  const [carrierForm, setCarrierForm] = useState({
    carrierName: 'Apex Freight Express',
    truckNumber: 'TRK-WA-884',
    driverName: 'Robert Vance'
  });
  const [actionLoading, setActionLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [availableOrders, setAvailableOrders] = useState<Order[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // New Shipment Form State
  const [createForm, setCreateForm] = useState({
    selectedOrderId: '',
    originCity: 'Seattle',
    originAddress: '100 Industrial Pkwy',
    originCountry: 'US',
    destCity: 'Portland',
    destAddress: '500 Commercial Way',
    destCountry: 'US',
    carrierName: '',
    truckNumber: '',
    driverName: ''
  });

  const loadShipments = async (autoSyncIfEmpty = true) => {
    setLoading(true);
    setError(null);
    try {
      const res = await shipmentApi.list({
        status: statusFilter || undefined,
        limit: 50
      });
      const list = res.data || [];
      setShipments(list);

      // Fetch orders to check if any exist to sync or pick
      try {
        const ordersRes = await orderApi.list({ limit: 50 });
        const orders = ordersRes.data || [];
        setAvailableOrders(orders);

        // If no shipments exist in MS2 yet, but orders exist in MS1, automatically stage them!
        if (autoSyncIfEmpty && list.length === 0 && orders.length > 0 && !statusFilter) {
          await syncOrdersInternal(orders, list);
        }
      } catch (orderErr) {
        console.warn('Could not fetch orders for sync:', orderErr);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch shipments from MS2');
    } finally {
      setLoading(false);
    }
  };

  const syncOrdersInternal = async (orders: Order[], currentShipments: Shipment[]) => {
    const existingOrderIds = new Set(currentShipments.map((s) => s.orderId));
    let staged = 0;
    for (const ord of orders) {
      if (!existingOrderIds.has(ord.id)) {
        const originCoords = getCityCoords(ord.origin.city, ord.origin.countryCode);
        const destCoords = getCityCoords(ord.destination.city, ord.destination.countryCode);
        try {
          await shipmentApi.create({
            orderId: ord.id,
            origin: {
              name: `${ord.origin.city} Hub`,
              address: ord.origin.addressLine1 || '100 Industrial Pkwy',
              city: ord.origin.city || 'Seattle',
              countryCode: (ord.origin.countryCode || 'US').toUpperCase(),
              latitude: originCoords.lat,
              longitude: originCoords.lon
            },
            destination: {
              name: `${ord.destination.city} Depot`,
              address: ord.destination.addressLine1 || '500 Commercial Way',
              city: ord.destination.city || 'Portland',
              countryCode: (ord.destination.countryCode || 'US').toUpperCase(),
              latitude: destCoords.lat,
              longitude: destCoords.lon
            },
            notes: `Auto-staged from order ${ord.orderNumber}`
          });
          staged++;
        } catch (e) {
          // ignore duplicate
        }
      }
    }
    if (staged > 0) {
      const refreshed = await shipmentApi.list({
        status: statusFilter || undefined,
        limit: 50
      });
      setShipments(refreshed.data || []);
      setSyncNotice(`Auto-staged ${staged} shipment(s) from existing orders!`);
      setTimeout(() => setSyncNotice(null), 6000);
    }
  };

  const handleManualSync = async () => {
    setSyncing(true);
    setSyncNotice(null);
    try {
      const ordersRes = await orderApi.list({ limit: 50 });
      const orders = ordersRes.data || [];
      const currentShipments = await shipmentApi.list({ limit: 100 });
      await syncOrdersInternal(orders, currentShipments.data || []);
      if (!syncNotice) {
        setSyncNotice('Sync complete. All orders checked.');
        setTimeout(() => setSyncNotice(null), 4000);
      }
    } catch (err: any) {
      alert(`Sync failed: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    loadShipments(true);
  }, [statusFilter]);

  const handleCreateShipment = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    try {
      let targetOrderId = createForm.selectedOrderId;
      // If no order selected, use the first available order or generate a deterministic UUID
      if (!targetOrderId) {
        if (availableOrders.length > 0) {
          targetOrderId = availableOrders[0].id;
        } else {
          // Create dummy UUID if testing standalone
          targetOrderId = 'a0000000-0000-4000-8000-000000000001';
        }
      }

      const originCoords = getCityCoords(createForm.originCity, createForm.originCountry);
      const destCoords = getCityCoords(createForm.destCity, createForm.destCountry);

      await shipmentApi.create({
        orderId: targetOrderId,
        carrierName: createForm.carrierName || null,
        truckNumber: createForm.truckNumber || null,
        driverName: createForm.driverName || null,
        origin: {
          name: `${createForm.originCity} Hub`,
          address: createForm.originAddress,
          city: createForm.originCity,
          countryCode: createForm.originCountry.toUpperCase(),
          latitude: originCoords.lat,
          longitude: originCoords.lon
        },
        destination: {
          name: `${createForm.destCity} Depot`,
          address: createForm.destAddress,
          city: createForm.destCity,
          countryCode: createForm.destCountry.toUpperCase(),
          latitude: destCoords.lat,
          longitude: destCoords.lon
        },
        notes: 'Manually staged from Control Tower'
      });

      setShowCreateModal(false);
      setSyncNotice('New shipment successfully staged!');
      setTimeout(() => setSyncNotice(null), 5000);
      loadShipments(false);
    } catch (err: any) {
      alert(`Failed to create shipment: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleAssignCarrier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedShipmentForAssign) return;
    setActionLoading(true);
    try {
      await shipmentApi.assignCarrier(
        selectedShipmentForAssign.id,
        carrierForm.carrierName,
        carrierForm.truckNumber,
        carrierForm.driverName
      );
      setSelectedShipmentForAssign(null);
      loadShipments(false);
    } catch (err: any) {
      alert(`Assignment failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleStatusChange = async (shipmentId: string, nextStatus: ShipmentStatus) => {
    try {
      await shipmentApi.updateStatus(shipmentId, nextStatus);
      loadShipments(false);
    } catch (err: any) {
      alert(`Status transition failed: ${err.message}`);
    }
  };

  const filteredShipments = shipments.filter((s) => {
    const q = searchQuery.toLowerCase();
    return (
      s.trackingNumber.toLowerCase().includes(q) ||
      (s.carrierName && s.carrierName.toLowerCase().includes(q)) ||
      (s.truckNumber && s.truckNumber.toLowerCase().includes(q)) ||
      (s.driverName && s.driverName.toLowerCase().includes(q)) ||
      (s.origin?.city && s.origin.city.toLowerCase().includes(q)) ||
      (s.destination?.city && s.destination.city.toLowerCase().includes(q))
    );
  });

  const getStatusBadge = (status: ShipmentStatus) => {
    switch (status) {
      case 'DELIVERED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-950 text-emerald-400 border border-emerald-800">
            <CheckCircle className="w-3 h-3 mr-1" /> Delivered
          </span>
        );
      case 'IN_TRANSIT':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-cyan-950 text-cyan-400 border border-cyan-800 animate-pulse">
            <Truck className="w-3 h-3 mr-1" /> In Transit
          </span>
        );
      case 'PICKED_UP':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-950 text-indigo-400 border border-indigo-800">
            <Clock className="w-3 h-3 mr-1" /> Picked Up
          </span>
        );
      case 'ASSIGNED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-950 text-blue-400 border border-blue-800">
            <UserCheck className="w-3 h-3 mr-1" /> Assigned
          </span>
        );
      case 'CANCELLED':
      case 'FAILED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-950 text-rose-400 border border-rose-800">
            <AlertTriangle className="w-3 h-3 mr-1" /> {status}
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Shipments & Fleet Management</h1>
          <p className="text-sm text-slate-400">
            Carrier assignments, route waypoints, and transit progression (MS2 PostgreSQL).
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={handleManualSync}
            disabled={syncing}
            className="flex items-center space-x-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition text-xs font-medium"
            title="Sync all orders into shipments"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin text-cyan-400' : ''}`} />
            <span>{syncing ? 'Syncing...' : 'Sync Orders'}</span>
          </button>

          <button
            onClick={() => loadShipments(false)}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition"
            title="Refresh Shipments"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
          </button>

          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-medium text-sm transition shadow-lg shadow-cyan-600/20"
          >
            <Plus className="w-4 h-4" />
            <span>Stage Shipment</span>
          </button>
        </div>
      </div>

      {/* Sync/Action Notification */}
      {syncNotice && (
        <div className="p-4 bg-cyan-950/70 border border-cyan-800 text-cyan-200 rounded-xl flex items-center justify-between animate-fadeIn">
          <div className="flex items-center space-x-3">
            <Sparkles className="w-5 h-5 text-cyan-400 flex-shrink-0" />
            <span className="text-sm font-medium">{syncNotice}</span>
          </div>
          <button
            onClick={() => setSyncNotice(null)}
            className="text-cyan-400 hover:text-white text-xs ml-4"
          >
            ✕
          </button>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-800/60 p-4 rounded-xl border border-slate-700/60">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            placeholder="Search tracking #, carrier, truck, city..."
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
            <option value="">All Statuses ({shipments.length})</option>
            <option value="PENDING">PENDING</option>
            <option value="ASSIGNED">ASSIGNED</option>
            <option value="PICKED_UP">PICKED_UP</option>
            <option value="IN_TRANSIT">IN_TRANSIT</option>
            <option value="DELIVERED">DELIVERED</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 bg-rose-950/60 border border-rose-800 text-rose-200 rounded-xl flex items-center justify-between">
          <span className="text-sm">{error}</span>
          <button
            onClick={() => loadShipments(false)}
            className="px-3 py-1 bg-rose-800 hover:bg-rose-700 text-white text-xs rounded transition"
          >
            Retry
          </button>
        </div>
      )}

      {/* Shipments Table or Empty State */}
      {loading && shipments.length === 0 ? (
        <div className="p-12 text-center bg-slate-800/40 rounded-xl border border-slate-700/40">
          <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-400">Loading shipments from PostgreSQL...</p>
        </div>
      ) : filteredShipments.length === 0 ? (
        <div className="p-10 text-center bg-slate-800/40 rounded-xl border border-slate-700/40 space-y-4">
          <Truck className="w-12 h-12 text-slate-500 mx-auto" />
          <div>
            <h3 className="text-lg font-medium text-white mb-1">
              {statusFilter ? `No shipments matching '${statusFilter}'` : 'No shipments staged yet'}
            </h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              {availableOrders.length > 0
                ? `You have ${availableOrders.length} order(s) available in MS1. Click below to automatically stage them into shipments!`
                : 'Create an order on the Orders page or stage a new shipment directly below.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            {availableOrders.length > 0 && (
              <button
                onClick={handleManualSync}
                disabled={syncing}
                className="flex items-center space-x-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition"
              >
                <Layers className="w-4 h-4" />
                <span>{syncing ? 'Staging Orders...' : `Stage ${availableOrders.length} Order(s) Now`}</span>
              </button>
            )}

            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center space-x-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm font-medium transition"
            >
              <Plus className="w-4 h-4" />
              <span>Stage New Shipment</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-slate-800/80 rounded-xl border border-slate-700/60 overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-900/60 text-slate-400 uppercase text-[11px] font-semibold border-b border-slate-700">
                <tr>
                  <th className="px-6 py-3.5">Tracking Number</th>
                  <th className="px-6 py-3.5">Route</th>
                  <th className="px-6 py-3.5">Carrier / Driver</th>
                  <th className="px-6 py-3.5">Status</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60 text-slate-200">
                {filteredShipments.map((shipment) => (
                  <tr key={shipment.id} className="hover:bg-slate-750 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-mono font-medium text-cyan-400">{shipment.trackingNumber}</div>
                      <div className="text-xs text-slate-400">Order: {shipment.orderId.substring(0, 8)}...</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2 text-slate-300">
                        <span>{shipment.origin?.city || 'Origin'}</span>
                        <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                        <span>{shipment.destination?.city || 'Destination'}</span>
                      </div>
                      <div className="text-xs text-slate-400">
                        {shipment.origin?.latitude ? Number(shipment.origin.latitude).toFixed(2) : '47.60'},{' '}
                        {shipment.origin?.longitude ? Number(shipment.origin.longitude).toFixed(2) : '-122.33'} →{' '}
                        {shipment.destination?.latitude ? Number(shipment.destination.latitude).toFixed(2) : '45.51'},{' '}
                        {shipment.destination?.longitude ? Number(shipment.destination.longitude).toFixed(2) : '-122.67'}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {shipment.carrierName ? (
                        <div>
                          <div className="font-medium text-white">{shipment.carrierName}</div>
                          <div className="text-xs text-slate-400">
                            {shipment.truckNumber} • {shipment.driverName || 'No driver assigned'}
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setSelectedShipmentForAssign(shipment)}
                          className="text-xs text-amber-400 hover:text-amber-300 underline font-medium"
                        >
                          + Assign Carrier & Truck
                        </button>
                      )}
                    </td>
                    <td className="px-6 py-4">{getStatusBadge(shipment.status)}</td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <button
                        onClick={() => onSelectShipment(shipment)}
                        className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded text-xs transition inline-flex items-center space-x-1"
                        title="View Full Shipment Dossier & Real-time GPS"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Details</span>
                      </button>

                      {/* State transitions */}
                      {shipment.status === 'PENDING' && (
                        <button
                          onClick={() => setSelectedShipmentForAssign(shipment)}
                          className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium transition"
                        >
                          Assign
                        </button>
                      )}

                      {shipment.status === 'ASSIGNED' && (
                        <button
                          onClick={() => handleStatusChange(shipment.id, 'PICKED_UP')}
                          className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-medium transition"
                        >
                          Mark Picked Up
                        </button>
                      )}

                      {shipment.status === 'PICKED_UP' && (
                        <button
                          onClick={() => handleStatusChange(shipment.id, 'IN_TRANSIT')}
                          className="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs font-medium transition"
                        >
                          Start Transit
                        </button>
                      )}

                      {shipment.status === 'IN_TRANSIT' && (
                        <button
                          onClick={() => handleStatusChange(shipment.id, 'DELIVERED')}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-medium transition"
                        >
                          Mark Delivered
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Stage Shipment Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-700 pb-3">
              <h2 className="text-lg font-bold text-white flex items-center space-x-2">
                <Truck className="w-5 h-5 text-cyan-400" />
                <span>Stage New Shipment</span>
              </h2>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateShipment} className="space-y-4 text-sm">
              <div>
                <label className="text-xs text-slate-400">Attach to Existing Order</label>
                <select
                  value={createForm.selectedOrderId}
                  onChange={(e) => {
                    const ordId = e.target.value;
                    const found = availableOrders.find((o) => o.id === ordId);
                    setCreateForm({
                      ...createForm,
                      selectedOrderId: ordId,
                      originCity: found?.origin.city || createForm.originCity,
                      originAddress: found?.origin.addressLine1 || createForm.originAddress,
                      destCity: found?.destination.city || createForm.destCity,
                      destAddress: found?.destination.addressLine1 || createForm.destAddress
                    });
                  }}
                  className="w-full mt-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white"
                >
                  <option value="">-- Select an Order (or auto-link) --</option>
                  {availableOrders.map((ord) => (
                    <option key={ord.id} value={ord.id}>
                      {ord.orderNumber} ({ord.origin.city} → {ord.destination.city}) - {ord.status}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400">Origin City</label>
                  <input
                    type="text"
                    value={createForm.originCity}
                    onChange={(e) => setCreateForm({ ...createForm, originCity: e.target.value })}
                    className="w-full mt-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Destination City</label>
                  <input
                    type="text"
                    value={createForm.destCity}
                    onChange={(e) => setCreateForm({ ...createForm, destCity: e.target.value })}
                    className="w-full mt-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400">Origin Street Address</label>
                  <input
                    type="text"
                    value={createForm.originAddress}
                    onChange={(e) => setCreateForm({ ...createForm, originAddress: e.target.value })}
                    className="w-full mt-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Destination Street Address</label>
                  <input
                    type="text"
                    value={createForm.destAddress}
                    onChange={(e) => setCreateForm({ ...createForm, destAddress: e.target.value })}
                    className="w-full mt-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white"
                    required
                  />
                </div>
              </div>

              <div className="border-t border-slate-700 pt-3">
                <p className="text-xs font-semibold text-slate-300 mb-2">Optional Carrier Pre-Assignment</p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[11px] text-slate-400">Carrier</label>
                    <input
                      type="text"
                      placeholder="Apex Freight"
                      value={createForm.carrierName}
                      onChange={(e) => setCreateForm({ ...createForm, carrierName: e.target.value })}
                      className="w-full mt-1 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400">Truck #</label>
                    <input
                      type="text"
                      placeholder="TRK-902"
                      value={createForm.truckNumber}
                      onChange={(e) => setCreateForm({ ...createForm, truckNumber: e.target.value })}
                      className="w-full mt-1 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400">Driver</label>
                    <input
                      type="text"
                      placeholder="John Doe"
                      value={createForm.driverName}
                      onChange={(e) => setCreateForm({ ...createForm, driverName: e.target.value })}
                      className="w-full mt-1 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-white"
                    />
                  </div>
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
                  disabled={actionLoading}
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs font-medium transition"
                >
                  {actionLoading ? 'Staging...' : 'Stage Shipment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assign Carrier Modal */}
      {selectedShipmentForAssign && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-700 pb-3">
              <h2 className="text-lg font-bold text-white">Assign Carrier & Driver</h2>
              <button
                onClick={() => setSelectedShipmentForAssign(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="text-xs text-slate-400">
              Shipment Tracking: <span className="font-mono text-cyan-400">{selectedShipmentForAssign.trackingNumber}</span>
            </div>

            <form onSubmit={handleAssignCarrier} className="space-y-4 text-sm">
              <div>
                <label className="text-xs text-slate-400">Carrier Company Name</label>
                <input
                  type="text"
                  value={carrierForm.carrierName}
                  onChange={(e) => setCarrierForm({ ...carrierForm, carrierName: e.target.value })}
                  className="w-full mt-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white"
                  required
                />
              </div>

              <div>
                <label className="text-xs text-slate-400">Truck / License Plate Number</label>
                <input
                  type="text"
                  value={carrierForm.truckNumber}
                  onChange={(e) => setCarrierForm({ ...carrierForm, truckNumber: e.target.value })}
                  className="w-full mt-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400">Driver Name</label>
                <input
                  type="text"
                  value={carrierForm.driverName}
                  onChange={(e) => setCarrierForm({ ...carrierForm, driverName: e.target.value })}
                  className="w-full mt-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-3 border-t border-slate-700">
                <button
                  type="button"
                  onClick={() => setSelectedShipmentForAssign(null)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs font-medium transition"
                >
                  {actionLoading ? 'Assigning...' : 'Save Assignment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
