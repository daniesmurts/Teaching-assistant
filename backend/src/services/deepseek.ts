import axios from 'axios'

const BASE_URL = 'https://api.deepseek.com'

function apiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) throw new Error('DEEPSEEK_API_KEY is not set')
  return key
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// ─── Core chat completion ─────────────────────────────────────────────────────

export async function chat(
  messages: ChatMessage[],
  opts: { jsonMode?: boolean } = {}
): Promise<string> {
  const response = await axios.post(
    `${BASE_URL}/chat/completions`,
    {
      model: 'deepseek-chat',
      messages,
      ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
      },
      timeout: 60_000,
    }
  )
  return response.data.choices[0].message.content as string
}

// ─── Embeddings ───────────────────────────────────────────────────────────────

export async function embed(text: string): Promise<number[]> {
  const response = await axios.post(
    `${BASE_URL}/embeddings`,
    { model: 'deepseek-embedding', input: text },
    {
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    }
  )
  return response.data.data[0].embedding as number[]
}

// ─── JSON parse with one retry ────────────────────────────────────────────────

export async function chatJSON<T>(
  messages: ChatMessage[],
  retryLabel = 'response'
): Promise<T> {
  const raw = await chat(messages, { jsonMode: true })
  try {
    return JSON.parse(raw) as T
  } catch {
    // Retry once with explicit instruction
    const retryMessages: ChatMessage[] = [
      ...messages,
      { role: 'assistant', content: raw },
      {
        role: 'user',
        content: `Your ${retryLabel} was not valid JSON. Respond ONLY with a valid JSON object, no markdown, no explanation.`,
      },
    ]
    const retryRaw = await chat(retryMessages, { jsonMode: true })
    return JSON.parse(retryRaw) as T
  }
}
