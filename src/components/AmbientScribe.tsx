import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { extractClinicalData, type ClinicalData } from '../api/cohere'

type SpeechRecognitionAlternativeLike = {
  transcript: string
}

type SpeechRecognitionResultLike = {
  readonly isFinal: boolean
  readonly length: number
  item: (index: number) => SpeechRecognitionAlternativeLike
  [index: number]: SpeechRecognitionAlternativeLike
}

type SpeechRecognitionResultListLike = {
  readonly length: number
  item: (index: number) => SpeechRecognitionResultLike
  [index: number]: SpeechRecognitionResultLike
}

type SpeechRecognitionEventLike = Event & {
  resultIndex: number
  results: SpeechRecognitionResultListLike
}

type SpeechRecognitionErrorEventLike = Event & {
  error: string
}

type MutableRecognition = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
}

type RecognitionConstructor = new () => MutableRecognition

const getRecognitionConstructor = (): RecognitionConstructor | null => {
  if (typeof window === 'undefined') {
    return null
  }

  const scopedWindow = window as unknown as {
    SpeechRecognition?: RecognitionConstructor
    webkitSpeechRecognition?: RecognitionConstructor
  }

  return scopedWindow.SpeechRecognition ?? scopedWindow.webkitSpeechRecognition ?? null
}

type TranscriptSegments = {
  final: string
  interim: string
}

const mapTranscriptSegments = (
  list: SpeechRecognitionResultListLike,
  startIndex: number
): TranscriptSegments => {
  let final = ''
  let interim = ''

  for (let index = startIndex; index < list.length; index += 1) {
    const result = list[index] ?? list.item(index)
    if (!result) {
      continue
    }

    const alternative = result[0] ?? result.item(0)
    const text = alternative?.transcript?.trim()
    if (!text) {
      continue
    }

    if (result.isFinal) {
      final = final ? `${final} ${text}` : text
    } else {
      interim = interim ? `${interim} ${text}` : text
    }
  }

  return { final, interim }
}

const useSpeechRecognition = () => {
  const recognitionRef = useRef<MutableRecognition | null>(null)
  const [isListening, setIsListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [interimTranscript, setInterimTranscript] = useState('')
  const [finalTranscript, setFinalTranscript] = useState('')

  useEffect(() => {
    const RecognitionCtor = getRecognitionConstructor()

    if (!RecognitionCtor) {
      setError('Speech recognition is not supported in this browser.')
      return
    }

    const recognition = new RecognitionCtor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      const segments = mapTranscriptSegments(event.results, event.resultIndex)
      setInterimTranscript(segments.interim)
      if (segments.final) {
        setFinalTranscript(previous =>
          previous ? `${previous} ${segments.final}`.trim() : segments.final
        )
      }
    }

    recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
      const message = event.error ? `Speech recognition error: ${event.error}` : 'Speech recognition error occurred.'
      setError(message)
      setIsListening(false)
    }

    recognition.onend = () => {
      setIsListening(false)
      setInterimTranscript('')
    }

    recognitionRef.current = recognition

    return () => {
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      try {
        recognition.stop()
      } catch (stopError) {
        // stop may throw if already stopped; ignore
      }
      try {
        recognition.abort()
      } catch (abortError) {
        // abort may throw if recognition never started; ignore
      }
      recognitionRef.current = null
    }
  }, [])

  const startListening = useCallback(() => {
    const recognition = recognitionRef.current
    if (!recognition) {
      setError('Speech recognition is not available.')
      return
    }

    setError(null)

    try {
      recognition.start()
      setIsListening(true)
    } catch (startError) {
      const message = startError instanceof Error ? startError.message : 'Unable to start speech recognition.'
      setError(message)
    }
  }, [])

  const stopListening = useCallback(() => {
    const recognition = recognitionRef.current
    if (!recognition) {
      return
    }

    try {
      recognition.stop()
    } catch (stopError) {
      // stop may throw if called redundantly; ignore
    }
    setIsListening(false)
    setInterimTranscript('')
  }, [])

  return {
    startListening,
    stopListening,
    isListening,
    error,
    interimTranscript,
    finalTranscript,
  }
}

const AmbientScribe: React.FC = () => {
  const { startListening, stopListening, isListening, error, interimTranscript, finalTranscript } =
    useSpeechRecognition()
  const [clinicalData, setClinicalData] = useState<ClinicalData | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [cohereError, setCohereError] = useState<string | null>(null)

  const statusLabel = useMemo(() => {
    if (error) {
      return `Error: ${error}`
    }
    return isListening ? 'Listening…' : 'Idle'
  }, [error, isListening])

  const recognitionUnavailable = useMemo(
    () => (error ? error.toLowerCase().includes('not supported') : false),
    [error]
  )

  const startDisabled = isListening || recognitionUnavailable
  const stopDisabled = !isListening
  const draftDisabled = !finalTranscript || isExtracting

  const handleGenerateDraft = useCallback(async () => {
    if (!finalTranscript.trim()) {
      setCohereError('Transcript is empty; please capture audio first.')
      return
    }
    setIsExtracting(true)
    setCohereError(null)
    try {
      const clinical = await extractClinicalData(finalTranscript)
      setClinicalData(clinical)
    } catch (cohereErr) {
      const message = cohereErr instanceof Error ? cohereErr.message : 'Failed to extract clinical data.'
      setCohereError(message)
    } finally {
      setIsExtracting(false)
    }
  }, [finalTranscript])

  const containerStyle: React.CSSProperties = {
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    padding: '2rem 1.5rem 2.75rem',
    maxWidth: '1040px',
    margin: '0 auto',
    color: '#0f172a',
    background: 'linear-gradient(180deg, #f8fafc 0%, #eef2ff 60%, #f8fafc 100%)',
    borderRadius: '18px',
    boxShadow: '0 25px 80px rgba(15, 23, 42, 0.12)',
  }

  const headerStyle: React.CSSProperties = {
    marginBottom: '0.35rem',
    fontSize: '1.85rem',
    fontWeight: 800,
    textAlign: 'center',
    letterSpacing: '-0.01em',
  }

  const statusStyle: React.CSSProperties = {
    marginBottom: '1.25rem',
    fontWeight: 600,
    textAlign: 'center',
    color: isListening ? '#166534' : '#334155',
  }

  const controlsStyle: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.75rem',
    marginBottom: '1.5rem',
    alignItems: 'center',
  }

  const primaryButtonStyle: React.CSSProperties = {
    padding: '0.65rem 1.2rem',
    borderRadius: '8px',
    border: '1px solid #2563eb',
    backgroundColor: '#2563eb',
    color: '#fff',
    cursor: 'pointer',
    boxShadow: '0 10px 20px rgba(37, 99, 235, 0.18)',
    transition: 'transform 120ms ease, box-shadow 120ms ease',
  }

  const secondaryButtonStyle: React.CSSProperties = {
    padding: '0.65rem 1.2rem',
    borderRadius: '8px',
    border: '1px solid #dc2626',
    backgroundColor: '#ef4444',
    color: '#ffffff',
    cursor: 'pointer',
    transition: 'transform 120ms ease, box-shadow 120ms ease',
  }

  const successButtonStyle: React.CSSProperties = {
    padding: '0.65rem 1.2rem',
    borderRadius: '8px',
    border: '1px solid #10b981',
    backgroundColor: '#0f9b6c',
    color: '#fff',
    cursor: 'pointer',
    marginLeft: 'auto',
    boxShadow: '0 10px 20px rgba(16, 185, 129, 0.18)',
    transition: 'transform 120ms ease, box-shadow 120ms ease',
  }

  const transcriptWrapperStyle: React.CSSProperties = {
    border: '1px solid #e2e8f0',
    borderRadius: '14px',
    padding: '1.35rem',
    marginBottom: '1.85rem',
    maxHeight: '260px',
    overflowY: 'auto',
    backgroundColor: '#ffffff',
    boxShadow: '0 12px 30px rgba(15, 23, 42, 0.06)',
  }

  const transcriptSectionStyle: React.CSSProperties = {
    marginBottom: '1rem',
  }

  const sectionHeaderStyle: React.CSSProperties = {
    fontSize: '1rem',
    fontWeight: 700,
    marginBottom: '0.4rem',
    letterSpacing: '-0.01em',
    color: '#0f172a',
  }

  const transcriptTextStyle: React.CSSProperties = {
    margin: 0,
    whiteSpace: 'pre-wrap',
    lineHeight: 1.5,
  }

  const disableStyle = (base: React.CSSProperties, disabled: boolean): React.CSSProperties => ({
    ...base,
    opacity: disabled ? 0.6 : 1,
    cursor: disabled ? 'not-allowed' : base.cursor,
  })

  return (
    <div style={containerStyle}>
      <h1 style={headerStyle}>Ambient Scribe – Doctor/Patient POC</h1>

      <div style={statusStyle}>{statusLabel}</div>
      {cohereError ? (
        <div style={{ color: '#b91c1c', marginBottom: '0.75rem', textAlign: 'center' }}>{cohereError}</div>
      ) : null}
      {isExtracting ? (
        <div style={{ color: '#1d4ed8', marginBottom: '0.75rem', textAlign: 'center' }}>Generating draft note…</div>
      ) : null}

      <div style={controlsStyle}>
        <button
          type="button"
          onClick={startListening}
          disabled={startDisabled}
          style={disableStyle(primaryButtonStyle, startDisabled)}
        >
          Start Listening
        </button>
        <button
          type="button"
          onClick={stopListening}
          disabled={stopDisabled}
          style={disableStyle(secondaryButtonStyle, stopDisabled)}
        >
          Stop Listening
        </button>
        <button
          type="button"
          onClick={handleGenerateDraft}
          disabled={draftDisabled}
          style={disableStyle(successButtonStyle, draftDisabled)}
        >
          Generate Draft Note
        </button>
      </div>

      <div style={transcriptWrapperStyle}>
        <div style={transcriptSectionStyle}>
          <div style={sectionHeaderStyle}>Live (interim)</div>
          <p style={transcriptTextStyle}>{interimTranscript || '—'}</p>
        </div>
        <div style={transcriptSectionStyle}>
          <div style={sectionHeaderStyle}>Session transcript</div>
          <p style={transcriptTextStyle}>{finalTranscript || '—'}</p>
        </div>
      </div>

      <div style={{ marginTop: '1.5rem', marginBottom: '0.75rem', fontWeight: 800, fontSize: '1.15rem' }}>
        Clinical notes
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1rem',
        }}
      >
        {(
          [
            { label: 'Symptoms', key: 'symptoms' as const },
            { label: 'History', key: 'history' as const },
            { label: 'Assessment', key: 'assessment' as const },
            { label: 'Medications', key: 'medications' as const },
            { label: 'Plan', key: 'plan' as const },
          ]
        ).map(section => {
          const items = clinicalData?.[section.key] ?? []
          return (
            <div
              key={section.key}
              style={{
                border: '1px solid #d1d5db',
                borderRadius: '10px',
                padding: '1rem',
                backgroundColor: '#fff',
                minHeight: '140px',
                boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: '0.5rem', fontSize: '1rem' }}>{section.label}</div>
              {items.length ? (
                <ul style={{ margin: 0, paddingLeft: '1.1rem', lineHeight: 1.5 }}>
                  {items.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p style={{ margin: 0, color: '#6b7280' }}>No entries yet.</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default AmbientScribe
