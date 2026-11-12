'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAdminService } = require('../src/admin/admin.service');

test('admin dashboard returns zero for every metric when the selected period has no data', async () => {
  const service = createAdminService({
    adminRepository: {
      async listBookings() {
        return { rows: [], total: 0 };
      },
      async findBookingSlots() {
        return [];
      },
      async getBookingDashboardCounts() {
        return {
          new_bookings: 0,
          cancelled_bookings: 0,
          completed_bookings: 0
        };
      },
      async getRevenueEvents() {
        return { paid_amount: '0', refunded_amount: '0' };
      }
    },
    bookingsRepository: {
      async withTransaction() {
        return null;
      }
    },
    now: () => new Date('2026-11-12T03:00:00.000Z'),
    notifyIncidentCancellation: async () => {},
    notifyPendingIncidentCancellation: async () => {}
  });

  assert.deepEqual(await service.getDashboard('today'), {
    period: 'today',
    new_bookings: 0,
    net_revenue: '0',
    cancelled_bookings: 0,
    completed_bookings: 0
  });
});
