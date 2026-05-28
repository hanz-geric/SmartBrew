const noopDb = {
  execAsync: async () => {},
  runAsync: async () => ({ lastInsertRowId: 0, changes: 0 }),
  getAllAsync: async () => [],
  getFirstAsync: async () => null,
  withTransactionAsync: async (fn: () => Promise<void>) => { await fn(); },
};

export async function getDb(): Promise<typeof noopDb> {
  return noopDb;
}

export async function initDb(): Promise<void> {}
