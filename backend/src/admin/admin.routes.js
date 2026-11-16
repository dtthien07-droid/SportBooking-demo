'use strict';

const express = require('express');
const { createAdminEtagMiddleware } = require('./admin-etag');

function lockReason(body) {
  if (body === undefined) return '';
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((key) => key !== 'reason')
      || (body.reason !== undefined && typeof body.reason !== 'string')
      || (body.reason || '').trim().length > 300) {
    const error = new Error('Lý do khóa không được vượt quá 300 ký tự.');
    error.status = 400;
    error.code = 'INVALID_LOCK_REASON';
    throw error;
  }
  return body.reason || '';
}

function sendSpreadsheet(response, result) {
  response
    .set('Cache-Control', 'no-store')
    .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .set('Content-Disposition', `attachment; filename="${result.filename}"`)
    .send(result.buffer);
}

function createAdminRouter({
  adminService,
  adminFacilitiesService,
  adminSlotsService,
  requireAuth,
  requireAdmin
}) {
  const router = express.Router();
  const adminEtag = createAdminEtagMiddleware();
  router.use((request, response, next) => {
    response.set('Cache-Control', request.method === 'GET' ? 'no-cache' : 'no-store');
    next();
  });

  router.get('/users', requireAuth, requireAdmin, adminEtag, async (request, response) => {
    response.json(await adminService.listUsers(request.query));
  });

  router.get('/users/export', requireAuth, requireAdmin, async (request, response) => {
    sendSpreadsheet(response, await adminService.exportUsers(
      request.query,
      request.auth.user.id
    ));
  });

  router.patch('/users/:id/lock', requireAuth, requireAdmin, async (request, response) => {
    response.json(await adminService.setUserLock(
      request.params.id,
      true,
      request.auth.user.id,
      lockReason(request.body)
    ));
  });

  router.patch('/users/:id/unlock', requireAuth, requireAdmin, async (request, response) => {
    response.json(await adminService.setUserLock(
      request.params.id,
      false,
      request.auth.user.id,
      lockReason(request.body)
    ));
  });

  router.get('/facilities', requireAuth, requireAdmin, adminEtag, async (request, response) => {
    response.json(await adminFacilitiesService.listFacilities(request.query));
  });

  router.get('/facilities/export', requireAuth, requireAdmin, async (request, response) => {
    sendSpreadsheet(response, await adminFacilitiesService.exportFacilities(
      request.query,
      request.auth.user.id
    ));
  });

  router.get('/facilities/:id', requireAuth, requireAdmin, adminEtag, async (request, response) => {
    response.json(await adminFacilitiesService.getFacility(request.params.id));
  });

  router.post('/facilities', requireAuth, requireAdmin, async (request, response) => {
    response.status(201).json(await adminFacilitiesService.createFacility(
      request.body,
      request.auth.user.id
    ));
  });

  router.patch('/facilities/:id', requireAuth, requireAdmin, async (request, response) => {
    response.json(await adminFacilitiesService.updateFacility(
      request.params.id,
      request.body,
      request.auth.user.id
    ));
  });

  router.delete('/facilities/:id', requireAuth, requireAdmin, async (request, response) => {
    response.json(await adminFacilitiesService.deleteFacility(
      request.params.id,
      request.body,
      request.auth.user.id
    ));
  });

  router.post('/courts', requireAuth, requireAdmin, async (request, response) => {
    response.status(201).json(await adminFacilitiesService.createCourt(
      request.body,
      request.auth.user.id
    ));
  });

  router.get(
    '/courts/:id/time-slots/summary',
    requireAuth,
    requireAdmin,
    adminEtag,
    async (request, response) => {
      response.json(await adminSlotsService.getMonthlySummary(
        request.params.id,
        request.query.month
      ));
    }
  );

  router.get(
    '/courts/:id/time-slots/export',
    requireAuth,
    requireAdmin,
    async (request, response) => {
      sendSpreadsheet(response, await adminSlotsService.exportTimeSlots(
        request.params.id,
        request.query.from,
        request.query.to,
        request.auth.user.id
      ));
    }
  );

  router.get('/courts/:id/time-slots', requireAuth, requireAdmin, adminEtag, async (request, response) => {
    response.json(await adminSlotsService.listTimeSlots(
      request.params.id,
      request.query.date,
      request.query.from_date,
      request.query.from,
      request.query.to
    ));
  });

  router.post('/courts/:id/generate-slots', requireAuth, requireAdmin, async (request, response) => {
    response.status(201).json(await adminSlotsService.generateSlots(
      request.params.id,
      request.body,
      request.auth.user.id
    ));
  });

  router.patch('/courts/:id/prices', requireAuth, requireAdmin, async (request, response) => {
    if (request.query.dry_run !== undefined
        && request.query.dry_run !== 'true'
        && request.query.dry_run !== 'false') {
      const error = new Error('dry_run phải là true hoặc false.');
      error.status = 400;
      error.code = 'INVALID_INPUT';
      throw error;
    }
    response.json(await adminSlotsService.updatePrices(
      request.params.id,
      request.body,
      request.auth.user.id,
      { dryRun: request.query.dry_run === 'true' }
    ));
  });

  router.patch('/courts/:id', requireAuth, requireAdmin, async (request, response) => {
    response.json(await adminFacilitiesService.updateCourt(
      request.params.id,
      request.body,
      request.auth.user.id
    ));
  });

  router.get('/bookings', requireAuth, requireAdmin, adminEtag, async (request, response) => {
    const result = await adminService.listBookings(request.query);
    response.json(result);
  });

  router.get('/bookings/export', requireAuth, requireAdmin, async (request, response) => {
    sendSpreadsheet(response, await adminService.exportBookings(
      request.query,
      request.auth.user.id
    ));
  });

  router.get('/bookings/:id', requireAuth, requireAdmin, adminEtag, async (request, response) => {
    response.json(await adminService.getBookingDetail(request.params.id));
  });

  router.post(
    '/bookings/:id/incident-cancellation',
    requireAuth,
    requireAdmin,
    async (request, response) => {
      const result = await adminService.cancelBookingForIncident(
        request.params.id,
        request.body,
        request.auth.user.id
      );
      response.json(result);
    }
  );

  router.get('/dashboard/export', requireAuth, requireAdmin, async (request, response) => {
    sendSpreadsheet(response, await adminService.exportDashboard(
      request.query,
      request.auth.user.id
    ));
  });

  router.get('/dashboard', requireAuth, requireAdmin, adminEtag, async (request, response) => {
    const result = await adminService.getDashboard(request.query);
    response.json(result);
  });

  return router;
}

module.exports = createAdminRouter;
