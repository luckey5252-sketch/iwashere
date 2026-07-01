import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.test' })

const URL = process.env.SUPABASE_URL!
const ANON = process.env.SUPABASE_ANON_KEY!
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!

export function serviceClient(): SupabaseClient {
  return createClient(URL, SERVICE, { auth: { persistSession: false } })
}

export function anonClient(): SupabaseClient {
  return createClient(URL, ANON, { auth: { persistSession: false } })
}

let counter = 0
export async function createTestUser(): Promise<{ id: string; client: SupabaseClient }> {
  const admin = serviceClient()
  counter += 1
  const email = `t${counter}_${Date.now()}@example.com`
  const password = 'password123!'
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error) throw error
  const client = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password })
  if (signInErr) throw signInErr
  return { id: data.user!.id, client }
}

export async function cleanup() {
  const admin = serviceClient()
  // 자식→부모 순서로 삭제(FK 안전)
  for (const t of ['reports', 'likes', 'post_photos', 'posts', 'places', 'profiles']) {
    await admin.from(t).delete().neq('id', '00000000-0000-0000-0000-000000000000')
  }
  // auth 유저도 정리
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
  for (const u of data?.users ?? []) {
    if (u.email?.startsWith('t') && u.email?.includes('@example.com')) {
      await admin.auth.admin.deleteUser(u.id)
    }
  }
}
