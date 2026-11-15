'use strict';

(() => {
  const state = window.SportBookingAdminState;
  const shell = window.SportBookingAdminShell;
  const api = window.SportBookingAdminApi;
  const exportDownload = window.SportBookingExportDownload;
  const slotsState = window.SportBookingAdminSlotsState;
  if (!state || !shell || !api || !exportDownload || !slotsState) {
    throw new Error('Thiếu cấu hình trang khung giờ và giá.');
  }
  shell.mountAdminShell({ active: 'slots' });
  const el = {
    guard: document.getElementById('adminGuard'),
    guardMessage: document.getElementById('adminGuardMessage'),
    guardRetry: document.getElementById('adminGuardRetry'),
    app: document.getElementById('adminApp'),
    facility: document.getElementById('slotFacility'),
    court: document.getElementById('slotCourt'),
    date: document.getElementById('slotDate'),
    status: document.getElementById('slotsStatus'),
    dateLabel: document.getElementById('slotGridDate'),
    rows: document.getElementById('slotRows'),
    priceForm: document.getElementById('slotPriceForm'),
    priceNormal: document.getElementById('slotPriceNormal'),
    pricePeak: document.getElementById('slotPricePeak'),
    pricePreview: document.getElementById('slotPricePreview'),
    priceError: document.getElementById('slotPriceError'),
    generateForm: document.getElementById('slotGenerateForm'),
    fromDate: document.getElementById('slotFromDate'),
    toDate: document.getElementById('slotToDate'),
    generateError: document.getElementById('slotGenerateError'),
    mockupFacility: document.getElementById('mockupSlotFacility'),
    mockupCourt: document.getElementById('mockupSlotCourt'),
    mockupDate: document.getElementById('mockupSlotDate'),
    viewButtons: [...document.querySelectorAll('[data-slot-view]')],
    exportButton: document.getElementById('slotsExport'),
    exportStatus: document.getElementById('slotsExportStatus'),
    normalHours: document.querySelector('[data-admin-normal-hours]'),
    hoursTitle: document.querySelector('[data-admin-hours-title]'),
    rangeLabel: document.querySelector('[data-admin-slot-range-label]'),
    pricePreviewMessage: document.querySelector('[data-admin-price-preview]'),
    normalPriceError: document.getElementById('mockupNormalPriceError'),
    peakPriceError: document.getElementById('mockupPeakPriceError'),
    normalApply: document.querySelector('[data-admin-price-apply="normal"]'),
    peakApply: document.querySelector('[data-admin-price-apply="peak"]'),
    mockupCourtTabs: document.querySelector('[data-admin-slot-court-tabs]'),
    mockupMatrix: document.querySelector('[data-admin-slot-matrix]'),
    mockupNormalPrice: document.getElementById('mockupNormalPrice'),
    mockupPeakPrice: document.getElementById('mockupPeakPrice'),
    mockupSavePrices: document.getElementById('btn-save-all')
  };
  let facilities = [];
  let courts = [];
  let selectedCourt = null;
  let selectedFacility = null;
  let viewMode = 'day';
  let polling = null;
  let pending = false;
  let selectionRequestId = 0;
  let pricePreviewRequestId = 0;
  let pricePreviewTimer = null;
  const today = slotsState.localDate();
  el.date.value = today;
  el.mockupDate.value = today;
  el.fromDate.value = today;
  const twoWeeksLater = new Date(`${today}T00:00:00Z`);
  twoWeeksLater.setUTCDate(twoWeeksLater.getUTCDate() + 13);
  el.toDate.value = twoWeeksLater.toISOString().slice(0, 10);
  function node(tag, text = '') {
    const element = document.createElement(tag);
    element.textContent = text;
    return element;
  }

  el.mockupMatrix?.replaceChildren(node('p', 'Đang tải khung giờ...'));
  el.mockupCourtTabs?.replaceChildren(node('span', 'Đang tải danh sách sân...'));

  async function authorize() {
    return Boolean(await shell.authorizeAdmin({
      api,
      state,
      guard: el.guard,
      guardMessage: el.guardMessage,
      guardRetry: el.guardRetry,
      app: el.app
    }));
  }

  async function loadFacilities() {
    try {
      const result = await api.listAdminFacilities({ page: 1, page_size: 50 });
      facilities = result.facilities;
      const options = [new Option('Chọn cơ sở', '')];
      for (const facility of facilities) options.push(new Option(facility.name, facility.id));
      el.facility.replaceChildren(...options);
      if (el.mockupFacility) {
        el.mockupFacility.replaceChildren(...facilities.map((facility) => new Option(facility.name, facility.id)));
      }
      if (facilities.length) {
        const requestedFacility = new URLSearchParams(window.location.search).get('facility');
        const selected = facilities.find((facility) => String(facility.id) === requestedFacility)
          || facilities[0];
        el.facility.value = selected.id;
        if (el.mockupFacility) el.mockupFacility.value = String(selected.id);
        await loadCourts(selected.id);
      } else {
        el.court.replaceChildren(new Option('Chưa có cơ sở', ''));
        el.mockupFacility?.replaceChildren(new Option('Chưa có cơ sở', ''));
        el.mockupCourt?.replaceChildren(new Option('Chưa có sân', ''));
        el.rows.replaceChildren(emptyRow('Chưa có cơ sở để quản lý.'));
        renderMockupCourtTabs();
        updateSlotMetrics([]);
      }
    } catch (error) {
      el.status.textContent = error.message || 'Không thể tải cơ sở.';
      throw error;
    }
  }

  function emptyRow(message) {
    const row = document.createElement('tr');
    const cell = node('td', message);
    cell.colSpan = 4;
    row.append(cell);
    return row;
  }

  async function loadCourts(facilityId, preferredCourtId = '') {
    const requestId = ++selectionRequestId;
    selectedCourt = null;
    courts = [];
    el.court.disabled = true;
    el.court.replaceChildren(new Option('Đang tải sân...', ''));
    try {
      const detail = await api.getAdminFacility(facilityId);
      if (requestId !== selectionRequestId) return;
      courts = detail.courts;
      selectedFacility = detail.facility;
      const options = [new Option(courts.length ? 'Chọn sân' : 'Cơ sở chưa có sân', '')];
      for (const court of courts) options.push(new Option(court.name, court.id));
      el.court.replaceChildren(...options);
      el.court.disabled = courts.length === 0;
      if (el.mockupCourt) {
        el.mockupCourt.replaceChildren(...courts.map((court) => new Option(court.name, court.id)));
        el.mockupCourt.disabled = courts.length === 0;
      }
      renderMockupCourtTabs();
      if (courts.length) {
        const selected = courts.some((court) => String(court.id) === String(preferredCourtId))
          ? preferredCourtId
          : courts[0].id;
        el.court.value = selected;
        if (el.mockupCourt) el.mockupCourt.value = String(selected);
        selectCourt(selected);
      } else {
        el.rows.replaceChildren(emptyRow('Cơ sở chưa có sân.'));
        renderMockupCourtTabs();
        updateSlotMetrics([]);
      }
    } catch (error) {
      if (requestId === selectionRequestId) {
        el.status.textContent = error.message || 'Không thể tải danh sách sân.';
        el.court.replaceChildren(new Option('Không tải được danh sách sân', ''));
      }
    }
  }

  function renderMockupCourtTabs() {
    if (!el.mockupCourtTabs) return;
    const buttons = courts.map((court) => {
      const selected = selectedCourt && String(selectedCourt.id) === String(court.id);
      const button = node('button', court.name);
      button.type = 'button';
      button.className = selected
        ? 'px-4 py-2 rounded-xl bg-primary text-on-primary font-label-md text-label-md shadow-sm font-semibold whitespace-nowrap'
        : 'px-4 py-2 rounded-xl bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-label-md text-label-md whitespace-nowrap';
      button.addEventListener('click', () => {
        el.mockupCourt.value = String(court.id);
        el.mockupCourt.dispatchEvent(new Event('change', { bubbles: true }));
      });
      return button;
    });
    el.mockupCourtTabs.replaceChildren(...buttons);
  }

  function updateSlotMetrics(value) {
    const metrics = Array.isArray(value) ? slotsState.getSlotMetrics(value) : value;
    const setMetric = (selector, value) => {
      const target = document.querySelector(selector);
      if (target) target.textContent = String(value);
    };
    const formatPercent = (value) => `${new Intl.NumberFormat('vi-VN', {
      maximumFractionDigits: 1
    }).format(value)}%`;
    setMetric('[data-admin-slot-total]', metrics.total);
    setMetric('[data-admin-slot-booked]', metrics.occupied);
    setMetric('[data-admin-slot-available]', metrics.available);
    setMetric('[data-admin-slot-fill-rate]', formatPercent(metrics.fillRate));
    setMetric('[data-admin-slot-revenue]',
      new Intl.NumberFormat('vi-VN').format(BigInt(metrics.expectedRevenue)));
    setMetric('[data-admin-normal-slot-count]', metrics.normalTotal);
    setMetric('[data-admin-normal-slot-rate]', formatPercent(metrics.normalFillRate));
    setMetric('[data-admin-peak-slot-count]', metrics.peakTotal);
    setMetric('[data-admin-peak-slot-rate]', formatPercent(metrics.peakFillRate));
    const progress = document.querySelector('[data-admin-slot-fill-bar]');
    if (progress) progress.style.width = `${metrics.fillRate}%`;
  }

  function updatePriceControls() {
    const readOnly = !selectedCourt || pending || el.date.value < today;
    el.mockupNormalPrice.disabled = readOnly;
    el.mockupPeakPrice.disabled = readOnly;
    el.mockupSavePrices.disabled = readOnly;
    el.normalApply.disabled = readOnly;
    el.peakApply.disabled = readOnly;
  }

  function getNormalHourRanges(openingTime, closingTime) {
    const toMinutes = (time) => {
      const [hours, minutes] = time.split(':').map(Number);
      return hours * 60 + minutes;
    };
    const toLabel = (minutes) =>
      `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    const opening = toMinutes(openingTime);
    const closing = toMinutes(closingTime);
    const ranges = [];
    if (opening < Math.min(closing, 17 * 60)) {
      ranges.push(`${toLabel(opening)} - ${toLabel(Math.min(closing, 17 * 60))}`);
    }
    if (closing > 21 * 60 && opening < closing) {
      ranges.push(`${toLabel(Math.max(opening, 21 * 60))} - ${toLabel(closing)}`);
    }
    return ranges.length ? ranges.join(', ') : 'Không có khung giờ thường';
  }

  function selectCourt(id) {
    selectedCourt = courts.find((court) => String(court.id) === String(id)) || null;
    renderMockupCourtTabs();
    updatePriceControls();
    if (!selectedCourt) {
      el.rows.replaceChildren(emptyRow('Chọn sân để xem khung giờ.'));
      el.pricePreview.textContent = 'Chọn sân để xem số khung còn trống.';
      el.pricePreviewMessage.textContent = 'Sẽ áp dụng cho 0 khung trống từ ngày hiện tại.';
      updateSlotMetrics(slotsState.getSlotMetrics([]));
      return;
    }
    const openingTime = String(selectedFacility?.opening_time || '').slice(0, 5);
    const closingTime = String(selectedFacility?.closing_time || '').slice(0, 5);
    el.normalHours.textContent = getNormalHourRanges(openingTime, closingTime);
    el.hoursTitle.textContent = openingTime === '00:00' && closingTime === '24:00'
      ? 'Mở cửa 24/24'
      : `Khung giờ ${openingTime} - ${closingTime}`;
    el.priceNormal.value = selectedCourt.price_normal;
    el.pricePeak.value = selectedCourt.price_peak;
    if (el.mockupNormalPrice) {
      el.mockupNormalPrice.value = new Intl.NumberFormat('vi-VN').format(selectedCourt.price_normal);
    }
    if (el.mockupPeakPrice) {
      el.mockupPeakPrice.value = new Intl.NumberFormat('vi-VN').format(selectedCourt.price_peak);
    }
    el.priceError.hidden = true;
    el.normalPriceError.hidden = true;
    el.peakPriceError.hidden = true;
    loadSlots();
    refreshPricePreview();
  }

  function renderSlots(slots) {
    const rows = slots.map((slot) => {
      const row = document.createElement('tr');
      row.append(node('td', `${slot.starts_at.slice(0, 5)} - ${slot.ends_at.slice(0, 5)}`));
      const status = node('td', slotsState.statusLabel(slot.status));
      status.className = 'admin-slot-state';
      status.dataset.state = slot.status;
      row.append(status);
      row.append(node('td', slot.booking_code || '—'));
      row.append(node('td', slotsState.formatMoney(slot.price)));
      return row;
    });
    el.rows.replaceChildren(...(rows.length ? rows : [emptyRow('Ngày này chưa có khung giờ.')]));
    renderMockupSlots(slots);
  }

  function renderMockupSlots(slots) {
    if (!el.mockupMatrix) return;
    if (!selectedCourt) {
      updateSlotMetrics([]);
      el.mockupMatrix.replaceChildren(node('p', 'Chọn sân để xem khung giờ.'));
      return;
    }
    if (!slots.length) {
      updateSlotMetrics(slots);
      el.mockupMatrix.replaceChildren(node('p', 'Ngày này chưa có khung giờ.'));
      return;
    }

    const availableCount = slots.filter((slot) => slot.status === 'AVAILABLE').length;
    updateSlotMetrics(slots);
    const card = node('div');
    card.className = 'flex flex-col gap-2 p-space-md rounded-xl bg-surface-container-low';
    const header = node('div');
    header.className = 'flex items-center justify-between';
    const identity = node('div');
    identity.className = 'flex items-center gap-2';
    const dot = node('span');
    dot.className = 'w-3 h-3 rounded-full bg-primary';
    const courtName = node('span', selectedCourt.name);
    courtName.className = 'font-headline-sm text-headline-sm text-on-surface font-bold';
    identity.append(dot, courtName);
    const summary = node('span', `${availableCount}/${slots.length} khung giờ trống`);
    summary.className = 'font-label-sm text-label-sm text-on-surface-variant';
    header.append(identity, summary);

    const grid = node('div');
    grid.className = 'grid grid-cols-8 lg:grid-cols-16 gap-2';
    for (const slot of slots) {
      const available = slot.status === 'AVAILABLE';
      const locked = slot.status === 'LOCKED';
      const cell = node('div');
      cell.className = available
        ? 'p-2.5 rounded-xl bg-surface-container-lowest flex flex-col justify-between h-24 shadow-sm'
        : locked
          ? 'p-2.5 rounded-xl bg-secondary-fixed text-on-secondary-fixed flex flex-col justify-between h-24 shadow-sm'
          : 'p-2.5 rounded-xl bg-inverse-surface text-inverse-on-surface flex flex-col justify-between h-24 shadow-sm';
      cell.setAttribute('aria-label',
        `${slot.starts_at.slice(0, 5)} - ${slot.ends_at.slice(0, 5)}, ${slotsState.statusLabel(slot.status)}`);
      const timeRow = node('div');
      timeRow.className = 'flex items-center justify-between';
      const time = node('span', slot.starts_at.slice(0, 5));
      time.className = `font-label-sm text-label-sm font-semibold ${
        available ? 'text-on-surface-variant' : locked ? 'text-secondary' : 'text-inverse-on-surface'
      }`;
      const indicator = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      if (available) {
        indicator.setAttribute('class', 'w-2 h-2 rounded-full bg-primary');
      } else {
        indicator.setAttribute('class', 'text-[14px]');
        window.SportBookingIcons.setIcon(indicator, locked ? 'hourglass_top' : 'check_circle');
      }
      timeRow.append(time, indicator);
      const details = node('div');
      details.className = 'flex flex-col min-w-0';
      const price = node('span', slotsState.formatMoney(slot.price));
      price.className = `font-label-md text-label-md font-bold ${
        available ? 'text-primary' : locked ? 'text-secondary' : 'text-inverse-on-surface'
      }`;
      const label = node('span', available
        ? 'Trống'
        : slot.booking_code || slotsState.statusLabel(slot.status));
      label.className = `font-label-sm text-label-sm truncate font-semibold ${
        available ? 'text-primary' : locked ? 'text-secondary' : 'text-inverse-on-surface'
      }`;
      details.append(price, label);
      cell.append(timeRow, details);
      grid.append(cell);
    }
    card.append(header, grid);
    el.mockupMatrix.replaceChildren(card);
  }

  function setViewMode(mode) {
    viewMode = mode;
    for (const button of el.viewButtons) {
      const active = button.dataset.slotView === viewMode;
      button.setAttribute('aria-pressed', String(active));
      button.className = active
        ? 'px-3 py-1.5 rounded-lg bg-surface-container-lowest text-on-surface font-label-sm text-label-sm shadow-sm font-semibold'
        : 'px-3 py-1.5 rounded-lg text-on-surface-variant hover:text-on-surface font-label-sm text-label-sm';
    }
    loadSlots();
  }

  function renderWeek(slots, dates) {
    updateSlotMetrics(slots);
    if (!slots.length) {
      el.mockupMatrix.replaceChildren(node('p', 'Không có khung giờ trong tuần này.'));
      return;
    }
    const table = node('table');
    table.className = 'min-w-[1080px] w-full border-collapse text-left';
    const head = node('thead');
    const header = node('tr');
    const timeHeading = node('th', 'Khung giờ');
    timeHeading.className = 'p-2 text-left';
    header.append(timeHeading);
    const dayNames = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
    dates.forEach((date, index) => {
      const cell = node('th', `${dayNames[index]} ${slotsState.formatDateVi(date).slice(0, 5)}`);
      cell.className = 'p-2 text-center';
      header.append(cell);
    });
    head.append(header);
    const body = node('tbody');
    const times = [...new Set(slots.map((slot) => slot.starts_at))].sort();
    const slotsByDateTime = new Map(slots.map((slot) => [
      `${slot.service_date}|${slot.starts_at}`,
      slot
    ]));
    for (const start of times) {
      const row = node('tr');
      const matching = slots.find((slot) => slot.starts_at === start);
      const label = node('th', `${start.slice(0, 5)} - ${matching.ends_at.slice(0, 5)}`);
      label.className = 'p-2 border-t border-outline-variant text-left whitespace-nowrap';
      row.append(label);
      for (const date of dates) {
        const cell = node('td');
        cell.className = 'p-1 border-t border-outline-variant';
        const slot = slotsByDateTime.get(`${date}|${start}`);
        if (slot) {
          const statusClass = {
            AVAILABLE: 'bg-primary-fixed text-on-primary-fixed-variant',
            LOCKED: 'bg-secondary-fixed text-on-secondary-fixed',
            BOOKED: 'bg-inverse-surface text-inverse-on-surface'
          }[slot.status];
          const card = node('div');
          card.className = `rounded-lg p-2 text-center ${statusClass || 'bg-surface-container-high'}`;
          card.setAttribute('aria-label',
            `${slotsState.formatDateVi(date)}, ${start.slice(0, 5)} - ${slot.ends_at.slice(0, 5)}, ${slotsState.statusLabel(slot.status)}`);
          card.append(
            node('span', slotsState.statusLabel(slot.status)),
            node('span', ` · ${slotsState.formatMoney(slot.price)}`)
          );
          cell.append(card);
        }
        row.append(cell);
      }
      body.append(row);
    }
    table.append(head, body);
    el.mockupMatrix.replaceChildren(table);
  }

  function renderMonth(days, monthRange) {
    updateSlotMetrics(slotsState.getSummaryMetrics(days));
    const calendar = node('div');
    calendar.className = 'grid grid-cols-7 gap-2';
    for (const dayName of ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']) {
      const heading = node('div', dayName);
      heading.className = 'p-2 text-center font-label-sm text-label-sm font-semibold text-on-surface-variant';
      calendar.append(heading);
    }
    for (let index = 0; index < monthRange.firstWeekday; index += 1) {
      calendar.append(node('div'));
    }
    for (const day of days) {
      const button = node('button');
      button.type = 'button';
      button.className = 'min-h-24 rounded-xl bg-surface-container-low p-2 text-left hover:bg-surface-container-high';
      button.setAttribute('aria-label',
        `${slotsState.formatDateVi(day.date)}: ${day.booked}/${day.total} khung đã đặt`);
      if (day.date === el.date.value) button.classList.add('ring-2', 'ring-primary');
      const dateNumber = node('span', String(Number(day.date.slice(8, 10))));
      dateNumber.className = 'block font-label-md text-label-md font-bold';
      const count = node('span', `${day.booked}/${day.total} đã đặt`);
      count.className = 'mt-2 block text-[11px] text-on-surface-variant';
      const progress = node('span');
      progress.className = 'mt-2 block h-1.5 overflow-hidden rounded-full bg-surface-container-highest';
      const bar = node('span');
      bar.className = 'block h-full rounded-full bg-primary';
      bar.style.width = `${day.total ? Math.min(100, day.booked * 100 / day.total) : 0}%`;
      progress.append(bar);
      button.append(dateNumber, count, progress);
      button.addEventListener('click', () => {
        el.date.value = day.date;
        el.mockupDate.value = day.date;
        setViewMode('day');
      });
      calendar.append(button);
    }
    el.mockupMatrix.replaceChildren(calendar);
  }

  async function loadSlots(isPolling = false) {
    if (!selectedCourt || !el.date.value) return;
    try {
      if (viewMode === 'month') {
        const monthRange = slotsState.getMonthRange(el.date.value.slice(0, 7));
        const result = await api.getAdminTimeSlotSummary(selectedCourt.id, monthRange.month);
        if (!Array.isArray(result.days) || result.days.length !== monthRange.days.length) {
          throw new Error('Tổng hợp khung giờ trong tháng không hợp lệ.');
        }
        renderMonth(result.days, monthRange);
        el.dateLabel.textContent = `Tháng ${monthRange.month}`;
        el.rangeLabel.textContent = `${slotsState.formatDateVi(monthRange.from)} - ${slotsState.formatDateVi(monthRange.to)}`;
      } else {
        const range = viewMode === 'week'
          ? slotsState.getWeekRange(el.date.value)
          : { from: el.date.value, to: el.date.value, dates: [el.date.value] };
        const result = await api.getAdminTimeSlots(selectedCourt.id, {
          from: range.from,
          to: range.to
        });
        if (!Array.isArray(result.time_slots)) {
          throw new Error('Danh sách khung giờ không hợp lệ.');
        }
        if (viewMode === 'week') {
          renderWeek(result.time_slots, range.dates);
          el.dateLabel.textContent = `Tuần ${slotsState.formatDateVi(range.from)} - ${slotsState.formatDateVi(range.to)}`;
          el.rangeLabel.textContent = `Thứ Hai ${slotsState.formatDateVi(range.from)} - Chủ Nhật ${slotsState.formatDateVi(range.to)}`;
        } else {
          renderSlots(result.time_slots);
          el.dateLabel.textContent = `Ngày ${slotsState.formatDateVi(el.date.value)}`;
          el.rangeLabel.textContent = slotsState.formatDateVi(el.date.value);
        }
      }
      el.status.textContent = 'Khung giờ được cập nhật tự động.';
    } catch (error) {
      if (error.status === 401) window.location.replace('/dang-nhap.html');
      else if (error.status === 403) window.location.replace(state.USER_HOME);
      else if (!isPolling) el.status.textContent = error.message || 'Không thể tải khung giờ.';
      if (isPolling) throw error;
    }
  }

  function getPriceValues() {
    const normal = el.mockupNormalPrice.value.trim();
    const peak = el.mockupPeakPrice.value.trim();
    const errors = slotsState.getPriceErrors(normal, peak, selectedCourt || {});
    el.normalPriceError.textContent = errors.normal;
    el.normalPriceError.hidden = !errors.normal;
    el.peakPriceError.textContent = errors.peak;
    el.peakPriceError.hidden = !errors.peak;
    el.mockupNormalPrice.setAttribute('aria-invalid', String(Boolean(errors.normal)));
    el.mockupPeakPrice.setAttribute('aria-invalid', String(Boolean(errors.peak)));
    el.priceError.textContent = errors.form;
    el.priceError.hidden = !errors.form;
    const errorMessage = errors.normal || errors.peak || errors.form;
    if (errorMessage) el.pricePreviewMessage.textContent = errorMessage;
    if (errors.normal || errors.peak || errors.form) return null;
    const result = {};
    if (normal) result.price_normal = Number(normal.replace(/\./g, ''));
    if (peak) result.price_peak = Number(peak.replace(/\./g, ''));
    return result;
  }

  async function refreshPricePreview() {
    if (!selectedCourt) return;
    const requestId = ++pricePreviewRequestId;
    const prices = getPriceValues();
    if (!prices) return;
    const fromDate = slotsState.localDate();
    el.pricePreviewMessage.textContent = 'Đang tính số khung giờ sẽ được cập nhật...';
    try {
      const result = await api.updateAdminCourtPrices(selectedCourt.id, {
        ...prices,
        expected_updated_at: selectedCourt.updated_at
      }, true);
      if (requestId !== pricePreviewRequestId) return;
      const text = `Sẽ áp dụng cho ${result.affected_slots} khung trống từ ${slotsState.formatDateVi(fromDate)}.`;
      el.pricePreviewMessage.textContent = text;
      el.pricePreview.textContent = text;
    } catch (error) {
      if (requestId !== pricePreviewRequestId) return;
      el.pricePreviewMessage.textContent = error.message || 'Không thể tính số khung giờ sẽ cập nhật.';
      if (error.status === 409) await loadCourts(el.facility.value, selectedCourt.id);
    }
  }

  async function applyPrices(fields) {
    if (!selectedCourt || pending || el.date.value < today) return;
    const values = getPriceValues();
    if (!values) return;
    const submission = {};
    if (fields.includes('normal') && values.price_normal !== undefined) {
      submission.price_normal = values.price_normal;
    }
    if (fields.includes('peak') && values.price_peak !== undefined) {
      submission.price_peak = values.price_peak;
    }
    if (Object.keys(submission).length === 0) {
      el.priceError.textContent = 'Cần nhập ít nhất một đơn giá.';
      el.priceError.hidden = false;
      el.pricePreviewMessage.textContent = el.priceError.textContent;
      el.status.textContent = el.priceError.textContent;
      return;
    }
    pending = true;
    updatePriceControls();
    try {
      const result = await api.updateAdminCourtPrices(selectedCourt.id, {
        ...submission,
        expected_updated_at: selectedCourt.updated_at
      });
      await loadCourts(el.facility.value, selectedCourt.id);
      polling?.refreshNow();
      el.status.textContent = `Đã cập nhật giá cho ${result.affected_slots} khung giờ trống.`;
    } catch (error) {
      el.priceError.textContent = error.message || 'Không thể cập nhật giá.';
      el.priceError.hidden = false;
      el.pricePreviewMessage.textContent = el.priceError.textContent;
      el.status.textContent = el.priceError.textContent;
      if (error.status === 409) await loadCourts(el.facility.value, selectedCourt.id);
    } finally {
      pending = false;
      updatePriceControls();
    }
  }

  async function savePrices(event) {
    event.preventDefault();
    el.mockupNormalPrice.value = el.priceNormal.value;
    el.mockupPeakPrice.value = el.pricePeak.value;
    await applyPrices(['normal', 'peak']);
  }

  async function generateSlots(event) {
    event.preventDefault();
    if (!selectedCourt || pending) return;
    el.generateError.hidden = true;
    try {
      if (el.fromDate.value > el.toDate.value) {
        throw new Error('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
      }
      pending = true;
      const result = await api.generateAdminTimeSlots(
        selectedCourt.id,
        el.fromDate.value,
        el.toDate.value
      );
      el.date.value = el.fromDate.value;
      await loadSlots();
      el.status.textContent = `Đã tạo ${result.inserted} khung mới; ${result.existing} khung đã có được giữ nguyên.`;
      polling?.refreshNow();
    } catch (error) {
      el.generateError.textContent = error.message || 'Không thể tạo khung giờ.';
      el.generateError.hidden = false;
    } finally {
      pending = false;
    }
  }

  el.facility.addEventListener('change', () => loadCourts(el.facility.value));
  el.court.addEventListener('change', () => selectCourt(el.court.value));
  el.date.addEventListener('change', () => {
    el.mockupDate.value = el.date.value;
    updatePriceControls();
    loadSlots();
  });
  el.mockupFacility?.addEventListener('change', () => {
    el.facility.value = el.mockupFacility.value;
    el.facility.dispatchEvent(new Event('change', { bubbles: true }));
  });
  el.mockupCourt?.addEventListener('change', () => {
    el.court.value = el.mockupCourt.value;
    el.court.dispatchEvent(new Event('change', { bubbles: true }));
  });
  el.mockupDate?.addEventListener('change', () => {
    if (!el.mockupDate.value) return;
    el.date.value = el.mockupDate.value;
    el.date.dispatchEvent(new Event('change', { bubbles: true }));
  });
  el.viewButtons.forEach((button) => {
    button.addEventListener('click', () => setViewMode(button.dataset.slotView));
  });
  el.exportButton.addEventListener('click', () => exportDownload.download(
    el.exportButton,
    el.exportStatus,
    () => {
      if (!selectedCourt) throw new Error('Vui lòng chọn sân trước khi xuất báo cáo.');
      const range = viewMode === 'month'
        ? slotsState.getMonthRange(el.date.value.slice(0, 7))
        : viewMode === 'week'
          ? slotsState.getWeekRange(el.date.value)
          : { from: el.date.value, to: el.date.value };
      return api.exportTimeSlots(selectedCourt.id, { from: range.from, to: range.to });
    }
  ));
  el.priceForm.addEventListener('submit', savePrices);
  el.generateForm.addEventListener('submit', generateSlots);
  el.mockupNormalPrice.addEventListener('input', () => {
    el.priceNormal.value = el.mockupNormalPrice.value;
    getPriceValues();
    window.clearTimeout(pricePreviewTimer);
    pricePreviewTimer = window.setTimeout(refreshPricePreview, 300);
  });
  el.mockupPeakPrice.addEventListener('input', () => {
    el.pricePeak.value = el.mockupPeakPrice.value;
    getPriceValues();
    window.clearTimeout(pricePreviewTimer);
    pricePreviewTimer = window.setTimeout(refreshPricePreview, 300);
  });
  el.normalApply.addEventListener('click', () => applyPrices(['normal']));
  el.peakApply.addEventListener('click', () => applyPrices(['peak']));
  el.mockupSavePrices?.addEventListener('click', () => applyPrices(['normal', 'peak']));
  el.guardRetry.addEventListener('click', initialize);
  window.addEventListener('admin-data-changed', () => polling?.refreshNow());
  window.addEventListener('pagehide', () => polling?.stop(), { once: true });

  async function initialize() {
    if (!await authorize()) return;
    await loadFacilities();
    polling = shell.startPolling(async ({ signal }) => {
      api.setPollingSignal(signal);
      try {
        await loadSlots(true);
      } finally {
        api.setPollingSignal(null);
      }
    }, 5000, (status) => shell.mountSyncStatus(el.status.parentElement, status));
  }

  document.querySelectorAll('.material-symbols-outlined').forEach((legacyIcon) => {
    const rawName = legacyIcon.textContent.trim();
    const iconName = window.SportBookingIcons.names.has(rawName) ? rawName : 'info';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const classes = [...legacyIcon.classList]
      .filter((className) => className !== 'material-symbols-outlined');
    if (classes.length) icon.setAttribute('class', classes.join(' '));
    window.SportBookingIcons.setIcon(icon, iconName);
    legacyIcon.replaceWith(icon);
  });
  window.SportBookingIcons?.renderAll(document);
  initialize();
})();
