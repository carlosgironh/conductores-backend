/********************************************************************
 * 🚀 BACKEND API CONDUCTORES - VERSIÓN 2026 SEGURA
 * ✔ RLS compatible
 * ✔ Bucket PRIVADO
 * ✔ Signed URLs
 * ✔ Validaciones completas
 ********************************************************************/

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");

const app = express();

/* =====================================================
   🌍 CORS
===================================================== */
app.use(cors({
  origin: "*"
}));

app.use(express.json());

/* =====================================================
   🚦 RATE LIMIT
===================================================== */
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

/* =====================================================
   🔐 SUPABASE
===================================================== */

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const supabaseClient = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/* =====================================================
   📂 MULTER
===================================================== */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["application/pdf", "image/jpeg"];
    if (!allowed.includes(file.mimetype)) {
      cb(new Error("Solo PDF o JPG"));
    } else {
      cb(null, true);
    }
  }
});

/* =====================================================
   🛡️ VERIFY JWT
===================================================== */
async function verifyJWT(req, res, next) {

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: "Token requerido" });
  }

  const token = authHeader.replace("Bearer ", "");

  const { data, error } =
    await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    return res.status(401).json({ error: "Token inválido" });
  }

  req.user = data.user;
  req.supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    }
  );

  next();
}

/* =====================================================
   ROOT
===================================================== */
app.get("/", (req, res) => {
  res.send("API Conductores funcionando 🚗");
});

/* =====================================================
   📝 REGISTRO
===================================================== */
app.post("/api/registro", async (req, res) => {

  const {
    email, password,
    nombres, apellidos, cedula, licencia,
    placa, modelo, marca, color,
    poliza_numero, celular, direccion
  } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email y password requeridos" });
  }

  try {

    const { data: userData, error: userError } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { role: "conductor" }
      });

    if (userError) {
      return res.status(400).json({ error: userError.message });
    }

    const userId = userData.user.id;
    const qr_token = crypto.randomBytes(16).toString("hex");

    const { data: conductor, error } =
      await supabaseAdmin
        .from("conductores")
        .insert([{
          nombres,
          apellidos,
          cedula,
          licencia,
          placa,
          modelo,
          marca,
          color,
          poliza_numero,
          celular,
          direccion,
          auth_user_id: userId,
          qr_token
        }])
        .select()
        .single();

    if (error) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return res.status(400).json({ error: error.message });
    }

    res.json({
      conductorId: conductor.id,
      qr_token
    });

  } catch {
    res.status(500).json({ error: "Error en registro" });
  }
});

/* =====================================================
   🔐 LOGIN
===================================================== */
app.post("/api/login", async (req, res) => {

  const { email, password } = req.body;

  const { data, error } =
    await supabaseClient.auth.signInWithPassword({ email, password });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json({ token: data.session.access_token });
});

/* =====================================================
   📂 SUBIR DOCUMENTO
===================================================== */
app.post(
  "/api/documentos/:conductorId/:tipo",
  verifyJWT,
  upload.single("archivo"),
  async (req, res) => {

    const { conductorId, tipo } = req.params;

    const tiposPermitidos = [
      "cedula",
      "licencia",
      "registro_vehicular",
      "poliza_vehicular",
      "foto_vehiculo",
      "foto_conductor"
    ];

    if (!tiposPermitidos.includes(tipo)) {
      return res.status(400).json({ error: "Tipo inválido" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Archivo requerido" });
    }

    try {

      const { data: conductor } =
        await req.supabase
          .from("conductores")
          .select("id")
          .eq("id", conductorId)
          .single();

      if (!conductor) {
        return res.status(403).json({ error: "No autorizado" });
      }

      const filePath = `${conductorId}/${tipo}_${Date.now()}`;

      const { error } =
        await supabaseAdmin.storage
          .from("documentos-conductores")
          .upload(filePath, req.file.buffer, {
            contentType: req.file.mimetype,
            upsert: true
          });

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      await req.supabase
        .from("documentos")
        .insert([{
          conductor_id: conductorId,
          tipo,
          file_path: filePath
        }]);

      res.json({ mensaje: "Archivo subido correctamente" });

    } catch {
      res.status(500).json({ error: "Error subiendo archivo" });
    }
  }
);

/* =====================================================
   🔎 PERFIL PÚBLICO
===================================================== */
app.get("/api/perfil/:token", async (req, res) => {

  const { token } = req.params;

  const { data: conductor } =
    await supabaseAdmin
      .from("conductores")
      .select("id,nombres,apellidos,placa,modelo,marca,color")
      .eq("qr_token", token)
      .single();

  if (!conductor) {
    return res.status(404).json({ error: "No encontrado" });
  }

  const { data: documentos } =
    await supabaseAdmin
      .from("documentos")
      .select("tipo,file_path")
      .eq("conductor_id", conductor.id);

  const docsConUrl = await Promise.all(
    (documentos || []).map(async (doc) => {

      const { data } =
        await supabaseAdmin.storage
          .from("documentos-conductores")
          .createSignedUrl(doc.file_path, 300);

      return {
        tipo: doc.tipo,
        url: data?.signedUrl
      };
    })
  );

  res.json({ conductor, documentos: docsConUrl });
});

/* =====================================================
   START
===================================================== */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto " + PORT);
});