import Database from "better-sqlite3";
import path from "path";

export interface Message {
  id: string;
  sender: "user" | "zoya";
  text: string;
  timestamp: number;
}

export interface Memory {
  id: string;
  key: string;
  value: string;
  extracted_at: number;
}

// Locate DB in root or workdir
let db: any = null;
let useMemoryFallback = false;

// In-Memory Fallbacks for serverless environments (where disk/compiled binary might not be writable/available)
let messagesFallback: Message[] = [];
let memoriesFallback: Memory[] = [];

try {
  const dbPath = path.resolve(process.cwd(), "zoya.db");
  db = new Database(dbPath);

  // Initialize Tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      sender TEXT NOT NULL,
      text TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      value TEXT NOT NULL,
      extracted_at INTEGER NOT NULL
    );
  `);
} catch (err) {
  console.warn("Warning: SQLite could not be initialized. Falling back to an interactive in-memory memory store.", err);
  useMemoryFallback = true;
}

// Database Operations
export function getAllMessages(limit = 100): Message[] {
  if (useMemoryFallback) {
    return messagesFallback.slice(-limit);
  }
  try {
    const stmt = db.prepare("SELECT * FROM messages ORDER BY timestamp ASC LIMIT ?");
    return stmt.all(limit) as Message[];
  } catch (err) {
    console.error("Failed to read messages:", err);
    return [];
  }
}

export function insertMessage(sender: "user" | "zoya", text: string): Message {
  const id = Date.now().toString() + "-" + Math.random().toString(36).substr(2, 4);
  const timestamp = Date.now();
  const newMsg: Message = { id, sender, text, timestamp };

  if (useMemoryFallback) {
    messagesFallback.push(newMsg);
    return newMsg;
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO messages (id, sender, text, timestamp)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(id, sender, text, timestamp);
  } catch (err) {
    console.error("Failed to insert message:", err);
  }
  return newMsg;
}

export function clearAllMessages() {
  if (useMemoryFallback) {
    messagesFallback = [];
    return;
  }
  try {
    db.prepare("DELETE FROM messages").run();
  } catch (err) {
    console.error("Failed to clear messages:", err);
  }
}

export function getMemories(): Memory[] {
  if (useMemoryFallback) {
    return memoriesFallback.sort((a, b) => b.extracted_at - a.extracted_at);
  }
  try {
    const stmt = db.prepare("SELECT * FROM memories ORDER BY extracted_at DESC");
    return stmt.all() as Memory[];
  } catch (err) {
    console.error("Failed to fetch memories:", err);
    return [];
  }
}

export function insertOrUpdateMemory(key: string, value: string) {
  const normalizedKey = key.toLowerCase();
  const id = Date.now().toString() + "-" + Math.random().toString(36).substr(2, 4);
  const timestamp = Date.now();

  if (useMemoryFallback) {
    const existingIndex = memoriesFallback.findIndex(m => m.key === normalizedKey);
    if (existingIndex > -1) {
      memoriesFallback[existingIndex] = { id, key: normalizedKey, value, extracted_at: timestamp };
    } else {
      memoriesFallback.push({ id, key: normalizedKey, value, extracted_at: timestamp });
    }
    return;
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO memories (id, key, value, extracted_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, extracted_at = excluded.extracted_at
    `);
    stmt.run(id, normalizedKey, value, timestamp);
  } catch (err) {
    console.error("Failed to insert memory:", err);
  }
}

export function deleteMemory(key: string) {
  const normalizedKey = key.toLowerCase();
  if (useMemoryFallback) {
    memoriesFallback = memoriesFallback.filter(m => m.key !== normalizedKey);
    return;
  }
  try {
    const stmt = db.prepare("DELETE FROM memories WHERE key = ?");
    stmt.run(normalizedKey);
  } catch (err) {
    console.error("Failed to delete memory:", err);
  }
}

export function clearAllMemories() {
  if (useMemoryFallback) {
    memoriesFallback = [];
    return;
  }
  try {
    db.prepare("DELETE FROM memories").run();
  } catch (err) {
    console.error("Failed to clear memories:", err);
  }
}
