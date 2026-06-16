const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const router = express.Router();

const YAPPY_MERCHANT_ID = process.env.YAPPY_MERCHANT_ID || '9aaf1605-ec6d-4ace-a610-86897b898cc2';
const YAPPY_SECRET_KEY = process.env.YAPPY_SECRET_KEY || '';
const YAPPY_BASE_URL = 'https://apipagosbg.bgeneral.cloud';
const YAPPY_DOMAIN = 'https://nrdesingcorp.com';

// ============================================================
// GET /api/yappy - Info y diagnóstico
// ============================================================
router.get('/', (req, res) => {
  res.json({
    status: 'Yappy API activa',
    version: '2.0',
    endpoints: {
      'GET /api/yappy': 'Info y diagnóstico (este endpoint)',
      'POST /api/yappy': 'Crear orden de pago (action: create-order)',
      'POST /api/yappy/validate': 'Paso 1: Validar comercio',
      'POST /api/yappy/payment': 'Paso 2: Crear orden (requiere token del paso 1)',
      'POST /api/yappy/signed-url': 'Generar URL firmado con secretKey (método SDK)'
    },
    config: {
      merchantId: YAPPY_MERCHANT_ID ? YAPPY_MERCHANT_ID.substring(0, 8) + '...' : 'NO CONFIGURADO',
      secretKeyConfigured: !!YAPPY_SECRET_KEY,
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

  if (action === 'signed-url') {
    return await generateSignedUrl(req, res);
  }

  return res.status(400).json({
    error: 'Invalid action. Use "create-order", "validate", "payment", or "signed-url"'
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
// POST /api/yappy/signed-url - Método SDK firmado
// ============================================================
router.post('/signed-url', async (req, res) => {
  return await generateSignedUrl(req, res);
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
// ============================================================
async function createPayment(req, res) {
  try {
    const {
      token,
      epochTime,
      orderId: customOrderId,
      total = '5.00',
      subtotal = '5.00',
      ipnUrl = `${YAPPY_DOMAIN}/yappy-ipn`
    } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token requerido. Primero llama a /validate' });
    }

    const orderId = customOrderId || 'ORD' + Math.random().toString(36).substring(2, 11).toUpperCase();
    const paymentDate = epochTime ? String(epochTime) : String(Math.floor(Date.now() / 1000));

    console.log('[YAPPY] [PASO 2] Creando orden...');
    console.log('[YAPPY] [PASO 2] orderId:', orderId);
    console.log('[YAPPY] [PASO 2] paymentDate:', paymentDate);

    const body = {
      merchantId: YAPPY_MERCHANT_ID,
      orderId: orderId,
      domain: YAPPY_DOMAIN,
      paymentDate: paymentDate,
      aliasYappy: '',
      ipnUrl: ipnUrl,
      discount: '0.00',
      taxes: '0.00',
      subtotal: subtotal,
      total: total
    };

    console.log('[YAPPY] [PASO 2] Body:', JSON.stringify(body));
    console.log('[YAPPY] [PASO 2] Authorization: Bearer', token.substring(0, 50) + '...');

    const response = await axios.post(`${YAPPY_BASE_URL}/payments/payment-wc`, body, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`
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
    const { total = '5.00', subtotal = '5.00', ipnUrl = `${YAPPY_DOMAIN}/yappy-ipn` } = req.body;

    console.log('[YAPPY] === FLUJO COMPLETO ===');

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
    console.log('[YAPPY] [PASO 2] paymentDate:', paymentDate);

    const body = {
      merchantId: YAPPY_MERCHANT_ID,
      orderId: orderId,
      domain: YAPPY_DOMAIN,
      paymentDate: paymentDate,
      aliasYappy: '',
      ipnUrl: ipnUrl,
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
        'Authorization': `Bearer ${step1Token}`
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

    // Si es 403, es problema de Yappy Comercial
    if (status === 403) {
      return res.status(403).json({
        error: 'Yappy payment failed - Merchant not authorized',
        details: {
          code: 'MERCHANT_NOT_ACTIVATED',
          description: 'El comercio no tiene permisos para crear ordenes. Verifique en Yappy Comercial que el Boton de Pago este activado. Contacte botondepagoYappy@bgeneral.com',
          merchantId: YAPPY_MERCHANT_ID,
          suggestion: 'Tambien puede probar el metodo "signed-url" que usa secretKey en vez de token'
        },
        step: error.config?.url?.includes('payment') ? 2 : 1
      });
    }

    return res.status(500).json({
      error: 'Yappy payment failed',
      message: error.message,
      status: status || null,
      details: details || null
    });
  }
}

// ============================================================
// MÉTODO ALTERNATIVO: URL firmado con secretKey (SDK style)
// Basado en el SDK de Eprezto
// ============================================================
async function generateSignedUrl(req, res) {
  try {
    const {
      orderId: customOrderId,
      total = '5.00',
      subtotal = '5.00',
      taxes = '0.00',
      discount = '0.00',
      successUrl = `${YAPPY_DOMAIN}/pago-exitoso`,
      failUrl = `${YAPPY_DOMAIN}/pago-fallido`
    } = req.body;

    if (!YAPPY_SECRET_KEY) {
      return res.status(500).json({
        error: 'YAPPY_SECRET_KEY no configurada en variables de entorno'
      });
    }

    const orderId = customOrderId || 'ORD' + Math.random().toString(36).substring(2, 11).toUpperCase();

    // Generar hash con secretKey (método SDK Eprezto)
    const hashString = `${orderId}${total}${subtotal}${taxes}${discount}${YAPPY_SECRET_KEY}`;
    const hash = crypto.createHash('sha256').update(hashString).digest('hex');

    // Construir URL de redirección
    const params = new URLSearchParams({
      merchantId: YAPPY_MERCHANT_ID,
      orderId: orderId,
      total: total,
      subtotal: subtotal,
      taxes: taxes,
      discount: discount,
      hash: hash,
      successUrl: successUrl,
      failUrl: failUrl,
      domain: YAPPY_DOMAIN
    });

    const redirectUrl = `${YAPPY_BASE_URL}/payments/payment?${params.toString()}`;

    console.log('[YAPPY] [SIGNED-URL] URL generada:', redirectUrl.substring(0, 100) + '...');

    return res.json({
      success: true,
      method: 'signed-url',
      orderId: orderId,
      redirectUrl: redirectUrl,
      hash: hash
    });

  } catch (error) {
    console.error('[YAPPY] [SIGNED-URL] Error:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

module.exports = router;