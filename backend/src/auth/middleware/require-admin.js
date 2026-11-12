'use strict';

function createAdminError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function createRequireAdmin() {
  return function requireAdmin(request, response, next) {
    if (request.auth?.user?.role !== 'ADMIN') {
      return next(createAdminError(403, 'ADMIN_REQUIRED', 'Chỉ quản trị viên mới được phép thực hiện thao tác này.'));
    }
    return next();
  };
}

module.exports = createRequireAdmin;
