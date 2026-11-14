'use strict';

(() => {
  const state = window.SportBookingAdminState;
  const shell = window.SportBookingAdminShell;
  const api = window.SportBookingAdminApi;
  const facilityState = window.SportBookingAdminFacilitiesState;
  if (!state || !shell || !api || !facilityState) {
    throw new Error('Thiếu cấu hình trang cơ sở và sân.');
  }
  shell.mountAdminShell({ active: 'facilities' });
  const el = {
    guard: document.getElementById('adminGuard'),
    guardMessage: document.getElementById('adminGuardMessage'),
    guardRetry: document.getElementById('adminGuardRetry'),
    app: document.getElementById('adminApp'),
    header: document.getElementById('adminHeaderMount'),
    filterForm: document.getElementById('facilityFilters'),
    search: document.getElementById('facilitySearch'),
    district: document.getElementById('facilityDistrict'),
    active: document.getElementById('facilityActive'),
    reset: document.getElementById('resetFacilityFilters'),
    rows: document.getElementById('facilityRows'),
    status: document.getElementById('facilitiesStatus'),
    summary: document.getElementById('facilityPaginationSummary'),
    previous: document.getElementById('previousFacilitiesPage'),
    next: document.getElementById('nextFacilitiesPage'),
    add: document.getElementById('addFacility'),
    dialog: document.getElementById('facilityDialog'),
    title: document.getElementById('facilityDialogTitle'),
    drawerBackdrop: document.getElementById('facility-drawer-backdrop'),
    drawer: document.getElementById('facility-drawer'),
    drawerTitle: document.querySelector('#facility-drawer h2'),
    drawerSave: document.getElementById('save-facility-drawer-btn'),
    form: document.getElementById('facilityForm'),
    formError: document.getElementById('facilityFormError'),
    courtsSection: document.getElementById('facilityCourts'),
    courtRows: document.getElementById('courtRows'),
    addCourt: document.getElementById('addCourt'),
    courtForm: document.getElementById('courtForm'),
    courtFormTitle: document.getElementById('courtFormTitle'),
    courtError: document.getElementById('courtFormError'),
    cancelCourt: document.getElementById('cancelCourtEdit')
  };
  const facilityFields = {
    name: 'facilityName',
    address: 'facilityAddress',
    district: 'facilityDistrictEdit',
    opening_time: 'facilityOpening',
    closing_time: 'facilityClosing',
    hotline: 'facilityHotline',
    map_url: 'facilityMapUrl',
    image_url: 'facilityImageUrl',
    amenities: 'facilityAmenities',
    description: 'facilityDescription',
    rules: 'facilityRules',
    cancellation_policy: 'facilityPolicy'
  };
  const courtFields = {
    name: 'courtName',
    sport_type: 'courtSport',
    price_normal: 'courtNormalPrice',
    price_peak: 'courtPeakPrice',
    description: 'courtDescription'
  };
  let draftFilters = {
    q: '',
    district: '',
    is_active: document.getElementById('mockupFacilityActive')?.value === 'active' ? 'true' : ''
  };
  let appliedFilters = { ...draftFilters, page: 1 };
  let latestFacilities = [];
  let latestTotal = 0;
  let currentFacility = null;
  let polling = null;
  let pageCount = 1;
  let requestId = 0;
  let pending = false;

  function node(tag, text = '') {
    const element = document.createElement(tag);
    element.textContent = text;
    return element;
  }

  const initialFacilityRow = document.createElement('tr');
  const initialFacilityCell = node('td', 'Đang tải danh sách cơ sở...');
  initialFacilityCell.colSpan = 10;
  initialFacilityCell.className = 'py-6 text-center text-on-surface-variant';
  initialFacilityRow.append(initialFacilityCell);
  document.getElementById('mockupFacilityRows')?.replaceChildren(initialFacilityRow);

  function formatMoney(value) {
    return `${new Intl.NumberFormat('vi-VN').format(Number(value) || 0)} đ`;
  }

  async function authorize() {
    return Boolean(await shell.authorizeAdmin({
      api,
      state,
      guard: el.guard,
      guardMessage: el.guardMessage,
      guardRetry: el.guardRetry,
      app: el.app,
      header: el.header
    }));
  }

  function updateDistrictOptions(facilities) {
    const mockupDistrict = document.getElementById('mockupFacilityDistrict');
    const selected = el.district.value;
    const districts = [...new Set(facilities.map((facility) => facility.district).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, 'vi'));
    const options = [new Option('Tất cả', '')];
    for (const district of districts) options.push(new Option(district, district));
    el.district.replaceChildren(...options);
    if (districts.includes(selected)) el.district.value = selected;
    if (mockupDistrict && !mockupDistrict.value) mockupDistrict.value = selected;
  }

  function renderFacilities(facilities, total = latestTotal) {
    latestFacilities = facilities;
    updateDistrictOptions(facilities);
    renderMockupFacilities(facilities, total);
    const rows = facilities.map((facility) => {
      const row = document.createElement('tr');
      const identity = node('td');
      identity.append(node('strong', facility.name), node('span', `${facility.address} · ${facility.district}`));
      row.append(identity);
      const hours = facility.opening_time && facility.closing_time
        ? `${facilityState.formatHours(facility.opening_time)} - ${facilityState.formatHours(facility.closing_time)}`
        : 'Chưa thiết lập giờ hoạt động';
      row.append(node('td', hours));
      row.append(node('td', `${facility.active_court_count}/${facility.court_count}`));
      row.append(node('td', facility.active_booking_count));
      const status = node('td', facility.is_active ? 'Đang hoạt động' : 'Ngừng hoạt động');
      status.className = 'admin-facility-status';
      status.dataset.active = String(facility.is_active);
      row.append(status);
      const actions = node('td');
      actions.className = 'admin-facility-actions';
      const edit = node('button', 'Chỉnh sửa');
      edit.type = 'button';
      edit.className = 'admin-button admin-button--quiet';
      edit.addEventListener('click', () => openFacilityDialog(facility.id));
      const courts = node('button', 'Xem sân');
      courts.type = 'button';
      courts.className = 'admin-button admin-button--quiet';
      courts.addEventListener('click', () => openFacilityDialog(facility.id));
      const toggle = node('button', facility.is_active ? 'Ngừng hoạt động' : 'Mở hoạt động');
      toggle.type = 'button';
      toggle.className = facility.is_active ? 'admin-button admin-button--danger' : 'admin-button admin-button--primary';
      toggle.addEventListener('click', () => toggleFacility(facility));
      actions.append(edit, courts, toggle);
      row.append(actions);
      return row;
    });
    if (rows.length === 0) {
      const row = document.createElement('tr');
      const cell = node('td', 'Không có cơ sở phù hợp.');
      cell.colSpan = 6;
      row.append(cell);
      rows.push(row);
    }
    el.rows.replaceChildren(...rows);
  }

  function renderMockupFacilities(facilities, total) {
    const body = document.getElementById('mockupFacilityRows');
    if (!body) return;
    const totalLabel = document.querySelector('[data-admin-facility-total]');
    if (totalLabel) totalLabel.textContent = new Intl.NumberFormat('vi-VN').format(total);
    document.querySelectorAll('[data-admin-facility-metric]').forEach((metric) => {
      metric.textContent = '—';
    });
    const range = document.querySelector('[data-admin-facility-pagination-range]');
    const paginationTotal = document.querySelector('[data-admin-facility-pagination-total]');
    if (range) {
      const first = total ? (appliedFilters.page - 1) * 20 + 1 : 0;
      range.textContent = `${first} - ${Math.min(first + facilities.length - 1, total)}`;
    }
    if (paginationTotal) paginationTotal.textContent = new Intl.NumberFormat('vi-VN').format(total);
    const rows = facilities.map((facility) => {
      const row = document.createElement('tr');
      row.className = 'hover:bg-surface-container-low transition-colors';

      const code = node('td', String(facility.id));
      code.className = 'py-4 px-space-md font-label-sm text-label-sm font-semibold text-primary max-w-[100px] truncate';
      code.title = String(facility.id);
      row.append(code);

      const identity = document.createElement('td');
      identity.className = 'py-4 px-space-md';
      const identityGroup = document.createElement('div');
      identityGroup.className = 'flex items-center gap-3';
      const image = node('div');
      image.className = 'w-14 h-14 rounded-xl bg-surface-container-high shrink-0 flex items-center justify-center';
      if (facility.image_url) {
        const img = document.createElement('img');
        img.src = facility.image_url;
        img.alt = '';
        img.className = 'w-full h-full rounded-xl object-cover';
        image.append(img);
      } else {
        const icon = node('span', 'stadium');
        icon.className = 'material-symbols-outlined text-primary';
        image.append(icon);
      }
      const details = document.createElement('div');
      details.className = 'flex flex-col min-w-0';
      const name = node('span', facility.name);
      name.className = 'font-label-lg text-label-lg text-on-surface font-semibold truncate';
      const address = node('span', `${facility.address} · ${facility.district}`);
      address.className = 'font-body-sm text-body-sm text-on-surface-variant truncate';
      details.append(name, address);
      identityGroup.append(image, details);
      identity.append(identityGroup);
      row.append(identity);

      const sport = node('td', '—');
      sport.className = 'py-4 px-space-md text-on-surface-variant';
      sport.title = 'Không có môn thể thao tổng hợp trong danh sách cơ sở.';
      row.append(sport);

      const addressCell = node('td');
      addressCell.className = 'py-4 px-space-md text-on-surface-variant max-w-[220px]';
      const addressWrapper = node('div');
      addressWrapper.className = 'flex items-start gap-1 min-w-0';
      const placeIcon = node('span', 'place');
      placeIcon.className = 'material-symbols-outlined text-[16px] shrink-0 mt-0.5';
      const addressText = node('span', facility.address || '—');
      addressText.className = 'line-clamp-2 break-words';
      addressWrapper.append(placeIcon, addressText);
      addressCell.append(addressWrapper);
      row.append(addressCell);

      const hours = facility.opening_time && facility.closing_time
        ? `${facilityState.formatHours(facility.opening_time)} - ${facilityState.formatHours(facility.closing_time)}`
        : 'Chưa thiết lập';
      const hoursCell = node('td', hours);
      hoursCell.className = 'py-4 px-space-md font-label-md text-label-md text-on-surface whitespace-nowrap';
      row.append(hoursCell);

      const courtCount = node('td', `${facility.active_court_count}/${facility.court_count}`);
      courtCount.className = 'py-4 px-space-md text-center';
      row.append(courtCount);

      const hotline = node('td', facility.hotline || '—');
      hotline.className = 'py-4 px-space-md font-label-md text-label-md text-on-surface max-w-[130px] whitespace-nowrap overflow-hidden text-ellipsis';
      hotline.title = facility.hotline || '';
      row.append(hotline);

      const price = node('td', '—');
      price.className = 'py-4 px-space-md text-on-surface-variant';
      price.title = 'Không có giá tổng hợp trong danh sách cơ sở.';
      row.append(price);

      const status = document.createElement('td');
      status.className = 'py-4 px-space-md text-center';
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = Boolean(facility.is_active);
      toggle.className = 'sr-only peer';
      toggle.setAttribute('aria-label', `${facility.is_active ? 'Ngừng' : 'Mở'} hoạt động ${facility.name}`);
      toggle.addEventListener('change', async () => {
        const updated = await toggleFacility(facility);
        if (!updated) toggle.checked = Boolean(facility.is_active);
      });
      const toggleLabel = document.createElement('label');
      toggleLabel.className = 'relative inline-flex items-center cursor-pointer';
      const toggleTrack = node('div');
      toggleTrack.className = 'w-11 h-6 bg-surface-variant rounded-full peer peer-checked:bg-primary after:content-[\'\'] after:absolute after:top-[2px] after:left-[2px] after:bg-surface-container-lowest after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full';
      toggleLabel.append(toggle, toggleTrack);
      status.append(toggleLabel);
      row.append(status);

      const actions = document.createElement('td');
      actions.className = 'py-4 px-space-md text-right';
      const edit = node('button', 'edit');
      edit.type = 'button';
      edit.className = 'w-8 h-8 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface';
      edit.title = 'Chỉnh sửa chi tiết';
      edit.setAttribute('aria-label', `Chỉnh sửa ${facility.name}`);
      edit.addEventListener('click', () => openFacilityDialog(facility.id));
      const schedule = document.createElement('a');
      schedule.href = `quan-tri-khung-gio-gia.html?facility=${encodeURIComponent(facility.id)}`;
      schedule.className = edit.className;
      schedule.title = 'Xem khung giờ và bảng giá';
      schedule.setAttribute('aria-label', schedule.title + ` của ${facility.name}`);
      schedule.append(node('span', 'calendar_view_week'));
      schedule.firstElementChild.className = 'material-symbols-outlined text-[18px]';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.disabled = true;
      remove.className = 'w-8 h-8 rounded-lg bg-surface-container text-error';
      remove.title = 'Xóa cơ sở · Sắp có';
      remove.setAttribute('aria-label', remove.title);
      const removeIcon = node('span', 'delete');
      removeIcon.className = 'material-symbols-outlined text-[18px]';
      remove.append(removeIcon);
      actions.append(edit, schedule, remove);
      row.append(actions);
      return row;
    });
    if (!rows.length) {
      const row = document.createElement('tr');
      const cell = node('td', 'Không có cơ sở phù hợp.');
      cell.colSpan = 10;
      cell.className = 'py-6 text-center text-on-surface-variant';
      row.append(cell);
      rows.push(row);
    }
    body.replaceChildren(...rows);
    window.SportBookingIcons?.renderAll(body);
  }

  function updateMockupPagination() {
    const buttons = [...document.querySelectorAll('[data-admin-page-number]')];
    const start = Math.max(1, Math.min(appliedFilters.page - 1, pageCount - buttons.length + 1));
    buttons.forEach((button, index) => {
      const page = start + index;
      button.dataset.adminPageNumber = String(page);
      button.hidden = page > pageCount;
      button.disabled = page > pageCount;
      button.className = page === appliedFilters.page
        ? 'w-8 h-8 rounded-lg bg-primary text-on-primary font-semibold flex items-center justify-center shadow-sm'
        : 'w-8 h-8 rounded-lg bg-surface-container-lowest hover:bg-surface-container-high text-on-surface flex items-center justify-center transition-all';
    });
    document.querySelectorAll('[data-admin-page="previous"]').forEach((button) => {
      button.disabled = appliedFilters.page <= 1;
    });
    document.querySelectorAll('[data-admin-page="next"]').forEach((button) => {
      button.disabled = appliedFilters.page >= pageCount;
    });
  }

  async function loadFacilities(isPolling = false) {
    const id = ++requestId;
    try {
      const result = await api.listAdminFacilities({ ...appliedFilters, page_size: 20 });
      if (id !== requestId) return;
      if (!Array.isArray(result.facilities) || !result.pagination) {
        throw new Error('Danh sách cơ sở không hợp lệ.');
      }
      pageCount = Math.max(1, Number(result.pagination.total_pages) || 1);
      if (appliedFilters.page > pageCount) {
        appliedFilters.page = pageCount;
        return loadFacilities(isPolling);
      }
      latestFacilities = result.facilities;
      latestTotal = Number(result.pagination.total) || 0;
      if (el.drawerBackdrop.hidden) renderFacilities(latestFacilities, latestTotal);
      el.summary.textContent = `Trang ${appliedFilters.page} / ${pageCount} · ${result.pagination.total} cơ sở`;
      el.previous.disabled = appliedFilters.page <= 1;
      el.next.disabled = appliedFilters.page >= pageCount;
      updateMockupPagination();
      el.status.textContent = 'Danh sách được cập nhật tự động.';
    } catch (error) {
      if (error.status === 401) window.location.replace('/dang-nhap.html');
      else if (error.status === 403) window.location.replace(state.USER_HOME);
      else el.status.textContent = error.message || 'Không thể tải danh sách cơ sở.';
      if (isPolling) throw error;
    }
  }

  function fillFacilityForm(facility) {
    for (const [field, id] of Object.entries(facilityFields)) {
      const input = document.getElementById(id);
      const value = facility[field];
      input.value = field === 'amenities'
        ? Array.isArray(value) ? value.join('\n') : ''
        : field.endsWith('_time') ? facilityState.formatHours(value) : value || '';
    }
    document.getElementById('facilityIsActive').checked = facility.is_active;
  }

  function fillCourtForm(court = {}) {
    for (const [field, id] of Object.entries(courtFields)) {
      document.getElementById(id).value = court[field] ?? '';
    }
    document.getElementById('courtIsActive').checked = court.is_active !== false;
    el.courtForm.dataset.courtId = court.id || '';
    el.courtForm.dataset.updatedAt = court.updated_at || '';
    el.courtFormTitle.textContent = court.id ? 'Chỉnh sửa sân' : 'Thêm sân';
    el.courtError.hidden = true;
    el.courtForm.hidden = false;
    document.getElementById('courtName').focus();
  }

  function renderCourts(courts) {
    const rows = courts.map((court) => {
      const row = node('article');
      row.className = 'admin-facility-court';
      const details = node('div');
      details.append(
        node('strong', court.name),
        node('span', `${court.sport_type} · ${formatMoney(court.price_normal)} - ${formatMoney(court.price_peak)} · ${court.is_active ? 'Đang hoạt động' : 'Ngừng hoạt động'}`)
      );
      const edit = node('button', 'Sửa');
      edit.type = 'button';
      edit.className = 'admin-button admin-button--quiet';
      edit.addEventListener('click', () => fillCourtForm(court));
      row.append(details, edit);
      return row;
    });
    if (!rows.length) rows.push(node('p', 'Cơ sở chưa có sân.'));
    el.courtRows.replaceChildren(...rows);
  }

  function fillDrawerFacility(facility) {
    for (const field of document.querySelectorAll('[data-facility-field]')) {
      const key = field.dataset.facilityField;
      const value = facility[key];
      field.value = key.endsWith('_time') && typeof value === 'string'
        ? value.slice(0, 5)
        : value || '';
    }
    const amenities = Array.isArray(facility.amenities) ? facility.amenities : [];
    for (const checkbox of document.querySelectorAll('[data-facility-amenity]')) {
      const label = checkbox.closest('label')?.querySelector('span:last-child')?.textContent.trim();
      checkbox.checked = Boolean(label && amenities.includes(label));
    }
  }

  function readDrawerFacilityForm() {
    const values = {};
    for (const field of document.querySelectorAll('[data-facility-field]')) {
      values[field.dataset.facilityField] = field.value;
    }
    const existingAmenities = Array.isArray(currentFacility?.amenities)
      ? currentFacility.amenities
      : [];
    const options = [...document.querySelectorAll('[data-facility-amenity]')].map((checkbox) => (
      checkbox.closest('label')?.querySelector('span:last-child')?.textContent.trim()
    )).filter(Boolean);
    const selected = [...document.querySelectorAll('[data-facility-amenity]:checked')].map((checkbox) => (
      checkbox.closest('label')?.querySelector('span:last-child')?.textContent.trim()
    )).filter(Boolean);
    values.amenities = [
      ...existingAmenities.filter((amenity) => !options.includes(amenity)),
      ...selected
    ].join('\n');
    values.map_url = currentFacility?.map_url || '';
    values.image_url = currentFacility?.image_url || '';
    values.description = currentFacility?.description || '';
    values.rules = currentFacility?.rules || '';
    values.is_active = currentFacility?.is_active !== false;
    if (!values.closing_time && currentFacility?.closing_time) {
      values.closing_time = currentFacility.closing_time.slice(0, 5);
    }
    return facilityState.normalizeFacilityForm(values);
  }

  async function openFacilityDialog(id = '') {
    el.formError.hidden = true;
    el.courtForm.hidden = true;
    document.getElementById('facilityDrawerError').hidden = true;
    if (!id) {
      currentFacility = null;
      el.drawerTitle.textContent = 'Thêm / Chỉnh sửa cơ sở thể thao';
      fillDrawerFacility({
        name: '', address: '', district: '', opening_time: '', closing_time: '',
        hotline: '', map_url: '', image_url: '', amenities: [], description: '',
        rules: '', cancellation_policy: '', is_active: true
      });
      el.drawerBackdrop.hidden = false;
      document.querySelector('[data-facility-field="name"]').focus();
      return;
    }
    try {
      const result = await api.getAdminFacility(id);
      currentFacility = result.facility;
      el.drawerTitle.textContent = 'Thêm / Chỉnh sửa cơ sở thể thao';
      fillDrawerFacility(result.facility);
      renderCourts(result.courts);
      el.drawerBackdrop.hidden = false;
      document.querySelector('[data-facility-field="name"]').focus();
    } catch (error) {
      el.status.textContent = error.message || 'Không thể tải thông tin cơ sở.';
    }
  }

  async function toggleFacility(facility) {
    const next = !facility.is_active;
    if (!window.confirm(`${next ? 'Mở lại' : 'Ngừng'} hoạt động cơ sở “${facility.name}”?`)) return false;
    try {
      await api.updateAdminFacility(facility.id, {
        expected_updated_at: facility.updated_at,
        is_active: next
      });
      polling?.refreshNow();
      return true;
    } catch (error) {
      el.status.textContent = error.message || 'Không thể cập nhật trạng thái cơ sở.';
      return false;
    }
  }

  async function saveFacility(event) {
    event?.preventDefault();
    if (pending) return;
    const drawerError = document.getElementById('facilityDrawerError');
    drawerError.hidden = true;
    try {
      const values = readDrawerFacilityForm();
      pending = true;
      const result = currentFacility
        ? await api.updateAdminFacility(currentFacility.id, {
          ...values,
          expected_updated_at: currentFacility.updated_at
        })
        : await api.createAdminFacility(values);
      if (currentFacility) {
        await openFacilityDialog(currentFacility.id);
      } else {
        const createdId = result.id || result.facility?.id;
        if (!createdId) throw new Error('Cơ sở đã lưu nhưng máy chủ không trả về mã cơ sở.');
        await openFacilityDialog(createdId);
      }
      polling?.refreshNow();
    } catch (error) {
      drawerError.textContent = error.message || 'Không thể lưu cơ sở.';
      drawerError.hidden = false;
    } finally {
      pending = false;
    }
  }

  async function saveCourt(event) {
    event.preventDefault();
    if (pending || !currentFacility) return;
    el.courtError.hidden = true;
    try {
      const values = {};
      for (const [field, id] of Object.entries(courtFields)) {
        values[field] = document.getElementById(id).value;
      }
      values.is_active = document.getElementById('courtIsActive').checked;
      const normalized = facilityState.normalizeCourtForm(values);
      pending = true;
      const id = el.courtForm.dataset.courtId;
      if (id) {
        await api.updateAdminCourt(id, {
          ...normalized,
          expected_updated_at: el.courtForm.dataset.updatedAt
        });
      } else {
        await api.createAdminCourt({ ...normalized, facility_id: currentFacility.id });
      }
      await openFacilityDialog(currentFacility.id);
      polling?.refreshNow();
    } catch (error) {
      el.courtError.textContent = error.message || 'Không thể lưu sân.';
      el.courtError.hidden = false;
    } finally {
      pending = false;
    }
  }

  function closeDialog() {
    if (pending) return;
    el.dialog.hidden = true;
    el.drawerBackdrop.hidden = true;
    currentFacility = null;
    el.courtForm.hidden = true;
    renderFacilities(latestFacilities, latestTotal);
    polling?.refreshNow();
  }

  el.filterForm.addEventListener('submit', (event) => {
    event.preventDefault();
    appliedFilters = { ...draftFilters, page: 1 };
    api.clearCache();
    loadFacilities();
  });
  const mockupSearch = document.getElementById('mockupFacilitySearch');
  const mockupDistrict = document.getElementById('mockupFacilityDistrict');
  const mockupActive = document.getElementById('mockupFacilityActive');
  mockupSearch?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    draftFilters.q = mockupSearch.value.trim();
    appliedFilters = { ...draftFilters, page: 1 };
    api.clearCache();
    loadFacilities();
  });
  mockupDistrict?.addEventListener('change', () => {
    draftFilters.district = mockupDistrict.value;
    el.district.value = mockupDistrict.value;
    appliedFilters = { ...draftFilters, page: 1 };
    api.clearCache();
    loadFacilities();
  });
  mockupActive?.addEventListener('change', () => {
    draftFilters.is_active = mockupActive.value === 'active'
      ? 'true'
      : mockupActive.value === 'inactive' ? 'false' : '';
    appliedFilters = { ...draftFilters, page: 1 };
    api.clearCache();
    loadFacilities();
  });
  document.querySelector('[title="Làm mới bộ lọc"]')?.addEventListener('click', () => {
    draftFilters = { q: '', district: '', is_active: '' };
    appliedFilters = { ...draftFilters, page: 1 };
    if (mockupSearch) mockupSearch.value = '';
    if (mockupDistrict) mockupDistrict.value = '';
    if (mockupActive) mockupActive.value = 'all';
    api.clearCache();
    loadFacilities();
  });
  document.getElementById('open-drawer-btn')?.addEventListener('click', () => openFacilityDialog());
  document.getElementById('close-drawer-btn')?.addEventListener('click', closeDialog);
  document.getElementById('cancel-drawer-btn')?.addEventListener('click', closeDialog);
  el.drawerSave.addEventListener('click', saveFacility);
  el.drawerBackdrop.addEventListener('click', (event) => {
    if (event.target === el.drawerBackdrop) closeDialog();
  });
  document.querySelectorAll('[data-admin-page]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.adminPage === 'previous' && appliedFilters.page > 1) {
        appliedFilters.page -= 1;
        loadFacilities();
      } else if (button.dataset.adminPage === 'next' && appliedFilters.page < pageCount) {
        appliedFilters.page += 1;
        loadFacilities();
      }
    });
  });
  document.querySelectorAll('[data-admin-page-number]').forEach((button) => {
    button.addEventListener('click', () => {
      const page = Number(button.dataset.adminPageNumber);
      if (page > pageCount || page === appliedFilters.page) return;
      appliedFilters.page = page;
      loadFacilities();
    });
  });
  el.search.addEventListener('input', () => { draftFilters.q = el.search.value; });
  el.district.addEventListener('change', () => { draftFilters.district = el.district.value; });
  el.active.addEventListener('change', () => { draftFilters.is_active = el.active.value; });
  el.reset.addEventListener('click', () => {
    draftFilters = { q: '', district: '', is_active: '' };
    appliedFilters = { ...draftFilters, page: 1 };
    el.search.value = '';
    el.district.value = '';
    el.active.value = '';
    api.clearCache();
    loadFacilities();
  });
  el.previous.addEventListener('click', () => {
    if (appliedFilters.page > 1) { appliedFilters.page -= 1; loadFacilities(); }
  });
  el.next.addEventListener('click', () => {
    if (appliedFilters.page < pageCount) { appliedFilters.page += 1; loadFacilities(); }
  });
  el.add.addEventListener('click', () => openFacilityDialog());
  el.form.addEventListener('submit', saveFacility);
  el.addCourt.addEventListener('click', () => fillCourtForm());
  el.courtForm.addEventListener('submit', saveCourt);
  el.cancelCourt.addEventListener('click', () => { el.courtForm.hidden = true; });
  document.querySelectorAll('[data-facility-dialog-close]').forEach((button) => {
    button.addEventListener('click', closeDialog);
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !el.drawerBackdrop.hidden) closeDialog();
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
        await loadFacilities(true);
      } finally {
        api.setPollingSignal(null);
      }
    }, 5000, (status) => shell.mountSyncStatus(el.status.parentElement, status));
  }

  window.SportBookingIcons?.renderAll(document);
  initialize();
})();
