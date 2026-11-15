'use strict';

(() => {
  const state = window.SportBookingAdminState;
  const shell = window.SportBookingAdminShell;
  const api = window.SportBookingAdminApi;
  const exportDownload = window.SportBookingExportDownload;
  const facilityState = window.SportBookingAdminFacilitiesState;
  if (!state || !shell || !api || !exportDownload || !facilityState) {
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
    banner: document.getElementById('facilityMutationBanner'),
    summary: document.getElementById('facilityPaginationSummary'),
    previous: document.getElementById('previousFacilitiesPage'),
    next: document.getElementById('nextFacilitiesPage'),
    exportButton: document.getElementById('facilitiesExport'),
    exportStatus: document.getElementById('facilitiesExportStatus'),
    add: document.getElementById('addFacility'),
    dialog: document.getElementById('facilityDialog'),
    title: document.getElementById('facilityDialogTitle'),
    drawerBackdrop: document.getElementById('facility-drawer-backdrop'),
    drawer: document.getElementById('facility-drawer'),
    drawerTitle: document.querySelector('#facility-drawer h2'),
    drawerSave: document.getElementById('save-facility-drawer-btn'),
    drawerSaveLabel: document.querySelector('#save-facility-drawer-btn span:last-child'),
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
  let latestSummary = {
    total_facilities: 0,
    active_facilities: 0,
    inactive_facilities: 0,
    avg_fill_rate_percent: 0
  };
  let currentFacility = null;
  let polling = null;
  let pageCount = 1;
  let requestId = 0;
  let pending = false;
  let facilityStatusUpdates = 0;

  function node(tag, text = '') {
    const element = document.createElement(tag);
    element.textContent = text;
    return element;
  }

  const initialFacilityRow = document.createElement('tr');
  const initialFacilityCell = node('td', 'Đang tải danh sách cơ sở...');
  initialFacilityCell.colSpan = 8;
  initialFacilityCell.className = 'py-6 text-center text-on-surface-variant';
  initialFacilityRow.append(initialFacilityCell);
  document.getElementById('mockupFacilityRows')?.replaceChildren(initialFacilityRow);
  document.querySelectorAll('span.material-symbols-outlined').forEach((span) => {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const classes = span.className.split(/\s+/)
      .filter((name) => name && name !== 'material-symbols-outlined');
    if (classes.length) icon.setAttribute('class', classes.join(' '));
    window.SportBookingIcons.setIcon(icon, span.textContent.trim());
    span.replaceWith(icon);
  });
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
      if (facilityState.buildFacilityRowModel(facility).no_courts) {
        const noCourts = node('span', 'Chưa có sân');
        noCourts.className = 'admin-facility-empty-courts';
        noCourts.setAttribute('data-no-courts', '');
        identity.append(noCourts);
      }
      row.append(identity);
      const hours = facility.opening_time && facility.closing_time
        ? `${facilityState.formatHours(facility.opening_time)} - ${facilityState.formatHours(facility.closing_time)}`
        : 'Chưa thiết lập giờ hoạt động';
      row.append(node('td', hours));
      row.append(node('td', `${facility.active_court_count}/${facility.court_count}`));
      row.append(node('td', facility.active_booking_count));
      const status = node('td');
      status.className = 'admin-facility-status';
      status.dataset.active = String(facility.is_active);
      status.append(node('span', facility.is_active ? 'Đang hoạt động' : 'Tạm khóa'));
      const statusToggle = node('input');
      statusToggle.type = 'checkbox';
      statusToggle.checked = Boolean(facility.is_active);
      statusToggle.dataset.facilityId = String(facility.id);
      statusToggle.setAttribute(
        'aria-label',
        `${facility.is_active ? 'Tạm khóa' : 'Mở lại'} ${facility.name}`
      );
      statusToggle.addEventListener('change', toggleFacility);
      status.append(statusToggle);
      row.append(status);
      const actions = node('td');
      actions.className = 'admin-facility-actions';
      const edit = node('button', 'Sửa');
      edit.type = 'button';
      edit.className = 'admin-button admin-button--quiet';
      edit.prepend(window.SportBookingIcons.createIcon('edit', 'w-4 h-4'));
      edit.addEventListener('click', () => openFacilityDialog(facility.id));
      actions.append(edit);
      const remove = node('button', 'Xóa');
      remove.type = 'button';
      remove.className = 'admin-button admin-button--danger';
      remove.prepend(window.SportBookingIcons.createIcon('delete', 'w-4 h-4'));
      remove.title = 'Xóa cơ sở';
      remove.setAttribute('aria-label', `Xóa cơ sở ${facility.name}`);
      remove.addEventListener('click', () => deleteFacility(facility));
      actions.append(remove);
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
    const range = document.querySelector('[data-admin-facility-pagination-range]');
    const paginationTotal = document.querySelector('[data-admin-facility-pagination-total]');
    if (range) {
      const first = total ? (appliedFilters.page - 1) * 20 + 1 : 0;
      range.textContent = `${first} - ${Math.min(first + facilities.length - 1, total)}`;
    }
    if (paginationTotal) paginationTotal.textContent = new Intl.NumberFormat('vi-VN').format(total);
    const rows = facilities.map(buildMockupFacilityRow);
    if (!rows.length) {
      const row = document.createElement('tr');
      const cell = node('td', 'Không có cơ sở phù hợp.');
      cell.colSpan = 8;
      cell.className = 'py-6 text-center text-on-surface-variant';
      row.append(cell);
      rows.push(row);
    }
    body.replaceChildren(...rows);
    window.SportBookingIcons?.renderAll(body);
  }

  function buildMockupFacilityRow(facility) {
      const model = facilityState.buildFacilityRowModel(facility);
      const row = document.createElement('tr');
      row.dataset.facilityId = model.id;
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
        const icon = window.SportBookingIcons.createIcon('stadium', 'text-primary');
        image.append(icon);
      }
      const details = document.createElement('div');
      details.className = 'flex flex-col min-w-0';
      const name = node('span', facility.name);
      name.className = 'font-label-lg text-label-lg text-on-surface font-semibold truncate';
      const address = node('span', `${facility.address} · ${facility.district}`);
      address.className = 'font-body-sm text-body-sm text-on-surface-variant truncate';
      details.append(name, address);
      if (model.no_courts) {
        const noCourts = node('span', 'Chưa có sân');
        noCourts.className = 'text-xs text-on-surface-variant';
        noCourts.setAttribute('data-no-courts', '');
        details.append(noCourts);
      }
      identityGroup.append(image, details);
      identity.append(identityGroup);
      row.append(identity);

      const addressCell = node('td');
      addressCell.className = 'py-4 px-space-md text-on-surface-variant max-w-[220px]';
      const addressWrapper = node('div');
      addressWrapper.className = 'flex items-start gap-1 min-w-0';
      const placeIcon = window.SportBookingIcons.createIcon(
        'place',
        'text-[16px] shrink-0 mt-0.5'
      );
      const addressText = node('span', facility.address || '—');
      addressText.className = 'line-clamp-2 break-words';
      addressWrapper.append(placeIcon, addressText);
      addressCell.append(addressWrapper);
      row.append(addressCell);

      const hoursCell = node('td', model.hours);
      hoursCell.className = 'py-4 px-space-md font-label-md text-label-md text-on-surface whitespace-nowrap';
      row.append(hoursCell);

      const courtCount = node('td', `${facility.active_court_count}/${facility.court_count}`);
      courtCount.className = 'py-4 px-space-md text-center';
      row.append(courtCount);

      const hotline = node('td', facility.hotline || '—');
      hotline.className = 'py-4 px-space-md font-label-md text-label-md text-on-surface max-w-[130px] whitespace-nowrap overflow-hidden text-ellipsis';
      hotline.title = facility.hotline || '';
      row.append(hotline);

      const status = document.createElement('td');
      status.className = 'py-4 px-space-md text-center';
      const statusText = node('span', model.status_text);
      statusText.className = 'mr-2';
      status.append(statusText);
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = model.is_active;
      toggle.className = 'sr-only peer';
      toggle.dataset.facilityId = model.id;
      toggle.setAttribute('aria-label', model.toggle_label);
      toggle.addEventListener('change', toggleFacility);
      const toggleLabel = document.createElement('label');
      toggleLabel.className = 'relative inline-flex items-center cursor-pointer';
      const toggleTrack = node('div');
      toggleTrack.className = 'w-11 h-6 bg-surface-variant rounded-full peer peer-checked:bg-primary after:content-[\'\'] after:absolute after:top-[2px] after:left-[2px] after:bg-surface-container-lowest after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full';
      toggleLabel.append(toggle, toggleTrack);
      status.append(toggleLabel);
      row.append(status);

      const actions = document.createElement('td');
      actions.className = 'py-4 px-space-md text-right';
      const edit = node('button', 'Sửa');
      edit.type = 'button';
      edit.className = 'inline-flex items-center gap-2 rounded-lg bg-surface-container px-3 py-2 text-on-surface hover:bg-surface-container-high';
      edit.prepend(window.SportBookingIcons.createIcon('edit', 'w-4 h-4'));
      edit.title = 'Sửa cơ sở';
      edit.setAttribute('aria-label', `Sửa ${facility.name}`);
      edit.addEventListener('click', () => openFacilityDialog(facility.id));
      actions.append(edit);
      const remove = node('button', 'Xóa');
      remove.type = 'button';
      remove.className = 'inline-flex items-center gap-2 rounded-lg border border-error/30 bg-error-container px-3 py-2 text-error hover:bg-error-container/80';
      remove.prepend(window.SportBookingIcons.createIcon('delete', 'w-4 h-4'));
      remove.title = 'Xóa cơ sở';
      remove.setAttribute('aria-label', `Xóa cơ sở ${facility.name}`);
      remove.addEventListener('click', () => deleteFacility(facility));
      actions.append(remove);
      row.append(actions);
      return row;
  }

  function renderSummary(summary = latestSummary) {
    const values = facilityState.updateFacilitySummary(summary);
    latestSummary = values;
    const number = new Intl.NumberFormat('vi-VN');
    const total = document.querySelector('[data-admin-facility-total]');
    const active = document.querySelector('[data-admin-facility-active-facilities]');
    const inactive = document.querySelector('[data-admin-facility-inactive-facilities]');
    const fillRate = document.querySelector('[data-admin-facility-fill-rate]');
    if (total) total.textContent = number.format(values.total_facilities);
    if (active) active.textContent = number.format(values.active_facilities);
    if (inactive) inactive.textContent = number.format(values.inactive_facilities);
    if (fillRate) {
      fillRate.textContent = `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 })
        .format(values.avg_fill_rate_percent)}%`;
    }
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
      if (id !== requestId) return false;
      if (!Array.isArray(result.facilities) || !result.pagination) {
        throw new Error('Danh sách cơ sở không hợp lệ.');
      }
      if (!result.summary || [
        'total_facilities', 'active_facilities', 'inactive_facilities', 'avg_fill_rate_percent'
      ].some((key) => !Number.isFinite(Number(result.summary[key])))) {
        throw new Error('Số liệu tổng hợp cơ sở không hợp lệ.');
      }
      pageCount = Math.max(1, Number(result.pagination.total_pages) || 1);
      if (appliedFilters.page > pageCount) {
        appliedFilters.page = pageCount;
        return loadFacilities(isPolling);
      }
      latestFacilities = result.facilities;
      latestTotal = Number(result.pagination.total) || 0;
      renderSummary({
        total_facilities: Number(result.summary.total_facilities),
        active_facilities: Number(result.summary.active_facilities),
        inactive_facilities: Number(result.summary.inactive_facilities),
        avg_fill_rate_percent: Number(result.summary.avg_fill_rate_percent)
      });
      if (el.drawerBackdrop.hidden) renderFacilities(latestFacilities, latestTotal);
      el.summary.textContent = `Trang ${appliedFilters.page} / ${pageCount} · ${result.pagination.total} cơ sở`;
      el.previous.disabled = appliedFilters.page <= 1;
      el.next.disabled = appliedFilters.page >= pageCount;
      updateMockupPagination();
      el.status.textContent = 'Danh sách được cập nhật tự động.';
      return true;
    } catch (error) {
      if (error.status === 401) window.location.replace('/dang-nhap.html');
      else if (error.status === 403) window.location.replace(state.USER_HOME);
      else if (!isPolling) el.status.textContent = error.message || 'Không thể tải danh sách cơ sở.';
      if (isPolling) throw error;
      return false;
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
    el.courtForm.dataset.isActive = String(court.is_active !== false);
    document.getElementById('courtActiveLabel').textContent =
      court.is_active === false ? 'Tạm khóa' : 'Đang hoạt động';
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
        node('span', `${court.sport_type} · ${formatMoney(court.price_normal)} - ${formatMoney(court.price_peak)} · ${court.is_active ? 'Đang hoạt động' : 'Tạm khóa'}`)
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

  function readFirstCourtForm() {
    return facilityState.normalizeCourtForm({
      name: document.getElementById('firstCourtName').value,
      sport_type: document.getElementById('firstCourtSport').value,
      price_normal: document.getElementById('firstCourtNormalPrice').value,
      price_peak: document.getElementById('firstCourtPeakPrice').value,
      description: '',
      is_active: true
    });
  }

  function clearFacilityErrors() {
    document.getElementById('facilityDrawerError').hidden = true;
    for (const error of document.querySelectorAll('[data-facility-error]')) error.hidden = true;
  }

  function showFacilityError(error) {
    const field = error.field || error.details?.field;
    const fieldError = field
      ? document.querySelector(`[data-facility-error="${field}"]`)
      : null;
    if (fieldError) {
      fieldError.textContent = error.message;
      fieldError.hidden = false;
      document.querySelector(`[data-facility-field="${field}"]`)?.focus();
      return;
    }
    const drawerError = document.getElementById('facilityDrawerError');
    drawerError.textContent = error.message || 'Không thể lưu cơ sở.';
    drawerError.hidden = false;
  }

  async function openFacilityDialog(id = '') {
    clearFacilityErrors();
    el.formError.hidden = true;
    el.courtForm.hidden = true;
    document.getElementById('newFacilityCourtFields').hidden = Boolean(id);
    if (!id) {
      currentFacility = null;
      el.drawerTitle.textContent = 'Thêm / Chỉnh sửa cơ sở thể thao';
      fillDrawerFacility({
        name: '', address: '', district: '', opening_time: '', closing_time: '',
        hotline: '', map_url: '', image_url: '', amenities: [], description: '',
        rules: '', cancellation_policy: '', is_active: true
      });
      document.getElementById('firstCourtName').value = '';
      document.getElementById('firstCourtSport').value = 'BADMINTON';
      document.getElementById('firstCourtNormalPrice').value = '';
      document.getElementById('firstCourtPeakPrice').value = '';
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

  function confirmStatusChange({ resource, name, next }) {
    return new Promise((resolve) => {
      const previousFocus = document.activeElement;
      const modal = document.createElement('div');
      modal.className = 'admin-modal';
      const dialog = document.createElement('section');
      dialog.className = 'admin-dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'facilityStatusConfirmationTitle');
      const header = document.createElement('header');
      header.className = 'admin-dialog__header';
      const title = document.createElement('h2');
      title.id = 'facilityStatusConfirmationTitle';
      title.textContent = next ? `Mở lại ${resource}` : `Tạm khóa ${resource}`;
      const body = document.createElement('div');
      body.className = 'admin-dialog__body';
      const description = document.createElement('p');
      description.className = 'admin-dialog__description';
      description.textContent = `${next ? 'Bạn muốn mở lại' : 'Bạn muốn tạm khóa'} ${resource} “${name}”?`;
      body.append(description);
      const footer = document.createElement('footer');
      footer.className = 'admin-dialog__footer';
      const cancel = node('button', 'Hủy');
      cancel.type = 'button';
      cancel.className = 'admin-button admin-button--quiet';
      const confirm = node('button', next ? 'Mở lại' : 'Tạm khóa');
      confirm.type = 'button';
      confirm.className = next
        ? 'admin-button admin-button--quiet'
        : 'admin-button admin-button--danger';
      footer.append(cancel, confirm);
      header.append(title);
      dialog.append(header, body, footer);
      modal.append(dialog);
      document.body.append(modal);

      function close(accepted) {
        document.removeEventListener('keydown', onKeydown);
        modal.remove();
        if (previousFocus?.isConnected) previousFocus.focus();
        resolve(accepted);
      }

      function onKeydown(event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          close(false);
        } else if (event.key === 'Tab') {
          event.preventDefault();
          (document.activeElement === cancel ? confirm : cancel).focus();
        }
      }

      modal.addEventListener('click', (event) => {
        if (event.target === modal) close(false);
      });
      cancel.addEventListener('click', () => close(false));
      confirm.addEventListener('click', () => close(true));
      document.addEventListener('keydown', onKeydown);
      cancel.focus();
    });
  }

  function confirmFacilityDeletion(facility) {
    const model = facilityState.buildFacilityDeleteConfirmation(facility);
    return new Promise((resolve) => {
      const previousFocus = document.activeElement;
      const modal = document.createElement('div');
      modal.className = 'admin-modal';
      const dialog = document.createElement('section');
      dialog.className = 'admin-dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'facilityDeleteConfirmationTitle');
      const header = document.createElement('header');
      header.className = 'admin-dialog__header';
      const title = node('h2', model.title);
      title.id = 'facilityDeleteConfirmationTitle';
      const body = document.createElement('div');
      body.className = 'admin-dialog__body';
      const description = node('p', model.description);
      description.className = 'admin-dialog__description';
      body.append(description);
      const footer = document.createElement('footer');
      footer.className = 'admin-dialog__footer';
      const keep = node('button', model.keep_label);
      keep.type = 'button';
      keep.className = 'admin-button admin-button--quiet';
      const confirm = node('button', model.confirm_label);
      confirm.type = 'button';
      confirm.className = 'admin-button admin-button--danger';
      footer.append(keep, confirm);
      header.append(title);
      dialog.append(header, body, footer);
      modal.append(dialog);
      document.body.append(modal);

      function close(accepted) {
        document.removeEventListener('keydown', onKeydown);
        modal.remove();
        if (previousFocus?.isConnected) previousFocus.focus();
        resolve(accepted);
      }

      function onKeydown(event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          close(false);
        } else if (event.key === 'Tab') {
          event.preventDefault();
          (document.activeElement === keep ? confirm : keep).focus();
        }
      }

      modal.addEventListener('click', (event) => {
        if (event.target === modal) close(false);
      });
      keep.addEventListener('click', () => close(false));
      confirm.addEventListener('click', () => close(true));
      document.addEventListener('keydown', onKeydown);
      keep.focus();
    });
  }

  function showFacilityMutationBanner(message, isError = false) {
    el.banner.textContent = message;
    el.banner.dataset.kind = isError ? 'error' : 'success';
    el.banner.hidden = false;
  }

  async function deleteFacility(facility) {
    if (!await confirmFacilityDeletion(facility)) return false;
    facilityStatusUpdates += 1;
    try {
      await api.deleteAdminFacility(facility.id, {
        expected_updated_at: facility.updated_at
      });
      latestFacilities = latestFacilities.filter(
        (item) => String(item.id) !== String(facility.id)
      );
      latestTotal = Math.max(0, latestTotal - 1);
      renderFacilities(latestFacilities, latestTotal);
      const refreshed = await loadFacilities();
      showFacilityMutationBanner(`Đã xóa cơ sở ${facility.name}`);
      if (!refreshed) {
        el.status.textContent = 'Đã xóa cơ sở nhưng không thể làm mới số liệu; hãy thử tải lại.';
      }
      return true;
    } catch (error) {
      showFacilityMutationBanner(error.message || 'Không thể xóa cơ sở.', true);
      return false;
    } finally {
      facilityStatusUpdates -= 1;
    }
  }

  function facilityMatchesFilters(facility) {
    if (appliedFilters.district && facility.district !== appliedFilters.district) return false;
    if (appliedFilters.is_active !== ''
        && Boolean(facility.is_active) !== (appliedFilters.is_active === 'true')) return false;
    const query = String(appliedFilters.q || '').trim().toLocaleLowerCase('vi');
    return !query || `${facility.name} ${facility.address}`.toLocaleLowerCase('vi').includes(query);
  }

  function updateFacilityRow(facility) {
    const index = latestFacilities.findIndex((item) => String(item.id) === String(facility.id));
    if (index >= 0) latestFacilities[index] = facility;

    const body = document.getElementById('mockupFacilityRows');
    if (!body) return;
    const row = [...body.querySelectorAll('tr[data-facility-id]')].find(
      (item) => item.dataset.facilityId === String(facility.id)
    );
    if (row) {
      if (facilityMatchesFilters(facility)) row.replaceWith(buildMockupFacilityRow(facility));
      else row.remove();
    }
    if (body.children.length === 0) {
      const emptyRow = document.createElement('tr');
      const cell = node('td', 'Không có cơ sở phù hợp.');
      cell.colSpan = 8;
      cell.className = 'py-6 text-center text-on-surface-variant';
      emptyRow.append(cell);
      body.append(emptyRow);
    }
    window.SportBookingIcons?.renderAll(body);
  }

  async function toggleFacility(event) {
    const control = event.currentTarget;
    const facility = facilityState.findFacilityForToggleEvent(event, latestFacilities);
    if (!facility) {
      control.checked = false;
      el.status.textContent = 'Không xác định được cơ sở cần cập nhật.';
      return false;
    }
    const next = !facility.is_active;
    if (!await confirmStatusChange({ resource: 'cơ sở', name: facility.name, next })) {
      control.checked = Boolean(facility.is_active);
      return false;
    }
    try {
      facilityStatusUpdates += 1;
      await api.updateAdminFacility(facility.id, {
        expected_updated_at: facility.updated_at,
        is_active: next
      });
    } catch (error) {
      control.checked = Boolean(facility.is_active);
      el.status.textContent = error.message || 'Không thể cập nhật trạng thái cơ sở.';
      return false;
    } finally {
      facilityStatusUpdates -= 1;
    }

    const successMessage = `${next ? 'Đã mở lại' : 'Đã tạm khóa'} ${facility.name}`;
    facility.is_active = next;
    control.checked = next;
    el.status.textContent = successMessage;
    updateFacilityRow({
      ...facility,
      active_court_count: next ? Number(facility.active_court_count) : 0
    });
    try {
      const [detail, list] = await Promise.all([
        api.getAdminFacility(facility.id),
        api.listAdminFacilities({ page: 1, page_size: 1 })
      ]);
      const updatedFacility = {
        ...facility,
        ...detail.facility,
        id: String(facility.id),
        court_count: detail.courts.length,
        active_court_count: detail.courts.filter((court) => court.is_active).length
      };
      renderSummary(list.summary);
      updateFacilityRow(updatedFacility);
      el.status.textContent = successMessage;
    } catch (error) {
      el.status.textContent = `${successMessage}; không thể làm mới số liệu: ${error.message}`;
      polling?.refreshNow();
    }
    return true;
  }

  async function saveFacility(event) {
    event?.preventDefault();
    if (pending) return;
    clearFacilityErrors();
    let suppressRefresh = false;
    try {
      const values = readDrawerFacilityForm();
      const updating = Boolean(currentFacility);
      const firstCourt = updating ? null : readFirstCourtForm();
      const facilityName = values.name;
      pending = true;
      el.drawerSave.disabled = true;
      el.drawerSaveLabel.textContent = 'Đang lưu...';
      facilityStatusUpdates += 1;
      suppressRefresh = true;
      const result = updating
        ? await api.updateAdminFacility(currentFacility.id, {
          ...values,
          expected_updated_at: currentFacility.updated_at
        })
        : await api.createAdminFacility({ ...values, courts: [firstCourt] });
      const facilityId = currentFacility?.id || result.id || result.facility?.id;
      if (!facilityId) throw new Error('Máy chủ không trả về mã cơ sở sau khi lưu.');
      el.drawerBackdrop.hidden = true;
      el.dialog.hidden = true;
      currentFacility = null;
      el.courtForm.hidden = true;
      const refreshed = await loadFacilities();
      if (refreshed) {
        el.status.textContent = updating
          ? `Đã cập nhật ${facilityName}`
          : `Đã lưu cơ sở ${facilityName}`;
      } else {
        el.status.textContent = `Đã lưu ${facilityName}, nhưng không thể làm mới danh sách và số liệu.`;
      }
    } catch (error) {
      showFacilityError(error);
    } finally {
      if (suppressRefresh) facilityStatusUpdates -= 1;
      pending = false;
      el.drawerSave.disabled = false;
      el.drawerSaveLabel.textContent = 'Lưu thông tin cơ sở';
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
      const id = el.courtForm.dataset.courtId;
      if (id && String(normalized.is_active) !== el.courtForm.dataset.isActive
          && !await confirmStatusChange({
            resource: 'sân',
            name: values.name,
            next: normalized.is_active
          })) {
        document.getElementById('courtIsActive').checked = el.courtForm.dataset.isActive === 'true';
        document.getElementById('courtActiveLabel').textContent =
          el.courtForm.dataset.isActive === 'true' ? 'Đang hoạt động' : 'Tạm khóa';
        return;
      }
      pending = true;
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
  el.exportButton.addEventListener('click', () => exportDownload.download(
    el.exportButton,
    el.exportStatus,
    () => api.exportFacilities({
      q: appliedFilters.q,
      district: appliedFilters.district,
      is_active: appliedFilters.is_active
    })
  ));
  el.form.addEventListener('submit', saveFacility);
  el.addCourt.addEventListener('click', () => fillCourtForm());
  document.getElementById('courtIsActive').addEventListener('change', (event) => {
    document.getElementById('courtActiveLabel').textContent =
      event.target.checked ? 'Đang hoạt động' : 'Tạm khóa';
  });
  el.courtForm.addEventListener('submit', saveCourt);
  el.cancelCourt.addEventListener('click', () => { el.courtForm.hidden = true; });
  document.querySelectorAll('[data-facility-dialog-close]').forEach((button) => {
    button.addEventListener('click', closeDialog);
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !el.drawerBackdrop.hidden) closeDialog();
  });
  el.guardRetry.addEventListener('click', initialize);
  window.addEventListener('admin-data-changed', () => {
    if (facilityStatusUpdates === 0) polling?.refreshNow();
  });
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
