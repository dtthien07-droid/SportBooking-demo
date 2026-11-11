'use strict';

const CATEGORIES = new Set(['BOOKING_HOLD', 'MATCH', 'PAYMENT', 'SYSTEM']);
const MAX_PAGE_SIZE = 50;

function notificationError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function parsePositiveInteger(value, field, fallback, maximum) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw notificationError(400, 'INVALID_REQUEST', `${field} phải là số nguyên dương.`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > maximum) {
    throw notificationError(400, 'INVALID_REQUEST', `${field} vượt giới hạn cho phép.`);
  }
  return number;
}

function parseNotificationId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,19}$/.test(value)) {
    throw notificationError(404, 'NOTIFICATION_NOT_FOUND', 'Không tìm thấy thông báo.');
  }
  try {
    if (BigInt(value) > 18446744073709551615n) {
      throw new Error('out of range');
    }
  } catch {
    throw notificationError(404, 'NOTIFICATION_NOT_FOUND', 'Không tìm thấy thông báo.');
  }
  return value;
}

function createNotificationsService(repository, { now = () => new Date() } = {}) {
  return {
    async list(user, query) {
      const category = query.category;
      if (category !== undefined && !CATEGORIES.has(category)) {
        throw notificationError(400, 'INVALID_REQUEST', 'Loại thông báo không được hỗ trợ.');
      }
      const pageSize = parsePositiveInteger(query.page_size, 'page_size', 10, MAX_PAGE_SIZE);
      const maxPage = Math.floor(Number.MAX_SAFE_INTEGER / pageSize) + 1;
      const page = parsePositiveInteger(query.page, 'page', 1, maxPage);
      const result = await repository.listForUser({
        userId: user.id,
        category: category || null,
        page,
        pageSize
      });
      return {
        notifications: result.rows.map((row) => ({
          id: String(row.id),
          category: row.category,
          title: row.title,
          body: row.body,
          resource_type: row.resource_type,
          resource_id: row.resource_id === null ? null : String(row.resource_id),
          read_at: row.read_at,
          created_at: row.created_at
        })),
        pagination: {
          page,
          page_size: pageSize,
          total: result.total,
          total_pages: Math.ceil(result.total / pageSize)
        },
        server_time: now().toISOString()
      };
    },

    countUnread(user) {
      return repository.countUnread(user.id).then((count) => ({
        count,
        server_time: now().toISOString()
      }));
    },

    async markRead(user, rawId) {
      const notification = await repository.markRead(user.id, parseNotificationId(rawId));
      if (!notification) {
        throw notificationError(404, 'NOTIFICATION_NOT_FOUND', 'Không tìm thấy thông báo.');
      }
      return {
        ...notification,
        id: String(notification.id),
        resource_id: notification.resource_id === null ? null : String(notification.resource_id)
      };
    },

    async markAllRead(user) {
      return { updated: await repository.markAllRead(user.id) };
    }
  };
}

module.exports = { createNotificationsService };
