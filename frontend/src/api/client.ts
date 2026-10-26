import { Order, Shipment, GPSLocation, PredictionData } from '../types';

const API_BASE = ''; // Uses Vite proxy config or relative path

// Helper fetch wrapper
async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers
  });

  if (!res.ok) {
    let errorDetail = res.statusText;
    try {
      const errJson = await res.json();
      const error = errJson.error;
      errorDetail =
        (typeof error === 'string' ? error : error?.message) ||
        errJson.message ||
        JSON.stringify(errJson);
    } catch (_) {
      // ignore
    }
    throw new Error(`API Error (${res.status}): ${errorDetail}`);
  }

  return res.json();
}

// MS1 Order Service APIs
export const orderApi = {
  list: async (params: { page?: number; limit?: number; status?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.page) qs.append('page', params.page.toString());
    if (params.limit) qs.append('limit', params.limit.toString());
    if (params.status) qs.append('status', params.status);
    const res = await request<{ success: boolean; data: Order[]; meta: any }>(`/api/v1/orders?${qs.toString()}`);
    return res;
  },

  getById: async (id: string) => {
    const res = await request<{ success: boolean; data: Order }>(`/api/v1/orders/${id}`);
    return res.data;
  },

  create: async (payload: any, idempotencyKey: string) => {
    const res = await request<{ success: boolean; data: Order }>('/api/v1/orders', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload)
    });
    return res.data;
  },

  confirm: async (id: string) => {
    const res = await request<{ success: boolean; data: Order }>(`/api/v1/orders/${id}/confirm`, {
      method: 'POST'
    });
    return res.data;
  },

  cancel: async (id: string, reason: string) => {
    const res = await request<{ success: boolean; data: Order }>(`/api/v1/orders/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
    return res.data;
  }
};

// MS2 Shipment Service APIs
export const shipmentApi = {
  list: async (params: { page?: number; limit?: number; status?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.page) qs.append('page', params.page.toString());
    if (params.limit) qs.append('limit', params.limit.toString());
    if (params.status) qs.append('status', params.status);
    const res = await request<{ success: boolean; data: Shipment[]; meta: any }>(`/api/v1/shipments?${qs.toString()}`);
    return res;
  },

  getById: async (id: string) => {
    const res = await request<{ success: boolean; data: Shipment & { history: any[] } }>(`/api/v1/shipments/${id}`);
    return res.data;
  },

  create: async (payload: any) => {
    const res = await request<{ success: boolean; data: Shipment }>('/api/v1/shipments', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    return res.data;
  },

  updateStatus: async (id: string, status: string, notes?: string) => {
    const res = await request<{ success: boolean; data: Shipment }>(`/api/v1/shipments/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, notes })
    });
    return res.data;
  },

  assignCarrier: async (id: string, carrierName: string, truckNumber?: string, driverName?: string) => {
    const res = await request<{ success: boolean; data: Shipment }>(`/api/v1/shipments/${id}/assignment`, {
      method: 'PATCH',
      body: JSON.stringify({ carrierName, truckNumber, driverName })
    });
    return res.data;
  }
};

// MS3 Tracking Service APIs
export const trackingApi = {
  getLatest: async (shipmentId: string): Promise<GPSLocation | null> => {
    try {
      return await request<GPSLocation>(`/api/v1/tracking/shipments/${shipmentId}/latest`);
    } catch (err: any) {
      if (err.message.includes('404')) return null;
      throw err;
    }
  },

  getHistory: async (shipmentId: string, limit = 50) => {
    return await request<any[]>(`/api/v1/tracking/shipments/${shipmentId}/history?limit=${limit}`);
  },

  getRoute: async (shipmentId: string) => {
    return await request<{ shipmentId: string; totalPoints: number; geojson: any }>(
      `/api/v1/tracking/shipments/${shipmentId}/route`
    );
  },

  startSimulation: async (shipmentId: string, steps = 12) => {
    return await request<any>(`/api/v1/tracking/simulator/start/${shipmentId}?steps=${steps}`, {
      method: 'POST'
    });
  },

  stepSimulation: async (shipmentId: string) => {
    return await request<any>(`/api/v1/tracking/simulator/step/${shipmentId}`, {
      method: 'POST'
    });
  }
};

// MS4 Prediction Service APIs
export const predictionApi = {
  getForShipment: async (shipmentId: string): Promise<PredictionData | null> => {
    try {
      const res = await request<{ success: boolean; data: PredictionData }>(
        `/api/v1/predictions/shipments/${shipmentId}`
      );
      return res.data;
    } catch (err: any) {
      if (err.message.includes('404')) return null;
      throw err;
    }
  },

  computeEta: async (payload: {
    shipmentId: string;
    currentLat: number;
    currentLon: number;
    destLat: number;
    destLon: number;
    currentSpeedKmh?: number;
    averageSpeedKmh?: number;
    scheduledDelivery?: string;
  }) => {
    const res = await request<{ success: boolean; data: PredictionData }>('/api/v1/predictions/eta', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    return res.data;
  }
};
