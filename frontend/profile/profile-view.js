'use strict';

(() => {
  const headerReady = window.SportBookingHeaderReady;
  if (!headerReady || typeof headerReady.then !== 'function') {
    throw new Error('Không thể tải thông tin tài khoản.');
  }

  headerReady.then((user) => {
    if (!user) return;

    const fullName = typeof user.fullName === 'string' ? user.fullName.trim() : '';
    const phone = typeof user.phone === 'string' && user.phone.trim()
      ? user.phone.trim()
      : 'Chưa cập nhật';
    const email = typeof user.email === 'string' && user.email.trim()
      ? user.email.trim()
      : 'Chưa cập nhật';
    const initial = Array.from(fullName)[0] || '';
    const avatar = document.querySelector('[data-profile-summary-avatar]');
    const name = document.querySelector('[data-profile-summary-name]');
    const phoneText = document.querySelector('[data-profile-summary-phone]');
    const emailText = document.querySelector('[data-profile-summary-email]');

    if (avatar) avatar.textContent = initial.toLocaleUpperCase('vi');
    if (name) name.textContent = fullName;
    if (phoneText) phoneText.textContent = phone;
    if (emailText) emailText.textContent = email;
  });
})();
