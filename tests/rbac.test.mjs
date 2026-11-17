const B = process.env.TEST_URL || "http://localhost:3456";
function session(){let c={};const jar=()=>Object.entries(c).map(([k,v])=>k+"="+v).join("; ");const st=r=>{for(const x of r.headers.getSetCookie()){const [kv]=x.split(";");const i=kv.indexOf("=");c[kv.slice(0,i)]=kv.slice(i+1)}};
 return {async login(e,p){const cs=await fetch(B+"/api/auth/csrf");st(cs);const t=(await cs.json()).csrfToken;const r=await fetch(B+"/api/auth/callback/credentials",{method:"POST",redirect:"manual",body:new URLSearchParams({csrfToken:t,email:e,password:p}),headers:{cookie:jar(),"content-type":"application/x-www-form-urlencoded"}});st(r);},
 async req(path,method="GET",body){const r=await fetch(B+path,{method,headers:{cookie:jar(),"content-type":"application/json"},body:body?JSON.stringify(body):undefined});let j;try{j=await r.json()}catch{j={}}return {s:r.status,j}}}}
const log=(n,ok,x="")=>console.log(`${ok?"PASS":"FAIL"}  ${n} ${x}`);
const A=session(); await A.login("admin@paylesscarrental.com",process.env.ADMIN_INITIAL_PASSWORD || "TestPassword123!");
let r=await A.req("/api/admin/roles"); log("system roles present",r.j.roles?.filter(x=>x.isSystem).length===6, r.j.roles?.map(x=>x.key).join(","));
r=await A.req("/api/admin/roles","POST",{name:"Agent aeroport B",description:"Comptoir TUN",permissions:["dashboard.view","bookings.view","bookings.edit","calendar.view","bogus.perm"]});
const key=r.j.role?.key; log("create custom role",r.s===201 && !r.j.role.permissions.includes("bogus.perm"),key);
r=await A.req("/api/admin/roles","POST",{name:"Agent aeroport B nuit",copyFrom:key}); log("duplicate role",r.s===201 && r.j.role.permissions.length===4, r.j.role?.key);
const dupKey=r.j.role.key;
r=await A.req("/api/admin/users","POST",{name:"Agent TUN",email:"tun2@ex.com",password:"tunpass123",role:key}); log("create user with custom role",r.s===201,r.j.error||"");
const U=session(); await U.login("tun2@ex.com","tunpass123");
r=await U.req("/api/admin/me"); log("custom-role user can sign in",r.j.user?.role===key, `access.bookings=${r.j.access?.bookings} fleet=${r.j.access?.fleet}`);
const bk=await U.req("/api/admin/bookings?limit=5"); log("bookings.view → list 200",bk.s===200);
const target=(bk.j.bookings||[]).find(b=>!["cancelled","completed"].includes(b.status));
if(target){
 r=await U.req(`/api/admin/bookings/${target._id}`,"PATCH",{status:"cancelled"}); log("no bookings.cancel → cancel refused 403",r.s===403,r.j.error);
 r=await U.req(`/api/admin/bookings/${target._id}`,"PATCH",{internalNotes:"note agent"}); log("bookings.edit → edit allowed",r.s===200);
 r=await U.req(`/api/admin/bookings/${target._id}`,"DELETE"); log("no bookings.delete → 403",r.s===403);
}
r=await U.req("/api/admin/vehicles"); log("no fleet.view → 403",r.s===403);
r=await U.req("/api/admin/users"); log("no users.view → 403",r.s===403);
r=await U.req("/api/admin/roles","PATCH",{key,permissions:["bookings.delete"]}); log("cannot edit roles without roles.edit",r.s===403);
r=await A.req("/api/admin/roles","PATCH",{key,permissions:["dashboard.view","bookings.view","bookings.edit","bookings.cancel","calendar.view"]}); log("superadmin grants bookings.cancel",r.s===200);
if(target){ r=await U.req(`/api/admin/bookings/${target._id}`,"PATCH",{status:"cancelled"}); log("cancel now allowed",r.s===200, r.j.error||""); }
r=await A.req("/api/admin/roles","PATCH",{key:"superadmin",permissions:[]}); log("superadmin role locked",r.s===403);
r=await A.req("/api/admin/roles?key=admin","DELETE"); log("system role cannot be deleted",r.s===403);
r=await A.req(`/api/admin/roles?key=${key}`,"DELETE"); log("delete role in use → asks reassignment (409)",r.s===409, r.j.error);
r=await A.req(`/api/admin/roles?key=${key}&reassignTo=staff`,"DELETE"); log("delete with reassignment",r.s===200 && r.j.reassigned===1);
r=await A.req("/api/admin/users"); log("user moved to staff",r.j.users.find(u=>u.email==="tun2@ex.com")?.role==="staff");
await A.req(`/api/admin/roles?key=${dupKey}`,"DELETE");
// escalation: an admin cannot grant superadmin nor edit roles
await A.req("/api/admin/users","POST",{name:"Admin Two",email:"adm3@ex.com",password:"adm2pass123",role:"admin"});
const D=session(); await D.login("adm3@ex.com","adm2pass123");
r=await D.req("/api/admin/users","POST",{name:"Evil",email:"evil@ex.com",password:"evilpass123",role:"superadmin"}); log("admin cannot create superadmin",r.s===403, `status=${r.s}`);
r=await D.req("/api/admin/roles","POST",{name:"X",permissions:["roles.edit"]}); log("admin (no roles.create) cannot create roles",r.s===403);
