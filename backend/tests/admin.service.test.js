'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const ExcelJS = require('exceljs');
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
        return { total_slots: 0, occupied_slots: 0 };
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
      fill_rate_occupied_slots: 0,
      fill_rate_total_slots: 0,
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
    assert.match(slotQuery.sql, /slot_booking\.status IN \('CONFIRMED', 'COMPLETED'\)/);
    assert.match(slotQuery.sql, /slot_booking\.status = 'PENDING'/);
    assert.match(
      slotQuery.sql,
      /WHEN active_booking\.status IN \('CONFIRMED', 'COMPLETED'\) THEN 'BOOKED'/
    );
    assert.equal(slotQuery.parameters[0], '2026-11-15 17:00:00.000');
    assert.equal(result.time_slots[0].status, 'AVAILABLE');
    assert.equal(result.time_slots[0].booking_code, null);

    await slots.getMonthlySummary('1', '2026-11');
    const monthlyQuery = slotQueries.find(({ sql }) => sql.includes('AS booked'));
    assert.match(monthlyQuery.sql, /active_booking\.status IN \('CONFIRMED', 'COMPLETED'\)/);
  } finally {
    if (previousCutoff === undefined) delete process.env.BOOKING_DATA_START_AT;
    else process.env.BOOKING_DATA_START_AT = previousCutoff;
  }
});

test('booking validity keeps user checks and omits the deployment cutoff when unset', () => {
  const previousCutoff = process.env.BOOKING_DATA_START_AT;
  delete process.env.BOOKING_DATA_START_AT;
  try {
    const validity = createAdminRepository.buildBookingValidityCondition();
    assert.match(validity.sql, /valid_booking_user\.id = b\.user_id/);
    assert.doesNotMatch(validity.sql, /created_at/);
    assert.deepEqual(validity.parameters, []);
  } finally {
    if (previousCutoff === undefined) delete process.env.BOOKING_DATA_START_AT;
    else process.env.BOOKING_DATA_START_AT = previousCutoff;
  }
});

test('dashboard status totals and exported workbook match for today, 7d, and 30d', async () => {
  const timestamp = new Date('2026-11-16T03:00:00.000Z');
  const statusCounts = {
    PENDING: 1,
    UPCOMING: 1,
    IN_PROGRESS: 1,
    COMPLETED: 0,
    CANCELLED: 1,
    EXPIRED: 0
  };
  const repository = {
    async listBookings() { return { rows: [], total: 0 }; },
    async findBookingSlots() { return []; },
    async getDashboardBookingCounts() {
      return {
        new_bookings: 4,
        confirmed_bookings: 2,
        cancelled_bookings: 1,
        completed_bookings: 0,
        pending_bookings: 1,
        expired_bookings: 0,
        bookings_by_status: statusCounts
      };
    },
    async getDashboardPaymentMetrics() { return { gross_paid: '12000', refunded: '2000' }; },
    async getRevenueByDay() { return []; },
    async getRevenueSeries() { return []; },
    async getBookingSeries() { return []; },
    async getDashboardFillRate() { return { total_slots: 457, occupied_slots: 1 }; },
    async getDashboardCourtCounts() {
      return { courts_active: 28, courts_inactive: 1, courts_with_bookings: 2 };
    },
    async getTopCourts() { return []; },
    async getRecentBookings() { return []; },
    async withTransaction() { return null; }
  };
  const service = createAdminService({
    adminRepository: repository,
    bookingsRepository: { async withTransaction() { return null; } },
    now: () => timestamp,
    notifyIncidentCancellation: async () => {},
    notifyPendingIncidentCancellation: async () => {},
    writeAudit: async () => {}
  });
  const statusLabels = [
    'Chờ thanh toán',
    'Sắp tới',
    'Đang trong trận',
    'Hoàn thành',
    'Đã hủy',
    'Hết hạn'
  ];

  for (const range of ['today', '7d', '30d']) {
    const dashboard = await service.getDashboard(range);
    assert.equal(dashboard.kpis.fill_rate_percent, 100 / 457);
    assert.equal(dashboard.kpis.fill_rate_occupied_slots, 1);
    assert.equal(dashboard.kpis.fill_rate_total_slots, 457);
    assert.equal(
      Object.values(dashboard.bookings_by_status).reduce((total, count) => total + count, 0),
      dashboard.kpis.new_bookings
    );

    const exported = await service.exportDashboard({ range }, 1);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.buffer);
    const overview = workbook.getWorksheet('Tổng quan kỳ');
    const metric = (label) => {
      const row = overview.getColumn(1).values.findIndex((value) => value === label);
      assert.ok(row > 0, `Missing dashboard metric: ${label}`);
      return overview.getCell(row, 2).value;
    };
    assert.equal(metric('Đơn trong kỳ'), dashboard.kpis.new_bookings);
    assert.equal(metric('Tỷ lệ lấp đầy'), dashboard.kpis.fill_rate_percent);
    assert.equal(metric('Sân đang hoạt động'), dashboard.kpis.courts_active);
    assert.equal(
      metric('Sân có đơn đang hiệu lực trong kỳ'),
      dashboard.kpis.courts_with_bookings
    );
    assert.equal(metric('Sân tạm khóa'), dashboard.kpis.courts_inactive);

    const statusSheet = workbook.getWorksheet('Theo trạng thái');
    const workbookLabels = statusSheet.getColumn(1).values.slice(2);
    const workbookCounts = statusSheet.getColumn(2).values.slice(2);
    assert.deepEqual(workbookLabels, statusLabels);
    assert.equal(workbookCounts.reduce((total, count) => total + count, 0), metric('Đơn trong kỳ'));
    assert.equal(statusSheet.rowCount, 7);
  }
});

test('dashboard court counts classify a court under a locked facility as inactive', async () => {
  const previousCutoff = process.env.BOOKING_DATA_START_AT;
  process.env.BOOKING_DATA_START_AT = '2026-11-15T17:00:00.000Z';
  try {
    const queries = [];
    const repository = createAdminRepository({
      async execute(sql, parameters) {
        queries.push({ sql, parameters });
        return [[{
          courts_active: '28',
          courts_inactive: '1',
          courts_with_bookings: '2'
        }], []];
      }
    });

    const counts = await repository.getDashboardCourtCounts(
      new Date('2026-11-15T17:00:00.000Z'),
      new Date('2026-11-16T17:00:00.000Z')
    );
    assert.equal(counts.courts_active, '28');
    assert.equal(counts.courts_inactive, '1');
    assert.equal(queries.length, 1);
    assert.match(
      queries[0].sql,
      /active_court\.is_active = TRUE AND active_facility\.is_active = TRUE/
    );
    assert.match(
      queries[0].sql,
      /inactive_court\.is_active = FALSE OR inactive_facility\.is_active = FALSE/
    );
    assert.match(queries[0].sql, /COUNT\(DISTINCT c\.id\) AS courts_with_bookings/);
    assert.match(queries[0].sql, /valid_booking_user\.id = b\.user_id/);
    assert.ok(queries[0].parameters.includes('2026-11-15 17:00:00.000'));
  } finally {
    if (previousCutoff === undefined) delete process.env.BOOKING_DATA_START_AT;
    else process.env.BOOKING_DATA_START_AT = previousCutoff;
  }
});

test('dashboard fill rate counts the same effective occupied statuses as the slot page', async () => {
  const previousCutoff = process.env.BOOKING_DATA_START_AT;
  delete process.env.BOOKING_DATA_START_AT;
  try {
    const queries = [];
    const repository = createAdminRepository({
      async execute(sql, parameters) {
        queries.push({ sql, parameters });
        return [[{ total_slots: '457', occupied_slots: '1' }], []];
      }
    });
    const metrics = await repository.getDashboardFillRate('2026-11-16', '2026-11-16');

    assert.deepEqual(metrics, { total_slots: '457', occupied_slots: '1' });
    assert.equal(queries.length, 1);
    assert.deepEqual(queries[0].parameters, ['2026-11-16', '2026-11-16']);
    assert.match(queries[0].sql, /slot_booking\.status IN \('CONFIRMED', 'COMPLETED'\)/);
    assert.match(
      queries[0].sql,
      /slot_booking\.status = 'PENDING'[\s\S]*?slot_booking\.lock_expires_at > UTC_TIMESTAMP\(3\)/
    );
    assert.match(queries[0].sql, /ts\.status IN \('AVAILABLE', 'LOCKED', 'BOOKED'\)/);
    assert.match(queries[0].sql, /INNER JOIN courts AS c ON c\.id = ts\.court_id/);
    assert.match(queries[0].sql, /INNER JOIN facilities AS f ON f\.id = c\.facility_id/);
    assert.match(queries[0].sql, /TIME\(ts\.starts_at\) >= f\.opening_time/);
    assert.match(queries[0].sql, /TIME\(ts\.ends_at\) <= f\.closing_time/);
    assert.doesNotMatch(queries[0].sql, /ts\.status <> 'LOCKED'/);
  } finally {
    if (previousCutoff === undefined) delete process.env.BOOKING_DATA_START_AT;
    else process.env.BOOKING_DATA_START_AT = previousCutoff;
  }
});
