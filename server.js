// ============================================================
// server.js — Entry point para Render
// Backend API: https://conductores-api.onrender.com
// ============================================================

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Health check ───
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'conductores-backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ─── Rutas ───
const yappyRoute = require('./routes/yappy');
app.use('/api/yappy', yappyRoute);

// ─── 404 handler ───
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint no encontrado' });
});

// ─── Error handler ───
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({
    error: 'Error interno del servidor',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// ─── Start ───
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/`);
  console.log(`💳 Yappy API:    http://localhost:${PORT}/api/yappy`);
});
