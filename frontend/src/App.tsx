import { useEffect, useState } from 'react'
import api from './api'
import './index.css'

export default function App() {
  const [status, setStatus] = useState('...')

  useEffect(() => {
    api.get('/health')
      .then(r => setStatus(r.data.status))
      .catch(() => setStatus('error'))
  }, [])

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="px-6 py-4 border-b border-zinc-800">
        <h1 className="text-2xl font-bold">GrindTracker</h1>
        <p className="text-sm text-zinc-400">
          Frontend OK. Backend status:{' '}
          <b className={status === 'ok' ? 'text-emerald-400' : 'text-red-400'}>
            {status}
          </b>
        </p>
      </header>
      <main className="p-6">
      </main>
    </div>
  )
}
