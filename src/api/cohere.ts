import { CohereClient } from 'cohere-ai'

export type ClinicalData = {
  symptoms: string[]
  history: string[]
  assessment: string[]
  medications: string[]
  plan: string[]
}

type CohereContentPart = {
  type?: string
  text?: string
}

type CohereChatResponse = {
  message?: {
    content?: CohereContentPart[]
  }
  text?: string
  chat_history?: Array<{
    role?: string
    message?: string
  }>
}

const extractText = (content?: CohereContentPart[]): string => {
  if (!Array.isArray(content)) return ''
  return content
    .map(part => part?.text?.trim() ?? '')
    .filter(Boolean)
    .join(' ')
    .trim()
}

const stripCodeFence = (text: string): string => {
  const fenced = text.trim()
  if (fenced.startsWith('```')) {
    const withoutFence = fenced.replace(/^```[a-zA-Z]*\s*/m, '').replace(/```\s*$/m, '')
    return withoutFence.trim()
  }
  return fenced
}

const cohereKeyFromEnv = (import.meta as { env?: Record<string, string | undefined> }).env?.COHERE_API_KEY
const COHERE_API_KEY = cohereKeyFromEnv ?? ''
const cohereClient = new CohereClient({ token: COHERE_API_KEY })

const ensureStringArray = (value: unknown): string[] => {
  if (!value) return []
  if (Array.isArray(value)) return value.map(item => `${item}`.trim()).filter(Boolean)
  return [`${value}`.trim()].filter(Boolean)
}

export const extractClinicalData = async (transcript: string): Promise<ClinicalData> => {
  if (!transcript || !transcript.trim()) {
    return {
      symptoms: [],
      history: [],
      assessment: [],
      medications: [],
      plan: [],
    }
  }

  if (!COHERE_API_KEY) {
    throw new Error('Missing Cohere API key (set COHERE_API_KEY)')
  }

  const trimmedTranscript = transcript.trim()
  if (!trimmedTranscript) {
    throw new Error('Transcript is empty; cannot extract clinical data.')
  }

  const systemPrompt =
    'You are a clinical NLP engine. Convert the given transcript into structured clinical data. ' +
    'Extract symptoms, medical history, assessment, medications, and plan. Ignore non-medical conversation. ' +
    'Return ONLY valid JSON with this structure: { "symptoms": [], "history": [], "assessment": [], "medications": [], "plan": [] }'

  const payload = {
    model: 'command-a-03-2025',
    preamble: systemPrompt,
    message: trimmedTranscript,
  }

  try {
    const data = (await cohereClient.chat(payload)) as CohereChatResponse

    let rawText = extractText(data.message?.content)

    if (!rawText && typeof data.text === 'string') {
      rawText = data.text.trim()
    }

    if (!rawText && Array.isArray(data.chat_history)) {
      const lastBot = [...data.chat_history].reverse().find(entry => entry.role?.toLowerCase() === 'chatbot')
      if (lastBot?.message) {
        rawText = lastBot.message.trim()
      }
    }

    rawText = stripCodeFence(rawText)

    if (!rawText) {
      console.error('Cohere returned:', JSON.stringify(data, null, 2))
      throw new Error('Cohere API returned empty content')
    }

    let parsed: Partial<ClinicalData> = {}
    try {
      parsed = JSON.parse(rawText)
    } catch (parseError) {
      console.error('Raw Cohere text:', rawText)
      throw new Error('Cohere response was not valid JSON')
    }

    return {
      symptoms: ensureStringArray(parsed.symptoms),
      history: ensureStringArray(parsed.history),
      assessment: ensureStringArray(parsed.assessment),
      medications: ensureStringArray(parsed.medications),
      plan: ensureStringArray(parsed.plan),
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error('extractClinicalData failed:', error.message)
      throw error
    }
    throw new Error('Unexpected error during extractClinicalData')
  }
}

// Example usage:
// const result = await extractClinicalData(transcript)
// console.log(result.symptoms, result.plan)
