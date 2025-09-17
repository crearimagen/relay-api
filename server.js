import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
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

// 🔐 Middleware de autenticación
app.addHook('onRequest', async (req, reply) => {
  console.log('🟡 onRequest', req.url)
  if (req.url === '/health' || req.url === '/') return
  const auth = req.headers['authorization']
  if (!auth || auth !== `Bearer ${ENTRY_TOKEN}`) {
    console.log('❌ No autorizado')
    return reply.code(401).send({ error: 'UNAUTHORIZED' })
  }
})

// ✅ Ruta raíz para health-check
app.get('/', async () => {
  console.log('💓 Root OK')
  return { ok: true, msg: 'Root alive' }
})

app.get('/health', async () => {
  console.log('💓 Health OK')
  return { ok: true, ts: Date.now() }
})

const phoneRegex = /^\+?[1-9]\d{7,14}$/

// ⚡ versión dummy sin fetch
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

  console.log('✅ Dummy: procesado correctamente')
  return reply.code(200).send({ status: 'OK', phone, authCode })
})

console.log('🌍 Variables cargadas:', {
  PORT: process.env.PORT,
  ENTRY_TOKEN: process.env.ENTRY_TOKEN
})

const PORT = process.env.PORT || 8080

try {
  await app.listen({ port: Number(PORT), host: '0.0.0.0' })
  console.log(`✅ Servidor escuchando en puerto ${PORT}`)
} catch (err) {
  console.log('💥 Error al iniciar servidor', err)
  process.exit(1)
}
