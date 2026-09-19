import { z } from 'zod'

const databaseName = 'skillpack'
const storeName = 'credentials'
const settingsKey = 'github-credentials'
const cryptoKey = 'github-credentials-key'

const credentialSettingsSchema = z.object({
  credentials: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      token: z.string(),
    }),
  ),
  globalCredentialId: z.string().nullable(),
})

export type CredentialSettings = z.infer<typeof credentialSettingsSchema>
export type GithubCredential = CredentialSettings['credentials'][number]

interface EncryptedValue {
  iv: ArrayBuffer
  ciphertext: ArrayBuffer
}

export async function loadCredentialSettings(): Promise<CredentialSettings> {
  const db = await openDatabase()
  try {
    const [key, encrypted] = await Promise.all([
      get<CryptoKey>(db, cryptoKey),
      get<EncryptedValue>(db, settingsKey),
    ])
    if (!key || !encrypted) return { credentials: [], globalCredentialId: null }

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(encrypted.iv) },
      key,
      encrypted.ciphertext,
    )
    return credentialSettingsSchema.parse(JSON.parse(new TextDecoder().decode(plaintext)))
  } finally {
    db.close()
  }
}

export async function saveCredentialSettings(settings: CredentialSettings) {
  const validated = credentialSettingsSchema.parse(settings)
  const db = await openDatabase()
  try {
    const key = await getOrCreateKey(db)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(JSON.stringify(validated)),
    )
    await put(db, settingsKey, { iv: iv.buffer, ciphertext } satisfies EncryptedValue)
  } finally {
    db.close()
  }
}

function openDatabase() {
  return request<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(databaseName, 1)
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(storeName)) open.result.createObjectStore(storeName)
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
}

async function getOrCreateKey(db: IDBDatabase) {
  const existing = await get<CryptoKey>(db, cryptoKey)
  if (existing) return existing

  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  await put(db, cryptoKey, key)
  return key
}

function get<T>(db: IDBDatabase, key: string) {
  return transaction<T | undefined>(db, 'readonly', (store) => store.get(key))
}

function put(db: IDBDatabase, key: string, value: unknown) {
  return transaction<IDBValidKey>(db, 'readwrite', (store) => store.put(value, key))
}

function transaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
) {
  return request<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode)
    const result = operation(tx.objectStore(storeName))
    result.onsuccess = () => resolve(result.result)
    result.onerror = () => reject(result.error)
  })
}

function request<T>(start: (resolve: (value: T) => void, reject: (reason?: unknown) => void) => void) {
  return new Promise<T>((resolve, reject) => start(resolve, reject))
}
