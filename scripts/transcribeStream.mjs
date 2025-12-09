import https from 'node:https'
import process from 'node:process'
import { createSpeechmaticsJWT } from '@speechmatics/auth'
import { RealtimeClient } from '@speechmatics/real-time-client'

const apiKey = process.env.SPEECHMATICS_API_KEY

if (!apiKey) {
  console.error('Missing SPEECHMATICS_API_KEY environment variable.')
  process.exit(1)
}

const streamURL = process.env.SPEECHMATICS_STREAM_URL ?? 'https://media-ice.musicradio.com/LBCUKMP3'
const client = new RealtimeClient()

const logTranscript = ({ data }) => {
  if (data.message === 'AddTranscript') {
    for (const result of data.results ?? []) {
      if (result.type === 'word') {
        process.stdout.write(' ')
      }
      const word = result.alternatives?.[0]?.content ?? ''
      process.stdout.write(word)
      if (result.is_eos) {
        process.stdout.write('\n')
      }
    }
  } else if (data.message === 'EndOfTranscript') {
    process.stdout.write('\n')
    client.stopRecognition({ noTimeout: true }).finally(() => process.exit(0))
  } else if (data.message === 'Error') {
    process.stderr.write(`\n${JSON.stringify(data)}\n`)
    client.stopRecognition({ noTimeout: true }).finally(() => process.exit(1))
  }
}

client.addEventListener('receiveMessage', logTranscript)

client.addEventListener('connectionError', event => {
  console.error('Connection error:', event.detail)
})

client.addEventListener('clientError', event => {
  console.error('Client error:', event.detail)
})

const transcribe = async () => {
  const jwt = await createSpeechmaticsJWT({
    type: 'rt',
    apiKey,
    ttl: 60,
  })

  await client.start(jwt, {
    transcription_config: {
      language: 'en',
      operating_point: 'enhanced',
      max_delay: 1.0,
      transcript_filtering_config: {
        remove_disfluencies: true,
      },
    },
  })

  const request = https.get(streamURL, response => {
    response.on('data', chunk => {
      client.sendAudio(chunk)
    })

    response.on('end', () => {
      console.log('Stream ended')
      client.stopRecognition({ noTimeout: true })
    })

    response.on('error', error => {
      console.error('Stream error:', error)
      client.stopRecognition()
    })
  })

  request.on('error', error => {
    console.error('Request error:', error)
    client.stopRecognition()
  })
}

const shutdown = () => {
  client.stopRecognition({ noTimeout: true }).finally(() => {
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

transcribe().catch(error => {
  console.error('Transcription failed:', error)
  client.stopRecognition({ noTimeout: true }).finally(() => process.exit(1))
})
