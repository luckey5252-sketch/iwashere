import type { SupabaseClient } from '@supabase/supabase-js'

export interface PostRow {
  id: string
  parent_id: string | null
  author_id: string
  body: string
  like_count: number
  created_at: string
}

export interface ThreadNode extends PostRow {
  replies: ThreadNode[]
}

export function buildThreadTree(rows: PostRow[]): ThreadNode[] {
  const byId = new Map<string, ThreadNode>()
  for (const r of rows) byId.set(r.id, { ...r, replies: [] })

  const roots: ThreadNode[] = []
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined
    if (parent) parent.replies.push(node)
    else roots.push(node)
  }

  const newestFirst = (a: ThreadNode, b: ThreadNode) => b.created_at.localeCompare(a.created_at)
  const oldestFirst = (a: ThreadNode, b: ThreadNode) => a.created_at.localeCompare(b.created_at)
  roots.sort(newestFirst)
  for (const node of byId.values()) node.replies.sort(oldestFirst)
  return roots
}

export async function getPlaceThread(
  client: SupabaseClient,
  placeId: string,
): Promise<ThreadNode[]> {
  const { data, error } = await client
    .from('posts')
    .select('id, parent_id, author_id, body, like_count, created_at')
    .eq('place_id', placeId)
  if (error) throw error
  return buildThreadTree((data ?? []) as PostRow[])
}
