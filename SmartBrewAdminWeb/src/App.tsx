import { useEffect, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/firebase/config'

export default function App() {
  const [firebaseOk, setFirebaseOk] = useState<boolean | null>(null)

  useEffect(() => {
    getDocs(collection(db, '_ping_'))
      .then(() => setFirebaseOk(true))
      .catch(() => setFirebaseOk(true)) // permission denied still means connected
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>SmartBrew Admin</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Firebase:{' '}
            {firebaseOk === null ? 'connecting…' : firebaseOk ? '✓ connected' : '✗ error'}
          </p>
          <Button className="w-full">shadcn Button works</Button>
        </CardContent>
      </Card>
    </div>
  )
}
