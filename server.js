require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

/* =====================================================
   🔐 CONFIGURACIÓN SUPABASE (SERVICE ROLE SOLO BACKEND)
===================================================== */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* =====================================================
   📦 CONFIGURACIÓN MULTER
   - Límite real 5MB
   - Solo PDF / JPG / JPEG
===================================================== */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "application/pdf",
      "image/jpeg",
      "image/jpg"
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      cb(new Error("Solo se permiten archivos PDF o JPG"));
    } else {
      cb(null, true);
    }
  }
});

/* =====================================================
   🛡️ MIDDLEWARE VALIDACIÓN JWT
===================================================== */
async function verifyJWT(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader)
      return res.status(401).json({ error: "Token requerido" });

    const token = authHeader.split(" ")[1];

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user)
      return res.status(401).json({ error: "Token inválido" });

    req.user = data.user;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token inválido" });
  }
}

/* =====================================================
   ROOT
===================================================== */
app.get("/", (req, res) => {
  res.send("API Conductores funcionando 🚗");
});

/* =====================================================
   REGISTRO (ANTI USUARIO HUÉRFANO)
===================================================== */
app.post("/api/registro", async (req, res) => {
  try {
    const {
      email, password, nombres, apellidos, cedula, licencia,
      placa, modelo, marca, color, poliza_numero, celular, direccion
    } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: "Email y password requeridos" });

    // 1️⃣ Crear usuario en Auth
    const { data: userData, error: userError } =
      await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      });

    if (userError)
      return res.status(400).json({ error: userError.message });

    const userId = userData.user.id;
    const qr_token = crypto.randomBytes(16).toString("hex");

    // 2️⃣ Insertar conductor
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

    // 🔥 Si falla, borrar usuario creado en Auth
    if (conductorError) {
      await supabase.auth.admin.deleteUser(userId);
      return res.status(400).json({ error: conductorError.message });
    }

    res.json({
      mensaje: "Conductor registrado correctamente",
      conductorId: conductor.id,
      qr_token
    });

  } catch (err) {
    console.error("Error registro:", err);
    res.status(500).json({ error: "Error en registro" });
  }
});

/* =====================================================
   LOGIN (DEVUELVE JWT)
===================================================== */
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const { data, error } =
      await supabase.auth.signInWithPassword({
        email,
        password
      });

    if (error)
      return res.status(400).json({ error: error.message });

    res.json({
      token: data.session.access_token,
      user: data.user
    });

  } catch (err) {
    res.status(500).json({ error: "Error en login" });
  }
});

/* =====================================================
   SUBIDA DOCUMENTOS SEGURA
===================================================== */
app.post(
  "/api/documentos/:conductorId/:tipo",
  verifyJWT, // 🔐 Solo usuario autenticado
  upload.single("archivo"),
  async (req, res) => {
    try {
      const { conductorId, tipo } = req.params;

      if (!req.file)
        return res.status(400).json({ error: "Archivo requerido" });

      // 🔐 Verificar que el conductor pertenece al usuario
      const { data: conductor } =
        await supabase
          .from("conductores")
          .select("*")
          .eq("id", conductorId)
          .eq("auth_user_id", req.user.id)
          .single();

      if (!conductor)
        return res.status(403).json({ error: "No autorizado" });

      const filePath = `${conductorId}/${tipo}_${Date.now()}`;

      // 🔥 Subir al bucket correcto
      const { error } =
        await supabase.storage
          .from("documentos-conductores")
          .upload(filePath, req.file.buffer, {
            contentType: req.file.mimetype,
            upsert: true
          });

      if (error)
        return res.status(400).json({ error: error.message });

      // Obtener URL pública
      const { data: publicUrlData } =
        supabase.storage
          .from("documentos-conductores")
          .getPublicUrl(filePath);

      // Guardar en tabla documentos
      await supabase
        .from("documentos")
        .insert([{
          conductor_id: conductorId,
          tipo,
          url_archivo: publicUrlData.publicUrl
        }]);

      res.json({
        mensaje: "Archivo subido correctamente",
        url: publicUrlData.publicUrl
      });

    } catch (err) {
      console.error("Error subida:", err);
      res.status(500).json({ error: "Error subiendo archivo" });
    }
  }
);

/* =====================================================
   PERFIL PÚBLICO POR QR TOKEN
===================================================== */
app.get("/api/perfil/:token", async (req, res) => {
  try {
    const { token } = req.params;

    const { data: conductor, error } =
      await supabase
        .from("conductores")
        .select("*")
        .eq("qr_token", token)
        .single();

    if (error || !conductor)
      return res.status(404).json({ error: "No encontrado" });

    const { data: documentos } =
      await supabase
        .from("documentos")
        .select("*")
        .eq("conductor_id", conductor.id);

    res.json({
      conductor,
      documentos: documentos || []
    });

  } catch (err) {
    res.status(500).json({ error: "Error cargando perfil" });
  }
});

/* =====================================================
   DASHBOARD ADMIN
===================================================== */
function verificarAdmin(req, res, next) {
  const pass = req.headers["admin-password"];
  if (!pass || pass !== process.env.ADMIN_PASSWORD)
    return res.status(401).json({ error: "No autorizado" });
  next();
}

app.get("/api/admin/conductores", verificarAdmin, async (req, res) => {
  try {
    const { q } = req.query;

    const { data } =
      await supabase
        .from("conductores")
        .select("*")
        .ilike("cedula", `%${q || ""}%`);

    res.json(data || []);

  } catch (err) {
    res.status(500).json({ error: "Error cargando conductores" });
  }
});

/* =====================================================
   INICIAR SERVIDOR
===================================================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log("Servidor corriendo en puerto " + PORT)
);