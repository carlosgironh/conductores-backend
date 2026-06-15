// routes/yappy.js
// ============================================================
// API Yappy para Render — v4.0 (fix 401 - secretKey decodificado)
// Endpoint: POST https://conductores-api.onrender.com/api/yappy
// ============================================================

const express = require('express');
const router = express.Router();

const YAPPY_API_BASE = 'https://apipagosbg.bgeneral.cloud';
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

      console.log('[YAPPY] Request body:', JSON.stringify(requestBody));

      const yappyRes = await fetch(`${YAPPY_API_BASE}/payments/validate/merchant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      const yappyData = await yappyRes.json();
      console.log('[YAPPY] Respuesta validate:', JSON.stringify(yappyData));

      if (yappyData.status?.code !== '0000') {
        console.error('[YAPPY] Yappy rechazó validación:', yappyData.status);
        return res.status(400).json({
          error: 'Yappy validation failed',
          details: yappyData.status,
          raw: yappyData,
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
      console.log('[YAPPY] yappyToken (primeros 50 chars):', yappyToken ? yappyToken.slice(0, 50) + '...' : 'VACÍO');

      if (!yappyToken) {
        console.error('[YAPPY] ERROR: yappyToken está vacío');
        return res.status(400).json({ error: 'yappyToken es requerido' });
      }

      // ─── Body del request a Yappy ───
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

      // Agregar secretKey decodificado al body si existe
      if (SECRET_KEY) {
        requestBody.secretKey = SECRET_KEY;
        console.log('[YAPPY] secretKey (decodificado) agregado al body');
      }

      const authHeader = `Bearer ${yappyToken}`;
      console.log('[YAPPY] Authorization header:', authHeader.slice(0, 60) + '...');
      console.log('[YAPPY] Request body:', JSON.stringify(requestBody));

      // ─── Headers para Yappy ───
      const yappyHeaders = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': authHeader,
      };

      console.log('[YAPPY] Headers:', JSON.stringify(yappyHeaders));

      // ─── Intentar con /payments/payment-wc ───
      console.log('[YAPPY] Intentando endpoint: /payments/payment-wc');
      let yappyRes = await fetch(`${YAPPY_API_BASE}/payments/payment-wc`, {
        method: 'POST',
        headers: yappyHeaders,
        body: JSON.stringify(requestBody),
      });

      let responseText = await yappyRes.text();
      console.log('[YAPPY] HTTP Status (payment-wc):', yappyRes.status);
      console.log('[YAPPY] Respuesta (payment-wc):', responseText);

      // Si falla con 401/403, intentar con /payments/payment
      if (yappyRes.status === 401 || yappyRes.status === 403) {
        console.log('[YAPPY] ⚠️ ' + yappyRes.status + ' con payment-wc. Intentando /payments/payment...');

        yappyRes = await fetch(`${YAPPY_API_BASE}/payments/payment`, {
          method: 'POST',
          headers: yappyHeaders,
          body: JSON.stringify(requestBody),
        });

        responseText = await yappyRes.text();
        console.log('[YAPPY] HTTP Status (payment):', yappyRes.status);
        console.log('[YAPPY] Respuesta (payment):', responseText);
      }

      // Si sigue fallando, intentar SIN Authorization header (solo secretKey en body)
      if ((yappyRes.status === 401 || yappyRes.status === 403) && SECRET_KEY) {
        console.log('[YAPPY] ⚠️ Siguiente ' + yappyRes.status + '. Intentando sin Authorization header...');

        const bodyWithoutAuth = { ...requestBody };

        yappyRes = await fetch(`${YAPPY_API_BASE}/payments/payment-wc`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify(bodyWithoutAuth),
        });

        responseText = await yappyRes.text();
        console.log('[YAPPY] HTTP Status (sin auth):', yappyRes.status);
        console.log('[YAPPY] Respuesta (sin auth):', responseText);
      }

      let yappyData;
      try {
        yappyData = JSON.parse(responseText);
      } catch (e) {
        yappyData = { raw: responseText };
      }

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