'use strict';

(() => {
  const query = new URLSearchParams(window.location.search);
  const bookingId = query.get('booking_id') || query.get('id');
  const main = document.querySelector('main');
  const outsideMessage = document.createElement('p');
  outsideMessage.className = 'max-w-[1280px] mx-auto mt-24 px-margin text-sm';
  outsideMessage.setAttribute('role', 'status');
  document.querySelector('[data-shared-header]')?.after(outsideMessage);
  const money = (value) => `${Number(value || 0).toLocaleString('vi-VN')}đ`;
  const setText = (selector, value) => { const node = document.querySelector(selector); if (node) node.textContent = value || '—'; };
  const dateText = (value) => {
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return Number.isNaN(date.valueOf()) ? String(value || '') : date.toLocaleDateString('vi-VN');
  };
  const timeText = (value) => {
    if (!value) return '';
    const date = new Date(String(value).includes('T') ? value : `1970-01-01T${value}`);
    return Number.isNaN(date.valueOf()) ? String(value).slice(0, 5) : date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  function renderQr(bookingCode) {
    const icon = [...document.querySelectorAll('main .material-symbols-outlined')].find((node) => node.textContent.trim() === 'qr_code_2');
    const container = document.getElementById('bookingQr') || icon?.closest('div');
    if (!container || !bookingCode) return;
    container.innerHTML = window.SportBookingQRCode.toSvg(bookingCode);
    const svg = container.querySelector('svg');
    if (svg) { svg.style.width = '100%'; svg.style.height = '100%'; }
  }
  function ensureTicketDetails() {
    if (document.getElementById('bookingIdText') && document.getElementById('displayBookerPhone')) return;
    const mount = document.querySelector('main h2')
      || document.querySelector('[data-booking-stepper]');

    const details = document.createElement('div');
    details.className = 'mt-2 flex flex-col gap-1 text-xs text-on-surface-variant';
    const codeLine = document.createElement('p');
    codeLine.append('Mã đơn: ');
    const code = document.createElement('span');
    code.id = 'bookingIdText';
    codeLine.append(code);
    const phoneLine = document.createElement('p');
    phoneLine.append('Số điện thoại: ');
    const phone = document.createElement('span');
    phone.id = 'displayBookerPhone';
    phoneLine.append(phone);
    details.append(codeLine, phoneLine);
    if (mount) mount.after(details);
    else main.append(details);
  }
  function renderBooking(booking, payments) {
    if (booking.status !== 'CONFIRMED') {
      outsideMessage.textContent = 'Đơn chưa được xác nhận; vé sẽ hiển thị sau khi thanh toán thành công.';
      return;
    }
    window.SportBookingStepper.render(
      document.querySelector('[data-booking-stepper]'),
      3
    );
    main.hidden = false;
    ensureTicketDetails();
    outsideMessage.hidden = true;
    const slots = booking.slots || [];
    document.querySelectorAll('main p').forEach((paragraph) => {
      if (/12\s*tiếng|100%/i.test(paragraph.textContent)) {
        paragraph.textContent = 'Thông tin hủy và hoàn tiền được áp dụng theo chính sách của đơn đặt sân.';
      }
    });
    const first = slots[0] || {};
    const code = booking.booking_code || '';
    setText('#bookingIdText', window.SportBookingFormat.formatBookingCode(code));
    setText('#ticketFacilityName', first.facility_name);
    setText('main h2', first.facility_name);
    setText('#ticketCourtName', [...new Set(slots.map((item) => item.court_name).filter(Boolean))].join(', '));
    const courtLine = document.querySelector('main p.text-sm.font-bold.text-on-surface.mt-1');
    if (courtLine) courtLine.textContent = [...new Set(slots.map((item) => item.court_name).filter(Boolean))].join(', ') || '—';
    setText('#displayMatchSlot', slots.map((item) => `${timeText(item.starts_at)} - ${timeText(item.ends_at)}`).join(', '));
    setText('#displayMatchDate', dateText(first.service_date));
    const days = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
    const day = new Date(`${String(first.service_date).slice(0, 10)}T00:00:00`).getDay();
    setText('#displayMatchDayOfWeek', days[day] || '');
    setText('#displayBookerName', '');
    const paid = booking.payment?.paid_amount || '0';
    const due = booking.amount_due_at_venue || '0';
    const amountColumn = [...document.querySelectorAll('main div')].find((node) => node.classList.contains('md:col-span-8') && node.parentElement?.classList.contains('md:grid-cols-12'));
    const totals = amountColumn ? [...amountColumn.children].map((row) => row.querySelector('span:last-child')).filter(Boolean) : [];
    [booking.total_amount, paid, due].forEach((value, index) => { if (totals[index]) totals[index].textContent = money(value); });
    renderQr(code);
    const map = document.getElementById('ticketMapLink');
    const phone = document.getElementById('ticketHotline');
    const parkingIcon = [...document.querySelectorAll('main .material-symbols-outlined')].find((node) => node.textContent.trim() === 'local_parking');
    if (parkingIcon?.parentElement?.parentElement) parkingIcon.parentElement.parentElement.hidden = true;
    window.SportBookingApi.getFacility(first.facility_id).then((result) => {
      const facility = result?.facility || result;
      setText('#ticketFacilityName', facility?.name || first.facility_name);
      setText('main h2', facility?.name || first.facility_name);
      const address = facility?.address || '';
      const addressLabel = [...document.querySelectorAll('main span')].find((node) => node.textContent.includes('35 Ph'));
      if (addressLabel) addressLabel.textContent = address;
      if (map) map.href = facility?.map_url || `https://maps.google.com/?q=${encodeURIComponent(address || facility?.name || '')}`;
      if (phone && facility?.hotline) { phone.href = `tel:${facility.hotline}`; phone.textContent = facility.hotline; }
    }).catch(() => {});
    const matchLink = [...document.querySelectorAll('main a')].find((link) => link.getAttribute('href') === 'tim-doi-choi.html');
    if (matchLink) { matchLink.removeAttribute('href'); matchLink.setAttribute('aria-disabled', 'true'); matchLink.querySelector('span:last-child').textContent = 'Tìm đối — Sắp có'; }
    const historyLink = [...document.querySelectorAll('main a')].find((link) => link.getAttribute('href') === 'lich-su-dat-san.html');
    const actions = historyLink?.parentElement;
    if (actions && !document.getElementById('ticketCancelDisabled')) {
      const cancel = document.createElement('button');
      cancel.id = 'ticketCancelDisabled'; cancel.type = 'button'; cancel.disabled = true; cancel.textContent = 'Hủy đơn (Sắp có)';
      cancel.className = 'h-12 px-space-md rounded-xl bg-surface-container text-on-surface-variant font-semibold text-xs border cursor-not-allowed opacity-60';
      actions.append(cancel);
    }
    const copy = document.getElementById('copyBtn');
    if (copy) copy.addEventListener('click', async () => { await navigator.clipboard?.writeText(code); setText('#copyFeedback', 'Đã chép!'); });
    if (payments?.ticket?.qr_code) document.body.dataset.ticketCode = payments.ticket.qr_code;
    window.SportBookingApi.getCurrentUser().then((result) => {
      const user = result?.user || result;
      setText('#displayBookerName', user?.fullName || user?.full_name || user?.name);
      setText('#displayBookerPhone', window.SportBookingFormat.maskPhone(user?.phone));
      setText('#displayNotificationEmail', user?.email);
    }).catch(() => {});
  }

  if (!bookingId) { outsideMessage.textContent = 'Thiếu mã đơn đặt sân.'; return; }
  window.SportBookingApi.getBooking(bookingId).then(async (booking) => {
    if (!booking) return;
    const payments = await window.SportBookingApi.getPayments(bookingId);
    renderBooking(booking, payments);
  }).catch((error) => { if (error.status !== 401) outsideMessage.textContent = error.status === 404 ? 'Không tìm thấy đơn đặt sân.' : 'Không thể tải vé đặt sân.'; });
})();
