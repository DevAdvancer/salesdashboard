import fc from 'fast-check';
import { isLocalMaintenanceRequest } from '@/lib/utils/maintenance-scope';
const read = (host:string|null,forwarded:string|null=null) => ({get:(key:string)=>key==='host'?host:key==='x-forwarded-host'?forwarded:null});

it('exempts loopback development requests on any valid port',()=>{
  fc.assert(fc.property(fc.constantFrom('localhost','127.0.0.1','[::1]'),fc.integer({min:1,max:65535}),(host,port)=>{
    const authority=`${host}:${port}`;
    expect(isLocalMaintenanceRequest(read(authority),{nodeEnv:'development',hosted:false})).toBe(true);
    expect(isLocalMaintenanceRequest(read(authority,authority),{nodeEnv:'development',hosted:false})).toBe(true);
  }));
});
it('never exempts a live host or a public forwarded host',()=>{
  fc.assert(fc.property(fc.uuid(),id=>{
    const live=`localhost.${id}.example.com`;
    expect(isLocalMaintenanceRequest(read(live,'localhost:5000'),{nodeEnv:'development',hosted:false})).toBe(false);
    expect(isLocalMaintenanceRequest(read('localhost:5000',live),{nodeEnv:'development',hosted:false})).toBe(false);
  }));
});
it('cannot use local-looking headers to bypass a hosted deployment or production server',()=>{
  fc.assert(fc.property(fc.constantFrom('localhost','127.0.0.1','[::1]'),host=>{
    expect(isLocalMaintenanceRequest(read(host),{nodeEnv:'development',hosted:true})).toBe(false);
    expect(isLocalMaintenanceRequest(read(host),{nodeEnv:'production',hosted:false})).toBe(false);
  }));
});
it.each([null,'','localhost,example.com','localhost@example.com','localhost/path','localhost?host=example.com','localhost#example.com',' localhost','localhost:999999'])('does not bypass maintenance for an invalid authority %s',host=>{
  expect(isLocalMaintenanceRequest(read(host),{nodeEnv:'development',hosted:false})).toBe(false);
});
