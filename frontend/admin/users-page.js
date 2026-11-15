'use strict';

(() => {
  const state = window.SportBookingAdminState;
  const shell = window.SportBookingAdminShell;
  const api = window.SportBookingAdminApi;
  const exportDownload = window.SportBookingExportDownload;
  if (!state || !shell || !api || !exportDownload) {
    throw new Error('Thiếu cấu hình trang người dùng.');
  }
  shell.mountAdminShell({ active: 'users' });
  const el = {
    guard: document.getElementById('adminGuard'),
    guardMessage: document.getElementById('adminGuardMessage'),
    guardRetry: document.getElementById('adminGuardRetry'),
    app: document.getElementById('adminApp'),
    header: document.getElementById('adminHeaderMount'),
    form: document.getElementById('userFilters'),
    search: document.getElementById('mockupUserSearch'),
    status: document.getElementById('mockupUserStatusFilter'),
    reset: document.getElementById('resetUserFilters'),
    rows: document.getElementById('mockupUserRows'),
    message: document.getElementById('usersStatus'),
    summary: document.getElementById('userPaginationSummary'),
    previous: document.getElementById('previousUsersPage'),
    next: document.getElementById('nextUsersPage'),
    exportButton: document.getElementById('usersExport'),
    exportStatus: document.getElementById('usersExportStatus'),
    modal: document.getElementById('ban-modal'),
    title: document.getElementById('userLockTitle'),
    description: document.getElementById('userLockStatusText'),
    reason: document.getElementById('userLockReason'),
    reasonCount: document.getElementById('userLockReasonCount'),
    reasonField: document.getElementById('userLockReasonField'),
    error: document.getElementById('userLockError'),
    confirm: document.getElementById('confirmUserLock')
  };
  let draft = { q: '', status: '' };
  let applied = { ...draft, page: 1 };
  let currentUserId = '';
  let selectedUser = null;
  let pending = false;
  let polling = null;
  let pageCount = 1;
  let requestId = 0;
  let latestUsers = [];
  let latestTotal = 0;
  let latestSummary = null;

  const loadingRow = document.createElement('tr');
  const loadingCell = make('td', 'Đang tải người dùng...');
  loadingCell.className = 'py-space-lg text-center text-on-surface-variant';
  loadingCell.colSpan = 7;
  loadingRow.append(loadingCell);
  el.rows.replaceChildren(loadingRow);

  function make(tag, text = '') {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  }

  async function authorize() {
    const user = await shell.authorizeAdmin({
      api,
      state,
      guard: el.guard,
      guardMessage: el.guardMessage,
      guardRetry: el.guardRetry,
      app: el.app,
      header: el.header
    });
    if (!user) return false;
    currentUserId = String(user.id);
    return true;
  }

  function appendCell(row, value) {
    const cell = make('td', String(value ?? ''));
    row.append(cell);
    return cell;
  }

  function renderUsers(users) {
    latestUsers = users;
    const rows = users.map((user) => {
      const row = document.createElement('tr');
      const identity = document.createElement('td');
      identity.append(make('strong', user.full_name), make('span', user.email));
      row.append(identity);
      appendCell(row, `${user.role === 'ADMIN' ? 'Quản trị viên' : 'Người dùng'} · ${user.account_status === 'ACTIVE' ? 'Đang hoạt động' : 'Đã khóa'}`);
      appendCell(row, user.stats.total_bookings);
      appendCell(row, `${user.stats.completed_count} · ${user.stats.completion_rate}%`);
      appendCell(row, `${user.stats.cancelled_count} · ${user.stats.cancel_rate}%`);
      appendCell(row, user.stats.late_cancel_count);
      const actions = document.createElement('td');
      if (String(user.id) !== currentUserId) {
        const button = make('button', user.account_status === 'ACTIVE' ? 'Khóa' : 'Mở khóa');
        button.type = 'button';
        button.className = user.account_status === 'ACTIVE'
          ? 'admin-button admin-button--danger'
          : 'admin-button admin-button--quiet';
        button.addEventListener('click', () => openLockDialog(user));
        actions.append(button);
      }
      row.append(actions);
      return row;
    });
    el.rows.replaceChildren(...rows);
    if (!rows.length) {
      const row = document.createElement('tr');
      const cell = make('td', 'Không có người dùng phù hợp.');
      cell.colSpan = 7;
      row.append(cell);
      el.rows.append(row);
    }
  }

  function renderMockupUsers(users, total, summary) {
    const body = el.rows;
    const count = document.querySelector('[data-admin-users-total]');
    if (count) count.textContent = new Intl.NumberFormat('vi-VN').format(summary.total_users);
    document.querySelectorAll('[data-admin-user-summary]').forEach((metric) => {
      metric.textContent = new Intl.NumberFormat('vi-VN').format(
        summary[metric.dataset.adminUserSummary]
      );
    });
    const range = document.querySelector('[data-admin-user-pagination-range]');
    const paginationTotal = document.querySelector('[data-admin-user-pagination-total]');
    if (range) {
      const first = total ? (applied.page - 1) * 20 + 1 : 0;
      range.textContent = `${first} - ${Math.min(first + users.length - 1, total)}`;
    }
    if (paginationTotal) paginationTotal.textContent = new Intl.NumberFormat('vi-VN').format(total);
    const rows = users.map((user) => {
      const row = document.createElement('tr');
      row.className = 'hover:bg-surface-container/50 transition-colors';

      const identity = document.createElement('td');
      identity.className = 'py-space-md px-space-lg';
      const identityGroup = document.createElement('div');
      identityGroup.className = 'flex items-center gap-3';
      const fullName = String(user.full_name || 'Người dùng');
      const avatar = make('span', fullName.slice(0, 1).toUpperCase());
      avatar.className = 'w-11 h-11 rounded-full bg-surface-container-high text-primary flex items-center justify-center font-bold';
      const details = document.createElement('div');
      details.className = 'flex flex-col min-w-0';
      const name = make('span', fullName);
      name.className = 'font-headline-sm text-body-lg font-semibold truncate text-on-surface';
      const email = make('span', user.email || '—');
      email.className = 'text-on-surface-variant text-[11px] truncate';
      const idAndPhone = make('span', `${user.id}${user.phone ? ` · ${user.phone}` : ''}`);
      idAndPhone.className = 'text-on-surface-variant font-label-md text-label-md truncate';
      details.append(name, idAndPhone, email);
      identityGroup.append(avatar, details);
      identity.append(identityGroup);
      row.append(identity);

      const profile = document.createElement('td');
      profile.className = 'py-space-md px-space-md';
      const profileDetails = document.createElement('div');
      profileDetails.className = 'flex flex-col gap-1 min-w-0';
      const role = make('span', user.role === 'ADMIN' ? 'Quản trị viên' : 'Người dùng');
      role.className = 'font-medium text-on-surface truncate';
      const unavailableProfile = make('span', 'Giới tính / trình độ: —');
      unavailableProfile.className = 'text-[11px] text-on-surface-variant truncate';
      profileDetails.append(role, unavailableProfile);
      profile.append(profileDetails);
      row.append(profile);

      const stats = user.stats || {};
      const bookings = make('td', String(Number(stats.total_bookings) || 0));
      bookings.className = 'py-space-md px-space-md text-center font-headline-sm font-bold';
      row.append(bookings);

      const trust = make('td');
      trust.className = 'py-space-md px-space-md text-center';
      const completion = stats.completion_rate == null ? NaN : Number(stats.completion_rate);
      const trustValue = make('span', Number.isFinite(completion) ? `${completion}%` : '—');
      trustValue.className = 'font-label-md text-label-md font-bold text-primary';
      const trustLabel = make('span', 'Tỷ lệ hoàn thành');
      trustLabel.className = 'block text-[10px] text-on-surface-variant';
      trust.append(trustValue, trustLabel);
      row.append(trust);

      const joinedDate = user.created_at ? new Date(user.created_at) : null;
      const joined = make('td', joinedDate && !Number.isNaN(joinedDate.getTime())
        ? new Intl.DateTimeFormat('vi-VN', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          timeZone: 'Asia/Ho_Chi_Minh'
        }).format(joinedDate)
        : '—');
      joined.className = 'py-space-md px-space-md whitespace-nowrap text-on-surface-variant';
      row.append(joined);

      const statusCell = document.createElement('td');
      statusCell.className = 'py-space-md px-space-md whitespace-nowrap';
      const isActive = user.account_status === 'ACTIVE';
      const status = make('span', isActive ? 'Đang hoạt động' : 'Bị khóa');
      status.className = isActive
        ? 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary-fixed/40 text-on-primary-fixed-variant font-label-sm text-label-sm font-semibold'
        : 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-error-container text-on-error-container font-label-sm text-label-sm font-semibold';
      status.prepend(make('span', ''));
      status.firstElementChild.className = `w-2 h-2 rounded-full ${isActive ? 'bg-primary' : 'bg-error'}`;
      statusCell.append(status);
      row.append(statusCell);

      const actions = document.createElement('td');
      actions.className = 'py-space-md px-space-lg text-right whitespace-nowrap';
      if (String(user.id) !== currentUserId) {
        const locking = user.account_status === 'ACTIVE';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = locking
          ? 'px-3 py-1.5 rounded-xl bg-error/10 hover:bg-error text-error hover:text-on-error font-label-sm font-semibold transition-all inline-flex items-center gap-1'
          : 'px-3 py-1.5 rounded-xl bg-primary/10 hover:bg-primary text-primary hover:text-on-primary font-label-sm font-semibold transition-all inline-flex items-center gap-1';
        button.append(
          window.SportBookingIcons.createIcon(locking ? 'lock' : 'lock_open', 'h-4 w-4'),
          document.createTextNode(locking ? 'Khóa' : 'Mở khóa')
        );
        if (!locking) button.classList.add('text-primary');
        button.addEventListener('click', () => openLockDialog(user));
        actions.append(button);
      }
      row.append(actions);
      return row;
    });
    if (!rows.length) {
      const row = document.createElement('tr');
      const cell = make('td', 'Không có người dùng phù hợp.');
      cell.colSpan = 7;
      cell.className = 'py-space-lg text-center text-on-surface-variant';
      row.append(cell);
      rows.push(row);
    }
    body.replaceChildren(...rows);
    window.SportBookingIcons?.renderAll(body);
  }

  function updateMockupPagination() {
    const buttons = [...document.querySelectorAll('[data-admin-page-number]')];
    const numbered = buttons.filter((button) => button.dataset.adminPageNumber !== 'last');
    const start = Math.max(1, Math.min(applied.page - 1, pageCount - numbered.length));
    numbered.forEach((button, index) => {
      const page = start + index;
      button.dataset.adminPageNumber = String(page);
      button.hidden = page > pageCount;
      button.textContent = String(page);
      button.disabled = page > pageCount;
      const current = page === applied.page;
      button.className = current
        ? 'w-9 h-9 rounded-xl bg-primary text-on-primary font-label-sm text-label-sm font-bold flex items-center justify-center shadow-sm'
        : 'w-9 h-9 rounded-xl bg-surface-container-low text-on-surface hover:bg-surface-container-high font-label-sm text-label-sm font-semibold flex items-center justify-center';
    });
    buttons.filter((button) => button.dataset.adminPageNumber === 'last').forEach((button) => {
      button.textContent = String(pageCount);
      button.dataset.adminPageNumber = 'last';
      button.hidden = pageCount <= numbered.length;
      button.disabled = applied.page >= pageCount;
      button.className = applied.page === pageCount
        ? 'w-9 h-9 rounded-xl bg-primary text-on-primary font-label-sm text-label-sm font-bold flex items-center justify-center shadow-sm'
        : 'w-9 h-9 rounded-xl bg-surface-container-low text-on-surface hover:bg-surface-container-high font-label-sm text-label-sm font-semibold flex items-center justify-center';
    });
    const ellipsis = document.querySelector('[data-admin-page-ellipsis]');
    if (ellipsis) ellipsis.hidden = pageCount <= numbered.length + 1;
    document.querySelectorAll('[data-admin-page="previous"]').forEach((button) => {
      button.disabled = applied.page <= 1;
    });
    document.querySelectorAll('[data-admin-page="next"]').forEach((button) => {
      button.disabled = applied.page >= pageCount;
    });
  }

  async function loadUsers(isPolling = false) {
    const id = ++requestId;
    try {
      const result = await api.getUsers({ ...applied, page_size: 20 });
      if (id !== requestId) return;
      if (!Array.isArray(result.users) || !result.pagination) throw new Error('Danh sách người dùng không hợp lệ.');
      if (!result.summary
          || ['total_users', 'active_users', 'locked_users', 'new_users_this_month']
            .some((key) => !Number.isSafeInteger(Number(result.summary[key]))
              || Number(result.summary[key]) < 0)) {
        throw new Error('Số liệu tổng quan người dùng không hợp lệ.');
      }
      pageCount = Math.max(1, Number(result.pagination.total_pages) || 1);
      latestTotal = Number(result.pagination.total) || 0;
      if (applied.page > pageCount) {
        applied.page = pageCount;
        return loadUsers(isPolling);
      }
      el.summary.textContent = `Trang ${applied.page} / ${pageCount} · ${result.pagination.total} người dùng`;
      updateMockupPagination();
      el.message.textContent = 'Dữ liệu tài khoản được cập nhật tự động.';
      latestUsers = result.users;
      latestSummary = result.summary;
      renderMockupUsers(result.users, latestTotal, result.summary);
    } catch (error) {
      if (error.status === 401) window.location.replace('/dang-nhap.html');
      else if (error.status === 403) window.location.replace(state.USER_HOME);
      else if (!isPolling) el.message.textContent = 'Không thể tải danh sách người dùng.';
      if (isPolling) throw error;
    }
  }

  function openLockDialog(user) {
    selectedUser = user;
    const locking = user.account_status === 'ACTIVE';
    el.title.textContent = locking ? 'Khóa tài khoản' : 'Mở khóa tài khoản';
    document.getElementById('modal-user-id').textContent = `Mã: ${user.id}`;
    document.getElementById('modal-user-name').textContent = user.full_name;
    el.description.textContent = `Trạng thái hiện tại: ${locking ? 'Đang hoạt động' : 'Bị khóa'}`;
    el.reason.value = '';
    el.reasonField.hidden = !locking;
    el.error.hidden = true;
    el.confirm.className = locking
      ? 'px-space-lg py-2.5 rounded-xl bg-error hover:bg-on-error-container text-on-error font-label-md text-label-md font-bold transition-all shadow-md flex items-center gap-2'
      : 'px-space-lg py-2.5 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md font-bold transition-all shadow-md flex items-center gap-2';
    el.confirm.replaceChildren(
      window.SportBookingIcons.createIcon(locking ? 'lock' : 'lock_open', 'h-4 w-4'),
      document.createTextNode(locking ? 'Xác nhận khóa' : 'Xác nhận mở khóa')
    );
    el.modal.hidden = false;
    updateLockDialogState();
    if (locking) el.reason.focus();
    else el.confirm.focus();
  }

  function updateLockDialogState() {
    if (el.reasonCount) el.reasonCount.textContent = String(el.reason.value.length);
    el.confirm.disabled = !state.canSubmitLock(el.reason.value, pending);
  }

  function closeModal() {
    if (pending) return;
    el.modal.hidden = true;
    selectedUser = null;
    renderMockupUsers(latestUsers, latestTotal, latestSummary);
    polling?.refreshNow();
  }

  async function submitLock() {
    if (!selectedUser || !state.canSubmitLock(el.reason.value, pending)) return;
    pending = true;
    updateLockDialogState();
    el.error.hidden = true;
    try {
      await api.setUserLock(selectedUser.id, selectedUser.account_status === 'ACTIVE', el.reason.value.trim());
      el.modal.hidden = true;
      selectedUser = null;
      await loadUsers();
      polling?.refreshNow();
    } catch (error) {
      if (error.status === 401) window.location.replace('/dang-nhap.html');
      else if (error.status === 403) window.location.replace(state.USER_HOME);
      else {
        el.error.textContent = error.message || 'Không thể cập nhật trạng thái tài khoản.';
        el.error.hidden = false;
        if (error.status === 409) await loadUsers();
      }
    } finally {
      pending = false;
      updateLockDialogState();
    }
  }

  el.form.addEventListener('submit', (event) => {
    event.preventDefault();
    applied = { q: draft.q.trim(), status: draft.status, page: 1 };
    api.clearCache();
    loadUsers();
  });
  el.exportButton.addEventListener('click', () => exportDownload.download(
    el.exportButton,
    el.exportStatus,
    () => api.exportUsers({ q: applied.q, status: applied.status })
  ));
  const mockupSearch = document.getElementById('mockupUserSearch');
  const mockupStatus = document.getElementById('mockupUserStatusFilter');
  const mockupRole = document.getElementById('mockupUserRoleFilter');
  if (mockupRole) {
    mockupRole.disabled = true;
    mockupRole.setAttribute('aria-disabled', 'true');
    if (mockupRole.options[0]) mockupRole.options[0].textContent += ' · Sắp có';
  }
  mockupSearch?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    draft.q = mockupSearch.value;
    applied = { q: draft.q.trim(), status: draft.status, page: 1 };
    api.clearCache();
    loadUsers();
  });
  mockupStatus?.addEventListener('change', () => {
    draft.status = mockupStatus.value === 'active'
      ? 'ACTIVE'
      : mockupStatus.value === 'banned' ? 'ADMIN_LOCKED' : '';
    applied = { q: draft.q.trim(), status: draft.status, page: 1 };
    api.clearCache();
    loadUsers();
  });
  document.querySelector('[title="Làm mới bộ lọc"]')?.addEventListener('click', () => {
    draft = { q: '', status: '' };
    applied = { ...draft, page: 1 };
    if (mockupSearch) mockupSearch.value = '';
    if (mockupStatus) mockupStatus.value = '';
    api.clearCache();
    loadUsers();
  });
  document.querySelector('[data-admin-page="previous"]')?.addEventListener('click', () => {
    if (applied.page > 1) {
      applied.page -= 1;
      loadUsers();
    }
  });
  document.querySelector('[data-admin-page="next"]')?.addEventListener('click', () => {
    if (applied.page < pageCount) {
      applied.page += 1;
      loadUsers();
    }
  });
  document.querySelectorAll('[data-admin-page-number]').forEach((button) => {
  button.addEventListener('click', () => {
    const page = button.dataset.adminPageNumber === 'last'
      ? pageCount
      : Number(button.dataset.adminPageNumber);
    if (page > pageCount || page === applied.page) return;
    applied.page = page;
    loadUsers();
  });
  });
  el.search.addEventListener('input', () => { draft.q = el.search.value; });
  el.reset.addEventListener('click', () => {
    draft = { q: '', status: '' };
    applied = { ...draft, page: 1 };
    el.search.value = '';
    el.status.value = '';
    api.clearCache();
    loadUsers();
  });
  el.previous.addEventListener('click', () => {
    if (applied.page > 1) { applied.page -= 1; loadUsers(); }
  });
  el.next.addEventListener('click', () => {
    if (applied.page < pageCount) { applied.page += 1; loadUsers(); }
  });
  el.confirm.addEventListener('click', submitLock);
  el.reason.addEventListener('input', updateLockDialogState);
  document.querySelectorAll('[data-user-modal-close]').forEach((button) => {
    button.addEventListener('click', closeModal);
  });
  el.guardRetry.addEventListener('click', initialize);
  window.addEventListener('admin-data-changed', () => polling?.refreshNow());
  window.addEventListener('pagehide', () => polling?.stop(), { once: true });

  async function initialize() {
    if (!await authorize()) return;
    await loadUsers();
    polling = shell.startPolling(async ({ signal }) => {
      api.setPollingSignal(signal);
      try {
        await loadUsers(true);
      } finally {
        api.setPollingSignal(null);
      }
    }, 5000, (status) => shell.mountSyncStatus(el.message.parentElement, status));
  }
  window.SportBookingIcons?.renderAll(document);
  initialize();
})();
