'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAdminService } = require('../src/admin/admin.service');
const createAdminRepository = require('../src/admin/admin.repository');
const { createAdminSlotsService } = require('../src/admin/slots.service');

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
            PENDING: 0,
            UPCOMING: 0,
            IN_PROGRESS: 0,
            COMPLETED: 0,
            CANCELLED: 0,
            EXPIRED: 0
          }
        };
      },
      async getDashboardPaymentMetrics() {
        return { gross_paid: '0', refunded: '0' };
      },
      async getRevenueSeries() {
        return [];
      },
      async getBookingSeries() {
        return [];
      },
      async getRevenueByDay() {
        return [];
      },
      async getDashboardCourtCounts() {
        return { courts_active: 0, courts_inactive: 0, courts_with_bookings: 0 };
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
      net_revenue_prev: '0',
      gross_paid: '0',
      refunded: '0',
      fill_rate_percent: 0,
      courts_active: 0,
      courts_with_bookings: 0,
      courts_inactive: 0,
      pending_match_requests: 0
    },
    series: {
      granularity: 'hour',
      buckets: Array.from({ length: 24 }, (_, hour) => ({
        start: new Date(Date.parse(
          `2026-11-12T${String(hour).padStart(2, '0')}:00:00+07:00`
        )).toISOString(),
        net_revenue: '0',
        bookings: 0
      }))
    },
    revenue_by_day: [{ date: '2026-11-12', net_revenue: '0' }],
    bookings_by_status: {
      PENDING: 0,
      UPCOMING: 0,
      IN_PROGRESS: 0,
      COMPLETED: 0,
      CANCELLED: 0,
      EXPIRED: 0
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

test('admin booking list applies each Vietnam creation-date range and fixed page size', async () => {
  const timestamp = new Date('2026-11-16T03:00:00.000Z');
  const observedFilters = [];
  const service = createAdminService({
    adminRepository: {
      async listBookings(filters) {
        observedFilters.push(filters);
        return {
          rows: [],
          total: 0,
          statusCounts: {
            PENDING: 0,
            UPCOMING: 0,
            IN_PROGRESS: 0,
            COMPLETED: 0,
            CANCELLED: 0,
            EXPIRED: 0
          }
        };
      },
      async findBookingSlots() {
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

  const expectedRanges = {
    today: ['2026-11-15T17:00:00.000Z', '2026-11-16T17:00:00.000Z'],
    '7d': ['2026-11-09T17:00:00.000Z', '2026-11-16T17:00:00.000Z'],
    '30d': ['2026-10-17T17:00:00.000Z', '2026-11-16T17:00:00.000Z']
  };
  for (const [range, [start, end]] of Object.entries(expectedRanges)) {
    const result = await service.listBookings({ range });
    const filters = observedFilters[observedFilters.length - 1];
    assert.equal(filters.createdFrom.toISOString(), start);
    assert.equal(filters.createdTo.toISOString(), end);
    assert.equal(filters.pageSize, 10);
    assert.equal(result.pagination.page_size, 10);
    assert.deepEqual(result.status_counts, {
      PENDING: 0,
      UPCOMING: 0,
      IN_PROGRESS: 0,
      COMPLETED: 0,
      CANCELLED: 0,
      EXPIRED: 0
    });
  }
});

test('admin booking list rejects a client-selected page size', async () => {
  const service = createAdminService({
    adminRepository: {
      async listBookings() {
        throw new Error('Must not query the repository.');
      }
    },
    bookingsRepository: {
      async withTransaction() {
        return null;
      }
    },
    now: () => new Date('2026-11-16T03:00:00.000Z'),
    notifyIncidentCancellation: async () => {},
    notifyPendingIncidentCancellation: async () => {},
    writeAudit: async () => {}
  });

  await assert.rejects(
    service.listBookings({ page_size: '1' }),
    { code: 'INVALID_ADMIN_QUERY' }
  );
});

test('booking list count, status counts, rows and slot display share the booking validity cutoff', async () => {
  const previousCutoff = process.env.BOOKING_DATA_START_AT;
  process.env.BOOKING_DATA_START_AT = '2026-11-15T17:00:00.000Z';
  try {
    const repositoryQueries = [];
    const repository = createAdminRepository({
      async execute(sql, parameters) {
        repositoryQueries.push({ sql, parameters });
        if (sql.includes('GROUP BY display_status')) {
          return [[{ display_status: 'UPCOMING', total: 1 }], []];
        }
        if (sql.includes('COUNT(DISTINCT b.id) AS total')) {
          return [[{ total: 1 }], []];
        }
        return [[], []];
      }
    });
    const list = await repository.listBookings({
      status: 'UPCOMING',
      query: 'SB-1',
      facilityId: '4',
      date: '2026-11-16',
      createdFrom: new Date('2026-11-15T17:00:00.000Z'),
      createdTo: new Date('2026-11-16T17:00:00.000Z'),
      page: 1,
      pageSize: createAdminRepository.BOOKING_PAGE_SIZE
    });
    assert.equal(list.total, 1);
    assert.equal(list.statusCounts.UPCOMING, 1);
    assert.equal(repositoryQueries.length, 3);
    for (const { sql, parameters } of repositoryQueries) {
      assert.match(sql, /valid_booking_user\.id = b\.user_id/);
      assert.match(sql, /b\.created_at >= \?/);
      assert.ok(parameters.includes('2026-11-15 17:00:00.000'));
      assert.match(sql, /filter_ts\.service_date = \?/);
      assert.match(sql, /filter_c\.facility_id = \?/);
    }

    const slotQueries = [];
    const slots = createAdminSlotsService({
      async execute(sql, parameters) {
        slotQueries.push({ sql, parameters });
        if (sql.includes('SELECT c.id, f.opening_time')) {
          return [[{ id: '1', opening_time: '08:00:00', closing_time: '22:00:00' }], []];
        }
        if (sql.includes('AS effective_status')) {
          return [[{
            id: '10',
            court_id: '1',
            service_date: '2026-11-16',
            starts_at: '10:00:00',
            ends_at: '11:00:00',
            price: '100000',
            booking_code: null,
            slot_date: '2026-11-16',
            effective_status: 'AVAILABLE'
          }], []];
        }
        return [[{ available_count: 1 }], []];
      }
    });
    const result = await slots.listTimeSlots('1', '2026-11-16');
    const slotQuery = slotQueries.find(({ sql }) => sql.includes('AS effective_status'));
    assert.match(slotQuery.sql, /valid_booking_user\.id = slot_booking\.user_id/);
    assert.match(slotQuery.sql, /slot_booking\.status = 'CONFIRMED'/);
    assert.match(slotQuery.sql, /slot_booking\.status = 'PENDING'/);
    assert.equal(slotQuery.parameters[0], '2026-11-15 17:00:00.000');
    assert.equal(result.time_slots[0].status, 'AVAILABLE');
    assert.equal(result.time_slots[0].booking_code, null);
  } finally {
    if (previousCutoff === undefined) delete process.env.BOOKING_DATA_START_AT;
    else process.env.BOOKING_DATA_START_AT = previousCutoff;
  }
});
