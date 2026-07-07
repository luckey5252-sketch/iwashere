'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getPlaceThread, type ThreadNode } from '@/lib/places/thread'

function ThreadItem({ node, depth }: { node: ThreadNode; depth: number }) {
  return (
    <div style={{ marginLeft: depth * 16, paddingBlock: 6, borderTop: '1px solid #eee' }}>
      <p style={{ margin: 0 }}>{node.body}</p>
      <small style={{ color: '#888' }}>♥ {node.like_count}</small>
      {node.replies.map((r) => (
        <ThreadItem key={r.id} node={r} depth={depth + 1} />
      ))}
    </div>
  )
}

export function PlaceDetailPanel({
  placeId,
  onClose,
}: {
  placeId: string | null
  onClose: () => void
}) {
  const [thread, setThread] = useState<ThreadNode[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!placeId) return
    setLoading(true)
    const supabase = createClient()
    getPlaceThread(supabase, placeId)
      .then(setThread)
      .catch(() => setThread([]))
      .finally(() => setLoading(false))
  }, [placeId])

  if (!placeId) return null

  return (
    <aside
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        maxHeight: '50dvh',
        overflow: 'auto',
        background: '#fff',
        borderTop: '1px solid #ddd',
        padding: 16,
        boxShadow: '0 -2px 12px rgba(0,0,0,0.08)',
      }}
    >
      <button onClick={onClose} style={{ float: 'right' }}>
        Close
      </button>
      {loading ? (
        <p>Loading…</p>
      ) : thread.length === 0 ? (
        <p>No notes yet.</p>
      ) : (
        thread.map((n) => <ThreadItem key={n.id} node={n} depth={0} />)
      )}
    </aside>
  )
}
