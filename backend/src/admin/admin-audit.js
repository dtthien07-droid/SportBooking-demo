'use strict';

async function writeAudit(connection, {
  adminUserId,
  action,
  resourceType,
  resourceId,
  details = null
}) {
  if (!connection || typeof connection.execute !== 'function'
      || !/^[1-9]\d*$/.test(String(adminUserId))
      || typeof action !== 'string' || action.length === 0 || action.length > 80
      || typeof resourceType !== 'string' || resourceType.length === 0
      || resourceType.length > 40 || !/^[1-9]\d*$/.test(String(resourceId))) {
    throw new TypeError('Thông tin ghi nhật ký quản trị không hợp lệ.');
  }
  const serializedDetails = details === null ? null : JSON.stringify(details);
  if (serializedDetails !== null && typeof serializedDetails !== 'string') {
    throw new TypeError('Chi tiết nhật ký quản trị không thể mã hóa.');
  }
  await connection.execute(
    `INSERT INTO admin_audit_logs
       (admin_user_id, action, resource_type, resource_id, details, created_at)
     VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
    [adminUserId, action, resourceType, resourceId, serializedDetails]
  );
}

module.exports = { writeAudit };
