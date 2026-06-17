const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const router = express.Router();

const YAPPY_MERCHANT_ID = process.env.YAPPY_MERCHANT_ID || '9aaf1605-ec6d-4ace-a610-86897b898cc2';
const YAPPY_SECRET_KEY = process.env.YAPPY_SECRET_KEY || '';
const YAPPY_DOMAIN = process.env.YAPPY_DOMAIN || 'https://nrdesingcorp.com';
const YAPPY_API_URL = 'https://apipagosbg.bgeneral.cloud';
const YAPPY_ALIAS_DEFAULT = '69977978'; // Fallback si no se envía desde frontend

// Log de diagnóstico al cargar
console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║           YAPPY API v3.1 - aliasYappy desde frontend     ║');
console.log('╠════════════════════════════════════════════════════════════╣');
console.log('║ MERCHANT_ID:', YAPPY_MERCHANT_ID.substring(0, 20) + '...');
console.log('║ ALIAS_DEFAULT (fallback):', YAPPY_ALIAS_DEFAULT);
console.log('║ SECRET_KEY configurado:', YAPPY_SECRET_KEY ? 'SÍ (' + YAPPY_SECRET_KEY.length + ' chars)' : 'NO');
console.log('╚════════════════════════════════════════════════════════════╝');

// GET /api/yappy - Info y diagnóstico
router.get('/', (req, res) => {
  res.json({
    status: 'Yappy API activa',
    version: '3.1 - aliasYappy desde frontend',
    endpoints: {
      'GET /api/yappy': 'Info y diagnóstico',
      'POST /api/yappy': 'Crear orden (action: create-order)'
    },
    config: {
      merchantId: YAPPY_MERCHANT_ID,
      aliasDefault: YAPPY_ALIAS_DEFAULT,
      domain: YAPPY_DOMAIN
    }
  });
});

// POST /api/yappy - Crear orden completa (paso 1 + paso 2)
router.post('/', async (req, res) => {
  const startTime = Date.now();
  const { action, total, subtotal, taxes, discount, orderId, aliasYappy } = req.body;

  console.log(`[YAPPY] [${new Date().toISOString()}] POST /api/yappy`);
  console.log(`[YAPPY] Body recibido:`, JSON.stringify(req.body, null, 2));

  // ============================================
  // CORRECCIÓN CRÍTICA: Usar aliasYappy del frontend
  // ============================================
  // Prioridad: 1) aliasYappy del body, 2) fallback default
  const finalAlias = aliasYappy || YAPPY_ALIAS_DEFAULT;

  console.log(`[YAPPY] aliasYappy desde frontend: "${aliasYappy}"`);
  console.log(`[YAPPY] aliasYappy final a usar: "${finalAlias}"`);

  if (action !== 'create-order') {
    return res.status(400).json({ error: 'Acción no válida. Use action: create-order' });
  }

  const finalOrderId = orderId || 'ORD' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const finalSubtotal = subtotal || total || '5.00';
  const finalTaxes = taxes || '0.00';
  const finalDiscount = discount || '0.00';
  const finalTotal = total || '5.00';
  const paymentDate = Math.floor(Date.now() / 1000).toString();
  const ipnUrl = `${YAPPY_DOMAIN}/api/yappy/ipn`;

  try {
    // ========== PASO 1: Validar comercio ==========
    console.log('[YAPPY] [PASO 1/2] Validando comercio...');
    const validateBody = {
      merchantId: YAPPY_MERCHANT_ID,
      urlDomain: YAPPY_DOMAIN
    };

    const validateResponse = await axios.post(
      `${YAPPY_API_URL}/payments/validate/merchant`,
      validateBody,
      { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
    );

    console.log('[YAPPY] [PASO 1/2] Respuesta:', JSON.stringify(validateResponse.data));

    const token = validateResponse.data?.body?.token;
    const epochTime = validateResponse.data?.body?.epochTime;

    if (!token) {
      console.error('[YAPPY] [PASO 1/2] ERROR: No se obtuvo token');
      return res.status(500).json({
        error: 'No se pudo obtener token de autenticación',
        details: validateResponse.data
      });
    }

    console.log(`[YAPPY] [PASO 1/2] Token obtenido, epochTime: ${epochTime}`);

    // ========== PASO 2: Crear orden ==========
    console.log('[YAPPY] [PASO 2/2] Creando orden...');
    console.log(`[YAPPY] [PASO 2/2] aliasYappy FINAL: "${finalAlias}"`);
    console.log(`[YAPPY] [PASO 2/2] orderId: ${finalOrderId}`);

    const paymentBody = {
      merchantId: YAPPY_MERCHANT_ID,
      orderId: finalOrderId,
      domain: YAPPY_DOMAIN,
      paymentDate: paymentDate,
      aliasYappy: finalAlias, // ← USA EL NÚMERO DEL CONDUCTOR
      ipnUrl: ipnUrl,
      discount: finalDiscount,
      taxes: finalTaxes,
      subtotal: finalSubtotal,
      total: finalTotal
    };

    console.log('[YAPPY] [PASO 2/2] Request body:', JSON.stringify(paymentBody, null, 2));

    const paymentResponse = await axios.post(
      `${YAPPY_API_URL}/payments/payment-wc`,
      paymentBody,
      {
        headers: {
          'Authorization': token, // SIN "Bearer "
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    console.log('[YAPPY] [PASO 2/2] Respuesta completa:', JSON.stringify(paymentResponse.data, null, 2));

    const responseBody = paymentResponse.data?.body || {};
    const responseStatus = paymentResponse.data?.status || {};

    const transactionId = responseBody.transactionId;
    const paymentToken = responseBody.token;
    const documentName = responseBody.documentName;

    console.log(`[YAPPY] [RESULTADO] transactionId: ${transactionId}`);
    console.log(`[YAPPY] [RESULTADO] documentName: ${documentName ? documentName.substring(0, 50) + '...' : 'NO RECIBIDO'}`);

    return res.json({
      success: true,
      step: 'complete',
      orderId: finalOrderId,
      aliasYappyUsed: finalAlias,
      data: paymentResponse.data,
      transactionId: transactionId,
      paymentToken: paymentToken,
      documentName: documentName,
      elapsedMs: Date.now() - startTime
    });

  } catch (error) {
    console.error('[YAPPY] ERROR:', error.message);
    if (error.response) {
      console.error('[YAPPY] Status:', error.response.status);
      console.error('[YAPPY] Data:', JSON.stringify(error.response.data, null, 2));
    }

    return res.status(error.response?.status || 500).json({
      error: 'Yappy payment failed',
      message: error.message,
      status: error.response?.status,
      details: error.response?.data,
      aliasYappyUsed: finalAlias
    });
  }
});

// IPN endpoint (GET)
router.get('/ipn', (req, res) => {
  const { orderId, status, hash, domain } = req.query;
  console.log(`[YAPPY IPN] orderId=${orderId}, status=${status}, domain=${domain}`);
  res.json({ received: true, orderId, status });
});

module.exports = router;