export {};
declare global { interface Window { dentiva: { request: (action:string,input?:unknown)=>Promise<unknown> } } }
