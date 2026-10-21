jest.mock('next/headers',()=>({headers:jest.fn()}));
jest.mock('@/lib/server/appwrite',()=>({createAdminClient:jest.fn()}));
import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/server/appwrite';
import { getMaintenanceStatus,getRequestMaintenanceStatus } from '@/lib/server/maintenance';

const config=JSON.stringify({enabled:true,endsAt:'2099-01-01T00:00:00Z'});
let originalEnv:string|undefined;
let originalVercel:string|undefined;
let originalVercelEnv:string|undefined;
beforeEach(()=>{
  jest.resetAllMocks();originalEnv=process.env.NODE_ENV;originalVercel=process.env.VERCEL;originalVercelEnv=process.env.VERCEL_ENV;
  Object.assign(process.env,{NODE_ENV:'development'});delete process.env.VERCEL;delete process.env.VERCEL_ENV;
  (createAdminClient as jest.Mock).mockResolvedValue({databases:{clearReadCacheForCollection:jest.fn(),getDocument:jest.fn().mockResolvedValue({config})}});
});
afterEach(()=>{
  for(const[key,value]of Object.entries({NODE_ENV:originalEnv,VERCEL:originalVercel,VERCEL_ENV:originalVercelEnv})){
    if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
});
const authority=(host:string)=>({get:(key:string)=>key==='host'?host:null});
it('leaves localhost available without reading the live maintenance configuration',async()=>{
  (headers as jest.Mock).mockResolvedValue(authority('localhost:5000'));
  expect(await getRequestMaintenanceStatus()).toEqual({active:false,enabled:false,endsAt:null});
  expect(createAdminClient).not.toHaveBeenCalled();
});
it('continues enforcing active maintenance on the live domain',async()=>{
  expect(await getRequestMaintenanceStatus(authority('crm.example.com'))).toMatchObject({active:true,enabled:true});
});
it('keeps raw admin settings visible from localhost so the live schedule can be managed',async()=>{
  expect(await getMaintenanceStatus()).toMatchObject({active:true,enabled:true});
});
it('does not accept a spoofed localhost host on Vercel',async()=>{
  process.env.VERCEL='1';
  expect(await getRequestMaintenanceStatus(authority('localhost:5000'))).toMatchObject({active:true});
});
