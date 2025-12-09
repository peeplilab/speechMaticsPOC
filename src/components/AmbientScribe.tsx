import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
  const [draftNote, setDraftNote] = useState('')

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
  const draftDisabled = !finalTranscript

  const handleGenerateDraft = useCallback(() => {
    setDraftNote(finalTranscript)
  }, [finalTranscript])

  const containerStyle: React.CSSProperties = {
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    padding: '2rem 1.5rem',
    maxWidth: '960px',
    margin: '0 auto',
    color: '#1f2933',
  }

  const headerStyle: React.CSSProperties = {
    marginBottom: '1.25rem',
    fontSize: '1.75rem',
    fontWeight: 700,
    textAlign: 'center',
  }

  const statusStyle: React.CSSProperties = {
    marginBottom: '1.25rem',
    fontWeight: 600,
    textAlign: 'center',
  }

  const controlsStyle: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.75rem',
    marginBottom: '1.5rem',
  }

  const primaryButtonStyle: React.CSSProperties = {
    padding: '0.6rem 1.1rem',
    borderRadius: '6px',
    border: '1px solid #2563eb',
    backgroundColor: '#2563eb',
    color: '#fff',
    cursor: 'pointer',
  }

  const secondaryButtonStyle: React.CSSProperties = {
    padding: '0.6rem 1.1rem',
    borderRadius: '6px',
    border: '1px solid #9ca3af',
    backgroundColor: '#e5e7eb',
    color: '#111827',
    cursor: 'pointer',
  }

  const successButtonStyle: React.CSSProperties = {
    padding: '0.6rem 1.1rem',
    borderRadius: '6px',
    border: '1px solid #10b981',
    backgroundColor: '#10b981',
    color: '#fff',
    cursor: 'pointer',
    marginLeft: 'auto',
  }

  const transcriptWrapperStyle: React.CSSProperties = {
    border: '1px solid #d1d5db',
    borderRadius: '10px',
    padding: '1.25rem',
    marginBottom: '1.75rem',
    maxHeight: '260px',
    overflowY: 'auto',
    backgroundColor: '#f9fafb',
  }

  const transcriptSectionStyle: React.CSSProperties = {
    marginBottom: '1rem',
  }

  const sectionHeaderStyle: React.CSSProperties = {
    fontSize: '1rem',
    fontWeight: 600,
    marginBottom: '0.5rem',
  }

  const transcriptTextStyle: React.CSSProperties = {
    margin: 0,
    whiteSpace: 'pre-wrap',
    lineHeight: 1.5,
  }

  const textareaStyle: React.CSSProperties = {
    width: '100%',
    minHeight: '200px',
    padding: '0.9rem',
    borderRadius: '8px',
    border: '1px solid #d1d5db',
    fontFamily: 'inherit',
    fontSize: '1rem',
    lineHeight: 1.6,
    resize: 'vertical',
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

      <label htmlFor="draft-note" style={{ fontWeight: 600, display: 'block', marginBottom: '0.6rem' }}>
        Draft clinical note
      </label>
      <textarea
        id="draft-note"
        value={draftNote}
        onChange={event => setDraftNote(event.target.value)}
        placeholder="Generated note will appear here..."
        style={textareaStyle}
      />
    </div>
  )
}

export default AmbientScribe
