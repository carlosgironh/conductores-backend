// routes/yappy.js
// ============================================================
// API Yappy para Render — v5.0 (prueba endpoint UAT)
// Endpoint: POST https://conductores-api.onrender.com/api/yappy
// ============================================================

const express = require('express');
const router = express.Router();

// ─── Endpoints ───
const YAPPY_API_PROD = 'https://apipagosbg.bgeneral.cloud';
const YAPPY_API_UAT = 'https://api-comecom-uat.yappycloud.com';
const YAPPY_API_BASE = YAPPY_API_PROD; // Cambiar a UAT si es necesario

const COMMERCE_ID = process.env.YAPPY_COMMERCE_ID;
const SECRET_KEY_B64 = process.env.YAPPY_SECRET_KEY;

// Decodificar secretKey si está en base64
let SECRET_KEY = SECRET_KEY_B64;
try {
  if (SECRET_KEY_B64) {
    const decoded = Buffer.from(SECRET_KEY_B64, 'base64').toString('utf-8');
    if (decoded && decoded.includes('.')) {
      SECRET_KEY = decoded;
      console.log('[YAPPY CONFIG] SecretKey decodificado correctamente');
    }
  }
} catch (e) {
  console.log('[YAPPY CONFIG] SecretKey no requiere decodificación');
}

// ─── Verificar variables de entorno al iniciar ───
console.log('[YAPPY CONFIG] Verificando variables de entorno...');
console.log('[YAPPY CONFIG] COMMERCE_ID:', COMMERCE_ID ? '✓ Configurado (' + COMMERCE_ID.slice(0, 8) + '...)' : '✗ NO CONFIGURADO');
console.log('[YAPPY CONFIG] SECRET_KEY (raw):', SECRET_KEY_B64 ? '✓ Configurado (' + SECRET_KEY_B64.slice(0, 8) + '...)' : '✗ NO CONFIGURADO');
console.log('[YAPPY CONFIG] SECRET_KEY (decoded):', SECRET_KEY ? '✓ Decodificado (' + SECRET_KEY.slice(0, 20) + '...)' : '✗ NO DISPONIBLE');
console.log('[YAPPY CONFIG] API Base:', YAPPY_API_BASE);

if (!COMMERCE_ID) {
  console.error('[YAPPY CONFIG] ⚠️ ERROR: YAPPY_COMMERCE_ID no está configurado.');
}
if (!SECRET_KEY) {
  console.error('[YAPPY CONFIG] ⚠️ ADVERTENCIA: YAPPY_SECRET_KEY no está configurado.');
}

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

// ─── Helper: hacer request a Yappy con reintentos ───
async function callYappy(endpoint, headers, body, apiBase = YAPPY_API_BASE) {
  const url = `${apiBase}${endpoint}`;
  console.log(`[YAPPY] Calling: ${url}`);
  console.log('[YAPPY] Headers:', JSON.stringify(headers));
  console.log('[YAPPY] Body:', JSON.stringify(body));

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const text = await res.text();
  console.log(`[YAPPY] Status: ${res.status}`);
  console.log(`[YAPPY] Response: ${text}`);

  let data;
  try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }

  return { status: res.status, data };
}

// ─── POST /api/yappy ───
router.post('/', async (req, res) => {
  const { action } = req.body;

  console.log(`[YAPPY API] Action: ${action} | Time: ${new Date().toISOString()}`);

  // Validar que COMMERCE_ID esté configurado
  if (!COMMERCE_ID) {
    console.error('[YAPPY API] ERROR: YAPPY_COMMERCE_ID no está configurado');
    return res.status(500).json({
      error: 'Server configuration error',
      message: 'YAPPY_COMMERCE_ID no está configurado.',
    });
  }

  try {
    // ═══════════════════════════════════════════════════════════
    // PASO 1: Validar comercio
    // ═══════════════════════════════════════════════════════════
    if (action === 'validate') {
      const { urlDomain } = req.body;

      console.log('[YAPPY] Paso 1: Validando comercio...');
      console.log('[YAPPY] merchantId:', COMMERCE_ID);
      console.log('[YAPPY] urlDomain:', urlDomain);

      const requestBody = {
        merchantId: COMMERCE_ID,
        urlDomain: urlDomain,
      };

      // Intentar con PROD primero
      let result = await callYappy(
        '/payments/validate/merchant',
        { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        requestBody,
        YAPPY_API_PROD
      );

      // Si falla, intentar con UAT
      if (result.status !== 200 || result.data.status?.code !== '0000') {
        console.log('[YAPPY] PROD falló. Intentando UAT...');
        result = await callYappy(
          '/payments/validate/merchant',
          { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          requestBody,
          YAPPY_API_UAT
        );
      }

      if (result.status !== 200 || result.data.status?.code !== '0000') {
        console.error('[YAPPY] Yappy rechazó validación:', result.data.status || result.data);
        return res.status(400).json({
          error: 'Yappy validation failed',
          details: result.data.status || result.data,
          raw: result.data,
        });
      }

      const epochTime = extractEpochTime(result.data.body?.token);

      return res.json({
        status: result.data.status,
        body: result.data.body,
        epochTime: epochTime,
        apiUsed: result.status === 200 ? 'PROD' : 'UAT',
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
      console.log('[YAPPY] yappyToken (primeros 50 chars):', yappyToken ? yappyToken.slice(0, 50) + '...' : 'VACÍO');

      if (!yappyToken) {
        console.error('[YAPPY] ERROR: yappyToken está vacío');
        return res.status(400).json({ error: 'yappyToken es requerido' });
      }

      const requestBody = {
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
      };

      if (SECRET_KEY) {
        requestBody.secretKey = SECRET_KEY;
        console.log('[YAPPY] secretKey agregado al body');
      }

      const authHeader = `Bearer ${yappyToken}`;
      const yappyHeaders = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': authHeader,
      };

      // ─── Intentar con PROD primero ───
      console.log('[YAPPY] Intentando PROD: /payments/payment-wc');
      let result = await callYappy(
        '/payments/payment-wc',
        yappyHeaders,
        requestBody,
        YAPPY_API_PROD
      );

      // Si falla con 401/403, intentar con UAT
      if (result.status === 401 || result.status === 403) {
        console.log('[YAPPY] PROD falló con ' + result.status + '. Intentando UAT...');
        result = await callYappy(
          '/payments/payment-wc',
          yappyHeaders,
          requestBody,
          YAPPY_API_UAT
        );
      }

      // Si sigue fallando, intentar endpoint alternativo /payments/payment
      if (result.status === 401 || result.status === 403) {
        console.log('[YAPPY] Intentando endpoint alternativo: /payments/payment');
        result = await callYappy(
          '/payments/payment',
          yappyHeaders,
          requestBody,
          YAPPY_API_PROD
        );
      }

      return res.status(result.status).json(result.data);
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