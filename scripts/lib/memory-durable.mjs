export class MemoryStorage {
  values = new Map();
  chain = Promise.resolve();
  async get(key) { return structuredClone(this.values.get(key)); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(key) { this.values.delete(key); }
  transaction(callback) {
    const result = this.chain.then(() => callback(this));
    this.chain = result.catch(() => {});
    return result;
  }
}

export function memoryNamespace(Handler) {
  const stores = new Map();
  return { idFromName: key => key, get: key => {
    if (!stores.has(key)) stores.set(key, new MemoryStorage());
    return new Handler({ storage: stores.get(key) });
  } };
}
