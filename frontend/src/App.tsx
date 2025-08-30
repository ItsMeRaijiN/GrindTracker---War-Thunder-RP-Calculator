import { useEffect, useState } from 'react'
import api from './api'

export default function App() {
  const [status, setStatus] = useState('...')
  useEffect(() => {
    api.get('/api/health').then(r => setStatus(r.data.status)).catch(() => setStatus('error'))
  }, [])
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">GrindTracker</h1>
      <p className="text-sm text-gray-600">
        Frontend OK. Backend status: <b>{status}</b>
      </p>
    </div>
  )
}
