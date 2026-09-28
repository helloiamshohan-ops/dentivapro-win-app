import Database from 'better-sqlite3';

export function migrate(db: Database.Database): void {
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version > 1) throw new Error('This database was created by a newer version. Restore a compatible backup or update the application.');
  if (version === 1) return;
  try { db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE roles (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, system INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE permissions (key TEXT PRIMARY KEY);
    CREATE TABLE role_permissions (role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT, permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE RESTRICT, PRIMARY KEY(role_id,permission_key));
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, password_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')), failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT, created_at TEXT NOT NULL);
    CREATE TABLE user_roles (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT, PRIMARY KEY(user_id,role_id));
    CREATE TABLE dentists (id TEXT PRIMARY KEY, name TEXT NOT NULL, designations TEXT NOT NULL DEFAULT '', phone TEXT, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE patients (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, phone TEXT, emergency_phone TEXT, dob TEXT, age INTEGER, gender TEXT, blood_group TEXT, address TEXT, presenting_problem TEXT, medical_history TEXT, dental_history TEXT, allergies TEXT, medications TEXT, notes TEXT, preferred_language TEXT NOT NULL DEFAULT 'en', registered_at TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), archived_at TEXT);
    CREATE INDEX idx_patients_recent ON patients(registered_at DESC);
    CREATE INDEX idx_patients_name ON patients(name COLLATE NOCASE);
    CREATE INDEX idx_patients_phone ON patients(phone);
    CREATE TABLE visits (id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT, dentist_id TEXT REFERENCES dentists(id) ON DELETE RESTRICT, dentist_name_snapshot TEXT NOT NULL, occurred_at TEXT NOT NULL, complaint TEXT NOT NULL, history TEXT, examination TEXT, diagnosis TEXT, affected_teeth TEXT, treatment TEXT, procedure_text TEXT, advice TEXT, follow_up TEXT, notes TEXT, created_by TEXT NOT NULL REFERENCES users(id));
    CREATE INDEX idx_visits_patient ON visits(patient_id,occurred_at DESC);
    CREATE TABLE invoices (id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT, patient_name_snapshot TEXT NOT NULL, issued_at TEXT NOT NULL, subtotal_poisha INTEGER NOT NULL CHECK(subtotal_poisha>=0), discount_poisha INTEGER NOT NULL CHECK(discount_poisha>=0), total_poisha INTEGER NOT NULL CHECK(total_poisha>=0), status TEXT NOT NULL CHECK(status IN ('finalized','void')), created_by TEXT NOT NULL REFERENCES users(id));
    CREATE INDEX idx_invoices_patient ON invoices(patient_id,issued_at DESC);
    CREATE TABLE invoice_items (id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT, description TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0), unit_poisha INTEGER NOT NULL CHECK(unit_poisha>=0), line_total_poisha INTEGER NOT NULL CHECK(line_total_poisha>=0));
    CREATE TABLE payments (id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT, amount_poisha INTEGER NOT NULL CHECK(amount_poisha>0), method TEXT NOT NULL, reference TEXT, received_at TEXT NOT NULL, received_by TEXT NOT NULL REFERENCES users(id));
    CREATE INDEX idx_payments_invoice ON payments(invoice_id,received_at DESC);
    CREATE TABLE audit_logs (id TEXT PRIMARY KEY, at TEXT NOT NULL, actor_id TEXT REFERENCES users(id) ON DELETE RESTRICT, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT, result TEXT NOT NULL, context TEXT NOT NULL DEFAULT '{}');
    CREATE INDEX idx_audit_at ON audit_logs(at DESC);
    CREATE TRIGGER visits_no_update BEFORE UPDATE ON visits BEGIN SELECT RAISE(ABORT,'Visits are append-only'); END;
    CREATE TRIGGER visits_no_delete BEFORE DELETE ON visits BEGIN SELECT RAISE(ABORT,'Visits are append-only'); END;
    CREATE TRIGGER invoices_no_update BEFORE UPDATE ON invoices BEGIN SELECT RAISE(ABORT,'Finalized invoices cannot be edited'); END;
    CREATE TRIGGER invoices_no_delete BEFORE DELETE ON invoices BEGIN SELECT RAISE(ABORT,'Finalized invoices cannot be deleted'); END;
    CREATE TRIGGER invoice_items_no_update BEFORE UPDATE ON invoice_items BEGIN SELECT RAISE(ABORT,'Invoice lines cannot be edited'); END;
    CREATE TRIGGER invoice_items_no_delete BEFORE DELETE ON invoice_items BEGIN SELECT RAISE(ABORT,'Invoice lines cannot be deleted'); END;
    CREATE TRIGGER payments_no_update BEFORE UPDATE ON payments BEGIN SELECT RAISE(ABORT,'Payments are append-only'); END;
    CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments BEGIN SELECT RAISE(ABORT,'Payments are append-only'); END;
    PRAGMA user_version=1;
    COMMIT;`); } catch (error) { if (db.inTransaction) db.exec('ROLLBACK'); throw error; }
}
