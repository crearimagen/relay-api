import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { fetch } from 'undici'
import cors from '@fastify/cors'

console.log('🟢 Iniciando servidor...')

const app = Fastify({
  logger: { transport: { target: 'pino-pretty' } },
  trustProxy: true
})

await app.register(cors, {
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true
})
console.log('✅ CORS registrado')

await app.register(rateLimit, {
  max: 500,
  timeWindow: 1000
})
console.log('✅ RateLimit registrado')

const ENTRY_TOKEN = process.env.ENTRY_TOKEN || 'MI_TOKEN_SECRETO'

app.addHook('onRequest', async (req, reply) => {
  console.log('🟡 onRequest', req.url)
  if (req.url === '/health') return
  const auth = req.headers['authorization']
  if (!auth || auth !== `Bearer ${ENTRY_TOKEN}`) {
    console.log('❌ No autorizado')
    return reply.code(401).send({ error: 'UNAUTHORIZED' })
  }
})

app.get('/health', async () => {
  console.log('💓 Health OK')
  return { ok: true, ts: Date.now() }
})

const phoneRegex = /^\+?[1-9]\d{7,14}$/

const destinations = []
if (process.env.WATI_URL && process.env.WATI_TOKEN && process.env.CHANNEL_NUMBER) {
  destinations.push({
    url: process.env.WATI_URL,
    token: process.env.WATI_TOKEN,
    channel: process.env.CHANNEL_NUMBER
  })
}
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
console.log('📦 Destinos cargados:', destinations)

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
  console.log('📩 POST /ingest recibido')
  const { phone, authCode } = req.body
  console.log('📲 Datos:', phone, authCode)

  if (!phoneRegex.test(phone)) {
    console.log('❌ Teléfono inválido')
    return reply.code(400).send({ error: 'PHONE_INVALID' })
  }

  try {
    const dest = destinations[currentIndex]
    currentIndex = (currentIndex + 1) % destinations.length
    console.log('🚀 Enviando a destino:', dest.url)

    const payload = {
      template_name: 'codigo_de_verificacion',
      broadcast_name: 'codigo_de_verificacion',
      receivers: [
        {
          whatsappNumber: phone.replace(/^\+/, ''),
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

    console.log('📥 Status respuesta WATI:', res.status)

    const data = await res.json().catch(() => ({}))
    console.log('📦 Data respuesta WATI:', data)

    if (!res.ok) {
      console.log('❌ Error en destino')
      return reply.code(502).send({ error: 'WATI_ERROR', dest: dest.url, detail: data })
    }

    console.log('✅ Mensaje enviado con éxito')
    return reply.code(200).send({ status: 'FORWARDED', dest: dest.url, data })

  } catch (err) {
    console.log('💥 Error de envío:', err)
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

try {
  await app.listen({ port: Number(PORT), host: '0.0.0.0' })
  console.log(`✅ Servidor escuchando en puerto ${PORT}`)
} catch (err) {
  console.log('💥 Error al iniciar servidor', err)
  process.exit(1)
}
