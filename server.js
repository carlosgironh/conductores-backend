require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ================= ROOT =================
app.get("/", (req, res) => {
  res.send("API Conductores funcionando 🚗");
});

// ================= REGISTRO =================
app.post("/api/registro", async (req, res) => {
  try {
    const {
      email, password, nombres, apellidos, cedula, licencia,
      placa, modelo, marca, color, poliza_numero, celular, direccion
    } = req.body;

    if(!email || !password) return res.status(400).json({ error: "Email y password requeridos" });

    // Crear usuario Auth en Supabase
    const { data: userData, error: userError } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true
    });
    if(userError) return res.status(400).json({ error: userError.message });

    const userId = userData.user.id;
    const qr_token = crypto.randomBytes(16).toString("hex"); // Token único para perfil público

    // Insertar conductor
    const { data: conductor, error: conductorError } = await supabase
      .from("conductores")
      .insert([{ nombres, apellidos, cedula, licencia, placa, modelo, marca, color, poliza_numero, celular, direccion, auth_user_id: userId, qr_token }])
      .select()
      .single();

    if(conductorError) return res.status(400).json({ error: conductorError.message });

    res.json({ mensaje:"Conductor registrado", conductorId: conductor.id, qr_token });

  } catch(err) {
    console.error(err);
    res.status(500).json({ error:"Error en registro" });
  }
});

// ================= SUBIDA DOCUMENTOS =================
app.post("/api/documentos/:conductorId/:tipo", upload.single("archivo"), async (req,res)=>{
  try {
    const { conductorId, tipo } = req.params;
    if(!req.file) return res.status(400).json({ error:"Archivo requerido" });

    const { data, error } = await supabase.storage.from("documentos").upload(
      `${conductorId}/${tipo}_${Date.now()}`,
      req.file.buffer
    );

    if(error) return res.status(400).json({ error: error.message });

    const url_archivo = `${process.env.SUPABASE_URL}/storage/v1/object/public/documentos/${data.path}`;
    await supabase.from("documentos").insert([{ conductor_id: conductorId, tipo, url_archivo }]);

    res.json({ mensaje:"Archivo subido", url_archivo });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error:"Error subiendo archivo" });
  }
});

// ================= PERFIL PÚBLICO =================
app.get("/api/perfil/:token", async (req,res)=>{
  try {
    const { token } = req.params;
    const { data: conductor, error } = await supabase.from("conductores").select("*").eq("qr_token", token).single();
    if(error || !conductor) return res.status(404).json({ error:"No encontrado" });

    const { data: documentos } = await supabase.from("documentos").select("*").eq("conductor_id", conductor.id);
    res.json({ conductor, documentos: documentos || [] });

  } catch(err) {
    console.error(err);
    res.status(500).json({ error:"Error cargando perfil" });
  }
});

// ================= DASHBOARD / ADMIN =================
function verificarAdmin(req,res,next){
  const pass = req.headers["admin-password"];
  if(!pass || pass !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error:"No autorizado" });
  next();
}

app.get("/api/admin/conductores", verificarAdmin, async (req,res)=>{
  const { q } = req.query;
  const { data } = await supabase.from("conductores").select("*").ilike("cedula", `%${q||""}%`);
  res.json(data || []);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log("Servidor corriendo en puerto " + PORT));