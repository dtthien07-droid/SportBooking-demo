'use strict';

const express = require('express');

function createNotificationsRouter({ notificationsService, requireAuth }) {
  const router = express.Router();

  router.use((request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/unread-count', requireAuth, async (request, response) => {
    response.json(await notificationsService.countUnread(request.auth.user));
  });

  router.get('/', requireAuth, async (request, response) => {
    response.json(await notificationsService.list(request.auth.user, request.query));
  });

  router.post('/read-all', requireAuth, async (request, response) => {
    response.json(await notificationsService.markAllRead(request.auth.user));
  });

  router.patch('/:id/read', requireAuth, async (request, response) => {
    response.json(await notificationsService.markRead(request.auth.user, request.params.id));
  });

  return router;
}

module.exports = createNotificationsRouter;
