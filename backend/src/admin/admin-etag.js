'use strict';

const crypto = require('node:crypto');

function createAdminEtagMiddleware() {
  return function adminEtag(request, response, next) {
    response.set('Cache-Control', 'no-cache');
    const sendJson = response.json.bind(response);
    response.json = (body) => {
      const { server_time: ignoredServerTime, ...data } = body;
      const payload = JSON.stringify(data);
      const digest = crypto.createHash('sha256').update(payload).digest('base64url');
      const etag = `W/"${digest}"`;
      response.set('ETag', etag);
      if (request.get('If-None-Match')?.split(',').some((value) => (
        value.trim() === etag || value.trim() === '*'
      ))) {
        return response.status(304).end();
      }
      return sendJson(body);
    };
    next();
  };
}

module.exports = { createAdminEtagMiddleware };
