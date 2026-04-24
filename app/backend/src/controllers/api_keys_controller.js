// app/backend/src/controllers/api_keys_controller.js
const express = require('express');
const router = express.Router();
const service = require('../services/api_keys_service');

router.get('/api/admin/keys', async (req, res) => {
  res.json(await service.listKeys());
});

router.post('/api/admin/keys', async (req, res) => {
  res.json(await service.createKey(req.user.id));
});

router.post('/api/admin/keys/:id/rotate', async (req, res) => {
  await service.rotateKey(req.params.id);
  res.json({ success: true });
});

router.post('/api/admin/keys/:id/revoke', async (req, res) => {
  await service.revokeKey(req.params.id);
  res.json({ success: true });
});

module.exports = router;
