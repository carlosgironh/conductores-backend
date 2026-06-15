const express = require('express');
const router = express.Router();

const YAPPY_API_BASE = 'https://apipagosbg.bgeneral.cloud';
const YAPPY_UAT_BASE = 'https://api-comecom-uat.yappycloud.com';
const COMMERCE_ID = process.env.YAPPY_COMMERCE_ID;
const SECRET_KEY = process.env.YAPPY_SECRET_KEY;

// CORS middleware
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

router.options('*', (req, res) => res.status(200).end());

// ─── CONFIG LOGGING ───
console.log('[YAPPY CONFIG] Verificando variables de entorno...');
if (!COMMERCE_ID) {
  console.error('[YAPPY CONFIG] ERROR: YAPPY_COMMERCE_ID no configurado');
} else {
  console.log('[YAPPY CONFIG] COMMERCE_ID: Configurado (' + COMMERCE_ID.substring(0, 8) + '...)');
}

let decodedSecret = null;
if (!SECRET_KEY) {
  console.error('[YAPPY CONFIG] ERROR: YAPPY_SECRET_KEY no configurado');
} else {
  console.log('[YAPPY CONFIG] SECRET_KEY (raw): Configurado (' + SECRET_KEY.substring(0, 8) + '...)');
  try {
    decodedSecret = Buffer.from(SECRET_KEY, 'base64').toString('utf-8');
    console.log('[YAPPY CONFIG] SECRET_KEY (decoded): Decodificado (' + decodedSecret.substring(0, 20) + '...)');
  } catch (e) {
    console.error('[YAPPY CONFIG] ERROR decodificando SECRET_KEY:', e.message);
    decodedSecret = SECRET_KEY;
  }
}

// ─── HELPER: Make request to Yappy ───
async function makeYappyRequest(url, method, headers, body) {
  const response = await fetch(url, {
    method: method,
    headers: headers,
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data: data };
}

// ─── MAIN ENDPOINT ───
router.post('/', async (req, res) => {
  try {
    const { action } = req.body;
    const timestamp = new Date().toISOString();
    console.log(`[YAPPY API] Action: ${action} | Time: ${timestamp}`);

    // ─── ACTION: validate ───
    if (action === 'validate') {
      console.log('[YAPPY] Paso 1: Validando comercio...');
      console.log('[YAPPY] merchantId:', COMMERCE_ID);
      console.log('[YAPPY] urlDomain:', req.body.urlDomain);

      const validateBody = {
        merchantId: COMMERCE_ID,
        urlDomain: req.body.urlDomain,
      };
      console.log('[YAPPY] Request body:', JSON.stringify(validateBody));

      const result = await makeYappyRequest(
        `${YAPPY_API_BASE}/payments/validate/merchant`,
        'POST',
        { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        validateBody
      );

      console.log('[YAPPY] Respuesta validate:', JSON.stringify(result.data));

      let epochTime = null;
      if (result.data.body?.token) {
        try {
          const payload = JSON.parse(
            Buffer.from(result.data.body.token.split('.')[1], 'base64url').toString()
          );
          epochTime = payload.iat || Math.floor(Date.now() / 1000);
        } catch (e) {
          epochTime = Math.floor(Date.now() / 1000);
        }
      }

      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(200).json({
        ...result.data,
        epochTime: epochTime || Math.floor(Date.now() / 1000),
      });
    }

    // ─── ACTION: payment ───
    if (action === 'payment') {
      const {
        yappyToken, orderId, domain, paymentDate, aliasYappy, ipnUrl,
        discount, taxes, subtotal, total,
      } = req.body;

      console.log('[YAPPY] Paso 2: Creando orden...');
      console.log('[YAPPY] orderId:', orderId);
      console.log('[YAPPY] paymentDate:', paymentDate);
      console.log('[YAPPY] total:', total);
      console.log('[YAPPY] yappyToken (primeros 50 chars):', yappyToken?.substring(0, 50) + '...');

      const paymentBody = {
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
      };

      // Probar todos los formatos de Authorization
      const authFormats = [
        { name: 'Bearer', header: `Bearer ${yappyToken}` },
        { name: 'Raw token', header: yappyToken },
        { name: 'Token', header: `Token ${yappyToken}` },
      ];

      const endpoints = [
        { name: 'payment-wc', url: `${YAPPY_API_BASE}/payments/payment-wc` },
        { name: 'payment', url: `${YAPPY_API_BASE}/payments/payment` },
      ];

      for (const endpoint of endpoints) {
        for (const authFormat of authFormats) {
          console.log(`[YAPPY] Probando: ${endpoint.name} + Authorization: ${authFormat.name}`);
          console.log('[YAPPY] Authorization header:', authFormat.header.substring(0, 60) + '...');
          console.log('[YAPPY] Request body:', JSON.stringify(paymentBody));

          const result = await makeYappyRequest(
            endpoint.url,
            'POST',
            {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'Authorization': authFormat.header,
            },
            paymentBody
          );

          console.log(`[YAPPY] HTTP Status (${endpoint.name} + ${authFormat.name}):`, result.status);
          console.log(`[YAPPY] Respuesta:`, JSON.stringify(result.data));

          if (result.status === 200 && result.data.status?.code === '0000') {
            console.log(`[YAPPY] EXITO con ${endpoint.name} + ${authFormat.name}`);
            res.setHeader('Access-Control-Allow-Origin', '*');
            return res.status(200).json(result.data);
          }
        }
      }

      // Si todo falla, intentar UAT
      console.log('[YAPPY] PROD falló con 403. Intentando UAT...');

      // Primero obtener token de UAT
      const uatValidate = await makeYappyRequest(
        `${YAPPY_UAT_BASE}/payments/validate/merchant`,
        'POST',
        { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        { merchantId: COMMERCE_ID, urlDomain: domain }
      );

      if (uatValidate.data.status?.code === '0000' && uatValidate.data.body?.token) {
        const uatToken = uatValidate.data.body.token;
        console.log('[YAPPY] UAT Token obtenido');

        for (const endpoint of endpoints) {
          for (const authFormat of authFormats) {
            const uatUrl = endpoint.url.replace(YAPPY_API_BASE, YAPPY_UAT_BASE);
            const authHeader = authFormat.name === 'Bearer' ? `Bearer ${uatToken}` : 
                              authFormat.name === 'Token' ? `Token ${uatToken}` : uatToken;

            console.log(`[YAPPY] UAT Probando: ${endpoint.name} + ${authFormat.name}`);

            const result = await makeYappyRequest(
              uatUrl,
              'POST',
              {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': authHeader,
              },
              paymentBody
            );

            console.log(`[YAPPY] UAT Status (${endpoint.name} + ${authFormat.name}):`, result.status);
            console.log(`[YAPPY] UAT Respuesta:`, JSON.stringify(result.data));

            if (result.status === 200 && result.data.status?.code === '0000') {
              console.log(`[YAPPY] UAT EXITO con ${endpoint.name} + ${authFormat.name}`);
              res.setHeader('Access-Control-Allow-Origin', '*');
              return res.status(200).json(result.data);
            }
          }
        }
      }

      console.log('[YAPPY] TODOS los intentos fallaron. El comercio no está activado en Yappy.');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(403).json({
        error: 'Yappy payment failed - Merchant not activated',
        details: {
          code: 'MERCHANT_NOT_ACTIVATED',
          description: 'El comercio no tiene permisos para crear ordenes. Verifique en Yappy Comercial que el Boton de Pago este activado (estado: Activo, no Pendiente).',
          merchantId: COMMERCE_ID,
          suggestion: 'Contacte botondepagoYappy@bgeneral.com con su merchantId para activar el comercio.'
        }
      });
    }

    // ─── ACTION: create-order (single-step) ───
    if (action === 'create-order') {
      console.log('[YAPPY] === FLUJO COMPLETO EN UN SOLO PASO ===');
      console.log('[YAPPY] merchantId:', COMMERCE_ID);
      console.log('[YAPPY] urlDomain:', req.body.urlDomain);

      // Paso 1: Validar
      const validateBody = {
        merchantId: COMMERCE_ID,
        urlDomain: req.body.urlDomain,
      };

      const validateResult = await makeYappyRequest(
        `${YAPPY_API_BASE}/payments/validate/merchant`,
        'POST',
        { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        validateBody
      );

      console.log('[YAPPY] [1/2] Respuesta validate:', JSON.stringify(validateResult.data));

      if (validateResult.data.status?.code !== '0000') {
        console.log('[YAPPY] [1/2] ERROR en validate:', validateResult.data.status?.description);
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.status(400).json({
          error: 'Yappy validation failed',
          details: validateResult.data.status || validateResult.data
        });
      }

      const yappyToken = validateResult.data.body?.token;
      const epochTime = validateResult.data.body?.epochTime || Math.floor(Date.now() / 1000);
      console.log('[YAPPY] [1/2] Token obtenido, epochTime:', epochTime);

      // Paso 2: Crear orden
      const orderId = req.body.orderId || 'ORD' + Date.now().toString(36).toUpperCase();
      const paymentBody = {
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
      };

      console.log('[YAPPY] [2/2] Creando orden...');
      console.log('[YAPPY] [2/2] orderId:', orderId);
      console.log('[YAPPY] [2/2] total:', paymentBody.total);

      // Probar todos los formatos
      const authFormats = [
        { name: 'Bearer', header: `Bearer ${yappyToken}` },
        { name: 'Raw', header: yappyToken },
        { name: 'Token', header: `Token ${yappyToken}` },
      ];

      const endpoints = [
        `${YAPPY_API_BASE}/payments/payment-wc`,
        `${YAPPY_API_BASE}/payments/payment`,
      ];

      for (const endpoint of endpoints) {
        for (const authFormat of authFormats) {
          console.log(`[YAPPY] [2/2] Probando ${endpoint.split('/').pop()} + ${authFormat.name}`);
          console.log('[YAPPY] [2/2] Authorization:', authFormat.header.substring(0, 50) + '...');
          console.log('[YAPPY] [2/2] Body:', JSON.stringify(paymentBody));

          const result = await makeYappyRequest(
            endpoint,
            'POST',
            {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'Authorization': authFormat.header,
            },
            paymentBody
          );

          console.log(`[YAPPY] [2/2] HTTP Status (${endpoint.split('/').pop()}):`, result.status);
          console.log(`[YAPPY] [2/2] Respuesta:`, JSON.stringify(result.data));

          if (result.status === 200 && result.data.status?.code === '0000') {
            console.log(`[YAPPY] [2/2] EXITO con ${endpoint.split('/').pop()} + ${authFormat.name}`);
            res.setHeader('Access-Control-Allow-Origin', '*');
            return res.status(200).json(result.data);
          }
        }
      }

      // Si todo falla, intentar UAT
      console.log('[YAPPY] PROD falló con 403. Intentando UAT...');

      const uatValidate = await makeYappyRequest(
        `${YAPPY_UAT_BASE}/payments/validate/merchant`,
        'POST',
        { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        { merchantId: COMMERCE_ID, urlDomain: req.body.urlDomain }
      );

      if (uatValidate.data.status?.code === '0000' && uatValidate.data.body?.token) {
        const uatToken = uatValidate.data.body.token;
        const uatEpoch = uatValidate.data.body.epochTime || Math.floor(Date.now() / 1000);

        paymentBody.paymentDate = String(uatEpoch);

        for (const endpoint of endpoints) {
          for (const authFormat of authFormats) {
            const uatUrl = endpoint.replace(YAPPY_API_BASE, YAPPY_UAT_BASE);
            const authHeader = authFormat.name === 'Bearer' ? `Bearer ${uatToken}` : 
                              authFormat.name === 'Token' ? `Token ${uatToken}` : uatToken;

            console.log(`[YAPPY] UAT ${endpoint.split('/').pop()} + ${authFormat.name}`);

            const result = await makeYappyRequest(
              uatUrl,
              'POST',
              {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': authHeader,
              },
              paymentBody
            );

            console.log(`[YAPPY] UAT Status:`, result.status);
            console.log(`[YAPPY] UAT Respuesta:`, JSON.stringify(result.data));

            if (result.status === 200 && result.data.status?.code === '0000') {
              console.log(`[YAPPY] UAT EXITO`);
              res.setHeader('Access-Control-Allow-Origin', '*');
              return res.status(200).json(result.data);
            }
          }
        }
      }

      console.log('[YAPPY] TODOS los intentos fallaron.');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(403).json({
        error: 'Yappy payment failed - All attempts exhausted',
        details: {
          code: 'MERCHANT_NOT_ACTIVATED',
          description: 'El comercio no tiene permisos para crear ordenes. Verifique en Yappy Comercial que el Boton de Pago este activado (estado: Activo, no Pendiente). Contacte botondepagoYappy@bgeneral.com con su merchantId: ' + COMMERCE_ID
        }
      });
    }

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