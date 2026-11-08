'use strict';

const express = require('express');

function createProfileRouter({ profileService, requireAuth }) {
  const router = express.Router();

  router.patch('/me', requireAuth, async (request, response) => {
    const user = await profileService.updateProfile(request.auth.user.id, request.body);
    response.json({ user });
  });

  router.patch('/me/password', requireAuth, async (request, response) => {
    await profileService.changePassword(request.auth.user.id, request.body);
    response.status(204).end();
  });

  return router;
}

module.exports = createProfileRouter;
