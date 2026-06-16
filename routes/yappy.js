const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const router = express.Router();

// ============================================================
// CONFIGURACIÓN - Basado en documentación Yappy Comercial v3.1.154
// ============================================================
const YAPPY_API_KEY = process.env.YAPPY_API_KEY || '';
const YAPPY_SECRET_KEY = process.env.YAPPY_SECRET_KEY || '';
const YAPPY_MERCHANT_ID = process.env.YAPPY_MERCHANT_ID || '9aaf1605-ec6d-4ace-a610-86897b898cc2';
const YAPPY_BASE_URL = 'https://api.yappy.com.pa';  // URL base oficial
const YAPPY_DOMAIN = 'https://nrdesingcorp.com';

// ============================================================
// GET /api/yappy - Info y diagnóstico
// ============================================================
router.get('/', (req, res) => {
  res.json({
    status: 'Yappy API activa',
    version: '3.0 - Yappy Comercial API',
    documentation: 'https://www.yappy.com.pa/comercial/desarrolladores/',
    endpoints: {
      'GET /api/yappy': 'Info y diagnóstico (este endpoint)',
      'POST /api/yappy': 'Crear orden de pago (action: create-order)',
      'POST /api/yappy/login': 'Paso 1: Login de sesión (v1/session/login)',
      'POST /api/yappy/payment': 'Paso 2: Crear orden de pago'
    },
    config: {
      merchantId: YAPPY_MERCHANT_ID ? YAPPY_MERCHANT_ID.substring(0, 8) + '...' : 'NO CONFIGURADO',
      apiKeyConfigured: !!YAPPY_API_KEY,
      secretKeyConfigured: !!YAPPY_SECRET_KEY,
      domain: YAPPY_DOMAIN,
      baseUrl: YAPPY_BASE_URL
    },
    note: 'Según documentación Yappy Comercial v3.1.154, se requiere api-key y secret-key en headers',
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

  if (action === 'login') {
    return await yappyLogin(req, res);
  }

  if (action === 'payment') {
    return await createPayment(req, res);
  }

  return res.status(400).json({
    error: 'Invalid action. Use "create-order", "login", or "payment"'
  });
});

// ============================================================
// POST /api/yappy/login - Paso 1: Autenticación
// Según doc: POST /v1/session/login
// Headers: api-key, secret-key, client-ip, channel
// Body: { "body": { "code": "..." } }
// ============================================================
router.post('/login', async (req, res) => {
  return await yappyLogin(req, res);
});

// ============================================================
// POST /api/yappy/payment - Paso 2: Crear orden
// ============================================================
router.post('/payment', async (req, res) => {
  return await createPayment(req, res);
});

// ============================================================
// PASO 1: Login de sesión (v1/session/login)
// ============================================================
async function yappyLogin(req, res) {
  try {
    if (!YAPPY_API_KEY || !YAPPY_SECRET_KEY) {
      return res.status(500).json({
        error: 'YAPPY_API_KEY o YAPPY_SECRET_KEY no configuradas en variables de entorno',
        note: 'Ve a Yappy Comercial → Integraciones → Generar credenciales'
      });
    }

    // El "code" se genera con secret-key (hash del merchantId + secretKey)
    const code = crypto.createHash('sha256')
      .update(YAPPY_MERCHANT_ID + YAPPY_SECRET_KEY)
      .digest('hex');

    console.log('[YAPPY] [PASO 1] Login de sesión...');
    console.log('[YAPPY] [PASO 1] URL:', `${YAPPY_BASE_URL}/v1/session/login`);
    console.log('[YAPPY] [PASO 1] Headers: api-key, secret-key, client-ip, channel');

    const response = await axios.post(`${YAPPY_BASE_URL}/v1/session/login`, {
      body: {
        code: code
      }
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'api-key': YAPPY_API_KEY,
        'secret-key': YAPPY_SECRET_KEY,
        'client-ip': req.ip || req.connection.remoteAddress || '127.0.0.1',
        'channel': 'WEB'
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
      details: error.response?.data || null,
      status: error.response?.status || null
    });
  }
}

// ============================================================
// PASO 2: Crear orden de pago
// ============================================================
async function createPayment(req, res) {
  try {
    const {
      token,
      orderId: customOrderId,
      total = '5.00',
      subtotal = '5.00'
    } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token requerido. Primero llama a /login' });
    }

    const orderId = customOrderId || 'ORD' + Math.random().toString(36).substring(2, 11).toUpperCase();

    console.log('[YAPPY] [PASO 2] Creando orden...');
    console.log('[YAPPY] [PASO 2] orderId:', orderId);

    // Según la documentación actual, el endpoint de pago puede variar
    // Intentamos con el formato más común
    const body = {
      body: {
        merchantId: YAPPY_MERCHANT_ID,
        orderId: orderId,
        amount: total,
        currency: 'USD',
        description: 'Suscripción Road To - 24h',
        callbackUrl: `${YAPPY_DOMAIN}/yappy-callback`,
        returnUrl: `${YAPPY_DOMAIN}/pago-exitoso`,
        cancelUrl: `${YAPPY_DOMAIN}/pago-fallido`
      }
    };

    console.log('[YAPPY] [PASO 2] Body:', JSON.stringify(body));

    const response = await axios.post(`${YAPPY_BASE_URL}/v1/payments/create`, body, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
        'api-key': YAPPY_API_KEY,
        'secret-key': YAPPY_SECRET_KEY,
        'client-ip': req.ip || req.connection.remoteAddress || '127.0.0.1',
        'channel': 'WEB'
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
// FLUJO COMPLETO: Login + Crear orden
// ============================================================
async function createOrder(req, res) {
  try {
    const { total = '5.00', subtotal = '5.00' } = req.body;

    if (!YAPPY_API_KEY || !YAPPY_SECRET_KEY) {
      return res.status(500).json({
        error: 'Credenciales Yappy no configuradas',
        details: {
          code: 'MISSING_CREDENTIALS',
          description: 'YAPPY_API_KEY y YAPPY_SECRET_KEY son requeridas. Ve a Yappy Comercial → Integraciones → Generar credenciales.',
          merchantId: YAPPY_MERCHANT_ID
        }
      });
    }

    console.log('[YAPPY] === FLUJO COMPLETO v3 ===');

    // PASO 1: Login
    console.log('[YAPPY] [PASO 1] Login de sesión...');

    const code = crypto.createHash('sha256')
      .update(YAPPY_MERCHANT_ID + YAPPY_SECRET_KEY)
      .digest('hex');

    const loginRes = await axios.post(`${YAPPY_BASE_URL}/v1/session/login`, {
      body: { code: code }
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'api-key': YAPPY_API_KEY,
        'secret-key': YAPPY_SECRET_KEY,
        'client-ip': req.ip || req.connection.remoteAddress || '127.0.0.1',
        'channel': 'WEB'
      },
      timeout: 15000
    });

    console.log('[YAPPY] [PASO 1] Respuesta:', JSON.stringify(loginRes.data));

    const sessionToken = loginRes.data?.body?.token;
    const sessionState = loginRes.data?.body?.state;

    if (!sessionToken || sessionState !== 'OPEN') {
      throw new Error('No se obtuvo token de sesión o estado no es OPEN');
    }

    console.log('[YAPPY] [PASO 1] ✓ Sesión abierta, token obtenido');

    // PASO 2: Crear orden
    const orderId = 'ORD' + Math.random().toString(36).substring(2, 11).toUpperCase();

    console.log('[YAPPY] [PASO 2] Creando orden...');
    console.log('[YAPPY] [PASO 2] orderId:', orderId);

    const paymentBody = {
      body: {
        merchantId: YAPPY_MERCHANT_ID,
        orderId: orderId,
        amount: total,
        currency: 'USD',
        description: 'Suscripción Road To - 24h',
        callbackUrl: `${YAPPY_DOMAIN}/yappy-callback`,
        returnUrl: `${YAPPY_DOMAIN}/pago-exitoso`,
        cancelUrl: `${YAPPY_DOMAIN}/pago-fallido`
      }
    };

    console.log('[YAPPY] [PASO 2] Body:', JSON.stringify(paymentBody));

    const paymentRes = await axios.post(`${YAPPY_BASE_URL}/v1/payments/create`, paymentBody, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${sessionToken}`,
        'api-key': YAPPY_API_KEY,
        'secret-key': YAPPY_SECRET_KEY,
        'client-ip': req.ip || req.connection.remoteAddress || '127.0.0.1',
        'channel': 'WEB'
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
      details: details || null,
      note: 'Verifica que YAPPY_API_KEY y YAPPY_SECRET_KEY estén configuradas correctamente en Render Dashboard'
    });
  }
}

module.exports = router;