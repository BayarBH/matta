import type { DocumentSnapshot, Firestore } from 'firebase-admin/firestore';

/** Raw document; callers zod-parse what they read. `col` may be a subcollection path. */
export type Doc = Record<string, unknown>;

/** Reads happen first; writes are buffered and committed atomically when the callback returns. */
export interface Tx {
  get(col: string, id: string): Promise<Doc | undefined>;
  where(col: string, field: string, value: unknown): Promise<Doc[]>;
  set(col: string, id: string, data: Doc): void;
}

export interface Store {
  get(col: string, id: string): Promise<Doc | undefined>;
  where(col: string, field: string, value: unknown): Promise<Doc[]>;
  all(col: string): Promise<Doc[]>;
  set(col: string, id: string, data: Doc): Promise<void>;
  del(col: string, id: string): Promise<void>;
  tx<T>(fn: (t: Tx) => Promise<T>): Promise<T>;
}

export function firestoreStore(db: Firestore): Store {
  const snap = (d: DocumentSnapshot) => (d.exists ? (d.data() as Doc) : undefined);
  return {
    get: async (col, id) => snap(await db.collection(col).doc(id).get()),
    where: async (col, field, value) => (await db.collection(col).where(field, '==', value).get()).docs.map((d) => d.data()),
    all: async (col) => (await db.collection(col).get()).docs.map((d) => d.data()),
    set: async (col, id, data) => {
      await db.collection(col).doc(id).set(data);
    },
    del: async (col, id) => {
      await db.collection(col).doc(id).delete();
    },
    tx: (fn) =>
      db.runTransaction(async (t) => {
        const writes = new Map<string, [string, string, Doc]>(); // last write per doc wins
        const result = await fn({
          get: async (col, id) => snap(await t.get(db.collection(col).doc(id))),
          where: async (col, field, value) => (await t.get(db.collection(col).where(field, '==', value))).docs.map((d) => d.data()),
          set: (col, id, data) => void writes.set(`${col}/${id}`, [col, id, data]),
        });
        for (const [col, id, data] of writes.values()) t.set(db.collection(col).doc(id), data);
        return result;
      }),
  };
}

/** In-memory store for tests. Transactions are serialized by a promise chain. */
export function memoryStore(): Store & { dump: () => Map<string, Map<string, Doc>> } {
  const data = new Map<string, Map<string, Doc>>();
  const col = (c: string) => data.get(c) ?? data.set(c, new Map()).get(c)!;
  const clone = <T>(v: T): T => structuredClone(v);
  const get = async (c: string, id: string) => clone(col(c).get(id));
  const where = async (c: string, f: string, v: unknown) => [...col(c).values()].filter((d) => d[f] === v).map(clone);
  let chain: Promise<unknown> = Promise.resolve();
  return {
    dump: () => data,
    get,
    where,
    all: async (c) => [...col(c).values()].map(clone),
    set: async (c, id, d) => void col(c).set(id, clone(d)),
    del: async (c, id) => void col(c).delete(id),
    tx: (fn) => {
      const run = chain.then(async () => {
        const writes = new Map<string, [string, string, Doc]>();
        const result = await fn({ get, where, set: (c, id, d) => void writes.set(`${c}/${id}`, [c, id, d]) });
        for (const [c, id, d] of writes.values()) col(c).set(id, clone(d));
        return result;
      });
      chain = run.catch(() => undefined);
      return run;
    },
  };
}
