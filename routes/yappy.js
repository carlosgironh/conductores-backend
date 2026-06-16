const express = require('express');
const axios = require('axios');
const router = express.Router();

// ============================================================
// CONFIGURACIÓN - API Original Yappy (apipagosbg.bgeneral.cloud)
// Según respuesta de Yappy Comercial:
// 1. NO usar "Bearer" antes del token. Enviar token directo.
// 2. SÍ incluir aliasYappy en el body.
// ============================================================
const YAPPY_MERCHANT_ID = process.env.YAPPY_MERCHANT_ID || '9aaf1605-ec6d-4ace-a610-86897b898cc2';
const YAPPY_SECRET_KEY = process.env.YAPPY_SECRET_KEY || '';
const YAPPY_BASE_URL = 'https://apipagosbg.bgeneral.cloud';
const YAPPY_DOMAIN = 'https://nrdesingcorp.com';
const YAPPY_ALIAS = process.env.YAPPY_ALIAS || '66000000';  // Teléfono de prueba o real

// ============================================================
// GET /api/yappy - Info y diagnóstico
// ============================================================
router.get('/', (req, res) => {
  res.json({
    status: 'Yappy API activa',
    version: '2.1 - API Original (corregido según Yappy Comercial)',
    documentation: 'https://www.yappy.com.pa/comercial/desarrolladores/boton-de-pago-yappy-nueva-integracion/',
    notes: [
      '1. Authorization: enviar token SIN prefijo "Bearer"',
      '2. Body debe incluir aliasYappy (teléfono destinatario)',
      '3. El comercio es: RoadTo PTY'
    ],
    endpoints: {
      'GET /api/yappy': 'Info y diagnóstico (este endpoint)',
      'POST /api/yappy': 'Crear orden de pago (action: create-order)',
      'POST /api/yappy/validate': 'Paso 1: Validar comercio',
      'POST /api/yappy/payment': 'Paso 2: Crear orden (requiere token del paso 1)'
    },
    config: {
      merchantId: YAPPY_MERCHANT_ID ? YAPPY_MERCHANT_ID.substring(0, 8) + '...' : 'NO CONFIGURADO',
      secretKeyConfigured: !!YAPPY_SECRET_KEY,
      aliasYappy: YAPPY_ALIAS,
      domain: YAPPY_DOMAIN,
      baseUrl: YAPPY_BASE_URL
    },
    timestamp: new Date().toISOString()
  });
});

// ============================================================
// POST /api/yappy - Acción principal
// ============================================================
router.post('/', async (req, res) => {
  const { action } = req.body;

  console.log(`[YAPPY API] Action: ${action} | Time: ${new Date().toISOString()}`);

  if (action === 'create-order') {
    return await createOrder(req, res);
  }

  if (action === 'validate') {
    return await validateMerchant(req, res);
  }

  if (action === 'payment') {
    return await createPayment(req, res);
  }

  return res.status(400).json({
    error: 'Invalid action. Use "create-order", "validate", or "payment"'
  });
});

// ============================================================
// POST /api/yappy/validate - Paso 1 manual
// ============================================================
router.post('/validate', async (req, res) => {
  return await validateMerchant(req, res);
});

// ============================================================
// POST /api/yappy/payment - Paso 2 manual
// ============================================================
router.post('/payment', async (req, res) => {
  return await createPayment(req, res);
});

// ============================================================
// PASO 1: Validar comercio
// ============================================================
async function validateMerchant(req, res) {
  try {
    const urlDomain = req.body.urlDomain || YAPPY_DOMAIN;

    console.log('[YAPPY] [PASO 1] Validando comercio...');
    console.log('[YAPPY] [PASO 1] URL:', `${YAPPY_BASE_URL}/payments/validate/merchant`);
    console.log('[YAPPY] [PASO 1] Body:', JSON.stringify({ merchantId: YAPPY_MERCHANT_ID, urlDomain }));

    const response = await axios.post(`${YAPPY_BASE_URL}/payments/validate/merchant`, {
      merchantId: YAPPY_MERCHANT_ID,
      urlDomain: urlDomain
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 15000
    });

    console.log('[YAPPY] [PASO 1] Respuesta:', JSON.stringify(response.data));

    return res.json({
      success: true,
      step: 1,
      data: response.data
    });

  } catch (error) {
    console.error('[YAPPY] [PASO 1] Error:', error.message);
    return res.status(500).json({
      success: false,
      step: 1,
      error: error.message,
      details: error.response?.data || null
    });
  }
}

// ============================================================
// PASO 2: Crear orden
// CORRECCIÓN: Authorization sin "Bearer", aliasYappy incluido
// ============================================================
async function createPayment(req, res) {
  try {
    const {
      token,
      epochTime,
      orderId: customOrderId,
      total = '5.00',
      subtotal = '5.00',
      aliasYappy = YAPPY_ALIAS,
      ipnUrl = `${YAPPY_DOMAIN}/yappy-ipn`
    } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token requerido. Primero llama a /validate' });
    }

    const orderId = customOrderId || 'ORD' + Math.random().toString(36).substring(2, 11).toUpperCase();
    const paymentDate = epochTime ? String(epochTime) : String(Math.floor(Date.now() / 1000));

    console.log('[YAPPY] [PASO 2] Creando orden...');
    console.log('[YAPPY] [PASO 2] orderId:', orderId);
    console.log('[YAPPY] [PASO 2] aliasYappy:', aliasYappy);

    // CORRECCIÓN 1: Authorization SIN "Bearer", solo el token directo
    // CORRECCIÓN 2: aliasYappy incluido en el body
    const body = {
      merchantId: YAPPY_MERCHANT_ID,
      orderId: orderId,
      domain: YAPPY_DOMAIN,
      paymentDate: paymentDate,
      aliasYappy: aliasYappy,  // ← CORRECCIÓN 2: Número de teléfono destinatario
      ipnUrl: ipnUrl,
      discount: '0.00',
      taxes: '0.00',
      subtotal: subtotal,
      total: total
    };

    console.log('[YAPPY] [PASO 2] Body:', JSON.stringify(body));
    console.log('[YAPPY] [PASO 2] Authorization (sin Bearer):', token.substring(0, 50) + '...');

    const response = await axios.post(`${YAPPY_BASE_URL}/payments/payment-wc`, body, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': token  // ← CORRECCIÓN 1: SIN "Bearer ", solo el token
      },
      timeout: 15000
    });

    console.log('[YAPPY] [PASO 2] Respuesta:', JSON.stringify(response.data));

    return res.json({
      success: true,
      step: 2,
      data: response.data
    });

  } catch (error) {
    console.error('[YAPPY] [PASO 2] Error:', error.message);
    return res.status(500).json({
      success: false,
      step: 2,
      error: error.message,
      status: error.response?.status || null,
      details: error.response?.data || null
    });
  }
}

// ============================================================
// FLUJO COMPLETO: Paso 1 + Paso 2
// ============================================================
async function createOrder(req, res) {
  try {
    const { 
      total = '5.00', 
      subtotal = '5.00',
      aliasYappy = YAPPY_ALIAS
    } = req.body;

    console.log('[YAPPY] === FLUJO COMPLETO (corregido) ===');

    // PASO 1: Validar comercio
    console.log('[YAPPY] [PASO 1] Validando comercio...');

    const validateRes = await axios.post(`${YAPPY_BASE_URL}/payments/validate/merchant`, {
      merchantId: YAPPY_MERCHANT_ID,
      urlDomain: YAPPY_DOMAIN
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 15000
    });

    console.log('[YAPPY] [PASO 1] Respuesta:', JSON.stringify(validateRes.data));

    const step1Token = validateRes.data?.body?.token;
    const epochTime = validateRes.data?.body?.epochTime;

    if (!step1Token) {
      throw new Error('No se obtuvo token del paso 1');
    }

    console.log('[YAPPY] [PASO 1] ✓ Token obtenido, epochTime:', epochTime);

    // PASO 2: Crear orden
    const orderId = 'ORD' + Math.random().toString(36).substring(2, 11).toUpperCase();
    const paymentDate = String(epochTime || Math.floor(Date.now() / 1000));

    console.log('[YAPPY] [PASO 2] Creando orden...');
    console.log('[YAPPY] [PASO 2] orderId:', orderId);
    console.log('[YAPPY] [PASO 2] aliasYappy:', aliasYappy);

    const body = {
      merchantId: YAPPY_MERCHANT_ID,
      orderId: orderId,
      domain: YAPPY_DOMAIN,
      paymentDate: paymentDate,
      aliasYappy: aliasYappy,  // ← CORRECCIÓN 2
      ipnUrl: `${YAPPY_DOMAIN}/yappy-ipn`,
      discount: '0.00',
      taxes: '0.00',
      subtotal: subtotal,
      total: total
    };

    console.log('[YAPPY] [PASO 2] Body:', JSON.stringify(body));

    const paymentRes = await axios.post(`${YAPPY_BASE_URL}/payments/payment-wc`, body, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': step1Token  // ← CORRECCIÓN 1: SIN "Bearer "
      },
      timeout: 15000
    });

    console.log('[YAPPY] [PASO 2] ✓ Respuesta:', JSON.stringify(paymentRes.data));

    return res.json({
      success: true,
      step: 'complete',
      orderId: orderId,
      data: paymentRes.data
    });

  } catch (error) {
    console.error('[YAPPY] ERROR:', error.message);

    const status = error.response?.status;
    const details = error.response?.data;

    return res.status(status || 500).json({
      error: 'Yappy payment failed',
      message: error.message,
      status: status || null,
      details: details || null
    });
  }
}

module.exports = router;