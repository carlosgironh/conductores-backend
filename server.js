const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'Conductores API',
    version: '2.1 - Yappy API Original (corregido)',
    timestamp: new Date().toISOString() 
  });
});

// Yappy routes
const yappyRouter = require('./routes/yappy');
app.use('/api/yappy', yappyRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint no encontrado', method: req.method, path: req.path });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/`);
  console.log(`💳 Yappy API: http://localhost:${PORT}/api/yappy`);
});