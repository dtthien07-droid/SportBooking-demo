'use strict';

const express = require('express');
const path = require('node:path');
const passwordHelper = require('./auth/password.helper');
const { createAuthService } = require('./auth/auth.service');
const { createProfileService } = require('./auth/profile.service');
const createFacilitiesRepository = require('./facilities/facilities.repository');
const { createFacilitiesService } = require('./facilities/facilities.service');
const createFacilitiesRouter = require('./facilities/facilities.routes');
const createSessionRouter = require('./auth/routes/auth.routes');
const createProfileRouter = require('./auth/routes/profile.routes');
const createRequireAuth = require('./auth/middleware/require-auth');
const createBookingRepository = require('./bookings/bookings.repository');
const { createBookingsService } = require('./bookings/bookings.service');
const createBookingsRouter = require('./bookings/bookings.routes');
const createAdminRepository = require('./admin/admin.repository');
const { createAdminService } = require('./admin/admin.service');
const { createAdminFacilitiesService } = require('./admin/facilities.service');
const { createAdminSlotsService } = require('./admin/slots.service');
const createAdminRouter = require('./admin/admin.routes');
const { writeAudit } = require('./admin/admin-audit');
const createRequireAdmin = require('./auth/middleware/require-admin');
const { createNotificationsRepository } = require('./notifications/notifications.repository');
const { createNotificationsService } = require('./notifications/notifications.service');
const createNotificationsRouter = require('./notifications/notifications.routes');
const {
  notifyIncidentCancellation,
  notifyPendingIncidentCancellation
} = require('./notifications/notification-events');
const { getCookieName, getSecureCookieSetting } = require('./auth/session.cookie');
const { createSessionService } = require('./auth/session.service');
const createSessionRepository = require('./auth/repositories/session.repository');
const createUserRepository = require('./auth/repositories/user.repository');
const healthRouter = require('./routes/health.routes');

function sendError(response, status, code, message, details = {}) {
  response.status(status).json({ error: { code, message, details } });
}

function createApp({ pool, env = process.env } = {}) {
  if (!pool || typeof pool.execute !== 'function') {
    throw new TypeError('A MySQL-compatible pool is required.');
  }

  const userRepository = createUserRepository(pool);
  const facilitiesRepository = createFacilitiesRepository(pool);
  const sessionRepository = createSessionRepository(pool);
  const authService = createAuthService({ userRepository });
  const profileService = createProfileService({ userRepository, passwords: passwordHelper });
  const facilitiesService = createFacilitiesService(facilitiesRepository);
  const bookingsRepository = createBookingRepository(pool);
  const bookingsService = createBookingsService(bookingsRepository);
  const adminRepository = createAdminRepository(pool);
  const adminFacilitiesService = createAdminFacilitiesService(pool);
  const adminSlotsService = createAdminSlotsService(pool);
  const adminService = createAdminService({
    adminRepository,
    bookingsRepository,
    notifyIncidentCancellation,
    notifyPendingIncidentCancellation,
    writeAudit
  });
  const notificationsRepository = createNotificationsRepository(pool);
  const notificationsService = createNotificationsService(notificationsRepository);
  const sessionService = createSessionService({ sessionRepository });
  const cookieName = getCookieName(env);
  const secureCookie = getSecureCookieSetting(env);
  const requireAuth = createRequireAuth({ sessionRepository, cookieName, secureCookie });
  const requireAdmin = createRequireAdmin();
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.use((request, response, next) => {
    response.locals.sessionCookieSecure = secureCookie || request.secure === true;
    next();
  });
  app.use(healthRouter);
  app.use('/api/v1/auth', createSessionRouter({
    authService,
    sessionService,
    sessionRepository,
    requireAuth,
    cookieName
  }));
  app.use('/api/v1/users', createProfileRouter({ profileService, requireAuth }));
  app.use('/api/v1/notifications', createNotificationsRouter({ notificationsService, requireAuth }));
  app.use('/api/v1/bookings', createBookingsRouter({ bookingsService, requireAuth }));
  app.use('/api/v1/admin', createAdminRouter({
    adminService,
    adminFacilitiesService,
    adminSlotsService,
    requireAuth,
    requireAdmin
  }));
  app.use('/api/v1', createFacilitiesRouter({ facilitiesService, requireAuth }));
  app.get('/', (request, response) => {
    response.redirect(302, '/dang-nhap.html');
  });
  app.use(express.static(path.resolve(__dirname, '../../frontend'), { index: false }));

  app.use((request, response) => {
    sendError(response, 404, 'NOT_FOUND', 'The requested resource was not found.');
  });

  app.use((error, request, response, next) => {
    if (response.headersSent) {
      return next(error);
    }
    if (error.type === 'entity.parse.failed') {
      return sendError(response, 400, 'INVALID_JSON', 'Request body must be valid JSON.');
    }
    if (error.type === 'entity.too.large') {
      return sendError(response, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
    }
    if (Number.isInteger(error.status) && error.status >= 400 && error.status < 500) {
      return sendError(
        response,
        error.status,
        error.code || 'REQUEST_ERROR',
        error.message || 'The request could not be completed.',
        error.details || {}
      );
    }
    return sendError(response, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  });

  app.locals.bookingsService = bookingsService;
  return app;
}

module.exports = { createApp };
