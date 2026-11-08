'use strict';

const express = require('express');
const { cookieOptions } = require('../session.cookie');
const { SESSION_DURATION_MS } = require('../session.service');

function createAuthRouter({ authService, sessionService, sessionRepository, requireAuth, cookieName }) {
  const router = express.Router();

  router.post('/register', async (request, response) => {
    const user = await authService.register(request.body);
    response.status(201).json({ user });
  });

  router.post('/login', async (request, response) => {
    const user = await authService.login(request.body);
    const { token } = await sessionService.startSession(user.id);
    const options = cookieOptions({ secure: response.locals.sessionCookieSecure });
    response.cookie(cookieName, token, { ...options, maxAge: SESSION_DURATION_MS });
    response.status(200).json({ user });
  });

  router.post('/logout', requireAuth, async (request, response) => {
    await sessionRepository.revokeByTokenHash(request.auth.tokenHash);
    response.clearCookie(cookieName, cookieOptions({
      secure: response.locals.sessionCookieSecure
    }));
    response.status(204).end();
  });

  router.get('/me', requireAuth, (request, response) => {
    response.json({ user: request.auth.user });
  });

  return router;
}

module.exports = createAuthRouter;
