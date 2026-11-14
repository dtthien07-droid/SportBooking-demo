'use strict';

(() => {
  const state = window.SportBookingAdminState;
  const shell = window.SportBookingAdminShell;
  const api = window.SportBookingAdminApi;
  const slotsState = window.SportBookingAdminSlotsState;
  if (!state || !shell || !api || !slotsState) {
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
    mockupCourtTabs: document.querySelector('[data-admin-slot-court-tabs]'),
    mockupMatrix: document.querySelector('[data-admin-slot-matrix]'),
    mockupNormalPrice: document.getElementById('mockupNormalPrice'),
    mockupPeakPrice: document.getElementById('mockupPeakPrice'),
    mockupSavePrices: document.getElementById('btn-save-all')
  };
  let facilities = [];
  let courts = [];
  let selectedCourt = null;
  let polling = null;
  let pending = false;
  let selectionRequestId = 0;
  const today = slotsState.localDate();
  el.date.value = today;
  el.fromDate.value = today;
  const twoWeeksLater = new Date(`${today}T00:00:00Z`);
  twoWeeksLater.setUTCDate(twoWeeksLater.getUTCDate() + 13);
  el.toDate.value = twoWeeksLater.toISOString().slice(0, 10);
  if (el.mockupDate) {
    const tomorrow = new Date(`${today}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    if (el.mockupDate.options[0]) {
      el.mockupDate.options[0].value = today;
      el.mockupDate.options[0].textContent = `Hôm nay (${today})`;
    }
    if (el.mockupDate.options[1]) {
      el.mockupDate.options[1].value = tomorrow.toISOString().slice(0, 10);
      el.mockupDate.options[1].textContent = `Ngày mai (${tomorrow.toISOString().slice(0, 10)})`;
    }
    [...el.mockupDate.options].slice(2).forEach((option) => {
      option.disabled = true;
      if (!option.textContent.includes('Sắp có')) option.textContent += ' · Sắp có';
    });
  }
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

  function updateSlotMetrics(slots) {
    const available = slots.filter((slot) => slot.status === 'AVAILABLE').length;
    const occupied = slots.length - available;
    const fillRate = slots.length ? Math.round(occupied * 1000 / slots.length) / 10 : 0;
    const normalSlots = slots.filter((slot) => Number(slot.starts_at.slice(0, 2)) < 17);
    const peakSlots = slots.filter((slot) => Number(slot.starts_at.slice(0, 2)) >= 17);
    const peakOccupied = peakSlots.filter((slot) => slot.status !== 'AVAILABLE').length;
    const normalCoverage = slots.length
      ? Math.round(normalSlots.length * 1000 / slots.length) / 10
      : 0;
    const peakFill = peakSlots.length
      ? Math.round(peakOccupied * 1000 / peakSlots.length) / 10
      : 0;
    const revenue = slots.reduce((sum, slot) => sum + BigInt(slot.price || 0), 0n);
    const setMetric = (selector, value) => {
      const target = document.querySelector(selector);
      if (target) target.textContent = String(value);
    };
    setMetric('[data-admin-slot-total]', slots.length);
    setMetric('[data-admin-slot-booked]', occupied);
    setMetric('[data-admin-slot-available]', available);
    setMetric('[data-admin-slot-fill-rate]', `${fillRate}%`);
    setMetric('[data-admin-slot-revenue]', new Intl.NumberFormat('vi-VN').format(revenue));
    setMetric('[data-admin-normal-slot-count]', normalSlots.length);
    setMetric('[data-admin-normal-slot-rate]', `${normalCoverage}%`);
    setMetric('[data-admin-peak-slot-count]', peakSlots.length);
    setMetric('[data-admin-peak-slot-rate]', `${peakFill}%`);
    const progress = document.querySelector('[data-admin-slot-fill-bar]');
    if (progress) progress.style.width = `${fillRate}%`;
  }

  function selectCourt(id) {
    selectedCourt = courts.find((court) => String(court.id) === String(id)) || null;
    renderMockupCourtTabs();
    el.mockupNormalPrice.disabled = !selectedCourt;
    el.mockupPeakPrice.disabled = !selectedCourt;
    el.mockupSavePrices.disabled = !selectedCourt || pending;
    if (!selectedCourt) {
      el.rows.replaceChildren(emptyRow('Chọn sân để xem khung giờ.'));
      el.pricePreview.textContent = 'Chọn sân để xem số khung còn trống.';
      updateSlotMetrics([]);
      return;
    }
    el.priceNormal.value = selectedCourt.price_normal;
    el.pricePeak.value = selectedCourt.price_peak;
    if (el.mockupNormalPrice) {
      el.mockupNormalPrice.value = new Intl.NumberFormat('vi-VN').format(selectedCourt.price_normal);
    }
    if (el.mockupPeakPrice) {
      el.mockupPeakPrice.value = new Intl.NumberFormat('vi-VN').format(selectedCourt.price_peak);
    }
    el.priceError.hidden = true;
    loadSlots();
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
      const indicator = node('span');
      if (available) {
        indicator.className = 'w-2 h-2 rounded-full bg-primary';
      } else {
        indicator.className = 'material-symbols-outlined text-[14px]';
        indicator.textContent = locked ? 'hourglass_top' : 'check_circle';
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

  async function loadSlots(isPolling = false) {
    if (!selectedCourt || !el.date.value) return;
    try {
      const result = await api.getAdminTimeSlots(
        selectedCourt.id,
        el.date.value,
        slotsState.localDate()
      );
      if (!Array.isArray(result.time_slots) || !result.price_preview) {
        throw new Error('Danh sách khung giờ không hợp lệ.');
      }
      renderSlots(result.time_slots);
      el.dateLabel.textContent = `Ngày ${result.service_date}`;
      el.pricePreview.textContent = `Sẽ áp dụng cho ${result.price_preview.available_slots} khung trống từ ${result.price_preview.from_date}.`;
      el.status.textContent = 'Khung giờ được cập nhật tự động.';
    } catch (error) {
      if (error.status === 401) window.location.replace('/dang-nhap.html');
      else if (error.status === 403) window.location.replace(state.USER_HOME);
      else el.status.textContent = error.message || 'Không thể tải khung giờ.';
      if (isPolling) throw error;
    }
  }

  async function savePrices(event) {
    event.preventDefault();
    if (!selectedCourt || pending) return;
    el.priceError.hidden = true;
    try {
      const prices = slotsState.normalizePrices(el.priceNormal.value, el.pricePeak.value);
      pending = true;
      el.mockupSavePrices.disabled = true;
      await api.updateAdminCourtPrices(selectedCourt.id, {
        ...prices,
        expected_updated_at: selectedCourt.updated_at
      });
      await loadCourts(el.facility.value, selectedCourt.id);
      polling?.refreshNow();
      el.status.textContent = 'Đã cập nhật giá cho các khung còn trống.';
    } catch (error) {
      el.priceError.textContent = error.message || 'Không thể cập nhật giá.';
      el.priceError.hidden = false;
      if (error.status === 409) await loadCourts(el.facility.value, selectedCourt.id);
    } finally {
      pending = false;
      el.mockupSavePrices.disabled = !selectedCourt;
    }
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
  el.date.addEventListener('change', () => loadSlots());
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
  el.priceForm.addEventListener('submit', savePrices);
  el.generateForm.addEventListener('submit', generateSlots);
  el.mockupSavePrices?.addEventListener('click', () => {
    if (!el.mockupNormalPrice || !el.mockupPeakPrice) return;
    const normal = el.mockupNormalPrice.value.replace(/[^\d]/g, '');
    const peak = el.mockupPeakPrice.value.replace(/[^\d]/g, '');
    el.priceNormal.value = normal;
    el.pricePeak.value = peak;
    el.priceForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
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

  window.SportBookingIcons?.renderAll(document);
  initialize();
})();
