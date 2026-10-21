async function ensureTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS planner_store (
      id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();
}

export async function onRequestGet(context) {
  const db = context.env.DB;
  if (!db) return Response.json({ cloudEnabled: false, data: null });

  await ensureTable(db);
  const row = await db
    .prepare("SELECT state_json, updated_at FROM planner_store WHERE id = ?1")
    .bind("main_schedule")
    .first();

  return Response.json({
    cloudEnabled: true,
    engine: "D1",
    updatedAt: row ? row.updated_at : null,
    data: row ? JSON.parse(row.state_json) : null
  });
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  if (!db) return Response.json({ cloudEnabled: false, saved: false });

  await ensureTable(db);
  const body = await context.request.json();
  const updatedAt = Number(body.updatedAt) || Date.now();

  await db
    .prepare(`
      INSERT INTO planner_store (id, state_json, updated_at)
      VALUES (?1, ?2, ?3)
      ON CONFLICT(id) DO UPDATE SET
        state_json = excluded.state_json,
        updated_at = excluded.updated_at
    `)
    .bind("main_schedule", JSON.stringify(body), updatedAt)
    .run();

  return Response.json({ cloudEnabled: true, engine: "D1", saved: true, updatedAt });
}
