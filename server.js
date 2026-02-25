require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// =====================================================
// 🟢 ROOT
// =====================================================
app.get("/", (req, res) => {
  res.send("API de Conductores funcionando 🚗");
});

// =====================================================
// 🔐 MIDDLEWARE ADMIN
// =====================================================
function verificarAdmin(req, res, next) {
  const password = req.headers["admin-password"];

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "No autorizado" });
  }

  next();
}

// =====================================================
// 🟢 REGISTRO CONDUCTOR
// =====================================================
app.post("/api/conductores", async (req, res) => {
  try {
    const {
      nombres,
      apellidos,
      cedula,
      licencia,
      placa,
      modelo,
      marca,
      color,
      poliza_numero,
      poliza_tipo,
      celular,
      direccion,
      qr_token,
      auth_user_id
    } = req.body;

    if (!qr_token) {
      return res.status(400).json({ error: "QR token requerido" });
    }

    const { data, error } = await supabase
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
        poliza_tipo,
        celular,
        direccion,
        qr_token,
        auth_user_id
      }])
      .select()
      .single();

    if (error) throw error;

    res.json({ conductor: data });

  } catch (err) {
    console.error("Error creando conductor:", err);
    res.status(500).json({ error: "Error creando conductor" });
  }
});

// =====================================================
// 🟢 PERFIL PÚBLICO POR TOKEN (QR)
// =====================================================
app.get("/api/perfil/:token", async (req, res) => {
  try {
    const { token } = req.params;

    const { data: conductor, error } = await supabase
      .from("conductores")
      .select("*")
      .eq("qr_token", token)
      .single();

    if (error || !conductor) {
      return res.status(404).json({ error: "Conductor no encontrado" });
    }

    const { data: documentos } = await supabase
      .from("documentos")
      .select("*")
      .eq("conductor_id", conductor.id);

    const { data: quejas } = await supabase
      .from("quejas")
      .select("*")
      .eq("conductor_id", conductor.id)
      .order("fecha", { ascending: false });

    res.json({
      conductor,
      documentos: documentos || [],
      quejas: quejas || []
    });

  } catch (err) {
    console.error("Error perfil público:", err);
    res.status(500).json({ error: "Error obteniendo datos" });
  }
});

// =====================================================
// 🟢 SUBIR DOCUMENTOS
// =====================================================
app.post(
  "/api/documentos/:conductorId/:tipo",
  upload.single("archivo"),
  async (req, res) => {
    try {
      const { conductorId, tipo } = req.params;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ error: "No se recibió archivo" });
      }

      const tiposPermitidos = [
        "CEDULA",
        "LICENCIA",
        "REGISTRO_VEHICULAR",
        "POLIZA_VEHICULAR",
        "FOTO_VEHICULO",
        "FOTO_CONDUCTOR",
        "PAZ_Y_SALVO",
        "REVISADO_VEHICULAR"
      ];

      if (!tiposPermitidos.includes(tipo)) {
        return res.status(400).json({ error: "Tipo de documento no válido" });
      }

      const filePath = `${conductorId}/${tipo}_${Date.now()}_${file.originalname}`;

      const { error: uploadError } = await supabase.storage
        .from("documentos-conductores")
        .upload(filePath, file.buffer, {
          contentType: file.mimetype
        });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from("documentos-conductores")
        .getPublicUrl(filePath);

      const { error: insertError } = await supabase
        .from("documentos")
        .insert([{
          conductor_id: conductorId,
          tipo,
          url_archivo: data.publicUrl
        }]);

      if (insertError) throw insertError;

      res.json({
        mensaje: "Documento subido correctamente",
        url: data.publicUrl
      });

    } catch (err) {
      console.error("Error subiendo documento:", err);
      res.status(500).json({ error: "Error subiendo documento" });
    }
  }
);

// =====================================================
// 🟢 CREAR QUEJAS
// =====================================================
app.post("/api/quejas", async (req, res) => {
  try {
    const { conductor_id, descripcion } = req.body;

    if (!conductor_id || !descripcion) {
      return res.status(400).json({ error: "Datos incompletos" });
    }

    const { error } = await supabase.from("quejas").insert([{
      conductor_id,
      descripcion,
      fecha: new Date()
    }]);

    if (error) throw error;

    res.json({ mensaje: "Queja enviada correctamente" });

  } catch (err) {
    console.error("Error guardando queja:", err);
    res.status(500).json({ error: "Error guardando queja" });
  }
});

// =====================================================
// 🔒 ADMIN: BUSCAR CONDUCTORES
// =====================================================
app.get("/api/admin/conductores", verificarAdmin, async (req, res) => {
  try {
    const { q } = req.query;

    const { data, error } = await supabase
      .from("conductores")
      .select("*")
      .ilike("cedula", `%${q}%`);

    if (error) throw error;

    res.json(data);

  } catch (err) {
    console.error("Error búsqueda admin:", err);
    res.status(500).json({ error: "Error buscando conductores" });
  }
});

// =====================================================
// 🔒 ADMIN: VER DOCUMENTOS
// =====================================================
app.get("/api/admin/documentos/:conductorId", verificarAdmin, async (req, res) => {
  try {
    const { conductorId } = req.params;

    const { data, error } = await supabase
      .from("documentos")
      .select("*")
      .eq("conductor_id", conductorId);

    if (error) throw error;

    res.json(data);

  } catch (err) {
    console.error("Error docs admin:", err);
    res.status(500).json({ error: "Error obteniendo documentos" });
  }
});

// =====================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor corriendo en puerto " + PORT));