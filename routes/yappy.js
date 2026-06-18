const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const router = express.Router();

// ============================================================
// CONFIGURACIÓN
// ============================================================
const YAPPY_MERCHANT_ID = process.env.YAPPY_MERCHANT_ID || '9aaf1605-ec6d-4ace-a610-86897b898cc2';
const YAPPY_SECRET_KEY = process.env.YAPPY_SECRET_KEY || '';
const YAPPY_DOMAIN = process.env.YAPPY_DOMAIN || 'https://nrdesingcorp.com';
const YAPPY_API_URL = 'https://apipagosbg.bgeneral.cloud';
const YAPPY_ALIAS_DEFAULT = '69977978';

// Supabase REST API (usando axios, no necesita @supabase/supabase-js)
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ugchmuhjzzyofoogprlr.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

// Headers para Supabase REST API
const supabaseHeaders = {
  'apikey': SUPABASE_SERVICE_KEY,
  'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

// Log de diagnóstico al cargar
console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║           YAPPY API v3.4 - IPN + Supabase REST             ║');
console.log('╠════════════════════════════════════════════════════════════╣');
console.log('║ MERCHANT_ID:', YAPPY_MERCHANT_ID.substring(0, 20) + '...');
console.log('║ ALIAS_DEFAULT:', YAPPY_ALIAS_DEFAULT);
console.log('║ SECRET_KEY:', YAPPY_SECRET_KEY ? 'SÍ (' + YAPPY_SECRET_KEY.length + ' chars)' : 'NO');
console.log('║ SUPABASE_SERVICE_KEY:', SUPABASE_SERVICE_KEY ? 'SÍ (' + SUPABASE_SERVICE_KEY.length + ' chars)' : 'NO');
console.log('╚════════════════════════════════════════════════════════════╝');

// ============================================================
// HELPERS - Supabase REST API
// ============================================================
async function supabaseInsert(table, data) {
  if (!SUPABASE_SERVICE_KEY) return { error: 'No SUPABASE_SERVICE_KEY' };
  try {
    const response = await axios.post(
      `${SUPABASE_URL}/rest/v1/${table}`,
      data,
      { headers: supabaseHeaders }
    );
    return { data: response.data, error: null };
  } catch (error) {
    return { data: null, error: error.response?.data || error.message };
  }
}

async function supabaseUpdate(table, match, data) {
  if (!SUPABASE_SERVICE_KEY) return { error: 'No SUPABASE_SERVICE_KEY' };
  try {
    const matchParams = Object.entries(match)
      .map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`)
      .join('&');
    const response = await axios.patch(
      `${SUPABASE_URL}/rest/v1/${table}?${matchParams}`,
      data,
      { headers: supabaseHeaders }
    );
    return { data: response.data, error: null };
  } catch (error) {
    return { data: null, error: error.response?.data || error.message };
  }
}

async function supabaseSelect(table, match, columns = '*') {
  if (!SUPABASE_SERVICE_KEY) return { data: null, error: 'No SUPABASE_SERVICE_KEY' };
  try {
    const matchParams = Object.entries(match)
      .map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`)
      .join('&');
    const response = await axios.get(
      `${SUPABASE_URL}/rest/v1/${table}?${matchParams}&select=${columns}`,
      { headers: supabaseHeaders }
    );
    return { data: response.data, error: null };
  } catch (error) {
    return { data: null, error: error.response?.data || error.message };
  }
}

// ============================================================
// GET /api/yappy - Info y diagnóstico
// ============================================================
router.get('/', (req, res) => {
  res.json({
    status: 'Yappy API activa',
    version: '3.4 - IPN + Supabase REST API (axios)',
    endpoints: {
      'GET /api/yappy': 'Info y diagnóstico',
      'POST /api/yappy': 'Crear orden (action: create-order)',
      'GET /api/yappy/ipn': 'IPN - Notificación de pago instantánea'
    },
    config: {
      merchantId: YAPPY_MERCHANT_ID,
      aliasDefault: YAPPY_ALIAS_DEFAULT,
      domain: YAPPY_DOMAIN,
      supabaseConfigured: !!SUPABASE_SERVICE_KEY
    }
  });
});

// ============================================================
// POST /api/yappy - Crear orden completa
// ============================================================
router.post('/', async (req, res) => {
  const startTime = Date.now();
  const { action, total, subtotal, taxes, discount, orderId, aliasYappy, conductor_id, auth_user_id } = req.body;

  console.log(`[YAPPY] [${new Date().toISOString()}] POST /api/yappy`);
  console.log(`[YAPPY] Body recibido:`, JSON.stringify(req.body, null, 2));

  const finalAlias = aliasYappy || YAPPY_ALIAS_DEFAULT;
  console.log(`[YAPPY] aliasYappy desde frontend: "${aliasYappy}"`);
  console.log(`[YAPPY] aliasYappy final a usar: "${finalAlias}"`);
  console.log(`[YAPPY] conductor_id: "${conductor_id}"`);
  console.log(`[YAPPY] auth_user_id: "${auth_user_id}"`);

  if (action !== 'create-order') {
    return res.status(400).json({ error: 'Acción no válida. Use action: create-order' });
  }

  const finalOrderId = orderId || 'ORD' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const finalSubtotal = subtotal || total || '0.01';
  const finalTaxes = taxes || '0.00';
  const finalDiscount = discount || '0.00';
  const finalTotal = total || '0.01';
  const paymentDate = Math.floor(Date.now() / 1000).toString();
  const ipnUrl = `${YAPPY_DOMAIN}/api/yappy/ipn`;

  try {
    // PASO 1: Validar comercio
    console.log('[YAPPY] [PASO 1/2] Validando comercio...');
    const validateBody = { merchantId: YAPPY_MERCHANT_ID, urlDomain: YAPPY_DOMAIN };

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
      return res.status(500).json({ error: 'No se pudo obtener token', details: validateResponse.data });
    }

    console.log(`[YAPPY] [PASO 1/2] Token obtenido, epochTime: ${epochTime}`);

    // PASO 2: Crear orden en Yappy
    console.log('[YAPPY] [PASO 2/2] Creando orden...');
    console.log(`[YAPPY] [PASO 2/2] aliasYappy FINAL: "${finalAlias}"`);

    const paymentBody = {
      merchantId: YAPPY_MERCHANT_ID,
      orderId: finalOrderId,
      domain: YAPPY_DOMAIN,
      paymentDate: paymentDate,
      aliasYappy: finalAlias,
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
        headers: { 'Authorization': token, 'Content-Type': 'application/json' },
        timeout: 15000
      }
    );

    console.log('[YAPPY] [PASO 2/2] Respuesta:', JSON.stringify(paymentResponse.data, null, 2));

    const responseBody = paymentResponse.data?.body || {};
    const transactionId = responseBody.transactionId;
    const paymentToken = responseBody.token;
    const documentName = responseBody.documentName;

    // PASO 3: Guardar en tabla pagos usando Supabase REST API
    if (SUPABASE_SERVICE_KEY && conductor_id) {
      try {
        console.log(`[YAPPY] [PASO 3/3] Guardando en tabla pagos...`);

        const { data: pagoData, error: pagoError } = await supabaseInsert('pagos', {
          conductor_id: conductor_id,
          auth_user_id: auth_user_id || null,
          monto: parseFloat(finalTotal),
          moneda: 'USD',
          plan: 'basico_24h',
          estado: 'pendiente',
          metodo: 'yappy',
          referencia: finalOrderId,
          fecha_pago: new Date().toISOString(),
          fecha_vencimiento: null,
          yappy_transaction_id: transactionId || null,
          yappy_document_name: documentName || null
        });

        if (pagoError) {
          console.error('[YAPPY] [PASO 3/3] Error insertando pago:', JSON.stringify(pagoError));
        } else {
          console.log(`[YAPPY] [PASO 3/3] ✅ Pago guardado. Referencia: ${finalOrderId}`);
        }
      } catch (e) {
        console.error('[YAPPY] [PASO 3/3] Error:', e.message);
      }
    } else {
      console.log('[YAPPY] [PASO 3/3] ⚠️ Supabase no configurado o sin conductor_id');
    }

    return res.json({
      success: true,
      step: 'complete',
      orderId: finalOrderId,
      aliasYappyUsed: finalAlias,
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
      aliasYappyUsed: finalAlias
    });
  }
});

// ============================================================
// IPN - Notificación instantánea de pago (GET)
// ============================================================
router.get('/ipn', async (req, res) => {
  const { orderId, status, hash, domain, confirmationNumber } = req.query;

  console.log(`[YAPPY IPN] ==========================================`);
  console.log(`[YAPPY IPN] orderId: ${orderId}`);
  console.log(`[YAPPY IPN] status: ${status}`);
  console.log(`[YAPPY IPN] hash: ${hash}`);
  console.log(`[YAPPY IPN] domain: ${domain}`);
  console.log(`[YAPPY IPN] confirmationNumber: ${confirmationNumber}`);
  console.log(`[YAPPY IPN] ==========================================`);

  // Validar hash con secret key
  let hashValid = false;
  if (YAPPY_SECRET_KEY && hash && orderId && status && domain) {
    try {
      const values = Buffer.from(YAPPY_SECRET_KEY, 'base64').toString('utf-8');
      const secrete = values.split('.');
      const signature = crypto.createHmac('sha256', secrete[0])
                              .update(orderId + status + domain)
                              .digest('hex');
      hashValid = hash === signature;
      console.log(`[YAPPY IPN] Hash validation: ${hashValid ? 'VALID ✅' : 'INVALID ❌'}`);
    } catch (e) {
      console.error('[YAPPY IPN] Error validando hash:', e.message);
    }
  }

  // Procesar según estado del pago
  if (status === 'E') {
    console.log(`[YAPPY IPN] ✅ PAGO EJECUTADO - Orden: ${orderId}`);

    if (SUPABASE_SERVICE_KEY) {
      try {
        // 1. Buscar pago por referencia (orderId)
        console.log(`[YAPPY IPN] Buscando pago con referencia: ${orderId}`);
        const { data: pagos, error: findError } = await supabaseSelect('pagos', { referencia: orderId }, 'id,conductor_id,auth_user_id,monto,estado');

        if (findError) {
          console.error('[YAPPY IPN] Error buscando pago:', JSON.stringify(findError));
        } else if (!pagos || pagos.length === 0) {
          console.log(`[YAPPY IPN] ⚠️ No se encontró pago con referencia: ${orderId}`);
        } else {
          const pago = pagos[0];
          console.log(`[YAPPY IPN] Pago encontrado: ID=${pago.id}, conductor_id=${pago.conductor_id}`);

          // 2. Actualizar pago a 'pagado'
          const { error: updatePagoError } = await supabaseUpdate('pagos',
            { id: pago.id },
            {
              estado: 'pagado',
              yappy_transaction_id: confirmationNumber || null,
              fecha_vencimiento: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            }
          );

          if (updatePagoError) {
            console.error('[YAPPY IPN] Error actualizando pago:', JSON.stringify(updatePagoError));
          } else {
            console.log(`[YAPPY IPN] ✅ Pago actualizado a 'pagado'`);
          }

          // 3. Activar suscripción del conductor
          const ahora = new Date();
          const expiracion = new Date(ahora.getTime() + 24 * 60 * 60 * 1000);

          const { data: conductores, error: condError } = await supabaseSelect('conductores',
            { id: pago.conductor_id },
            'id,nombres,apellidos,auth_user_id'
          );

          if (condError) {
            console.error('[YAPPY IPN] Error buscando conductor:', JSON.stringify(condError));
          } else if (conductores && conductores.length > 0) {
            const conductor = conductores[0];
            console.log(`[YAPPY IPN] Conductor: ${conductor.nombres} ${conductor.apellidos}`);

            const { error: updateCondError } = await supabaseUpdate('conductores',
              { id: pago.conductor_id },
              {
                status: 'active',
                suscripcion_activa: true,
                pago_al_dia: true,
                fecha_ultimo_pago: ahora.toISOString(),
                proximo_pago: expiracion.toISOString(),
                fecha_vencimiento: expiracion.toISOString(),
                payment_status: 'paid'
              }
            );

            if (updateCondError) {
              console.error('[YAPPY IPN] Error activando suscripción:', JSON.stringify(updateCondError));
            } else {
              console.log(`[YAPPY IPN] ✅ Suscripción activada para ${conductor.nombres} ${conductor.apellidos}`);
              console.log(`[YAPPY IPN] ✅ Válida hasta: ${expiracion.toISOString()}`);
            }
          }
        }
      } catch (e) {
        console.error('[YAPPY IPN] Error en procesamiento IPN:', e.message);
      }
    } else {
      console.log('[YAPPY IPN] ⚠️ Supabase no configurado');
    }
  } else if (status === 'R') {
    console.log(`[YAPPY IPN] ❌ PAGO RECHAZADO - Orden: ${orderId}`);
    await actualizarEstadoPago(orderId, 'rechazado');
  } else if (status === 'C') {
    console.log(`[YAPPY IPN] ❌ PAGO CANCELADO - Orden: ${orderId}`);
    await actualizarEstadoPago(orderId, 'cancelado');
  } else if (status === 'X') {
    console.log(`[YAPPY IPN] ⏰ PAGO EXPIRADO - Orden: ${orderId}`);
    await actualizarEstadoPago(orderId, 'expirado');
  }

  // Responder a Yappy
  res.json({ success: true, received: true, orderId, status, hashValid });
});

// Helper para actualizar estado de pago
async function actualizarEstadoPago(orderId, estado) {
  if (!SUPABASE_SERVICE_KEY || !orderId) return;
  try {
    const { error } = await supabaseUpdate('pagos', { referencia: orderId }, { estado: estado });
    if (error) console.error(`[YAPPY IPN] Error actualizando pago a ${estado}:`, JSON.stringify(error));
    else console.log(`[YAPPY IPN] Pago ${orderId} actualizado a: ${estado}`);
  } catch (e) {
    console.error('[YAPPY IPN] Error:', e.message);
  }
}

module.exports = router;