'use strict';

const express = require('express');

function createAdminRouter({ adminService, requireAuth, requireAdmin }) {
  const router = express.Router();

  router.use((request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/bookings', requireAuth, requireAdmin, async (request, response) => {
    const result = await adminService.listBookings(request.query);
    response.json(result);
  });

  router.post(
    '/bookings/:id/incident-cancellation',
    requireAuth,
    requireAdmin,
    async (request, response) => {
      const result = await adminService.cancelBookingForIncident(
        request.params.id,
        request.body
      );
      response.json(result);
    }
  );

  router.get('/dashboard', requireAuth, requireAdmin, async (request, response) => {
    const result = await adminService.getDashboard(request.query.period);
    response.json(result);
  });

  return router;
}

module.exports = createAdminRouter;
