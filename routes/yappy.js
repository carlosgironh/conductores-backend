const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const router = express.Router();

const YAPPY_MERCHANT_ID = process.env.YAPPY_MERCHANT_ID || '9aaf1605-ec6d-4ace-a610-86897b898cc2';
const YAPPY_SECRET_KEY = process.env.YAPPY_SECRET_KEY || '';
const YAPPY_DOMAIN = process.env.YAPPY_DOMAIN || 'https://nrdesingcorp.com';
const YAPPY_API_URL = 'https://apipagosbg.bgeneral.cloud';
const YAPPY_ALIAS = '69977978'; // Número de RoadTo (destinatario del pago)

// Log de diagnóstico al cargar
console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║           YAPPY API v3.0 - RoadTo PTY                    ║');
console.log('╠════════════════════════════════════════════════════════════╣');
console.log('║ MERCHANT_ID:', YAPPY_MERCHANT_ID.substring(0, 20) + '...');
console.log('║ ALIAS (RoadTo):', YAPPY_ALIAS);
console.log('║ DOMAIN:', YAPPY_DOMAIN);
console.log('║ SECRET_KEY configurado:', YAPPY_SECRET_KEY ? 'SÍ (' + YAPPY_SECRET_KEY.length + ' chars)' : 'NO');
console.log('╚════════════════════════════════════════════════════════════╝');

// GET /api/yappy - Info y diagnóstico
router.get('/', (req, res) => {
  res.json({
    status: 'Yappy API activa',
    version: '3.0 - RoadTo PTY',
    endpoints: {
      'GET /api/yappy': 'Info y diagnóstico',
      'POST /api/yappy': 'Crear orden (action: create-order)',
      'POST /api/yappy/validate': 'Paso 1: Validar comercio',
      'POST /api/yappy/payment': 'Paso 2: Crear orden'
    },
    config: {
      merchantId: YAPPY_MERCHANT_ID,
      aliasYappy: YAPPY_ALIAS,
      domain: YAPPY_DOMAIN,
      secretKeyConfigured: !!YAPPY_SECRET_KEY
    }
  });
});

// POST /api/yappy - Crear orden completa (paso 1 + paso 2)
router.post('/', async (req, res) => {
  const startTime = Date.now();
  const { action, total, subtotal, taxes, discount, orderId } = req.body;

  console.log(`[YAPPY] [${new Date().toISOString()}] POST /api/yappy`);
  console.log(`[YAPPY] Body recibido:`, JSON.stringify(req.body, null, 2));

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
    console.log('[YAPPY] [PASO 1/2] Request:', JSON.stringify(validateBody));

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
    console.log(`[YAPPY] [PASO 2/2] aliasYappy (RoadTo): ${YAPPY_ALIAS}`);
    console.log(`[YAPPY] [PASO 2/2] orderId: ${finalOrderId}`);

    const paymentBody = {
      merchantId: YAPPY_MERCHANT_ID,
      orderId: finalOrderId,
      domain: YAPPY_DOMAIN,
      paymentDate: paymentDate,
      aliasYappy: YAPPY_ALIAS, // RoadTo recibe el pago
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

    // Extraer datos para el componente Yappy
    const transactionId = responseBody.transactionId;
    const paymentToken = responseBody.token;
    const documentName = responseBody.documentName;

    console.log(`[YAPPY] [PASO 2/2] transactionId: ${transactionId}`);
    console.log(`[YAPPY] [PASO 2/2] documentName: ${documentName ? documentName.substring(0, 50) + '...' : 'NO RECIBIDO'}`);
    console.log(`[YAPPY] [PASO 2/2] token: ${paymentToken ? paymentToken.substring(0, 50) + '...' : 'NO RECIBIDO'}`);

    return res.json({
      success: true,
      step: 'complete',
      orderId: finalOrderId,
      aliasYappy: YAPPY_ALIAS,
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
      aliasYappyUsed: YAPPY_ALIAS
    });
  }
});

// IPN endpoint (GET) - Notificación instantánea de pago
router.get('/ipn', (req, res) => {
  const { orderId, status, hash, domain, confirmationNumber } = req.query;
  console.log(`[YAPPY IPN] ==========================================`);
  console.log(`[YAPPY IPN] orderId: ${orderId}`);
  console.log(`[YAPPY IPN] status: ${status}`);
  console.log(`[YAPPY IPN] hash: ${hash}`);
  console.log(`[YAPPY IPN] domain: ${domain}`);
  console.log(`[YAPPY IPN] confirmationNumber: ${confirmationNumber}`);
  console.log(`[YAPPY IPN] ==========================================`);

  // Validar hash con secret key (opcional pero recomendado)
  if (YAPPY_SECRET_KEY && hash && orderId && status && domain) {
    try {
      const values = Buffer.from(YAPPY_SECRET_KEY, 'base64').toString('utf-8');
      const secrete = values.split('.');
      const signature = crypto.createHmac('sha256', secrete[0])
                              .update(orderId + status + domain)
                              .digest('hex');
      const success = hash === signature;
      console.log(`[YAPPY IPN] Hash validation: ${success ? 'VALID' : 'INVALID'}`);

      if (success && status === 'E') {
        console.log(`[YAPPY IPN] ✅ PAGO EXITOSO - Orden: ${orderId}`);
        // Aquí activar suscripción en Supabase
      }

      return res.json({ success, orderId, status });
    } catch (e) {
      console.error('[YAPPY IPN] Error validando hash:', e.message);
    }
  }

  res.json({ received: true, orderId, status });
});

module.exports = router;