import { APICallError, RetryError } from 'ai'

function handleApiCallError(operation: string, error: APICallError) {
  let message = error.message
  if (error.statusCode) message += ` (${error.statusCode})`
  if (error.cause) message += `\nCause: ${error.cause}`
  if (error.responseBody) message += `\nResponse: ${error.responseBody}`
  if (error.url) message += `\nURL: ${error.url}`

  console.error(`[${operation}]`, error, {
    statusCode: error.statusCode,
    response: error.responseBody,
    cause: error.cause,
    stack: error.stack,
    isRetryable: error.isRetryable,
    url: error.url,
  })
  throw new Error(message)
}

function handleRetryError(operation: string, error: RetryError) {
  if (APICallError.isInstance(error.lastError)) {
    handleApiCallError(operation, error.lastError)
  }
  let message = error.message
  if (error.cause) message += `\nCause: ${error.cause}`
  if (error.stack) message += `\nStack: ${error.stack}`
  if (error.reason) message += `\nReason: ${error.reason}`

  console.error(`[${operation}]`, error, {
    cause: error.cause,
    stack: error.stack,
    lastError: error.lastError,
    reason: error.reason,
    errors: error.errors,
  })
  throw new Error(message)
}

/**
 * Parse an error thrown by the AI SDK, and re-throw it with a human-readable message
 */
export function throwAiError(operation: string, error: unknown) {
  if (APICallError.isInstance(error)) {
    handleApiCallError(operation, error)
  } else if (RetryError.isInstance(error)) {
    handleRetryError(operation, error)
  } else {
    console.error(`[${operation}]`, error)
  }
  throw error
}
