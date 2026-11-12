'use strict';

async function insertNotification(connection, {
  userId,
  category,
  title,
  body,
  booking
}) {
  await connection.execute(
    `INSERT INTO notifications
       (user_id, category, title, body, resource_type, resource_id, created_at)
     VALUES (?, ?, ?, ?, 'BOOKING', ?, UTC_TIMESTAMP(3))`,
    [userId, category, title, body, booking.id]
  );
}

function formatAmount(value) {
  return `${BigInt(String(value)).toLocaleString('vi-VN')} đ`;
}

function formatDate(value) {
  const [year, month, day] = String(value || '').slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : '';
}

function bookingDetails(booking) {
  const slots = Array.isArray(booking.slots) ? [...booking.slots] : [];
  slots.sort((left, right) => (
    String(left.service_date).localeCompare(String(right.service_date))
    || String(left.starts_at).localeCompare(String(right.starts_at))
  ));
  const first = slots[0];
  const last = slots[slots.length - 1];
  const venue = [first && first.facility_name, first && first.court_name]
    .filter(Boolean)
    .join(' — ');
  const date = first ? formatDate(first.service_date) : '';
  const time = first && last
    ? `${String(first.starts_at).slice(0, 5)}–${String(last.ends_at).slice(0, 5)}`
    : '';
  return [venue, date, time, booking.booking_code]
    .filter(Boolean)
    .join(', ');
}

async function notifyPaymentSucceeded(connection, booking, payment) {
  const details = bookingDetails(booking);
  const option = payment.payment_option === 'DEPOSIT_50' ? 'đặt cọc 50%' : 'thanh toán toàn bộ';
  await insertNotification(connection, {
    userId: booking.user_id,
    category: 'PAYMENT',
    title: 'Thanh toán thành công',
    body: `Đã trả ${formatAmount(payment.paid_amount)} (${option}); còn thu tại sân ${formatAmount(payment.amount_due_at_venue)}. ${details}.`,
    booking
  });
  await insertNotification(connection, {
    userId: booking.user_id,
    category: 'BOOKING_HOLD',
    title: 'Đặt sân thành công',
    body: `${details}. Đơn đã được xác nhận.`,
    booking
  });
}

async function notifyHoldExpired(connection, booking) {
  await insertNotification(connection, {
    userId: booking.user_id,
    category: 'BOOKING_HOLD',
    title: 'Giữ chỗ đã hết hạn, khung giờ được nhả',
    body: `${bookingDetails(booking)}. Khung giờ đã được nhả.`,
    booking
  });
}

async function notifyUserCancellation(connection, booking, refundedAmount) {
  const details = bookingDetails(booking);
  const refunded = BigInt(String(refundedAmount)) > 0n;
  await insertNotification(connection, {
    userId: booking.user_id,
    category: 'BOOKING_HOLD',
    title: `Đã hủy đơn ${booking.booking_code}`,
    body: refunded
      ? `${details}. Đơn đã hủy.`
      : `${details}. Đơn đã hủy. Không có khoản hoàn theo chính sách hủy.`,
    booking
  });
  if (refunded) {
    await insertNotification(connection, {
      userId: booking.user_id,
      category: 'PAYMENT',
      title: `Hoàn tiền ${formatAmount(refundedAmount)}`,
      body: `Đã hoàn ${formatAmount(refundedAmount)} cho ${details}.`,
      booking
    });
  }
}

async function notifyIncidentCancellation(connection, booking, refundedAmount) {
  const amount = formatAmount(refundedAmount);
  const details = bookingDetails(booking);
  await insertNotification(connection, {
    userId: booking.user_id,
    category: 'BOOKING_HOLD',
    title: `Sân gặp sự cố, đơn ${booking.booking_code} bị hủy`,
    body: `${details}. Đơn bị hủy do sự cố.`,
    booking
  });
  await insertNotification(connection, {
    userId: booking.user_id,
    category: 'PAYMENT',
    title: `Hoàn 100% số đã trả: ${amount}`,
    body: `Đã hoàn 100% số đã trả (${amount}) cho ${details}.`,
    booking
  });
}

module.exports = {
  notifyHoldExpired,
  notifyIncidentCancellation,
  notifyPaymentSucceeded,
  notifyUserCancellation
};
