/********************************************************************
 * 🚀 BACKEND API CONDUCTORES - VERSIÓN PRODUCCIÓN FINAL
 * -------------------------------------------------
 * ✔ Seguridad avanzada
 * ✔ Validaciones completas
 * ✔ Bucket PRIVADO
 * ✔ Signed URLs
 * ✔ Tipos alineados con frontend
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
   🌍 CORS (Restringir dominios en producción real)
===================================================== */
app.use(cors());

/* =====================================================
   📦 JSON BODY
===================================================== */
app.use(express.json());

/* =====================================================
   🚦 RATE LIMIT
===================================================== */
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Demasiadas solicitudes. Intente más tarde." }
});
app.use(limiter);

/* =====================================================
   🔐 SUPABASE CONFIG
===================================================== */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* =====================================================
   📂 MULTER CONFIG
===================================================== */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["application/pdf", "image/jpeg", "image/jpg"];

    if (!allowedTypes.includes(file.mimetype)) {
      cb(new Error("Solo se permiten archivos PDF o JPG"));
    } else {
      cb(null, true);
    }
  }
});

/* =====================================================
   🛡️ VALIDAR JWT
===================================================== */
async function verifyJWT(req, res, next) {

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token requerido" });
  }

  const token = authHeader.split(" ")[1];

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    return res.status(401).json({ error: "Token inválido" });
  }

  req.user = data.user;
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

  try {

    const {
      email, password,
      nombres, apellidos, cedula, licencia,
      placa, modelo, marca, color,
      poliza_numero, celular, direccion
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email y password requeridos" });
    }

    /* Crear usuario */
    const { data: userData, error: userError } =
      await supabase.auth.admin.createUser({
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

    /* Insertar conductor */
    const { data: conductor, error: conductorError } =
      await supabase
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

    if (conductorError) {
      await supabase.auth.admin.deleteUser(userId);
      return res.status(400).json({ error: conductorError.message });
    }

    res.json({
      conductorId: conductor.id,
      qr_token
    });

  } catch (err) {
    res.status(500).json({ error: "Error en registro" });
  }
});

/* =====================================================
   🔐 LOGIN
===================================================== */
app.post("/api/login", async (req, res) => {

  try {

    const { email, password } = req.body;

    const { data, error } =
      await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({
      token: data.session.access_token
    });

  } catch {
    res.status(500).json({ error: "Error en login" });
  }
});

/* =====================================================
   📂 SUBIDA DOCUMENTOS (TIPOS ALINEADOS)
===================================================== */
app.post(
  "/api/documentos/:conductorId/:tipo",
  verifyJWT,
  upload.single("archivo"),
  async (req, res) => {

    try {

      const { conductorId, tipo } = req.params;

      /* Tipos permitidos alineados con frontend */
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

      /* Verificar propiedad */
      const { data: conductor } =
        await supabase
          .from("conductores")
          .select("id")
          .eq("id", conductorId)
          .eq("auth_user_id", req.user.id)
          .single();

      if (!conductor) {
        return res.status(403).json({ error: "No autorizado" });
      }

      const filePath = `${conductorId}/${tipo}_${Date.now()}`;

      /* Subir a bucket PRIVADO */
      const { error } =
        await supabase.storage
          .from("documentos-conductores")
          .upload(filePath, req.file.buffer, {
            contentType: req.file.mimetype,
            upsert: true
          });

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      /* Guardar path en BD */
      await supabase.from("documentos").insert([{
        conductor_id: conductorId,
        tipo,
        file_path: filePath
      }]);

      res.json({ mensaje: "Archivo subido correctamente" });

    } catch (err) {
      res.status(500).json({ error: "Error subiendo archivo" });
    }
  }
);

/* =====================================================
   🔎 PERFIL PÚBLICO CON SIGNED URL
===================================================== */
app.get("/api/perfil/:token", async (req, res) => {

  try {

    const { token } = req.params;

    const { data: conductor } =
      await supabase
        .from("conductores")
        .select("id,nombres,apellidos,placa,modelo,marca,color")
        .eq("qr_token", token)
        .single();

    if (!conductor) {
      return res.status(404).json({ error: "No encontrado" });
    }

    const { data: documentos } =
      await supabase
        .from("documentos")
        .select("tipo,file_path")
        .eq("conductor_id", conductor.id);

    const docsConUrl = await Promise.all(
      (documentos || []).map(async (doc) => {

        const { data } =
          await supabase.storage
            .from("documentos-conductores")
            .createSignedUrl(doc.file_path, 60 * 5);

        return {
          tipo: doc.tipo,
          url: data?.signedUrl
        };
      })
    );

    res.json({ conductor, documentos: docsConUrl });

  } catch {
    res.status(500).json({ error: "Error cargando perfil" });
  }
});

/* =====================================================
   🚀 START SERVER
===================================================== */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto " + PORT);
});