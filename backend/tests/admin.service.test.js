'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAdminService } = require('../src/admin/admin.service');

test('admin dashboard returns a zero-filled date range and metrics when no data exists', async () => {
  const timestamp = new Date('2026-11-12T03:00:00.000Z');
  const service = createAdminService({
    adminRepository: {
      async listBookings() {
        return { rows: [], total: 0 };
      },
      async findBookingSlots() {
        return [];
      },
      async getDashboardBookingCounts() {
        return {
          new_bookings: 0,
          confirmed_bookings: 0,
          cancelled_bookings: 0,
          completed_bookings: 0,
          bookings_by_status: {
            PENDING: 0, CONFIRMED: 0, COMPLETED: 0, CANCELLED: 0, EXPIRED: 0
          }
        };
      },
      async getDashboardPaymentMetrics() {
        return { gross_paid: '0', refunded: '0' };
      },
      async getRevenueByDay() {
        return [];
      },
      async getDashboardFillRate() {
        return { total_slots: 0, booked_slots: 0 };
      },
      async getTopCourts() {
        return [];
      },
      async getRecentBookings() {
        return [];
      }
    },
    bookingsRepository: {
      async withTransaction() {
        return null;
      }
    },
    now: () => timestamp,
    notifyIncidentCancellation: async () => {},
    notifyPendingIncidentCancellation: async () => {},
    writeAudit: async () => {}
  });

  const dashboard = await service.getDashboard('today');
  assert.deepEqual(dashboard, {
    period: 'today',
    range: { from: '2026-11-12', to: '2026-11-12' },
    kpis: {
      new_bookings: 0,
      confirmed_bookings: 0,
      cancelled_bookings: 0,
      net_revenue: '0',
      gross_paid: '0',
      refunded: '0',
      fill_rate_percent: 0,
      pending_match_requests: 0
    },
    revenue_by_day: [{ date: '2026-11-12', net_revenue: '0' }],
    bookings_by_status: {
      PENDING: 0, CONFIRMED: 0, COMPLETED: 0, CANCELLED: 0, EXPIRED: 0
    },
    top_courts: [],
    recent_bookings: [],
    new_bookings: 0,
    net_revenue: '0',
    cancelled_bookings: 0,
    completed_bookings: 0,
    server_time: timestamp.toISOString()
  });
});
