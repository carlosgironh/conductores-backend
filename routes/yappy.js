// routes/yappy.js
// ============================================================
// API Yappy para Render — Reemplaza completamente la Edge Function de Supabase
// Endpoint: POST https://conductores-api.onrender.com/api/yappy
// ============================================================

const express = require('express');
const router = express.Router();

const YAPPY_API_BASE = 'https://apipagosbg.bgeneral.cloud';
const COMMERCE_ID = process.env.YAPPY_COMMERCE_ID;
const SECRET_KEY = process.env.YAPPY_SECRET_KEY;

// ─── CORS Middleware ───
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  next();
});

router.options('/', (req, res) => res.status(200).end());

// ─── Helper: extraer epochTime del token JWT ───
function extractEpochTime(token) {
  if (!token) return Math.floor(Date.now() / 1000);
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString()
    );
    return payload.iat || payload.exp || Math.floor(Date.now() / 1000);
  } catch (e) {
    return Math.floor(Date.now() / 1000);
  }
}

// ─── POST /api/yappy ───
router.post('/', async (req, res) => {
  const { action } = req.body;

  console.log(`[YAPPY API] Action: ${action} | Time: ${new Date().toISOString()}`);

  try {
    // ═══════════════════════════════════════════════════════════
    // PASO 1: Validar comercio
    // ═══════════════════════════════════════════════════════════
    if (action === 'validate') {
      const { urlDomain } = req.body;

      console.log('[YAPPY] Paso 1: Validando comercio...');
      console.log('[YAPPY] merchantId:', COMMERCE_ID);
      console.log('[YAPPY] urlDomain:', urlDomain);

      const yappyRes = await fetch(`${YAPPY_API_BASE}/payments/validate/merchant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          merchantId: COMMERCE_ID,
          urlDomain: urlDomain,
        }),
      });

      const yappyData = await yappyRes.json();
      console.log('[YAPPY] Respuesta validate:', JSON.stringify(yappyData));

      if (yappyData.status?.code !== '0000') {
        return res.status(400).json({
          error: 'Yappy validation failed',
          details: yappyData.status,
        });
      }

      const epochTime = extractEpochTime(yappyData.body?.token);

      return res.json({
        status: yappyData.status,
        body: yappyData.body,
        epochTime: epochTime,
      });
    }

    // ═══════════════════════════════════════════════════════════
    // PASO 2: Crear orden de pago
    // ═══════════════════════════════════════════════════════════
    if (action === 'payment') {
      const {
        yappyToken,
        orderId,
        domain,
        paymentDate,
        aliasYappy,
        ipnUrl,
        discount,
        taxes,
        subtotal,
        total,
      } = req.body;

      console.log('[YAPPY] Paso 2: Creando orden...');
      console.log('[YAPPY] orderId:', orderId);
      console.log('[YAPPY] paymentDate:', paymentDate);
      console.log('[YAPPY] total:', total);

      const yappyRes = await fetch(`${YAPPY_API_BASE}/payments/payment-wc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${yappyToken}`,
        },
        body: JSON.stringify({
          merchantId: COMMERCE_ID,
          orderId: orderId,
          domain: domain,
          paymentDate: String(paymentDate),
          aliasYappy: aliasYappy || '',
          ipnUrl: ipnUrl,
          discount: discount || '0.00',
          taxes: taxes || '0.00',
          subtotal: subtotal,
          total: total,
        }),
      });

      const yappyData = await yappyRes.json();
      console.log('[YAPPY] Respuesta payment:', JSON.stringify(yappyData));

      return res.status(yappyRes.status).json(yappyData);
    }

    // ═══════════════════════════════════════════════════════════
    // Acción inválida
    // ═══════════════════════════════════════════════════════════
    return res.status(400).json({
      error: 'Invalid action',
      message: 'Use "validate" or "payment"',
    });

  } catch (error) {
    console.error('[YAPPY API ERROR]', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

module.exports = router;