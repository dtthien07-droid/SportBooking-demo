'use strict';

(function exposeBackNav(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SportBookingBackNav = api;
}(typeof window === 'undefined' ? null : window, () => {
  const fallbackTarget = '/lich-su-dat-san.html';
  const allowedPaths = new Set([
    '/lich-su-dat-san.html',
    '/dat-san-thanh-cong.html',
    '/chi-tiet-don-dat-san.html',
    '/ve-dien-tu.html',
    '/trangchu-user.html',
    '/thanh-toan.html',
    '/tim-san.html',
    '/thong-bao.html',
    '/quan-tri.html',
    '/quan-tri-tong-quan.html',
    '/quan-tri-nguoi-dung.html',
    '/quan-tri-san.html',
    '/quan-tri-khung-gio-gia.html'
  ]);
  const labels = Object.freeze({
    '/lich-su-dat-san.html': 'Quay lại lịch sử đặt sân',
    '/dat-san-thanh-cong.html': 'Quay lại hoàn tất đặt lịch',
    '/chi-tiet-don-dat-san.html': 'Quay lại chi tiết đơn',
    '/ve-dien-tu.html': 'Quay lại vé điện tử',
    '/trangchu-user.html': 'Quay lại trang chủ',
    '/thanh-toan.html': 'Quay lại thanh toán',
    '/tim-san.html': 'Quay lại tìm sân',
    '/thong-bao.html': 'Quay lại thông báo',
    '/quan-tri.html': 'Quay lại trang quản trị',
    '/quan-tri-tong-quan.html': 'Quay lại trang tổng quan',
    '/quan-tri-nguoi-dung.html': 'Quay lại quản lý người dùng',
    '/quan-tri-san.html': 'Quay lại quản lý cơ sở và sân',
    '/quan-tri-khung-gio-gia.html': 'Quay lại quản lý khung giờ và giá'
  });

  function getAllowedPath(value) {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')
        || value.includes('\\')) {
      return null;
    }
    const path = value.split(/[?#]/, 1)[0];
    return allowedPaths.has(path) ? path : null;
  }

  function buildDetailUrl(bookingId, fromPath) {
    return `/chi-tiet-don-dat-san.html?booking_id=${encodeURIComponent(String(bookingId))}`
      + `&from=${encodeURIComponent(String(fromPath))}`;
  }

  function buildTicketUrl(bookingId, fromPath) {
    return `/ve-dien-tu.html?booking_id=${encodeURIComponent(String(bookingId))}`
      + `&from=${encodeURIComponent(String(fromPath))}`;
  }

  function resolveBackTarget(search, referrer, currentOrigin) {
    const from = new URLSearchParams(search).get('from');
    if (getAllowedPath(from)) return from;

    if (typeof currentOrigin === 'string' && currentOrigin) {
      try {
        const origin = new URL(currentOrigin).origin;
        const referrerUrl = new URL(referrer);
        const path = getAllowedPath(`${referrerUrl.pathname}${referrerUrl.search}${referrerUrl.hash}`);
        if (referrerUrl.origin === origin && path) {
          return `${referrerUrl.pathname}${referrerUrl.search}${referrerUrl.hash}`;
        }
      } catch {
        // Invalid or absent referrers use the safe fallback.
      }
    }
    return fallbackTarget;
  }

  function backLabel(target) {
    const path = typeof target === 'string' ? target.split(/[?#]/, 1)[0] : '';
    return labels[path] || labels[fallbackTarget];
  }

  return { buildDetailUrl, buildTicketUrl, resolveBackTarget, backLabel };
}));
