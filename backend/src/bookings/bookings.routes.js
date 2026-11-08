'use strict';

const express = require('express');

function createBookingsRouter({ bookingsService, requireAuth }) {
  const router = express.Router();

  router.post('/', requireAuth, async (request, response) => {
    const booking = await bookingsService.createBooking(request.auth.user.id, request.body);
    response.status(201).json(booking);
  });

  router.get('/:id', requireAuth, async (request, response) => {
    const booking = await bookingsService.getBooking(request.auth.user, request.params.id);
    response.json(booking);
  });

  router.post('/:id/cancel', requireAuth, async (request, response) => {
    const booking = await bookingsService.cancelBooking(
      request.auth.user.id,
      request.params.id
    );
    response.json(booking);
  });

  return router;
}

module.exports = createBookingsRouter;
