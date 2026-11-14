'use strict';

(function exposeHeaderState(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SportBookingHeaderState = api;
}(typeof window === 'undefined' ? null : window, () => {
  // These pages do not show the pending-hold bar; unauthenticated pages have no rendered header.
  const HIDDEN_PENDING_BANNER_PATHS = Object.freeze([
    '/thanh-toan.html',
    '/dang-nhap.html',
    '/dang-ky.html',
    '/quan-tri.html',
    '/quan-tri-tong-quan.html',
    '/quan-tri-nguoi-dung.html',
    '/quan-tri-san.html',
    '/quan-tri-khung-gio-gia.html'
  ]);

  function shouldShowPendingBanner(pathname, authenticated) {
    return Boolean(authenticated)
      && !HIDDEN_PENDING_BANNER_PATHS.includes(String(pathname || ''));
  }

  function shouldShowNavigation(role) {
    return role !== 'ADMIN';
  }

  function mergeVenueNames(facilityName, courtName) {
    const facility = String(facilityName || '').trim().replace(/\s+/g, ' ');
    const court = String(courtName || '').trim().replace(/\s+/g, ' ');
    if (!facility) return court;
    if (!court || facility.toLocaleLowerCase('vi') === court.toLocaleLowerCase('vi')) {
      return facility;
    }
    return `${facility} — ${court}`;
  }

  function subscribePendingBookingChanged(target, refreshPending, refreshNotifications) {
    if (!target || typeof target.addEventListener !== 'function'
        || typeof refreshPending !== 'function'
        || typeof refreshNotifications !== 'function') {
      throw new TypeError('A window event target and refresh callbacks are required.');
    }
    const listener = () => {
      refreshPending();
      refreshNotifications();
    };
    target.addEventListener('pending-booking-changed', listener);
    return () => target.removeEventListener('pending-booking-changed', listener);
  }

  return {
    HIDDEN_PENDING_BANNER_PATHS,
    mergeVenueNames,
    shouldShowNavigation,
    shouldShowPendingBanner,
    subscribePendingBookingChanged
  };
}));
