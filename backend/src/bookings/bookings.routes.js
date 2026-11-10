'use strict';

const express = require('express');

function createBookingsRouter({ bookingsService, requireAuth }) {
  const router = express.Router();

  router.param('id', (request, response, next, id) => {
    const numericId = Number(id);
    if (!/^\d+$/.test(id) || !Number.isSafeInteger(numericId) || numericId <= 0) {
      response.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Không tìm thấy tài nguyên.'
        }
      });
      return;
    }
    next();
  });

  router.post('/', requireAuth, async (request, response) => {
    const booking = await bookingsService.createBooking(request.auth.user.id, request.body);
    response.status(201).json(booking);
  });

  router.get('/', requireAuth, async (request, response) => {
    const result = await bookingsService.listBookings(request.auth.user, request.query);
    response.set('Cache-Control', 'no-store');
    response.json(result);
  });

  router.get('/pending', requireAuth, async (request, response) => {
    const booking = await bookingsService.getPendingBooking(request.auth.user);
    response.set('Cache-Control', 'no-store');
    response.json(booking);
  });

  router.get('/summary', requireAuth, async (request, response) => {
    const summary = await bookingsService.getBookingSummary(request.auth.user);
    response.set('Cache-Control', 'no-store');
    response.json(summary);
  });

  router.get('/:id', requireAuth, async (request, response) => {
    const booking = await bookingsService.getBooking(request.auth.user, request.params.id);
    response.set('Cache-Control', 'no-store');
    response.json(booking);
  });

  router.post('/:id/cancel', requireAuth, async (request, response) => {
    const booking = await bookingsService.cancelBooking(
      request.auth.user.id,
      request.params.id
    );
    response.json(booking);
  });

  router.post('/:id/payment-attempts', requireAuth, async (request, response) => {
    const result = await bookingsService.createPaymentAttempt(
      request.auth.user,
      request.params.id,
      request.body
    );
    response.status(201).json(result);
  });

  router.get('/:id/payments', requireAuth, async (request, response) => {
    const payments = await bookingsService.getPayments(request.auth.user, request.params.id);
    response.json(payments);
  });

  return router;
}

module.exports = createBookingsRouter;
