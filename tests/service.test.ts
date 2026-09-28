import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ClinicService } from '../src/main/service';
import { hashPassword, verifyPassword, activationMatches } from '../src/main/security';
import { migrate } from '../src/main/schema';
import Database from 'better-sqlite3';

let clinic: ClinicService;
const sender=42;
function initialized(){
  clinic.db.prepare("INSERT INTO metadata(key,value) VALUES('activated','test')").run();
  clinic.setup({clinic:'দাঁত Care',dentist:'Dr Rahman',designation:'BDS',username:'owner',password:'this-is-a-strong-password'});
  clinic.login(sender,{username:'owner',password:'this-is-a-strong-password'});
}
function patient(name='নাম Patient') {return clinic.request(sender,'patients.create',{name,phone:'01712345678'}) as string;}
const request=(action:string,payload:unknown={})=>clinic.request(sender,action,payload);

beforeEach(()=>{clinic=new ClinicService(':memory:');});
afterEach(()=>clinic.close());
describe('schema and offline security',()=>{
  it('enforces relationships, persistent schema version and migration idempotency',()=>{
    expect(clinic.db.pragma('user_version',{simple:true})).toBe(1);
    migrate(clinic.db);
    expect(()=>clinic.db.prepare("INSERT INTO visits(id,patient_id,dentist_name_snapshot,occurred_at,complaint,created_by) VALUES('v','missing','x','date','c','none')").run()).toThrow();
  });
  it('rejects incorrect activation and does not advance setup',()=>{
    expect(activationMatches('invalid')).toBe(false);
    expect(()=>request('activate',{code:'invalid'})).toThrow('not accepted');
    expect(clinic.status(sender).phase).toBe('activation');
  });
  it('salts password hashes and fails closed on invalid hashes',()=>{
    const a=hashPassword('secure-password-123');const b=hashPassword('secure-password-123');
    expect(a).not.toBe(b);expect(a).not.toContain('secure-password-123');
    expect(verifyPassword('secure-password-123',a)).toBe(true);
    expect(verifyPassword('wrong',a)).toBe(false);
    expect(verifyPassword('anything','garbage')).toBe(false);
  });
  it('denies unauthenticated IPC and locks session',()=>{
    initialized();expect(()=>clinic.request(999,'patients.list',{})).toThrow('Session locked');
    request('lock');expect(()=>request('patients.list')).toThrow('Session locked');
  });
  it('locks after five wrong attempts',()=>{
    initialized();request('lock');
    for(let n=0;n<5;n++)expect(()=>request('login',{username:'owner',password:'wrong-pass'})).toThrow();
    expect(()=>request('login',{username:'owner',password:'this-is-a-strong-password'})).toThrow('temporarily locked');
  });
  it('stops requests to an unknown operation',()=>{initialized();expect(()=>request('database.raw',{sql:'DROP TABLE patients'})).toThrow('not available');});
});
describe('permanent clinical and billing records',()=>{
  beforeEach(initialized);
  it('creates unicode patients with unique sequential codes, visits and audit records',()=>{
    const id=patient();const next=patient('Another patient');
    const dentist=clinic.request(sender,'dentists.list',{}) as {id:string}[];
    request('visits.create',{patientId:id,dentistId:dentist[0].id,complaint:'দাঁতে ব্যথা',diagnosis:'caries'});
    const profile=request('patients.get',{id}) as {patient:{name:string,code:string},visits:{complaint:string}[]};
    expect(profile.patient.name).toBe('নাম Patient');expect(profile.patient.code).toBe('DP-000001');
    expect(profile.visits[0].complaint).toBe('দাঁতে ব্যথা');
    expect((request('patients.get',{id:next}) as {patient:{code:string}}).patient.code).toBe('DP-000002');
    expect((request('patients.list',{query:'নাম',page:0}) as unknown[]).length).toBe(1);
    expect((clinic.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='visit.created'").get() as {n:number}).n).toBe(1);
  });
  it('paginates patients and searches beyond the first page',()=>{
    for(let n=0;n<35;n++)patient(`Patient ${String(n).padStart(2,'0')}`);
    expect((request('patients.list',{page:0}) as unknown[]).length).toBe(30);
    expect((request('patients.list',{page:1}) as unknown[]).length).toBe(5);
    expect((request('patients.list',{query:'Patient 00',page:0}) as unknown[])).toHaveLength(1);
  });
  it('preserves invoice snapshots, exact poisha and multiple partial payments',()=>{
    const id=patient();
    const invoice=request('invoices.create',{patientId:id,items:[{description:'Consultation',quantity:2,unit_poisha:15050}],discount_poisha:100}) as string;
    const balance=()=> (request('invoices.list') as {total_poisha:number,paid_poisha:number,patient_name_snapshot:string}[])[0];
    expect(balance().total_poisha).toBe(30000);
    request('payments.record',{invoiceId:invoice,amount_poisha:10000,method:'bKash'});
    request('payments.record',{invoiceId:invoice,amount_poisha:20000,method:'Cash'});
    expect(balance().paid_poisha).toBe(30000);
    expect(()=>clinic.db.prepare('UPDATE invoices SET discount_poisha=0 WHERE id=?').run(invoice)).toThrow('cannot be edited');
    expect(()=>clinic.db.prepare('DELETE FROM payments WHERE invoice_id=?').run(invoice)).toThrow('append-only');
    expect(()=>request('payments.record',{invoiceId:invoice,amount_poisha:1,method:'Cash'})).toThrow('exceeds');
    clinic.db.prepare('UPDATE patients SET name=? WHERE id=?').run('Changed',id);
    expect(balance().patient_name_snapshot).toBe('নাম Patient');
    expect((clinic.db.prepare('SELECT COUNT(*) n FROM payments').get() as {n:number}).n).toBe(2);
  });
  it('rolls back invalid amounts and missing dentist writes',()=>{
    const id=patient();
    expect(()=>request('visits.create',{patientId:id,dentistId:'missing',complaint:'Pain'})).toThrow();
    expect(()=>request('invoices.create',{patientId:id,items:[{description:'Care',quantity:2,unit_poisha:-10}]})).toThrow();
    expect((clinic.db.prepare('SELECT COUNT(*) n FROM invoices').get() as {n:number}).n).toBe(0);
  });
  it('enforces financial access beyond UI even for receptionist with invoice access',()=>{
    const receptionist='receptionist-user';
    clinic.db.prepare('INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,?)').run(receptionist,'reception',hashPassword('another-strong-pass'),'2026-09-28');
    clinic.db.prepare('INSERT INTO user_roles(user_id,role_id) VALUES(?,?)').run(receptionist,'Receptionist');
    clinic.login(77,{username:'reception',password:'another-strong-pass'});
    expect(clinic.request(77,'invoices.list')).toEqual([]);
    expect(()=>clinic.request(77,'finance.summary',{start:'2026-01-01',end:'2026-12-31'})).toThrow('permission');
    expect((clinic.request(77,'dashboard') as {finance:unknown}).finance).toBeNull();
    expect(()=>clinic.request(77,'users.manage')).toThrow();
  });
  it('rejects SQL patterns as data rather than executing them',()=>{
    patient("Robert'); DROP TABLE patients; --");
    expect((clinic.db.prepare('SELECT COUNT(*) n FROM patients').get() as {n:number}).n).toBe(1);
  });
});
it('rejects future schema versions without modifying data',()=>{
  const db=new Database(':memory:');db.pragma('user_version=500');expect(()=>migrate(db)).toThrow('newer version');db.close();
});
