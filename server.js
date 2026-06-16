const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'conductores-backend', version: '1.0.0' });
});

// Rutas
const yappyRoute = require('./routes/yappy');
app.use('/api/yappy', yappyRoute);

// Error handlers
app.use((req, res) => res.status(404).json({ error: 'Endpoint no encontrado' }));
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ error: 'Error interno' });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/`);
  console.log(`💳 Yappy API: http://localhost:${PORT}/api/yappy`);
});