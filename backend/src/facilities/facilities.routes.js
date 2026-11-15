'use strict';

const express = require('express');

function createFacilitiesRouter({ facilitiesService, requireAuth }) {
  const router = express.Router();

  router.use(requireAuth);

  router.get('/facilities', async (request, response) => {
    response.set('Cache-Control', 'no-store');
    response.json(await facilitiesService.listFacilities(request.query));
  });

  router.get('/facilities/:id', async (request, response) => {
    response.set('Cache-Control', 'no-store');
    response.json(await facilitiesService.getFacility(request.params.id));
  });

  router.get('/courts/:id/time-slots', async (request, response) => {
    response.set('Cache-Control', 'no-store');
    response.json(await facilitiesService.getCourtTimeSlots(
      request.params.id,
      request.query.date
    ));
  });

  return router;
}

module.exports = createFacilitiesRouter;
