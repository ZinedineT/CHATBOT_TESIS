import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import fetch from "node-fetch";
import dotenv from "dotenv";
import Fuse from "fuse.js";

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
  windowMs: 60 * 1000, // 1 minuto
  max: 10,
  message: { error: "Demasiadas solicitudes, intenta más tarde." },
});
app.use(limiter);

// ✅ Lista blanca de modelos
const ALLOWED_MODELS = process.env.ALLOW_MODELS
  ? process.env.ALLOW_MODELS.split(",")
  : [process.env.AIML_MODEL];

// ✅ Contexto general (para fallback IA)
const baseContext = `
Eres CistBot, el asistente virtual de Cistcor Networks. Eres amable, servicial y entusiasta por ayudar a los negocios.

INFORMACIÓN DE LA EMPRESA:
Cistcor es un sistema de gestión de negocios y facturación electrónica que simplifica la administración de tu negocio y hace más fácil tu trabajo.

BENEFICIOS PRINCIPALES:
• Emitir comprobantes en segundos ⚡
• Controlar inventario al instante 📦  
• Reportes en tiempo real de ventas y compras 📊
• Cumplimiento fácil con SUNAT ✅
• Acceso 24/7 desde cualquier dispositivo 🌐

INSTRUCCIONES DE PERSONALIDAD:
1. Sé amigable, cálido y entusiasta 😊
2. Usa emojis moderadamente para dar calidez
3. Formatea respuestas con saltos de línea y viñetas
4. Muestra empatía e interés genuino en ayudar
5. Mantén un tono alegre pero profesional

INFORMACIÓN TÉCNICA (solo si es relevante):
• Requisitos: RUC activo, Internet, dispositivo (PC/tablet) 📋
• Plataforma: 100% en la nube ☁️

PLANES DE CISTCOR (precios con IGV incluido):
• 🚀 EMPRENDEDOR: S/59 mensual
  - 300 comprobantes/mes
  - Ideal para pequeños negocios

• 📈 ESTÁNDAR: S/97 mensual (MÁS POPULAR)  
  - 1500 comprobantes/mes
  - Perfecto para negocios en crecimiento

• 🏆 PROFESIONAL: S/177 mensual
  - 4000 comprobantes/mes
  - Para empresas establecidas

Todos incluyen prueba gratis y soporte.

FORMATO DE RESPUESTAS:
- Usa saltos de línea entre ideas
- Emplea viñetas (•) para listas
- Sé claro pero no frío o robótico
- Responde específicamente a lo preguntado
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
    q: "¿qué es una factura electrónica?", 
    a: `Una factura electrónica es un comprobante de pago en formato digital que sirve para sustentar la compraventa de bienes o servicios entre empresas y clientes.

✨ Beneficios:
• Reduce costos de almacenamiento e impresión
• Es más seguro y confiable
• Cumple con normativa SUNAT
• Acceso inmediato desde cualquier dispositivo` 
  },
  { 
    q: "¿qué beneficios obtengo al utilizar cistcor?", 
    a: `¡Muchísimos beneficios! 🎉 Al usar Cistcor:

• Ahorras tiempo al emitir comprobantes en segundos ⚡
• Conoces tu inventario al instante con un par de clicks 📦
• Te sientes tranquilo de estar al día con SUNAT ✅
• Accedes desde cualquier dispositivo las 24 horas 🌐
• Obtienes reportes de ventas y compras en segundos 📊` 
  },
  { 
    q: "¿qué necesito para implementar cistcor en mi negocio?", 
    a: `¡Es muy sencillo! Solo necesitas:

1. 📋 Tener un RUC activo y habido
2. 🌐 Contar con internet en tu negocio  
3. 💻 Tener una computadora, laptop o Tablet

¡Y listo! Puedes empezar hoy mismo 🚀` 
  },
  { 
    q: "¿cistcor está en la nube o en mi computadora?", 
    a: `☁️ La plataforma se encuentra en la NUBE, lo que te permite:

• Conectarte en cualquier momento ⏰
• Acceder desde cualquier dispositivo 📱💻
• No preocuparte por instalaciones o mantenimiento
• Trabajar desde tu negocio, casa o donde estés 🌍` 
  },
  { 
    q: "¿cómo elegir un sistema de facturación electrónica para mi negocio?", 
    a: `Para elegir un buen Sistema de Facturación Electrónica, te recomiendo analizar:

🔍 Aspectos importantes:
• Facilidad de uso e intuitivo
• Soporte técnico responsive
• Validación OSE garantizada  
• Actualizaciones periódicas
• Protección de tu información
• Experiencia y reputación

¡Cistcor cumple con todos estos puntos! ✅` 
  }
];

// ✅ Configuración de Fuse.js para búsqueda flexible
const fuse = new Fuse(faqs, {
  keys: ["q"],
  threshold: 0.4 // Sensibilidad de coincidencia (0 = exacto, 1 = muy flexible)
});

// ✅ Historial en memoria (por usuario temporalmente)
const conversations = {};

// ✅ Endpoint de salud
app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// ✅ Limpiar historiales antiguos (cada hora)
setInterval(() => {
  const now = Date.now();
  const twentyFiveMinutes = 25 * 60 * 1000;
  
  for (const userId in conversations) {
    if (now - conversations[userId].lastActivity > twentyFiveMinutes) {
      delete conversations[userId];
    }
  }
}, 25 * 60 * 1000);

// ✅ Endpoint principal del chatbot
app.post("/api/chat", async (req, res) => {
  try {
    const { message, model, userId } = req.body;

    if (!message || typeof message !== "string" || message.length > 2000) {
      return res.status(400).json({ error: "Mensaje inválido o demasiado largo" });
    }

    // ✅ Inicializar historial si no existe
    if (!conversations[userId]) {
      conversations[userId] = {
        messages: [],
        lastActivity: Date.now()
      };
    }
    
    conversations[userId].lastActivity = Date.now();
    conversations[userId].messages.push({ role: "user", content: message });

    // 🔍 Buscar respuesta en FAQs con Fuse.js
    const result = fuse.search(message);
    if (result.length > 0 && result[0].score < 0.4) {
      const faqAnswer = result[0].item.a;
      conversations[userId].messages.push({ role: "assistant", content: faqAnswer });
      return res.json({ reply: faqAnswer });
    }

    // ✅ Preparar contexto dinámico (últimos 3 mensajes)
    const history = conversations[userId].messages.slice(-3).map(m => `${m.role}: ${m.content}`).join("\n");
    const context = `${baseContext}\n\nHistorial reciente:\n${history}`;

    // ✅ Llamada a IA (Gemma u otro modelo)
    const selectedModel = ALLOWED_MODELS.includes(model) ? model : process.env.AIML_MODEL;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(process.env.AIML_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.AIML_API_KEY}`,
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          { role: "system", 
            content: `Eres CistBot, asistente de Cistcor. Sé amable y servicial. 
            Usa esta información contextual:\n${context}` },
          ...conversations[userId].messages.slice(-3), 
          { role: "user", content: message }
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
    const reply = data?.choices?.[0]?.message?.content || "No hay respuesta";

    // ✅ Agregar respuesta al historial
    conversations[userId].messages.push({ role: "assistant", content: reply });

    res.json({ reply });
  } catch (err) {
    console.error("Error en /api/chat:", err.message);
    if (err.name === "AbortError") {
      return res.status(504).json({ error: "Tiempo de espera agotado" });
    }
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ✅ Servidor
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});
