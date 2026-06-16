const express = require('express');
const router = express.Router();

const YAPPY_API_BASE = 'https://apipagosbg.bgeneral.cloud';
const COMMERCE_ID = process.env.YAPPY_COMMERCE_ID;

// CORS
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

router.options('*', (req, res) => res.status(200).end());

// Helper: fetch con timeout
async function fetchYappy(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeout);
    return response;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ============================================================
// ENDPOINT PRINCIPAL - Exactamente como indica la documentación
// ============================================================
router.post('/', async (req, res) => {
  try {
    const { action } = req.body;
    const timestamp = new Date().toISOString();
    console.log(`[YAPPY API] Action: ${action} | Time: ${timestamp}`);

    // ─── ACTION: validate (Paso 1 de la documentación) ───
    if (action === 'validate') {
      console.log('[YAPPY] Paso 1: Validando comercio...');
      console.log('[YAPPY] POST /payments/validate/merchant');
      console.log('[YAPPY] Body:', JSON.stringify({
        merchantId: COMMERCE_ID,
        urlDomain: req.body.urlDomain
      }));

      const response = await fetchYappy(`${YAPPY_API_BASE}/payments/validate/merchant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          merchantId: COMMERCE_ID,
          urlDomain: req.body.urlDomain,
        }),
      });

      const data = await response.json();
      console.log('[YAPPY] Respuesta paso 1:', JSON.stringify(data));

      if (data.status?.code === '0000' && data.body?.token) {
        // Extraer epochTime del token JWT
        let epochTime = data.body.epochTime;
        if (!epochTime && data.body.token) {
          try {
            const payload = JSON.parse(
              Buffer.from(data.body.token.split('.')[1], 'base64url').toString()
            );
            epochTime = payload.iat || payload.exp || Math.floor(Date.now() / 1000);
          } catch (e) {
            epochTime = Math.floor(Date.now() / 1000);
          }
        }

        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.status(200).json({
          status: data.status,
          body: {
            token: data.body.token,
            epochTime: epochTime,
          }
        });
      }

      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(400).json(data);
    }

    // ─── ACTION: payment (Paso 2 de la documentación) ───
    if (action === 'payment') {
      const {
        yappyToken,      // Token del paso 1
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
      console.log('[YAPPY] POST /payments/payment-wc');
      console.log('[YAPPY] Authorization: Bearer', yappyToken.substring(0, 30) + '...');
      console.log('[YAPPY] Body:', JSON.stringify({
        merchantId: COMMERCE_ID,
        orderId,
        domain,
        paymentDate,
        aliasYappy: aliasYappy || '',
        ipnUrl,
        discount: discount || '0.00',
        taxes: taxes || '0.00',
        subtotal,
        total,
      }));

      const response = await fetchYappy(`${YAPPY_API_BASE}/payments/payment-wc`, {
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
          paymentDate: paymentDate,
          aliasYappy: aliasYappy || '',
          ipnUrl: ipnUrl,
          discount: discount || '0.00',
          taxes: taxes || '0.00',
          subtotal: subtotal,
          total: total,
        }),
      });

      const data = await response.json();
      console.log('[YAPPY] Respuesta paso 2:', JSON.stringify(data));

      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(response.status).json(data);
    }

    // ─── ACTION: create-order (Flujo completo) ───
    if (action === 'create-order') {
      console.log('[YAPPY] === FLUJO COMPLETO ===');

      // Paso 1: Validar
      console.log('[YAPPY] [1/2] Validando comercio...');
      const validateResponse = await fetchYappy(`${YAPPY_API_BASE}/payments/validate/merchant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          merchantId: COMMERCE_ID,
          urlDomain: req.body.urlDomain,
        }),
      });

      const validateData = await validateResponse.json();
      console.log('[YAPPY] [1/2] Respuesta:', JSON.stringify(validateData));

      if (validateData.status?.code !== '0000') {
        console.log('[YAPPY] [1/2] ERROR:', validateData.status?.description);
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.status(400).json(validateData);
      }

      const yappyToken = validateData.body?.token;
      const epochTime = validateData.body?.epochTime || Math.floor(Date.now() / 1000);
      console.log('[YAPPY] [1/2] Token obtenido, epochTime:', epochTime);

      // Paso 2: Crear orden
      const orderId = req.body.orderId || 'ORD' + Date.now().toString(36).toUpperCase();

      console.log('[YAPPY] [2/2] Creando orden...');
      console.log('[YAPPY] [2/2] orderId:', orderId);
      console.log('[YAPPY] [2/2] paymentDate:', epochTime);

      const paymentResponse = await fetchYappy(`${YAPPY_API_BASE}/payments/payment-wc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${yappyToken}`,
        },
        body: JSON.stringify({
          merchantId: COMMERCE_ID,
          orderId: orderId,
          domain: req.body.urlDomain,
          paymentDate: String(epochTime),
          aliasYappy: '',
          ipnUrl: req.body.urlDomain + '/yappy-ipn',
          discount: '0.00',
          taxes: '0.00',
          subtotal: req.body.total || '5.00',
          total: req.body.total || '5.00',
        }),
      });

      const paymentData = await paymentResponse.json();
      console.log('[YAPPY] [2/2] Respuesta:', JSON.stringify(paymentData));

      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(paymentResponse.status).json(paymentData);
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(400).json({ error: 'Invalid action. Use "validate", "payment", or "create-order"' });

  } catch (error) {
    console.error('[YAPPY API ERROR]', error);
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

module.exports = router;