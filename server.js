import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { fetch } from 'undici'

const app = Fastify({
  logger: { transport: { target: 'pino-pretty' } },
  trustProxy: true
})

await app.register(rateLimit, {
  max: 500,
  timeWindow: 1000
})

const ENTRY_TOKEN = process.env.ENTRY_TOKEN || 'MI_TOKEN_SECRETO'

// Middleware de autenticación
app.addHook('onRequest', async (req, reply) => {
  if (req.url === '/health') return // deja libre /health

  const auth = req.headers['authorization']
  if (!auth || auth !== `Bearer ${ENTRY_TOKEN}`) {
    return reply.code(401).send({ error: 'UNAUTHORIZED' })
  }
})

app.get('/health', async () => ({ ok: true, ts: Date.now() }))

const phoneRegex = /^\+?[1-9]\d{7,14}$/

// Puedes definir varios destinos en tu .env (DEST_1_URL, DEST_1_TOKEN, DEST_1_CHANNEL, etc.)
// 🔁 Cargar dinámicamente todos los destinos definidos en .env
const destinations = []

// Siempre incluye el principal
if (process.env.WATI_URL && process.env.WATI_TOKEN && process.env.CHANNEL_NUMBER) {
  destinations.push({
    url: process.env.WATI_URL,
    token: process.env.WATI_TOKEN,
    channel: process.env.CHANNEL_NUMBER
  })
}

// Buscar DEST_2, DEST_3, DEST_4... hasta que no haya más
let i = 2
while (process.env[`DEST_${i}_URL`]) {
  destinations.push({
    url: process.env[`DEST_${i}_URL`],
    token: process.env[`DEST_${i}_TOKEN`],
    channel: process.env[`DEST_${i}_CHANNEL`]
  })
  i++
}

if (destinations.length === 0) {
  throw new Error('No hay destinos configurados en el .env')
}

// ⚡ Índice para round robin
let currentIndex = 0

app.post('/ingest', {
  schema: {
    body: {
      type: 'object',
      required: ['phone', 'authCode'],
      properties: {
        phone: { type: 'string' },
        authCode: { type: 'string', minLength: 4, maxLength: 16 }
      },
      additionalProperties: false
    }
  }
}, async (req, reply) => {
  const { phone, authCode } = req.body

  if (!phoneRegex.test(phone)) {
    return reply.code(400).send({ error: 'PHONE_INVALID' })
  }

  req.log.info({ phone, authCode }, 'Datos recibidos')

  try {
    // ⚡ Elegir destino en turno (round robin)
    const dest = destinations[currentIndex]
    currentIndex = (currentIndex + 1) % destinations.length

    const payload = {
      template_name: 'codigo_de_verificacion',
      broadcast_name: 'codigo_de_verificacion',
      receivers: [
        {
          whatsappNumber: phone.replace(/^\+/, ''), // quitar "+"
          customParams: [{ name: '1', value: authCode }]
        }
      ],
      channel_number: dest.channel
    }

    const res = await fetch(dest.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${dest.token}`
      },
      body: JSON.stringify(payload)
    })

    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      req.log.error({ status: res.status, data }, `Error en ${dest.url}`)
      return reply.code(502).send({ error: 'WATI_ERROR', dest: dest.url, detail: data })
    }

    req.log.info({ data }, `Mensaje enviado a ${dest.url}`)
    return reply.code(200).send({ status: 'FORWARDED', dest: dest.url, data })

    // 📝 (Antes enviaba a todos en bucle)
    /*
    const results = []
    for (const dest of destinations) { ... }
    return reply.code(200).send({ status: 'FORWARDED', results })
    */

  } catch (err) {
    req.log.error(err, 'Fallo en envío round robin')
    return reply.code(500).send({ error: 'FETCH_FAILED' })
  }
})
console.log('🌍 Variables cargadas:', {
  PORT: process.env.PORT,
  ENTRY_TOKEN: process.env.ENTRY_TOKEN,
  WATI_URL: process.env.WATI_URL,
  WATI_TOKEN: process.env.WATI_TOKEN ? '[OK]' : '[FALTA]',
  CHANNEL_NUMBER: process.env.CHANNEL_NUMBER,
  DEST_2_URL: process.env.DEST_2_URL,
  DEST_2_TOKEN: process.env.DEST_2_TOKEN ? '[OK]' : '[FALTA]',
  DEST_2_CHANNEL: process.env.DEST_2_CHANNEL
})
const PORT = process.env.PORT || 8080
await app.listen({ port: Number(PORT), host: '0.0.0.0' })
  .then(() => app.log.info(`Relay API escuchando en ${PORT}`))
  .catch(err => { app.log.error(err); process.exit(1) })
