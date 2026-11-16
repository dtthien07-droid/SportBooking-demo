'use strict';

const ExcelJS = require('exceljs');

const HEADERS = [
  'Mã đơn',
  'Khách hàng',
  'SĐT',
  'Email',
  'Cơ sở',
  'Sân',
  'Ngày chơi',
  'Khung giờ',
  'Trạng thái',
  'Tổng tiền',
  'Đã trả',
  'Đã hoàn',
  'Thời điểm đặt',
  'Người hủy',
  'Lý do hủy'
];

function escapeTextCell(value) {
  const text = value == null ? '' : String(value);
  return /^[=+\-@\t\r\n]/.test(text) ? `'${text}` : text;
}

function parseSlotTimestamp(slot, key) {
  const date = String(slot.service_date || '').slice(0, 10);
  const time = String(slot[key] || '').slice(0, 8);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}:\d{2}$/.test(time)) {
    throw new TypeError('Khung giờ trong dữ liệu xuất Excel không hợp lệ.');
  }
  const timestamp = time === '24:00:00'
    ? Date.parse(`${date}T00:00:00+07:00`) + 24 * 60 * 60 * 1000
    : Date.parse(`${date}T${time}+07:00`);
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('Khung giờ trong dữ liệu xuất Excel không hợp lệ.');
  }
  return timestamp;
}

function getStatusLabel(booking, slots, currentTime) {
  switch (booking.status) {
    case 'PENDING':
      return 'Chờ thanh toán';
    case 'EXPIRED':
      return 'Hết hạn';
    case 'CANCELLED':
      return 'Đã hủy';
    case 'COMPLETED':
      return 'Hoàn thành';
    case 'CONFIRMED': {
      if (slots.length === 0) {
        throw new TypeError('Đơn đã xác nhận không có khung giờ để xuất trạng thái.');
      }
      const orderedSlots = [...slots].sort((first, second) => (
        String(first.service_date).localeCompare(String(second.service_date))
        || String(first.starts_at).localeCompare(String(second.starts_at))
      ));
      const start = parseSlotTimestamp(orderedSlots[0], 'starts_at');
      const end = parseSlotTimestamp(orderedSlots[orderedSlots.length - 1], 'ends_at');
      if (end < start) throw new TypeError('Khoảng khung giờ của đơn không hợp lệ.');
      if (currentTime.getTime() < start) return 'Sắp tới';
      if (currentTime.getTime() < end) return 'Đang trong trận';
      return 'Hoàn thành';
    }
    default:
      throw new TypeError('Trạng thái đơn đặt sân không được hỗ trợ khi xuất Excel.');
  }
}

function formatServiceDate(value) {
  const date = String(value || '').slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new TypeError('Ngày chơi trong dữ liệu xuất Excel không hợp lệ.');
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatBookingTime(value) {
  if (value === null || value === undefined || value === '') {
    throw new TypeError('Thời điểm đặt trong dữ liệu xuất Excel không hợp lệ.');
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError('Thời điểm đặt trong dữ liệu xuất Excel không hợp lệ.');
  }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${values.day}/${values.month}/${values.year} ${values.hour}:${values.minute}`;
}

function amountValue(value) {
  const amount = BigInt(String(value ?? 0));
  const numeric = Number(amount);
  if (amount < 0n || !Number.isSafeInteger(numeric)) {
    throw new RangeError('Số tiền trong dữ liệu xuất Excel nằm ngoài phạm vi.');
  }
  return numeric;
}

function formatVietnamFilenameTime(value) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${values.year}${values.month}${values.day}-${values.hour}${values.minute}`;
}

function dateValue(value) {
  if (value instanceof Date || (typeof value === 'string' && value.includes('T'))) {
    const parsed = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(parsed.getTime())) {
      throw new TypeError('Ngày trong dữ liệu xuất Excel không hợp lệ.');
    }
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).formatToParts(parsed);
    const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
    return `${values.day}/${values.month}/${values.year}`;
  }
  const date = String(value || '').slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new TypeError('Ngày trong dữ liệu xuất Excel không hợp lệ.');
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatTime(value) {
  const time = String(value || '');
  if (!/^\d{2}:\d{2}(?::\d{2})?$/.test(time)) {
    throw new TypeError('Giờ trong dữ liệu xuất Excel không hợp lệ.');
  }
  return time.slice(0, 5);
}

function createWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SportBooking';
  return workbook;
}

function createWorksheet(workbook, name, columns) {
  const worksheet = workbook.addWorksheet(name);
  worksheet.columns = columns.map(([header, key, width, numFmt]) => ({
    header,
    key,
    width,
    ...(numFmt ? { style: { numFmt } } : {})
  }));
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = {
    from: 'A1',
    to: `${String.fromCharCode(64 + columns.length)}1`
  };
  worksheet.getRow(1).font = { bold: true };
  return worksheet;
}

function assertExportRows(rows) {
  if (!Array.isArray(rows)) throw new TypeError('Danh sách dữ liệu xuất Excel không hợp lệ.');
  if (rows.length > 5000) {
    const error = new Error('Quá nhiều dòng, hãy lọc thu hẹp');
    error.status = 400;
    error.code = 'EXPORT_TOO_MANY_ROWS';
    throw error;
  }
}

function valueRows(worksheet, values) {
  for (const [label, value, numberFormat] of values) {
    const row = worksheet.addRow([
      escapeTextCell(label),
      typeof value === 'string' ? escapeTextCell(value) : value
    ]);
    if (numberFormat) row.getCell(2).numFmt = numberFormat;
  }
}

function displayDateTime(value) {
  return formatBookingTime(value);
}

async function writeExport(workbook, prefix, now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Thời điểm xuất Excel không hợp lệ.');
  }
  return {
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    filename: `${prefix}-${formatVietnamFilenameTime(now)}.xlsx`
  };
}

async function createBookingsExport({ bookings, slotsByBookingId, now = new Date() }) {
  if (!Array.isArray(bookings) || !(slotsByBookingId instanceof Map)
      || !(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Thông tin xuất Excel không hợp lệ.');
  }
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SportBooking';
  const worksheet = workbook.addWorksheet('Đơn đặt sân');
  worksheet.columns = [
    { header: HEADERS[0], key: 'booking_code', width: 22 },
    { header: HEADERS[1], key: 'customer', width: 28 },
    { header: HEADERS[2], key: 'phone', width: 18 },
    { header: HEADERS[3], key: 'email', width: 32 },
    { header: HEADERS[4], key: 'facility', width: 32 },
    { header: HEADERS[5], key: 'court', width: 24 },
    { header: HEADERS[6], key: 'dates', width: 24 },
    { header: HEADERS[7], key: 'times', width: 28 },
    { header: HEADERS[8], key: 'status', width: 20 },
    { header: HEADERS[9], key: 'total_amount', width: 18 },
    { header: HEADERS[10], key: 'paid_amount', width: 18 },
    { header: HEADERS[11], key: 'refunded_amount', width: 18 },
    { header: HEADERS[12], key: 'created_at', width: 22 },
    { header: HEADERS[13], key: 'cancelled_by', width: 20 },
    { header: HEADERS[14], key: 'cancellation_reason', width: 48 }
  ];
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = { from: 'A1', to: 'O1' };
  worksheet.getRow(1).font = { bold: true };

  for (const booking of bookings) {
    const bookingId = String(booking.id);
    const slots = slotsByBookingId.get(bookingId) || [];
    const facilities = [...new Set(slots.map((slot) => slot.facility_name))];
    const courts = [...new Set(slots.map((slot) => slot.court_name))];
    const cancellationLabels = { USER: 'Khách', ADMIN: 'Quản trị viên' };
    if (booking.cancelled_by && !Object.hasOwn(cancellationLabels, booking.cancelled_by)) {
      throw new TypeError('Người hủy trong dữ liệu xuất Excel không hợp lệ.');
    }
    const row = worksheet.addRow([
      escapeTextCell(booking.booking_code),
      escapeTextCell(booking.owner_full_name),
      escapeTextCell(booking.owner_phone),
      escapeTextCell(booking.owner_email),
      escapeTextCell(facilities.join(', ')),
      escapeTextCell(courts.join(', ')),
      escapeTextCell([...new Set(slots.map((slot) => formatServiceDate(slot.service_date)))].join(', ')),
      escapeTextCell(slots.map((slot) => (
        `${slot.starts_at.slice(0, 5)}-${slot.ends_at.slice(0, 5)}`
      )).join(', ')),
      getStatusLabel(booking, slots, now),
      amountValue(booking.total_amount),
      amountValue(booking.paid_amount),
      amountValue(booking.refunded_amount),
      formatBookingTime(booking.created_at),
      cancellationLabels[booking.cancelled_by] || '',
      escapeTextCell(booking.cancellation_reason)
    ]);
    for (const column of [10, 11, 12]) row.getCell(column).numFmt = '#,##0 "đ"';
  }

  const timestamp = formatVietnamFilenameTime(now);
  return {
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    filename: `don-dat-san-${timestamp}.xlsx`
  };
}

const DASHBOARD_STATUS_LABELS = Object.freeze({
  PENDING: 'Chờ thanh toán',
  UPCOMING: 'Sắp tới',
  IN_PROGRESS: 'Đang trong trận',
  COMPLETED: 'Hoàn thành',
  CANCELLED: 'Đã hủy',
  EXPIRED: 'Hết hạn',
  CONFIRMED: 'Đã xác nhận'
});
const DASHBOARD_STATUS_ORDER = Object.freeze([
  'PENDING',
  'UPCOMING',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED'
]);

async function createDashboardExport({ dashboard, now = new Date() }) {
  if (!dashboard || !dashboard.kpis || !dashboard.series
      || !Array.isArray(dashboard.series.buckets)
      || !dashboard.bookings_by_status
      || !Array.isArray(dashboard.top_courts)
      || !Array.isArray(dashboard.recent_bookings)) {
    throw new TypeError('Số liệu tổng quan không hợp lệ.');
  }
  const workbook = createWorkbook();
  const kpis = dashboard.kpis;
  const summary = createWorksheet(workbook, 'Tổng quan kỳ', [
    ['Chỉ số', 'metric', 32],
    ['Giá trị', 'value', 22]
  ]);
  valueRows(summary, [
    ['Đơn trong kỳ', Number(kpis.new_bookings)],
    ['Doanh thu thuần', amountValue(kpis.net_revenue), '#,##0 "đ"'],
    ['Doanh thu kỳ trước', amountValue(kpis.net_revenue_prev), '#,##0 "đ"'],
    ['Tỷ lệ lấp đầy', Number(kpis.fill_rate_percent), '0.##"%"'],
    ['Sân đang hoạt động', Number(kpis.courts_active)],
    ['Sân có đơn đang hiệu lực trong kỳ', Number(kpis.courts_with_bookings)],
    ['Sân tạm khóa', Number(kpis.courts_inactive)]
  ]);

  const hourly = dashboard.series.granularity === 'hour';
  if (!hourly && dashboard.series.granularity !== 'day') {
    throw new TypeError('Chuỗi biểu đồ tổng quan không hợp lệ.');
  }
  const series = createWorksheet(workbook, hourly ? 'Theo giờ' : 'Theo ngày', [
    [hourly ? 'Giờ' : 'Ngày', 'bucket', 20],
    ['Số đơn', 'bookings', 16],
    ['Doanh thu thuần', 'net_revenue', 22, '#,##0 "đ"']
  ]);
  for (const bucket of dashboard.series.buckets) {
    const date = new Date(bucket.start);
    if (!Number.isFinite(date.getTime())) throw new TypeError('Mốc biểu đồ không hợp lệ.');
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      ...(hourly ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}),
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    const label = hourly
      ? `${values.day}/${values.month}/${values.year} ${values.hour}:${values.minute}`
      : `${values.day}/${values.month}/${values.year}`;
    series.addRow([
      escapeTextCell(label),
      Number(bucket.bookings),
      amountValue(bucket.net_revenue)
    ]);
  }

  const statusSheet = createWorksheet(workbook, 'Theo trạng thái', [
    ['Trạng thái', 'status', 28],
    ['Số đơn', 'bookings', 18]
  ]);
  const statusKeys = Object.keys(dashboard.bookings_by_status);
  if (statusKeys.length !== DASHBOARD_STATUS_ORDER.length
      || statusKeys.some((status) => !DASHBOARD_STATUS_ORDER.includes(status))) {
    throw new TypeError('Trạng thái đơn tổng quan không hợp lệ.');
  }
  for (const status of DASHBOARD_STATUS_ORDER) {
    const count = Number(dashboard.bookings_by_status[status]);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new TypeError('Số đơn theo trạng thái tổng quan không hợp lệ.');
    }
    statusSheet.addRow([DASHBOARD_STATUS_LABELS[status], count]);
  }

  const top = createWorksheet(workbook, 'Top cơ sở', [
    ['Cơ sở', 'facility', 32],
    ['Sân', 'court', 26],
    ['Môn thể thao', 'sport', 20],
    ['Số đơn', 'bookings', 16],
    ['Doanh thu', 'revenue', 22, '#,##0 "đ"']
  ]);
  for (const item of dashboard.top_courts) {
    top.addRow([
      escapeTextCell(item.facility_name),
      escapeTextCell(item.court_name),
      escapeTextCell(item.sport_type),
      Number(item.booking_count),
      amountValue(item.revenue)
    ]);
  }

  const recent = createWorksheet(workbook, 'Đơn mới nhất', [
    ['Mã đơn', 'code', 24],
    ['Khách hàng', 'customer', 28],
    ['Cơ sở', 'facility', 30],
    ['Sân', 'court', 24],
    ['Ngày chơi', 'date', 18],
    ['Thời điểm đặt', 'created_at', 24],
    ['Trạng thái', 'status', 22],
    ['Đã trả', 'paid', 18, '#,##0 "đ"'],
    ['Đã hoàn', 'refunded', 18, '#,##0 "đ"']
  ]);
  for (const booking of dashboard.recent_bookings) {
    const status = DASHBOARD_STATUS_LABELS[booking.status];
    if (!status) throw new TypeError('Trạng thái đơn mới nhất không hợp lệ.');
    recent.addRow([
      escapeTextCell(booking.booking_code),
      escapeTextCell(booking.owner_name),
      escapeTextCell(booking.facility_name),
      escapeTextCell(booking.court_name),
      booking.service_date ? dateValue(booking.service_date) : '',
      displayDateTime(booking.created_at),
      status,
      amountValue(booking.paid_amount),
      amountValue(booking.refunded_amount)
    ]);
  }
  return writeExport(workbook, 'bao-cao-tong-quan', now);
}

async function createUsersExport({ users, summary, now = new Date() }) {
  assertExportRows(users);
  if (!summary || typeof summary !== 'object') {
    throw new TypeError('Số liệu người dùng không hợp lệ.');
  }
  const workbook = createWorkbook();
  const worksheet = createWorksheet(workbook, 'Người dùng', [
    ['Mã', 'id', 16],
    ['Họ tên', 'name', 30],
    ['Email', 'email', 34],
    ['SĐT', 'phone', 20],
    ['Trạng thái', 'status', 20],
    ['Ngày tham gia', 'joined', 20]
  ]);
  for (const user of users) {
    if (!['ACTIVE', 'ADMIN_LOCKED'].includes(user.account_status)) {
      throw new TypeError('Trạng thái người dùng không hợp lệ.');
    }
    worksheet.addRow([
      escapeTextCell(user.id),
      escapeTextCell(user.full_name),
      escapeTextCell(user.email),
      escapeTextCell(user.phone),
      user.account_status === 'ACTIVE' ? 'Đang hoạt động' : 'Bị khóa',
      dateValue(user.created_at)
    ]);
  }
  const summarySheet = createWorksheet(workbook, 'Tóm tắt', [
    ['Chỉ số', 'metric', 32],
    ['Số lượng', 'value', 20]
  ]);
  valueRows(summarySheet, [
    ['Tổng người dùng', Number(summary.total_users)],
    ['Đang hoạt động', Number(summary.active_users)],
    ['Bị khóa', Number(summary.locked_users)],
    ['Người dùng mới trong tháng', Number(summary.new_users_this_month)]
  ]);
  return writeExport(workbook, 'nguoi-dung', now);
}

async function createFacilitiesExport({ facilities, courts, summary, now = new Date() }) {
  assertExportRows(facilities);
  assertExportRows(courts);
  if (!summary || typeof summary !== 'object') {
    throw new TypeError('Số liệu cơ sở không hợp lệ.');
  }
  const workbook = createWorkbook();
  const worksheet = createWorksheet(workbook, 'Cơ sở & Sân', [
    ['Mã cơ sở', 'id', 16],
    ['Tên', 'name', 32],
    ['Quận/Huyện', 'district', 20],
    ['Địa chỉ', 'address', 42],
    ['Hotline', 'hotline', 20],
    ['Giờ mở', 'opening', 14],
    ['Giờ đóng', 'closing', 14],
    ['Trạng thái', 'status', 20],
    ['Số sân', 'court_count', 14],
    ['Số sân đang hoạt động', 'active_courts', 24]
  ]);
  for (const facility of facilities) {
    worksheet.addRow([
      escapeTextCell(facility.id),
      escapeTextCell(facility.name),
      escapeTextCell(facility.district),
      escapeTextCell(facility.address),
      escapeTextCell(facility.hotline),
      formatTime(facility.opening_time),
      formatTime(facility.closing_time),
      facility.is_active ? 'Đang hoạt động' : 'Tạm khóa',
      Number(facility.court_count),
      Number(facility.active_court_count)
    ]);
  }
  const courtsSheet = createWorksheet(workbook, 'Sân con', [
    ['Mã cơ sở', 'facility_id', 16],
    ['Tên cơ sở', 'facility_name', 32],
    ['Mã sân', 'court_id', 16],
    ['Tên sân', 'court_name', 28],
    ['Giá thường', 'normal', 20, '#,##0 "đ"'],
    ['Giá cao điểm', 'peak', 20, '#,##0 "đ"']
  ]);
  for (const court of courts) {
    courtsSheet.addRow([
      escapeTextCell(court.facility_id),
      escapeTextCell(court.facility_name),
      escapeTextCell(court.id),
      escapeTextCell(court.name),
      amountValue(court.price_normal),
      amountValue(court.price_peak)
    ]);
  }
  const summarySheet = createWorksheet(workbook, 'Tóm tắt', [
    ['Chỉ số', 'metric', 32],
    ['Giá trị', 'value', 22]
  ]);
  valueRows(summarySheet, [
    ['Tổng số cơ sở', Number(summary.total_facilities)],
    ['Cơ sở đang hoạt động', Number(summary.active_facilities)],
    ['Cơ sở tạm khóa', Number(summary.inactive_facilities)],
    ['Tỷ lệ lấp đầy 7 ngày', Number(summary.avg_fill_rate_percent), '0.##"%"']
  ]);
  return writeExport(workbook, 'co-so-san', now);
}

async function createTimeSlotsExport({ court, slots, from, to, now = new Date() }) {
  assertExportRows(slots);
  if (!court || !Array.isArray(slots)) throw new TypeError('Dữ liệu khung giờ không hợp lệ.');
  const workbook = createWorkbook();
  const worksheet = createWorksheet(workbook, 'Khung giờ & Giá', [
    ['Ngày', 'date', 18],
    ['Khung giờ', 'time', 18],
    ['Loại giờ', 'type', 18],
    ['Giá', 'price', 20, '#,##0 "đ"'],
    ['Trạng thái', 'status', 22]
  ]);
  const labels = { AVAILABLE: 'Trống', LOCKED: 'Đang giữ chỗ', BOOKED: 'Đã đặt' };
  let booked = 0;
  let held = 0;
  let available = 0;
  let expectedRevenue = 0n;
  for (const slot of slots) {
    const status = labels[slot.status];
    if (!status) throw new TypeError('Trạng thái khung giờ không hợp lệ.');
    if (slot.status === 'BOOKED') booked += 1;
    else if (slot.status === 'LOCKED') held += 1;
    else available += 1;
    const hour = Number(String(slot.starts_at).slice(0, 2));
    const price = BigInt(String(slot.price));
    if (price < 0n) throw new RangeError('Giá khung giờ không hợp lệ.');
    expectedRevenue += price;
    worksheet.addRow([
      dateValue(slot.service_date),
      `${formatTime(slot.starts_at)}-${formatTime(slot.ends_at)}`,
      hour >= 17 && hour < 21 ? 'Cao điểm' : 'Thường',
      amountValue(slot.price),
      status
    ]);
  }
  const summarySheet = createWorksheet(workbook, 'Tóm tắt', [
    ['Chỉ số', 'metric', 30],
    ['Giá trị', 'value', 24]
  ]);
  valueRows(summarySheet, [
    ['Cơ sở', court.facility_name || ''],
    ['Sân', court.name || ''],
    ['Giá thường', amountValue(court.price_normal), '#,##0 "đ"'],
    ['Giá cao điểm', amountValue(court.price_peak), '#,##0 "đ"'],
    ['Từ ngày', dateValue(from)],
    ['Đến ngày', dateValue(to)],
    ['Tổng khung', slots.length],
    ['Đã đặt', booked],
    ['Đang giữ chỗ', held],
    ['Còn trống', available],
    ['Doanh thu dự kiến', amountValue(expectedRevenue), '#,##0 "đ"']
  ]);
  return writeExport(workbook, 'khung-gio-gia', now);
}

module.exports = {
  assertExportRows,
  createBookingsExport,
  createDashboardExport,
  createFacilitiesExport,
  createTimeSlotsExport,
  createUsersExport,
  escapeTextCell
};
