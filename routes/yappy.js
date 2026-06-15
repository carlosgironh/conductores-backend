// routes/yappy.js
// ============================================================
// API Yappy para Render — v6.0 (Single-step flow)
// El frontend llama una vez con action="create-order"
// La API hace validate + payment internamente
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
    // FLUJO COMPLETO EN UN SOLO PASO
    // ═══════════════════════════════════════════════════════════
    if (action === 'create-order') {
      const {
        urlDomain,
        orderId,
        domain,
        aliasYappy,
        ipnUrl,
        discount,
        taxes,
        subtotal,
        total,
      } = req.body;

      console.log('[YAPPY] === FLUJO COMPLETO EN UN SOLO PASO ===');
      console.log('[YAPPY] merchantId:', COMMERCE_ID);
      console.log('[YAPPY] urlDomain:', urlDomain);
      console.log('[YAPPY] orderId:', orderId);
      console.log('[YAPPY] total:', total);

      // ─── PASO 1: Validar comercio (interno) ───
      console.log('[YAPPY] [1/2] Validando comercio...');

      const validateRes = await fetch(`${YAPPY_API_BASE}/payments/validate/merchant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          merchantId: COMMERCE_ID,
          urlDomain: urlDomain,
        }),
      });

      const validateData = await validateRes.json();
      console.log('[YAPPY] [1/2] Respuesta validate:', JSON.stringify(validateData));

      if (validateData.status?.code !== '0000') {
        console.error('[YAPPY] [1/2] Yappy rechazó validación:', validateData.status);
        return res.status(400).json({
          error: 'Yappy validation failed',
          details: validateData.status,
          raw: validateData,
        });
      }

      const yappyToken = validateData.body?.token;
      const epochTime = extractEpochTime(yappyToken);

      if (!yappyToken) {
        console.error('[YAPPY] [1/2] No se recibió token de Yappy');
        return res.status(500).json({ error: 'No token received from Yappy' });
      }

      console.log('[YAPPY] [1/2] ✓ Token obtenido, epochTime:', epochTime);

      // ─── PASO 2: Crear orden (interno, inmediatamente) ───
      console.log('[YAPPY] [2/2] Creando orden...');

      const paymentBody = {
        merchantId: COMMERCE_ID,
        orderId: orderId,
        domain: domain,
        paymentDate: String(epochTime),
        aliasYappy: aliasYappy || '',
        ipnUrl: ipnUrl,
        discount: discount || '0.00',
        taxes: taxes || '0.00',
        subtotal: subtotal,
        total: total,
      };

      if (SECRET_KEY) {
        paymentBody.secretKey = SECRET_KEY;
      }

      const authHeader = `Bearer ${yappyToken}`;

      console.log('[YAPPY] [2/2] Authorization:', authHeader.slice(0, 60) + '...');
      console.log('[YAPPY] [2/2] Body:', JSON.stringify(paymentBody));

      const paymentRes = await fetch(`${YAPPY_API_BASE}/payments/payment-wc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': authHeader,
        },
        body: JSON.stringify(paymentBody),
      });

      const paymentText = await paymentRes.text();
      console.log('[YAPPY] [2/2] HTTP Status:', paymentRes.status);
      console.log('[YAPPY] [2/2] Respuesta:', paymentText);

      let paymentData;
      try {
        paymentData = JSON.parse(paymentText);
      } catch (e) {
        paymentData = { raw: paymentText };
      }

      // Si falla con 401/403, intentar con endpoint alternativo
      if (paymentRes.status === 401 || paymentRes.status === 403) {
        console.log('[YAPPY] [2/2] ⚠️ ' + paymentRes.status + ' con payment-wc. Intentando /payments/payment...');

        const altRes = await fetch(`${YAPPY_API_BASE}/payments/payment`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': authHeader,
          },
          body: JSON.stringify(paymentBody),
        });

        const altText = await altRes.text();
        console.log('[YAPPY] [2/2] HTTP Status (alt):', altRes.status);
        console.log('[YAPPY] [2/2] Respuesta (alt):', altText);

        if (altRes.status !== 401 && altRes.status !== 403) {
          try {
            paymentData = JSON.parse(altText);
          } catch (e) {
            paymentData = { raw: altText };
          }
          return res.status(altRes.status).json(paymentData);
        }
      }

      return res.status(paymentRes.status).json(paymentData);
    }

    // ═══════════════════════════════════════════════════════════
    // Acción inválida
    // ═══════════════════════════════════════════════════════════
    return res.status(400).json({
      error: 'Invalid action',
      message: 'Use "create-order"',
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