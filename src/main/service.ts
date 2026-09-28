import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { activationMatches, hashPassword, verifyPassword } from './security';
import { migrate } from './schema';

const now = () => new Date().toISOString();
type Row = Record<string, unknown>;
export class AppError extends Error { constructor(message: string) { super(message); this.name = 'AppError'; } }
function text(value: unknown, field: string, required = false, max = 2000): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new AppError(`${field} must be ${required ? 'provided' : 'valid'} (maximum ${max} characters).`);
  return value.trim();
}
function obj(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('Invalid request.');
  return value as Row;
}
function integer(value: unknown, label: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new AppError(`${label} must be a valid whole number.`);
  return value as number;
}
const patientFields = ['name','phone','emergency_phone','dob','gender','blood_group','address','presenting_problem','medical_history','dental_history','allergies','medications','notes','preferred_language'] as const;
const visitFields = ['complaint','history','examination','diagnosis','affected_teeth','treatment','procedure_text','advice','follow_up','notes'] as const;
const permissionDefaults: Record<string,string[]> = {
  Owner: ['patients.view','patients.create','patients.edit','patients.archive','clinical.visits.write','billing.invoices.view','billing.invoices.create','billing.payments.record','finance.reports.view','users.manage','audit.view'],
  Administrator: ['patients.view','patients.create','patients.edit','patients.archive','clinical.visits.write','billing.invoices.view','billing.invoices.create','billing.payments.record','finance.reports.view','users.manage'],
  Dentist: ['patients.view','patients.create','patients.edit','clinical.visits.write'],
  Receptionist: ['patients.view','patients.create','patients.edit','billing.invoices.view','billing.invoices.create','billing.payments.record'],
  'Nurse/Assistant': ['patients.view'], Accountant: ['billing.invoices.view','billing.invoices.create','billing.payments.record','finance.reports.view'], 'Inventory Manager': []
};
export type Session = { id: string; username: string; role: string; permissions: string[]; lastActive: number };

export class ClinicService {
  readonly db: Database.Database;
  private sessions = new Map<number, Session>();
  constructor(path: string) { this.db = new Database(path); migrate(this.db); }
  close(): void { this.db.close(); }
  private meta(key: string): string | undefined { return (this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key) as {value:string}|undefined)?.value; }
  private audit(actor: string | null, action: string, entity: string, entityId: string | null, result = 'success'): void {
    this.db.prepare('INSERT INTO audit_logs(id,at,actor_id,action,entity,entity_id,result) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),now(),actor,action,entity,entityId,result);
  }
  status(sender: number): Row {
    const session = this.session(sender);
    return { phase: !this.meta('activated') ? 'activation' : !this.meta('setup_complete') ? 'setup' : session ? 'ready' : 'login', clinic: this.meta('clinic_name') || '', user: session ? { username: session.username, role: session.role, permissions: session.permissions } : null };
  }
  private session(sender: number): Session | undefined {
    const session = this.sessions.get(sender);
    if (session && Date.now() - session.lastActive > 10 * 60_000) { this.sessions.delete(sender); return undefined; }
    return session;
  }
  private require(sender: number, permission: string): Session {
    const session = this.session(sender);
    if (!session) throw new AppError('Session locked or expired. Sign in again.');
    if (!session.permissions.includes(permission)) throw new AppError('You do not have permission for this operation.');
    session.lastActive = Date.now();
    return session;
  }
  activate(value: unknown): void {
    if (this.meta('activated')) throw new AppError('Application is already activated.');
    const code = text(obj(value).code, 'Activation code', true, 100);
    if (!activationMatches(code)) throw new AppError('Activation code was not accepted. Check the code and try again.');
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO metadata(key,value) VALUES('activated',?)").run(now());
      this.audit(null,'activation','application',null);
    })();
  }
  setup(value: unknown): void {
    if (!this.meta('activated') || this.meta('setup_complete')) throw new AppError('Initial setup is unavailable.');
    const v = obj(value);
    const clinic = text(v.clinic, 'Clinic name', true, 120);
    const username = text(v.username, 'Username', true, 40);
    if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) throw new AppError('Username must be 3–40 letters, numbers, dots, hyphens or underscores.');
    const password = text(v.password, 'Password', true, 256);
    const dentist = text(v.dentist, 'Dentist name', true, 120);
    const designation = text(v.designation ?? '', 'Designation', false, 200);
    const hash = hashPassword(password);
    this.db.transaction(() => {
      if (this.meta('setup_complete')) throw new AppError('Initial setup is already complete.');
      const id = randomUUID();
      this.db.prepare('INSERT INTO metadata(key,value) VALUES(?,?)').run('clinic_name',clinic);
      this.db.prepare('INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,?)').run(id,username,hash,now());
      for (const [role, permissions] of Object.entries(permissionDefaults)) {
        this.db.prepare('INSERT INTO roles(id,name,system) VALUES(?,?,1)').run(role,role);
        for (const permission of permissions) {
          this.db.prepare('INSERT OR IGNORE INTO permissions(key) VALUES(?)').run(permission);
          this.db.prepare('INSERT INTO role_permissions(role_id,permission_key) VALUES(?,?)').run(role,permission);
        }
      }
      this.db.prepare('INSERT INTO user_roles(user_id,role_id) VALUES(?,?)').run(id,'Owner');
      this.db.prepare('INSERT INTO dentists(id,name,designations) VALUES(?,?,?)').run(randomUUID(),dentist,designation);
      this.db.prepare("INSERT INTO metadata(key,value) VALUES('setup_complete',?)").run(now());
      this.audit(id,'setup','application',null);
    })();
  }
  login(sender: number, value: unknown): void {
    if (!this.meta('setup_complete')) throw new AppError('Complete initial setup first.');
    const v = obj(value);
    const username = text(v.username, 'Username', true, 40);
    const password = text(v.password, 'Password', true, 256);
    const user = this.db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(username) as Row | undefined;
    if (user?.locked_until && Date.parse(user.locked_until as string) > Date.now()) throw new AppError('Account temporarily locked. Try again later.');
    if (!user || user.status !== 'active' || !verifyPassword(password,user.password_hash as string)) {
      if (user) {
        const attempts = (user.failed_attempts as number) + 1;
        this.db.prepare('UPDATE users SET failed_attempts=?,locked_until=? WHERE id=?').run(attempts >= 5 ? 0 : attempts,attempts >= 5 ? new Date(Date.now()+15*60_000).toISOString() : null,user.id);
      }
      this.audit(user?.id as string || null,'login','user',user?.id as string || null,'failed');
      throw new AppError('Incorrect credentials or unavailable account. After five failures, wait 15 minutes.');
    }
    this.db.prepare('UPDATE users SET failed_attempts=0,locked_until=NULL WHERE id=?').run(user.id);
    const roles = this.db.prepare('SELECT r.name FROM roles r JOIN user_roles ur ON ur.role_id=r.id WHERE ur.user_id=?').all(user.id) as {name:string}[];
    const perms = this.db.prepare('SELECT DISTINCT rp.permission_key AS key FROM role_permissions rp JOIN user_roles ur ON ur.role_id=rp.role_id WHERE ur.user_id=?').all(user.id) as {key:string}[];
    this.sessions.set(sender,{id:user.id as string, username:user.username as string, role:roles.map(r=>r.name).join(', '), permissions:perms.map(p=>p.key),lastActive:Date.now()});
    this.audit(user.id as string,'login','user',user.id as string);
  }
  lock(sender: number): void { const session = this.sessions.get(sender); if (session) this.audit(session.id,'lock','user',session.id); this.sessions.delete(sender); }
  // This service method, not the renderer, is the sole authorization boundary for IPC operations.
  request(sender: number, action: string, input: unknown): unknown {
    if (action === 'status') return this.status(sender);
    if (action === 'activate') return this.activate(input);
    if (action === 'setup') return this.setup(input);
    if (action === 'login') return this.login(sender,input);
    if (action === 'lock') return this.lock(sender);
    if (action === 'patients.list') {
      this.require(sender,'patients.view');
      const v = obj(input); const query = text(v.query ?? '', 'Search', false, 100);
      const page = integer(v.page ?? 0,'Page',0,1000000);
      const filter = `%${query.replace(/[\\%_]/g,'\\$&')}%`;
      return this.db.prepare("SELECT id,code,name,phone,gender,registered_at FROM patients WHERE archived_at IS NULL AND (name LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\') ORDER BY registered_at DESC LIMIT 30 OFFSET ?").all(filter,filter,filter,page*30);
    }
    if (action === 'patients.get') {
      this.require(sender,'patients.view');
      const id = text(obj(input).id,'Patient identifier',true,64);
      const patient = this.db.prepare('SELECT * FROM patients WHERE id=? AND archived_at IS NULL').get(id);
      if (!patient) throw new AppError('Patient not found or archived.');
      const visits = this.db.prepare('SELECT * FROM visits WHERE patient_id=? ORDER BY occurred_at DESC LIMIT 100').all(id);
      return {patient,visits};
    }
    if (action === 'patients.create') {
      const actor = this.require(sender,'patients.create'); const v = obj(input);
      const fields = patientFields.map(f=>text(v[f] ?? '',f,f==='name',2000));
      if (fields[1] && !/^[+0-9 ()-]{7,20}$/.test(fields[1])) throw new AppError('Enter a valid phone number.');
      return this.db.transaction(() => {
        const id = randomUUID();
        const seq = (this.db.prepare("SELECT value FROM metadata WHERE key='patient_sequence'").get() as {value:string}|undefined)?.value;
        const next = Number(seq || '0')+1;
        this.db.prepare("INSERT INTO metadata(key,value) VALUES('patient_sequence',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(next));
        const code = `DP-${String(next).padStart(6,'0')}`;
        this.db.prepare(`INSERT INTO patients(id,code,${patientFields.join(',')},registered_at,created_by) VALUES(${Array(2+patientFields.length+2).fill('?').join(',')})`).run(id,code,...fields,now(),actor.id);
        this.audit(actor.id,'patient.created','patient',id);
        return id;
      })();
    }
    if (action === 'visits.create') {
      const actor = this.require(sender,'clinical.visits.write'); const v = obj(input);
      const patientId = text(v.patientId,'Patient identifier',true,64);
      const dentistId = text(v.dentistId,'Dentist identifier',true,64);
      const patient = this.db.prepare('SELECT id FROM patients WHERE id=? AND archived_at IS NULL').get(patientId);
      const dentist = this.db.prepare('SELECT name FROM dentists WHERE id=? AND active=1').get(dentistId) as {name:string}|undefined;
      if (!patient || !dentist) throw new AppError('Select an active patient and dentist.');
      const fields = visitFields.map(f=>text(v[f] ?? '',f,f==='complaint',5000));
      return this.db.transaction(() => {
        const id = randomUUID();
        this.db.prepare(`INSERT INTO visits(id,patient_id,dentist_id,dentist_name_snapshot,occurred_at,${visitFields.join(',')},created_by) VALUES(${Array(5+visitFields.length+1).fill('?').join(',')})`).run(id,patientId,dentistId,dentist.name,now(),...fields,actor.id);
        this.audit(actor.id,'visit.created','visit',id);
        return id;
      })();
    }
    if (action === 'dentists.list') { this.require(sender,'patients.view'); return this.db.prepare('SELECT id,name,designations FROM dentists WHERE active=1 ORDER BY name').all(); }
    if (action === 'invoices.list') {
      this.require(sender,'billing.invoices.view');
      return this.db.prepare('SELECT i.*,p.code,(SELECT COALESCE(SUM(amount_poisha),0) FROM payments WHERE invoice_id=i.id) paid_poisha FROM invoices i JOIN patients p ON p.id=i.patient_id ORDER BY issued_at DESC LIMIT 100').all();
    }
    if (action === 'invoices.create') {
      const actor=this.require(sender,'billing.invoices.create'); const v=obj(input);
      const patientId=text(v.patientId,'Patient identifier',true,64);
      const patient=this.db.prepare('SELECT name FROM patients WHERE id=? AND archived_at IS NULL').get(patientId) as {name:string}|undefined;
      if (!patient) throw new AppError('Select an active patient.');
      if (!Array.isArray(v.items) || v.items.length<1 || v.items.length>100) throw new AppError('Add 1–100 invoice items.');
      const items=v.items.map(raw=>{const item=obj(raw); const description=text(item.description,'Item description',true,200); const quantity=integer(item.quantity,'Quantity',1,100000); const unit=integer(item.unit_poisha,'Unit price',0,100000000000); const line=quantity*unit; if(!Number.isSafeInteger(line)) throw new AppError('Invoice amount exceeds supported range.'); return {description,quantity,unit,line};});
      const subtotal=items.reduce((sum,item)=>sum+item.line,0);
      const discount=integer(v.discount_poisha ?? 0,'Discount',0,subtotal);
      if (!Number.isSafeInteger(subtotal)) throw new AppError('Invoice amount exceeds supported range.');
      return this.db.transaction(()=>{
        const id=randomUUID(); const next=Number(this.meta('invoice_sequence')||'0')+1;
        const number=`INV-${String(next).padStart(6,'0')}`;
        this.db.prepare("INSERT INTO metadata(key,value) VALUES('invoice_sequence',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(next));
        this.db.prepare("INSERT INTO invoices(id,number,patient_id,patient_name_snapshot,issued_at,subtotal_poisha,discount_poisha,total_poisha,status,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)").run(id,number,patientId,patient.name,now(),subtotal,discount,subtotal-discount,'finalized',actor.id);
        for(const item of items) this.db.prepare('INSERT INTO invoice_items(id,invoice_id,description,quantity,unit_poisha,line_total_poisha) VALUES(?,?,?,?,?,?)').run(randomUUID(),id,item.description,item.quantity,item.unit,item.line);
        this.audit(actor.id,'invoice.created','invoice',id); return id;
      })();
    }
    if (action === 'payments.record') {
      const actor=this.require(sender,'billing.payments.record'); const v=obj(input);
      const invoiceId=text(v.invoiceId,'Invoice identifier',true,64);
      const amount=integer(v.amount_poisha,'Amount',1,100000000000);
      const method=text(v.method,'Payment method',true,40);
      if (!['Cash','Bank','Card','bKash','Nagad','Rocket','Upay','Other'].includes(method)) throw new AppError('Select a supported payment method.');
      const reference=text(v.reference ?? '','Reference',false,120);
      return this.db.transaction(()=>{
        const invoice=this.db.prepare('SELECT id,patient_id,total_poisha,status FROM invoices WHERE id=?').get(invoiceId) as Row|undefined;
        if(!invoice || invoice.status!=='finalized') throw new AppError('Invoice is unavailable for payment.');
        const paid=(this.db.prepare('SELECT COALESCE(SUM(amount_poisha),0) paid FROM payments WHERE invoice_id=?').get(invoiceId) as {paid:number}).paid;
        if(amount> (invoice.total_poisha as number)-paid) throw new AppError('Payment exceeds the remaining invoice balance.');
        const id=randomUUID();
        this.db.prepare('INSERT INTO payments(id,invoice_id,patient_id,amount_poisha,method,reference,received_at,received_by) VALUES(?,?,?,?,?,?,?,?)').run(id,invoiceId,invoice.patient_id,amount,method,reference,now(),actor.id);
        this.audit(actor.id,'payment.recorded','payment',id); return id;
      })();
    }
    if (action === 'finance.summary') {
      this.require(sender,'finance.reports.view');
      const v=obj(input);
      const start=text(v.start,'Start date',true,10);
      const end=text(v.end,'End date',true,10);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start>end) throw new AppError('Choose a valid date range.');
      return this.db.prepare(`SELECT
        (SELECT COALESCE(SUM(total_poisha),0) FROM invoices WHERE status='finalized' AND substr(issued_at,1,10) BETWEEN ? AND ?) AS invoiced_poisha,
        (SELECT COALESCE(SUM(amount_poisha),0) FROM payments WHERE substr(received_at,1,10) BETWEEN ? AND ?) AS paid_poisha`).get(start,end,start,end);
    }
    if (action === 'dashboard') {
      this.require(sender,'patients.view');
      const patients=(this.db.prepare('SELECT COUNT(*) n FROM patients WHERE archived_at IS NULL').get() as {n:number}).n;
      const visits=(this.db.prepare('SELECT COUNT(*) n FROM visits').get() as {n:number}).n;
      const canFinance=this.session(sender)?.permissions.includes('finance.reports.view');
      const finance=canFinance ? this.db.prepare('SELECT (SELECT COALESCE(SUM(total_poisha),0) FROM invoices WHERE status=\'finalized\') billed,(SELECT COALESCE(SUM(amount_poisha),0) FROM payments) received').get() : null;
      return {patients,visits,finance};
    }
    throw new AppError('This operation is not available.');
  }
  // For future test fixtures only: no renderer-accessible session creation method.
  getSession(sender:number): Session | undefined { return this.session(sender); }
}
