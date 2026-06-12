const express = require("express");
const twilio = require("twilio");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Historial de conversaciones por número de cliente
const conversaciones = {};

const SYSTEM_PROMPT = `Sos un asistente virtual de ventas que trabaja para Jessica Alfonso, la mejor vendedora externa de Tiendas Gonzalito en Paraguay. Tu misión es atender clientes por WhatsApp, entender qué necesitan y, cuando estén interesados, derivarlos a Jessica para cerrar la venta de forma personal.

## SOBRE TIENDAS GONZALITO
Tiendas Gonzalito es una cadena líder de electrodomésticos en Paraguay con precios contado y crédito, entregas rápidas y seguras. Vende marcas reconocidas como Tokyo, Samsung, Whirlpool, LG, Midea, Philips, Carrier, Mabe, Electrolux, Midas, Sony, Remington y muchas más.

## CATEGORÍAS DE PRODUCTOS
- Línea Blanca: Heladeras, lavarropas, secarropas, lavasecarropas, lavavajillas, congeladores
- Climatización: Aires acondicionados residenciales y comerciales
- Cocina: Cocinas a gas, microondas, hornos, anafes, freidoras air fryer, cafeteras
- Pequeños electrodomésticos: Licuadoras, planchas, batidoras, tostadoras, hervidoras
- Tecnología: Televisores, celulares (Samsung, Apple, Xiaomi), notebooks, tablets
- Audio: Speakers, barras de sonido, parlantes (JBL, Sony, Samsung)
- Cuidado personal: Planchas de pelo, secadores, afeitadoras (Philips, Remington, Babyliss)
- Muebles: Dormitorio, sala, cocina, oficina, bebé
- Bienestar: Bicicletas, equipos de gimnasia, juguetes, piletas
- Rural/Jardín: Hidrolavadoras, herramientas, compresores

## TU FORMA DE HABLAR
- Usá español paraguayo natural y cálido
- Usá "vos", "podés", "querés", "tenés"
- Sé entusiasta pero sin presionar
- Respondé de forma corta y directa (máximo 3-4 oraciones)
- Usá emojis con moderación 😊

## FLUJO DE CONVERSACIÓN
1. Saludo y detección de necesidad
2. Calificación: preguntá si prefieren crédito o contado
3. Recomendación: mencioná opciones con ventajas (sin inventar precios exactos)
4. Derivación a Jessica cuando el cliente esté listo

## CUÁNDO DERIVAR A JESSICA
Derivá cuando el cliente:
- Pida precio exacto o cotización
- Pregunte por financiación o cuotas
- Diga que quiere comprar o esté decidido
- Pregunte por stock o quiera reservar

## FRASE DE DERIVACIÓN
Cuando sea momento de derivar, respondé exactamente así al final de tu mensaje:
"¡Perfecto! Te paso con Jessica Alfonso, nuestra asesora personal para darte el mejor precio 😊 Ella te atiende ahora mismo → DERIVAR_A_JESSICA"

## LO QUE NO PODÉS HACER
- Inventar precios específicos en guaraníes
- Prometer stock sin confirmación
- Cerrar la venta vos solo sin derivar a Jessica`;

const JESSICA_NUMERO = "whatsapp:+595975449164";

app.post("/webhook", async (req, res) => {
  const twiml = new twilio.twiml.MessagingResponse();
  const mensajeCliente = req.body.Body?.trim();
  const numeroCliente = req.body.From;
  const nombreCliente = req.body.ProfileName || "Cliente";

  if (!mensajeCliente) {
    res.type("text/xml").send(twiml.toString());
    return;
  }

  // Inicializar historial si es nuevo cliente
  if (!conversaciones[numeroCliente]) {
    conversaciones[numeroCliente] = [];
  }

  // Agregar mensaje del cliente al historial
  conversaciones[numeroCliente].push({
    role: "user",
    content: mensajeCliente,
  });

  // Limitar historial a últimos 20 mensajes para no sobrepasar tokens
  if (conversaciones[numeroCliente].length > 20) {
    conversaciones[numeroCliente] = conversaciones[numeroCliente].slice(-20);
  }

  try {
    const respuestaIA = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: conversaciones[numeroCliente],
    });

    let textoRespuesta = respuestaIA.content[0].text;

    // Detectar si hay que derivar a Jessica
    if (textoRespuesta.includes("DERIVAR_A_JESSICA")) {
      textoRespuesta = textoRespuesta.replace("DERIVAR_A_JESSICA", "").trim();

      // Notificar a Jessica por WhatsApp
      const clienteTwilio = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );

      await clienteTwilio.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: JESSICA_NUMERO,
        body: `🔔 *CLIENTE LISTO PARA COMPRAR*\n\n👤 Nombre: ${nombreCliente}\n📱 Número: ${numeroCliente}\n\n💬 Último mensaje: "${mensajeCliente}"\n\n¡Entrá a atenderlo ahora! 🚀`,
      });
    }

    // Guardar respuesta en historial
    conversaciones[numeroCliente].push({
      role: "assistant",
      content: textoRespuesta,
    });

    twiml.message(textoRespuesta);
  } catch (error) {
    console.error("Error:", error);
    twiml.message(
      "Lo siento, tuve un problema técnico 😅 Por favor escribime de nuevo o contactá directamente a nuestra asesora Jessica."
    );
  }

  res.type("text/xml").send(twiml.toString());
});

// Health check
app.get("/", (req, res) => {
  res.send("✅ Bot de Jessica - Tiendas Gonzalito funcionando");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
