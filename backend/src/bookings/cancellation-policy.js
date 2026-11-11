'use strict';

const REFUND_MESSAGES = Object.freeze({
  full: 'Còn từ 24 giờ trở lên trước giờ bắt đầu: hoàn 100% số tiền đã thanh toán.',
  half: 'Còn từ 6 giờ đến dưới 24 giờ trước giờ bắt đầu: hoàn 50% số tiền đã thanh toán.',
  none: 'Còn dưới 6 giờ trước giờ bắt đầu: không hoàn tiền.',
  unpaid: 'Đơn chưa thanh toán nên không phát sinh hoàn tiền.'
});

function slotStartTimestamp(slot) {
  const date = String(slot?.service_date || '');
  const time = String(slot?.starts_at || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}:\d{2}$/.test(time)) {
    throw new TypeError('Thời điểm bắt đầu khung giờ không hợp lệ.');
  }
  const timestamp = Date.parse(`${date}T${time}+07:00`);
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('Thời điểm bắt đầu khung giờ không hợp lệ.');
  }
  return timestamp;
}

function slotEndTimestamp(slot) {
  const date = String(slot?.service_date || '');
  const time = String(slot?.ends_at || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}:\d{2}$/.test(time)) {
    throw new TypeError('Thời điểm kết thúc khung giờ không hợp lệ.');
  }
  const isEndOfDay = time === '24:00:00';
  const timestamp = Date.parse(`${date}T${isEndOfDay ? '00:00:00' : time}+07:00`)
    + (isEndOfDay ? 24 * 60 * 60 * 1000 : 0);
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('Thời điểm kết thúc khung giờ không hợp lệ.');
  }
  return timestamp;
}

function getCancellationRefund({ firstSlot, paidAmount, now }) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Thời điểm hiện tại không hợp lệ.');
  }
  if (!/^(0|[1-9]\d*)$/.test(String(paidAmount))) {
    throw new TypeError('Số tiền đã thanh toán không hợp lệ.');
  }

  const hoursUntilStartExact = (slotStartTimestamp(firstSlot) - now.getTime()) / 3_600_000;
  const refundPercent = hoursUntilStartExact >= 24 ? 100 : hoursUntilStartExact >= 6 ? 50 : 0;
  const paid = BigInt(String(paidAmount));
  const refundAmount = refundPercent === 100
    ? paid
    : refundPercent === 50 ? paid / 2n : 0n;
  const message = refundPercent === 100
    ? REFUND_MESSAGES.full
    : refundPercent === 50 ? REFUND_MESSAGES.half : REFUND_MESSAGES.none;

  return {
    refund_percent: refundPercent,
    refund_amount: refundAmount.toString(),
    paid_amount: paid.toString(),
    hours_until_start: Number(hoursUntilStartExact.toFixed(2)),
    message
  };
}

module.exports = {
  REFUND_MESSAGES,
  getCancellationRefund,
  slotEndTimestamp,
  slotStartTimestamp
};
