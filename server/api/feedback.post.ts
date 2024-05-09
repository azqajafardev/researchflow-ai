import { generateFeedback } from '~~/lib/core/feedback'
import type { ConfigAi } from '~~/shared/types/config'

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const body = await readBody(event)

  const { query, language, numQuestions = 3 } = body

  // Validate required parameters
  if (!query || !language) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required parameters',
    })
  }

  // Create server-side configuration
  const serverConfig: ConfigAi = {
    provider: runtimeConfig.public.aiProvider as ConfigAi['provider'],
    apiKey: runtimeConfig.aiApiKey,
    apiBase: runtimeConfig.aiApiBase,
    model: runtimeConfig.public.aiModel,
    contextSize: runtimeConfig.public.aiContextSize,
  }

  // Set response headers for streaming
  setHeader(event, 'Content-Type', 'text/event-stream')
  setHeader(event, 'Cache-Control', 'no-cache')
  setHeader(event, 'Connection', 'keep-alive')

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      try {
        const feedbackGenerator = generateFeedback({
          query,
          language,
          numQuestions,
          aiConfig: serverConfig,
        })

        for await (const chunk of feedbackGenerator) {
          const data = `data: ${JSON.stringify(chunk)}\n\n`
          controller.enqueue(encoder.encode(data))
        }

        controller.close()
      } catch (error: any) {
        const errorData = `data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`
        controller.enqueue(encoder.encode(errorData))
        controller.close()
      }
    },
  })

  return sendStream(event, stream)
})
