let tableInitialized = false;

async function ensureTable(db) {
  if (tableInitialized) return;
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS planner_store (
      id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();
  tableInitialized = true;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // D1 Cloud Sync API Endpoint (/api/schedule)
    if (url.pathname === "/api/schedule") {
      const db = env.DB;

      if (!db) {
        return Response.json({
          cloudEnabled: false,
          engine: "none",
          data: null
        });
      }

      try {
        await ensureTable(db);

        if (request.method === "GET") {
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

        if (request.method === "POST" || request.method === "PUT") {
          const body = await request.json();
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

          return Response.json({
            cloudEnabled: true,
            engine: "D1",
            saved: true,
            updatedAt
          });
        }
      } catch (err) {
        return Response.json(
          { cloudEnabled: true, engine: "D1", error: err.message },
          { status: 500 }
        );
      }
    }

    // Serve static frontend assets from ./public
    return env.ASSETS.fetch(request);
  }
};
