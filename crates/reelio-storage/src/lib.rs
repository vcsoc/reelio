use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

pub struct Storage {
    connection: Connection,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub id: String,
    pub project_id: Option<String>,
    pub sequence: u64,
    pub status: String,
    pub destination: String,
    pub progress: Option<Value>,
    pub error: Option<String>,
    pub created_at: String,
}
impl Storage {
    pub fn open(path: &Path) -> Result<Self, String> {
        let mut c = Connection::open(path).map_err(|e| e.to_string())?;
        c.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        c.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;")
            .map_err(|e| e.to_string())?;
        let version: i64 = c
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if version > 2 {
            return Err(
                "Database was created by a newer Reelio version; it has not been modified".into(),
            );
        }
        if version == 0 {
            let tx = c.transaction().map_err(|e| e.to_string())?;
            tx.execute_batch("CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE recents(path TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('media','project')), opened_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY(path,kind));
                CREATE TABLE jobs(id TEXT PRIMARY KEY, sequence INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, destination TEXT NOT NULL, project TEXT NOT NULL, progress TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
                CREATE INDEX jobs_status ON jobs(status);
                PRAGMA user_version=1;").map_err(|e|e.to_string())?;
            tx.commit().map_err(|e| e.to_string())?;
        }
        if version < 2 {
            let tx = c.transaction().map_err(|e| e.to_string())?;
            tx.execute_batch("ALTER TABLE jobs ADD COLUMN project_id TEXT; UPDATE jobs SET project_id=json_extract(project,'$.id'); CREATE INDEX jobs_project ON jobs(project_id,created_at); PRAGMA user_version=2;").map_err(|e|e.to_string())?;
            tx.commit().map_err(|e| e.to_string())?;
        }
        c.execute("UPDATE jobs SET status='interrupted', sequence=sequence+1, error='Application stopped before a terminal result. Inspect the destination before retrying; no job is resumed automatically.' WHERE status IN ('queued','processing','verifying')",[]).map_err(|e|e.to_string())?;
        Ok(Self { connection: c })
    }
    pub fn setting(&self, key: &str) -> Result<Option<Value>, String> {
        let value: Option<String> = self
            .connection
            .query_row("SELECT value FROM settings WHERE key=?1", [key], |r| {
                r.get(0)
            })
            .optional()
            .map_err(|e| e.to_string())?;
        value
            .map(|v| serde_json::from_str(&v).map_err(|e| e.to_string()))
            .transpose()
    }
    pub fn set_setting(&self, key: &str, value: &Value) -> Result<(), String> {
        self.connection.execute("INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,value.to_string()]).map_err(|e|e.to_string())?;
        Ok(())
    }
    pub fn recent(&self, path: &str, kind: &str) -> Result<(), String> {
        self.connection.execute("INSERT INTO recents(path,kind) VALUES(?1,?2) ON CONFLICT(path,kind) DO UPDATE SET opened_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",params![path,kind]).map_err(|e|e.to_string())?;
        Ok(())
    }
    pub fn recents(&self) -> Result<Vec<Value>, String> {
        let mut s = self
            .connection
            .prepare("SELECT path,kind,opened_at FROM recents ORDER BY opened_at DESC LIMIT 30")
            .map_err(|e| e.to_string())?;
        let rows=s.query_map([],|r|Ok(serde_json::json!({"path":r.get::<_,String>(0)?,"kind":r.get::<_,String>(1)?,"opened_at":r.get::<_,String>(2)?}))).map_err(|e|e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }
    pub fn insert_job(&self, id: &str, destination: &str, project: &Value) -> Result<(), String> {
        self.connection
            .execute(
                "INSERT INTO jobs(id,status,destination,project,project_id) VALUES(?1,'queued',?2,?3,?4)",
                params![id, destination, project.to_string(),project["id"].as_str()],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn update_job(
        &self,
        id: &str,
        status: &str,
        progress: Option<&Value>,
        error: Option<&str>,
    ) -> Result<(), String> {
        self.connection.execute("UPDATE jobs SET sequence=sequence+1,status=?2,progress=COALESCE(?3,progress),error=?4 WHERE id=?1",params![id,status,progress.map(Value::to_string),error]).map_err(|e|e.to_string())?;
        Ok(())
    }
    pub fn job_project(&self, id: &str) -> Result<Value, String> {
        let raw: Option<String> = self
            .connection
            .query_row(
                "SELECT project FROM jobs WHERE id=?1 AND length(project)<=4194304",
                [id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        serde_json::from_str(
            &raw.ok_or("Job snapshot not found or exceeds the 4 MiB restore limit")?,
        )
        .map_err(|e| e.to_string())
    }
    pub fn jobs(&self) -> Result<Vec<Job>, String> {
        // Poll summaries only; embedded cover payloads are fetched once on explicit restore.
        let mut s=self.connection.prepare("SELECT id,sequence,status,destination,progress,error,created_at,project_id FROM jobs ORDER BY created_at DESC LIMIT 100").map_err(|e|e.to_string())?;
        let rows = s
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, u64>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, String>(6)?,
                    r.get::<_, Option<String>>(7)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut out = vec![];
        for row in rows {
            let (id, sequence, status, destination, progress, error, created_at, project_id) =
                row.map_err(|e| e.to_string())?;
            out.push(Job {
                id,
                project_id,
                sequence,
                status,
                destination,
                progress: progress
                    .map(|v| serde_json::from_str(&v))
                    .transpose()
                    .map_err(|e| e.to_string())?,
                error,
                created_at,
            });
        }
        Ok(out)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migration_and_restart_recovery() {
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("state.db");
        {
            let s = Storage::open(&path).unwrap();
            s.insert_job("a", "out.mkv", &serde_json::json!({}))
                .unwrap();
            s.set_setting("theme", &serde_json::json!("dark")).unwrap();
        }
        let s = Storage::open(&path).unwrap();
        assert_eq!(s.jobs().unwrap()[0].status, "interrupted");
        assert_eq!(s.setting("theme").unwrap(), Some(serde_json::json!("dark")));
    }
    #[test]
    fn project_ownership_is_backfilled_without_deleting_history() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.db");
        let raw = Connection::open(&path).unwrap();
        raw.execute_batch("CREATE TABLE jobs(id TEXT PRIMARY KEY,sequence INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL,destination TEXT NOT NULL,project TEXT NOT NULL,progress TEXT,error TEXT,created_at TEXT NOT NULL DEFAULT 'old');PRAGMA user_version=1;").unwrap();
        raw.execute(
            "INSERT INTO jobs(id,status,destination,project)VALUES('old','completed','old.mp4',?1)",
            params![serde_json::json!({"id":"project-a"}).to_string()],
        )
        .unwrap();
        drop(raw);
        let storage = Storage::open(&path).unwrap();
        storage
            .insert_job("new", "new.mp4", &serde_json::json!({"id":"project-b"}))
            .unwrap();
        let jobs = storage.jobs().unwrap();
        assert_eq!(jobs.len(), 2);
        assert_eq!(
            jobs.iter()
                .find(|j| j.id == "old")
                .unwrap()
                .project_id
                .as_deref(),
            Some("project-a")
        );
        assert_eq!(
            jobs.iter()
                .find(|j| j.id == "new")
                .unwrap()
                .project_id
                .as_deref(),
            Some("project-b")
        );
        assert_eq!(storage.job_project("old").unwrap()["id"], "project-a");
    }
    #[test]
    fn job_poll_excludes_cover_payload_but_restore_keeps_snapshot() {
        let s = Storage::open(Path::new(":memory:")).unwrap();
        let snapshot = serde_json::json!({"artwork":{"jpeg":"x".repeat(500_000)}});
        s.insert_job("cover-job", "out.mp4", &snapshot).unwrap();
        let poll = serde_json::to_string(&s.jobs().unwrap()).unwrap();
        assert!(poll.len() < 1024);
        assert_eq!(s.job_project("cover-job").unwrap(), snapshot);
        assert!(s.job_project("'; DROP TABLE jobs;--").is_err());
    }
    #[test]
    fn completed_crop_report_survives_status_update_and_restart() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("state.db");
        let report = serde_json::json!({"phase":"verifying", "percent":100, "notices":["Cropped audio [stable-id] to video end", "Omitted subtitle: no cues"]});
        {
            let storage = Storage::open(&path).unwrap();
            storage
                .insert_job(
                    "crop-job",
                    "new.mp4",
                    &serde_json::json!({"source":"unchanged"}),
                )
                .unwrap();
            storage
                .update_job("crop-job", "verifying", Some(&report), None)
                .unwrap();
            storage
                .update_job("crop-job", "completed", Some(&report), None)
                .unwrap();
            storage
                .update_job("crop-job", "completed", None, None)
                .unwrap();
        }
        let storage = Storage::open(&path).unwrap();
        let jobs = storage.jobs().unwrap();
        assert_eq!(jobs[0].status, "completed");
        assert_eq!(jobs[0].progress, Some(report));
        assert_eq!(
            storage.job_project("crop-job").unwrap(),
            serde_json::json!({"source":"unchanged"})
        );
    }
    #[test]
    fn recent_query_is_parameterized() {
        let s = Storage::open(Path::new(":memory:")).unwrap();
        s.recent("'; DROP TABLE jobs;--", "media").unwrap();
        assert_eq!(s.recents().unwrap().len(), 1);
        assert!(s.jobs().unwrap().is_empty());
    }
}
