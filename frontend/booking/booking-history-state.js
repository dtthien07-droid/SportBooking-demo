'use strict';

(function exposeBookingHistoryState(root, factory) {
  const backNav = typeof module === 'object' && module.exports
    ? require('../shared/back-nav.js')
    : root?.SportBookingBackNav;
  const api = factory(backNav);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SportBookingHistoryState = api;
}(typeof window === 'undefined' ? null : window, (backNav) => {
  if (!backNav) throw new Error('Thiếu tiện ích điều hướng quay lại.');

  const displayStatuses = new Set([
    'PENDING',
    'EXPIRED',
    'UPCOMING',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED'
  ]);
  const displayStatusLabels = Object.freeze({
    PENDING: 'Chờ thanh toán',
    EXPIRED: 'Hết hạn',
    UPCOMING: 'Sắp tới',
    IN_PROGRESS: 'Đang trong trận',
    COMPLETED: 'Hoàn thành',
    CANCELLED: 'Đã hủy'
  });

  function getBookingStatusLabel(code) {
    if (!displayStatuses.has(code)) {
      throw new TypeError('Trạng thái hiển thị của đơn đặt sân không hợp lệ.');
    }
    return displayStatusLabels[code];
  }

  function canCancelBooking(booking) {
    return Boolean(booking && (
      (booking.status === 'CONFIRMED' && booking.display_status_code === 'UPCOMING')
      || (booking.status === 'PENDING' && booking.display_status_code === 'PENDING')
    ));
  }

  function formatStartCountdown(seconds) {
    const remaining = Number(seconds);
    if (!Number.isFinite(remaining)) {
      throw new TypeError('Thời gian đến giờ thi đấu không hợp lệ.');
    }
    if (remaining <= 0) return 'Đã bắt đầu';
    const safeSeconds = Math.floor(remaining);
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const secondsPart = safeSeconds % 60;
    if (hours > 0) return `${hours} giờ ${minutes} phút ${secondsPart} giây`;
    if (minutes > 0) return `${minutes} phút ${secondsPart} giây`;
    return `${secondsPart} giây`;
  }

  function getRefundPercentBySeconds(seconds) {
    const remaining = Number(seconds);
    if (!Number.isFinite(remaining)) {
      throw new TypeError('Thời gian đến giờ thi đấu không hợp lệ.');
    }
    if (remaining >= 24 * 60 * 60) return 100;
    if (remaining >= 6 * 60 * 60) return 50;
    return 0;
  }

  function getCancelConfirmationLabel(refundAmount, isPending = false) {
    if (isPending) return 'Xác nhận hủy đơn';
    const amount = String(refundAmount);
    if (!/^(0|[1-9]\d*)$/.test(amount)) {
      throw new TypeError('Số tiền hoàn trong thông tin hủy không hợp lệ.');
    }
    if (BigInt(amount) === 0n) return 'Xác nhận hủy (không hoàn tiền)';
    return `Xác nhận hủy & hoàn ${new Intl.NumberFormat('vi-VN').format(BigInt(amount))} đ`;
  }

  function getCancellationSuccessMessage(bookingCode, refundedAmount, bookingStatus) {
    const code = String(bookingCode || '').trim();
    if (!code) throw new TypeError('Mã đơn đặt sân không hợp lệ.');
    if (bookingStatus === 'PENDING') return `Đã hủy đơn ${code}.`;
    const amount = String(refundedAmount);
    if (!/^(0|[1-9]\d*)$/.test(amount)) {
      throw new TypeError('Số tiền hoàn trong kết quả hủy không hợp lệ.');
    }
    if (BigInt(amount) === 0n) {
      return `Đã hủy đơn ${code}. Không có khoản hoàn theo chính sách hủy.`;
    }
    return `Đã hủy đơn ${code}. Hoàn ${new Intl.NumberFormat('vi-VN').format(BigInt(amount))} đ về phương thức thanh toán.`;
  }

  function getBookingPresentation(booking, fromPath = '/lich-su-dat-san.html') {
    if (!booking || !displayStatuses.has(booking.display_status_code)) {
      throw new TypeError('Trạng thái hiển thị của đơn đặt sân không hợp lệ.');
    }

    const bookingId = String(booking.booking_id || '');
    if (!/^[1-9]\d*$/.test(bookingId)) {
      throw new TypeError('Mã đơn đặt sân không hợp lệ.');
    }

    let action;
    let href;
    if (booking.status === 'PENDING' && booking.display_status_code === 'PENDING') {
      action = 'continue-payment';
      href = `/thanh-toan.html?booking_id=${encodeURIComponent(bookingId)}`;
    } else if (booking.status === 'CONFIRMED') {
      action = 'view-ticket';
      href = backNav.buildTicketUrl(bookingId, fromPath);
    } else {
      action = 'view-details';
      href = backNav.buildDetailUrl(bookingId, fromPath);
    }

    const remainingSeconds = booking.remaining_seconds == null
      ? Number.NaN
      : Number(booking.remaining_seconds);
    if (booking.status === 'PENDING' && booking.display_status_code === 'PENDING'
        && !Number.isFinite(remainingSeconds)) {
      throw new TypeError('Đơn chờ thanh toán thiếu thời gian còn lại.');
    }
    return {
      label: getBookingStatusLabel(booking.display_status_code),
      action,
      href,
      remainingSeconds: booking.status === 'PENDING'
        && booking.display_status_code === 'PENDING'
        && Number.isFinite(remainingSeconds)
        ? Math.max(0, Math.floor(remainingSeconds))
        : null,
      showQr: false,
      showStepper: false
    };
  }

  function getBookingErrorAction(status) {
    if (status === 401) return 'login';
    if (status === 404) return 'not-found';
    return 'retry';
  }

  function getBookingErrorView(status) {
    if (status === 401) {
      return { action: 'login', title: '', message: '', showRetry: false };
    }
    if (status === 404) {
      return { action: 'not-found', title: 'Không tìm thấy đơn', message: '', showRetry: false };
    }
    return {
      action: 'retry',
      title: 'Không thể tải đơn đặt sân',
      message: 'Vui lòng thử lại.',
      showRetry: true
    };
  }

  function formatCountdown(seconds) {
    const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(safeSeconds / 60);
    const remainder = safeSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  }

  function getBookingSummaryPresentation(summary) {
    if (!summary || typeof summary !== 'object' || !summary.counts_by_status) {
      throw new TypeError('Số liệu tóm tắt lịch sử đặt sân không hợp lệ.');
    }
    const labels = {
      pending: 'Chờ thanh toán',
      active: 'Sắp tới/Đang trong trận',
      completed: 'Hoàn thành',
      cancelled: 'Đã hủy',
      expired: 'Hết hạn'
    };
    const counts = {};
    for (const [key, label] of Object.entries(labels)) {
      const value = Number(summary.counts_by_status[label]);
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError('Số lượng trạng thái trong lịch sử đặt sân không hợp lệ.');
      }
      counts[key] = value;
    }
    if (!/^-?(0|[1-9]\d*)$/.test(String(summary.total_spent))) {
      throw new TypeError('Tổng chi phí trong lịch sử đặt sân không hợp lệ.');
    }
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    return {
      upcomingCount: String(summaryCount(summary.upcoming_count)),
      completedCount: String(summaryCount(summary.completed_count)),
      totalSpent: `${new Intl.NumberFormat('vi-VN').format(BigInt(summary.total_spent))} đ`,
      counts: {
        all: String(total),
        upcoming: String(counts.active),
        'payment-pending': String(counts.pending),
        completed: String(counts.completed),
        cancelled: String(counts.cancelled),
        expired: String(counts.expired)
      }
    };
  }

  function summaryCount(value) {
    const count = Number(value);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new TypeError('Số liệu tóm tắt lịch sử đặt sân không hợp lệ.');
    }
    return count;
  }

  return {
    formatCountdown,
    getBookingSummaryPresentation,
    getBookingStatusLabel,
    getBookingErrorAction,
    getBookingErrorView,
    getBookingPresentation,
    canCancelBooking,
    formatStartCountdown,
    getRefundPercentBySeconds,
    getCancelConfirmationLabel,
    getCancellationSuccessMessage
  };
}));
