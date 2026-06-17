const express = require('express');
const axios = require('axios');
const router = express.Router();

// ============================================================
// CONFIGURACIÓN - API Original Yappy (apipagosbg.bgeneral.cloud)
// CORRECCIONES según Yappy Comercial:
// 1. Authorization: token SIN "Bearer " prefix
// 2. aliasYappy = NÚMERO DE TELÉFONO (sin prefijo, sin guiones)
// ============================================================
const YAPPY_MERCHANT_ID = process.env.YAPPY_MERCHANT_ID || '9aaf1605-ec6d-4ace-a610-86897b898cc2';
const YAPPY_SECRET_KEY = process.env.YAPPY_SECRET_KEY || '';
const YAPPY_BASE_URL = 'https://apipagosbg.bgeneral.cloud';
const YAPPY_DOMAIN = 'https://nrdesingcorp.com';
// IMPORTANTE: aliasYappy debe ser NÚMERO DE TELÉFONO válido en Yappy
const YAPPY_ALIAS = process.env.YAPPY_ALIAS || '69977978';

// LOGS DE DIAGNÓSTICO AL INICIAR
console.log('');
console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║           YAPPY API v2.5 - DIAGNÓSTICO DE INICIO           ║');
console.log('╠════════════════════════════════════════════════════════════╣');
console.log('║ MERCHANT_ID:', YAPPY_MERCHANT_ID.substring(0, 12) + '...');
console.log('║ ALIAS (env):', process.env.YAPPY_ALIAS || '(no configurado)');
console.log('║ ALIAS (final):', YAPPY_ALIAS);
console.log('║ ALIAS length:', YAPPY_ALIAS.length);
console.log('║ ALIAS es número:', /^\d+$/.test(YAPPY_ALIAS) ? 'SÍ' : 'NO');
console.log('║ SECRET_KEY:', YAPPY_SECRET_KEY ? 'Configurada' : 'NO configurada');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log('');

// ============================================================
// GET /api/yappy - Info y diagnóstico
// ============================================================
router.get('/', (req, res) => {
  res.json({
    status: 'Yappy API activa',
    version: '2.5 - Fix aliasYappy hardcodeado',
    notes: [
      '✅ Authorization SIN "Bearer" prefix',
      '✅ aliasYappy = NÚMERO DE TELÉFONO (sin prefijo, sin guiones)',
      '⚠️ Verificar que YAPPY_ALIAS esté configurado en Render'
    ],
    endpoints: {
      'GET /api/yappy': 'Info y diagnóstico',
      'POST /api/yappy': 'Crear orden de pago (action: create-order)',
      'POST /api/yappy/validate': 'Paso 1: Validar comercio',
      'POST /api/yappy/payment': 'Paso 2: Crear orden'
    },
    config: {
      merchantId: YAPPY_MERCHANT_ID ? YAPPY_MERCHANT_ID.substring(0, 8) + '...' : 'NO CONFIGURADO',
      secretKeyConfigured: !!YAPPY_SECRET_KEY,
      aliasYappy: YAPPY_ALIAS,
      aliasYappyLength: YAPPY_ALIAS.length,
      aliasIsNumber: /^\d+$/.test(YAPPY_ALIAS),
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

router.post('/validate', async (req, res) => {
  return await validateMerchant(req, res);
});

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
    return res.json({ success: true, step: 1, data: response.data });

  } catch (error) {
    console.error('[YAPPY] [PASO 1] Error:', error.message);
    return res.status(500).json({
      success: false, step: 1, error: error.message,
      details: error.response?.data || null
    });
  }
}

// ============================================================
// PASO 2: Crear orden
// CORRECCIÓN: aliasYappy = NÚMERO DE TELÉFONO
// ============================================================
async function createPayment(req, res) {
  try {
    const {
      token,
      epochTime,
      orderId: customOrderId,
      total = '5.00',
      subtotal = '5.00',
      aliasYappy,
      ipnUrl = `${YAPPY_DOMAIN}/yappy-ipn`
    } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token requerido. Primero llama a /validate' });
    }

    const orderId = customOrderId || 'ORD' + Math.random().toString(36).substring(2, 11).toUpperCase();
    const paymentDate = epochTime ? String(epochTime) : String(Math.floor(Date.now() / 1000));

    // USAR ALIAS: request > env > default
    const finalAlias = aliasYappy || YAPPY_ALIAS || '69977978';

    console.log('[YAPPY] [PASO 2] aliasYappy desde request:', aliasYappy);
    console.log('[YAPPY] [PASO 2] aliasYappy desde env:', YAPPY_ALIAS);
    console.log('[YAPPY] [PASO 2] aliasYappy final:', finalAlias);

    const body = {
      merchantId: YAPPY_MERCHANT_ID,
      orderId: orderId,
      domain: YAPPY_DOMAIN,
      paymentDate: paymentDate,
      aliasYappy: finalAlias,
      ipnUrl: ipnUrl,
      discount: '0.00',
      taxes: '0.00',
      subtotal: subtotal,
      total: total
    };

    console.log('[YAPPY] [PASO 2] Body completo:', JSON.stringify(body));

    const response = await axios.post(`${YAPPY_BASE_URL}/payments/payment-wc`, body, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': token
      },
      timeout: 15000
    });

    console.log('[YAPPY] [PASO 2] Respuesta:', JSON.stringify(response.data));
    return res.json({ success: true, step: 2, data: response.data });

  } catch (error) {
    console.error('[YAPPY] [PASO 2] Error:', error.message);
    return res.status(500).json({
      success: false, step: 2, error: error.message,
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
    const { total = '5.00', subtotal = '5.00', aliasYappy } = req.body;

    console.log('[YAPPY] === FLUJO COMPLETO (v2.5) ===');
    console.log('[YAPPY] aliasYappy desde request body:', aliasYappy);
    console.log('[YAPPY] YAPPY_ALIAS desde env:', YAPPY_ALIAS);

    // PASO 1: Validar comercio
    console.log('[YAPPY] [PASO 1] Validando comercio...');
    const validateRes = await axios.post(`${YAPPY_BASE_URL}/payments/validate/merchant`, {
      merchantId: YAPPY_MERCHANT_ID,
      urlDomain: YAPPY_DOMAIN
    }, {
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
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

    // USAR ALIAS: request > env > default
    const finalAlias = aliasYappy || YAPPY_ALIAS || '69977978';
    console.log('[YAPPY] [PASO 2] aliasYappy final usado:', finalAlias);

    const body = {
      merchantId: YAPPY_MERCHANT_ID,
      orderId: orderId,
      domain: YAPPY_DOMAIN,
      paymentDate: paymentDate,
      aliasYappy: finalAlias,
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
        'Authorization': step1Token
      },
      timeout: 15000
    });

    console.log('[YAPPY] [PASO 2] ✓ Respuesta:', JSON.stringify(paymentRes.data));

    const responseBody = paymentRes.data?.body;
    const transactionId = responseBody?.transactionId;
    const paymentToken = responseBody?.token;
    const documentName = responseBody?.documentName;

    console.log('[YAPPY] [RESULTADO] transactionId:', transactionId);
    console.log('[YAPPY] [RESULTADO] documentName:', documentName);

    return res.json({
      success: true,
      step: 'complete',
      orderId: orderId,
      transactionId: transactionId,
      paymentToken: paymentToken,
      documentName: documentName,
      data: paymentRes.data
    });

  } catch (error) {
    console.error('[YAPPY] ERROR:', error.message);
    const status = error.response?.status;
    const details = error.response?.data;

    if (details?.status?.code === 'YAPPY-004') {
      return res.status(400).json({
        error: 'Yappy payment failed - YAPPY-004',
        message: 'Error en el request o algun campo puede estar vacio.',
        details: details,
        currentAlias: YAPPY_ALIAS,
        suggestions: [
          'Verificar que YAPPY_ALIAS esté configurado en Render Dashboard',
          'Verificar que aliasYappy sea un número de teléfono válido en Yappy',
          'Verificar que todos los campos del body estén presentes'
        ]
      });
    }

    return res.status(status || 500).json({
      error: 'Yappy payment failed',
      message: error.message,
      status: status || null,
      details: details || null
    });
  }
}

module.exports = router;