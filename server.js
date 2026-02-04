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

app.get("/", (req, res) => {
  res.send("API de Conductores funcionando 🚗");
});

// Crear conductor
app.post("/api/conductores", async (req, res) => {
  try {
    const {
      nombres,
      apellidos,
      cedula,
      licencia,
      placa,
      poliza_numero,
      poliza_tipo,
      celular,
      direccion
    } = req.body;

    const { data, error } = await supabase
      .from("conductores")
      .insert([{
        nombres,
        apellidos,
        cedula,
        licencia,
        placa,
        poliza_numero,
        poliza_tipo,
        celular,
        direccion
      }])
      .select()
      .single();

    if (error) throw error;

    res.json({ conductor: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error creando conductor" });
  }
});

// Obtener perfil público
app.get("/api/conductores/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { data: conductor } = await supabase
      .from("conductores")
      .select("*")
      .eq("id", id)
      .single();

    const { data: documentos } = await supabase
      .from("documentos")
      .select("*")
      .eq("conductor_id", id);

    const { data: quejas } = await supabase
      .from("quejas")
      .select("*")
      .eq("conductor_id", id);

    res.json({ conductor, documentos, quejas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error obteniendo datos" });
  }
});

// Subir documento
app.post("/api/documentos/:conductorId/:tipo", upload.single("archivo"), async (req, res) => {
  try {
    const { conductorId, tipo } = req.params;
    const file = req.file;

    if (!file) {
      console.log("❌ NO SE RECIBIÓ ARCHIVO");
      return res.status(400).json({ error: "No se recibió archivo" });
    }

    const tiposPermitidos = [
      "licencia",
      "registro_vehicular",
      "foto_vehiculo",
      "paz_y_salvo",
      "revisado_vehicular"
    ];

    if (!tiposPermitidos.includes(tipo)) {
      return res.status(400).json({ error: "Tipo de documento no válido" });
    }

    const filePath = `${conductorId}/${tipo}_${Date.now()}_${file.originalname}`;

    const { error: uploadError } = await supabase.storage
      .from("documentos-conductores")
      .upload(filePath, file.buffer, { contentType: file.mimetype });

    if (uploadError) {
      console.error("❌ ERROR SUPABASE STORAGE:", uploadError);
      return res.status(500).json({ error: uploadError.message });
    }

    const { data } = supabase.storage
      .from("documentos-conductores")
      .getPublicUrl(filePath);

    await supabase.from("documentos").insert([{
      conductor_id: conductorId,
      tipo,
      url_archivo: data.publicUrl
    }]);

    res.json({ mensaje: "Documento subido", url: data.publicUrl });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error subiendo documento" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor corriendo en puerto " + PORT));
