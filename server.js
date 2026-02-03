require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

// 🔹 Conexión a Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// 🔹 Ruta raíz (prueba de servidor)
app.get("/", (req, res) => {
  res.send("API de Conductores funcionando 🚗");
});

// 🔹 Registrar conductor
app.post("/api/conductores", async (req, res) => {
  try {
    const { nombre, cedula, licencia_numero, telefono, direccion, cip } = req.body;

    if (!nombre) {
      return res.status(400).json({ error: "El nombre es obligatorio" });
    }

    const { data, error } = await supabase
      .from("conductores")
      .insert([{ nombre, cedula, licencia_numero, telefono, direccion, cip }])
      .select()
      .single();

    if (error) throw error;

    const urlQR = `https://nrdesingcorp.com/conductor/${data.id}`;

    res.json({
      mensaje: "Conductor registrado correctamente",
      url_qr: urlQR,
      conductor: data
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al registrar conductor" });
  }
});

// 🔹 Obtener perfil público del conductor (para el QR)
app.get("/api/conductores/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { data: conductor, error } = await supabase
      .from("conductores")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !conductor) {
      return res.status(404).json({ error: "Conductor no encontrado" });
    }

    const { data: quejas } = await supabase
      .from("quejas")
      .select("*")
      .eq("conductor_id", id)
      .order("fecha", { ascending: false });

    res.json({ conductor, quejas });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener datos del conductor" });
  }
});

// 🔹 Puerto del servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor corriendo en puerto " + PORT));
