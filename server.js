import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import fetch from "node-fetch";
import dotenv from "dotenv";
import Fuse from "fuse.js";
import fs from "fs";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

// ✅ Middlewares
app.use(helmet());
app.use(express.json({ limit: "2mb" }));
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN,
  methods: ["POST", "GET"],
}));

// ✅ Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Demasiadas solicitudes, intenta más tarde." },
});
app.use(limiter);

// ✅ Lista blanca de modelos
const ALLOWED_MODELS = process.env.ALLOW_MODELS
  ? process.env.ALLOW_MODELS.split(",")
  : [process.env.AIML_MODEL];

// ✅ Cargar company_context.txt (con manejo de errores)
let companyContext = "";
try {
  companyContext = fs.readFileSync("./company_context.txt", "utf8");
  console.log("✅ company_context.txt cargado correctamente.");
} catch (err) {
  console.warn("⚠ No se encontró company_context.txt, usando contexto base.");
  companyContext = `
Cistcor Networks es un sistema de gestión de negocios y facturación electrónica.
Ofrece emisión rápida de comprobantes, control de inventario y reportes en tiempo real.
`;
}

// ✅ Contexto base (fallback general)
const baseContext = `
Eres CistBot, el asistente virtual de Cistcor Networks. Eres amable, servicial y entusiasta por ayudar a los negocios.

INSTRUCCIONES DE PERSONALIDAD:
1. Sé amigable, cálido y entusiasta 😊
2. Usa emojis moderadamente para dar calidez
3. Formatea respuestas con saltos de línea y viñetas
4. Muestra empatía e interés genuino en ayudar
5. Mantén un tono alegre pero profesional
`;

// ✅ FAQs
const faqs = [
  {
    q: "¿qué es cistcor?",
    a: `¡Hola! 😊 Cistcor es tu sistema de gestión y facturación electrónica que simplifica tu negocio.

Te permite:
• Emitir comprobantes en segundos ⚡
• Controlar tu inventario facilmente 📦
• Obtener reportes en tiempo real de ventas y compras 📊
• Cumplir fácilmente con SUNAT ✅`
  },
  {
    q: "¿qué beneficios obtengo al utilizar cistcor?",
    a: `¡Muchísimos beneficios! 🎉 Al usar Cistcor:

• Ahorras tiempo al emitir comprobantes en segundos ⚡
• Conoces tu inventario al instante con un par de clicks 📦
• Te sientes tranquilo de estar al día con SUNAT ✅
• Accedes desde cualquier dispositivo las 24 horas 🌐
• Obtienes reportes de ventas y compras en segundos 📊`
  }
];

// ✅ Configurar Fuse.js
const fuse = new Fuse(faqs, {
  keys: ["q"],
  threshold: 0.4
});

// ✅ Historial en memoria
const conversations = {};

// ✅ Endpoint de salud
app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// ✅ Limpiar historiales antiguos
setInterval(() => {
  const now = Date.now();
  const limit = 25 * 60 * 1000;
  for (const id in conversations) {
    if (now - conversations[id].lastActivity > limit) delete conversations[id];
  }
}, 25 * 60 * 1000);

// ✅ Endpoint principal del chatbot
app.post("/api/chat", async (req, res) => {
  try {
    const { message, model, userId } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Mensaje inválido" });
    }

    // Crear historial si no existe
    if (!conversations[userId]) {
      conversations[userId] = { messages: [], lastActivity: Date.now() };
    }
    conversations[userId].lastActivity = Date.now();
    conversations[userId].messages.push({ role: "user", content: message });

    // Buscar respuesta rápida (FAQ)
    const result = fuse.search(message);
    if (result.length > 0 && result[0].score < 0.4) {
      const faqAnswer = result[0].item.a;
      conversations[userId].messages.push({ role: "assistant", content: faqAnswer });
      return res.json({ reply: faqAnswer });
    }

    // Contexto dinámico con historial + companyContext
    const history = conversations[userId].messages
      .slice(-3)
      .map(m => `${m.role}: ${m.content}`)
      .join("\n");

    const selectedModel = ALLOWED_MODELS.includes(model)
      ? model
      : process.env.AIML_MODEL;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 40000);

    const response = await fetch(process.env.AIML_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.AIML_API_KEY}`,
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          ...conversations[userId].messages.slice(-3),
          {
            role: "user",
            content: `Contexto general:\n${baseContext}\n\nDatos de la empresa:\n${companyContext}\n\nPregunta: ${message}`
          }
        ]
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: "Error en AIML API", details: errorText });
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content || "No hay respuesta.";

    conversations[userId].messages.push({ role: "assistant", content: reply });
    res.json({ reply });

  } catch (err) {
    console.error("❌ Error en /api/chat:", err.message);
    if (err.name === "AbortError") {
      return res.status(504).json({ error: "Tiempo de espera agotado" });
    }
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ✅ Iniciar servidor
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});
