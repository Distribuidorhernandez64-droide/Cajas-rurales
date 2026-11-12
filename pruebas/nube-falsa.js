// Nube simulada para las pruebas: imita las tablas y funciones de supabase/cajas_rurales.sql
// (mismas reglas de negocio). La guarda en localStorage para sobrevivir recargas de la página.
(function(){
  const K='__nube_falsa';
  const ini=()=>({
    usuarios:{'cesar@cobros.local':'ClaveCesar1','tienda@cobros.local':'ClaveTienda1'},
    sesion:null,
    cuentas:[{id:'bam',saldo_inicial:0,configurada:false},{id:'ss',saldo_inicial:0,configurada:false},{id:'sr',saldo_inicial:0,configurada:false}],
    movs:[], accesos:[{caja:'ss',nombre:'',usuario:null,clave:null,activo:false},{caja:'sr',nombre:'',usuario:null,clave:null,activo:false}],
    sesionesEnc:[], seq:0, llamadas:[]
  });
  const leer=()=>{try{return JSON.parse(localStorage.getItem(K))||ini();}catch(e){return ini();}};
  const guardar=db=>localStorage.setItem(K,JSON.stringify(db));
  window.__nube={leer,guardar,reiniciar:()=>guardar(ini())};
  if(!localStorage.getItem(K))guardar(ini());
  const sinRed=()=>localStorage.getItem('__sin_red')==='1';
  const errRed={message:'Failed to fetch'};
  const esAdmin=db=>db.sesion==='cesar@cobros.local';

  function consulta(tabla){
    const q={tabla,filtros:[],ord:[],rango:null,accion:'select',datos:null};
    const api={
      select(){return api;},
      eq(k,v){q.filtros.push([k,v]);return api;},
      order(k,o){q.ord.push([k,o&&o.ascending===false?-1:1]);return api;},
      range(a,b){q.rango=[a,b];return api;},
      insert(d){q.accion='insert';q.datos=d;return api;},
      update(d){q.accion='update';q.datos=d;return api;},
      then(ok,mal){return Promise.resolve().then(()=>ejecutar(q)).then(ok,mal);}
    };
    return api;
  }
  function ejecutar(q){
    if(sinRed())return {data:null,error:errRed};
    const db=leer();db.llamadas.push(q.accion+' '+q.tabla);
    if(!esAdmin(db)){guardar(db);return q.accion==='select'?{data:[],error:null}:{data:null,error:{message:'new row violates row-level security policy'}};}
    const lista=q.tabla==='cr_cuentas'?db.cuentas:db.movs;
    const pasa=r=>q.filtros.every(([k,v])=>r[k]===v);
    if(q.accion==='select'){
      let r=lista.filter(pasa);
      q.ord.slice().reverse().forEach(([k,s])=>{r=r.slice().sort((a,b)=>(a[k]<b[k]?-1:a[k]>b[k]?1:0)*s);});
      if(q.rango)r=r.slice(q.rango[0],q.rango[1]+1);
      guardar(db);return {data:JSON.parse(JSON.stringify(r)),error:null};
    }
    if(q.accion==='insert'){
      const d=q.datos;
      if(!(+d.monto>0))return {data:null,error:{message:'check monto'}};
      if(!((d.cuenta==='bam'&&d.afecta_tarjeta)||(d.cuenta!=='bam'&&(d.tipo==='retiro'||!d.afecta_tarjeta))))return {data:null,error:{message:'check regla'}};
      const ahora=new Date(Date.now()+(db.seq++)).toISOString();
      db.movs.push({id:'m'+db.seq,fecha:d.fecha||ahora,creado_en:ahora,tipo:d.tipo,cuenta:d.cuenta,monto:Number(d.monto),afecta_tarjeta:!!d.afecta_tarjeta,anulado:false});
      guardar(db);return {data:null,error:null};
    }
    if(q.accion==='update'){
      lista.filter(pasa).forEach(r=>Object.assign(r,q.datos,q.datos.saldo_inicial!==undefined?{saldo_inicial:Number(q.datos.saldo_inicial)}:{}));
      guardar(db);return {data:null,error:null};
    }
  }
  function datosCaja(db,caja){
    const c=db.cuentas.find(x=>x.id===caja),a=db.accesos.find(x=>x.caja===caja);
    const ms=db.movs.filter(m=>m.cuenta===caja&&!m.anulado).sort((x,y)=>x.fecha<y.fecha?-1:x.fecha>y.fecha?1:x.creado_en<y.creado_en?-1:1);
    let s=Math.round(c.saldo_inicial*100);const out=[];
    ms.forEach(m=>{s+=(m.tipo==='retiro'?-1:1)*Math.round(m.monto*100);out.push({fecha:m.fecha,tipo:m.tipo,monto:m.monto,saldo:s/100});});
    return {ok:true,caja,cuenta:{ss:'Caja Santa Sofía',sr:'Caja San Rafael'}[caja],nombre:a.nombre,saldo:s/100,movimientos:out.reverse()};
  }
  function rpc(nombre,p){
    if(sinRed())return Promise.resolve({data:null,error:errRed});
    const db=leer();db.llamadas.push('rpc '+nombre);
    let res={data:null,error:null};
    if(nombre==='cr_es_admin')res.data=esAdmin(db);
    else if(nombre==='cr_ver_accesos'){if(!esAdmin(db))res.error={message:'Sin permiso'};else res.data=db.accesos.map(a=>({caja:a.caja,nombre:a.nombre,usuario:a.usuario,activo:a.activo,tiene_clave:!!a.clave}));}
    else if(nombre==='cr_guardar_acceso'){
      if(!esAdmin(db))res.error={message:'Sin permiso'};
      else{const a=db.accesos.find(x=>x.caja===p.p_caja),u=String(p.p_usuario||'').replace(/\s/g,'').toLowerCase(),k=p.p_clave||'';
        if(u.length<3)res.data={ok:false,error:'El usuario debe tener al menos 3 letras.'};
        else if(['cesar','tienda','facturacion'].includes(u))res.data={ok:false,error:'Ese usuario ya se usa en Cobros. Elige otro.'};
        else if(db.accesos.some(x=>x.caja!==p.p_caja&&x.usuario===u))res.data={ok:false,error:'Ese usuario ya lo tiene la otra caja.'};
        else if(k&&k.length<6)res.data={ok:false,error:'La contraseña debe tener al menos 6 caracteres.'};
        else if(p.p_activo&&!k&&!a.clave)res.data={ok:false,error:'Pon una contraseña antes de activar el acceso.'};
        else{const cerrar=!!k||!p.p_activo||a.usuario!==u;Object.assign(a,{nombre:String(p.p_nombre||'').trim(),usuario:u,activo:!!p.p_activo});if(k)a.clave=k;
          if(cerrar)db.sesionesEnc=db.sesionesEnc.filter(s=>s.caja!==a.caja);res.data={ok:true,sesiones_cerradas:cerrar};}}
    }
    else if(nombre==='cr_login'){
      const a=db.accesos.find(x=>x.usuario&&x.usuario===String(p.p_usuario||'').trim().toLowerCase());
      if(!a||!a.clave||a.clave!==p.p_clave)res.data={ok:false,error:'Usuario o contraseña incorrectos.'};
      else if(!a.activo)res.data={ok:false,error:'Este acceso está desactivado.'};
      else{const t='tok'+Math.random().toString(16).slice(2);db.sesionesEnc.push({t,caja:a.caja});res.data={ok:true,token:t,caja:a.caja,nombre:a.nombre};}
    }
    else if(nombre==='cr_datos'){
      const s=db.sesionesEnc.find(x=>x.t===p.p_token);
      if(!s)res.data={ok:false};
      else{const a=db.accesos.find(x=>x.caja===s.caja);res.data=a.activo?datosCaja(db,s.caja):{ok:false};}
    }
    else if(nombre==='cr_salir')db.sesionesEnc=db.sesionesEnc.filter(x=>x.t!==p.p_token);
    else res.error={message:'función desconocida '+nombre};
    guardar(db);
    return Promise.resolve(res);
  }
  window.supabase={createClient:()=>({
    from:consulta,
    rpc:rpc,
    auth:{
      async getSession(){const db=leer();return {data:{session:db.sesion?{user:{email:db.sesion}}:null}};},
      async signInWithPassword({email,password}){
        if(sinRed())return {data:{},error:errRed};
        const db=leer();if(db.usuarios[email]&&db.usuarios[email]===password){db.sesion=email;guardar(db);return {data:{session:{user:{email}},user:{email}},error:null};}
        return {data:{},error:{message:'Invalid login credentials'}};
      },
      async signOut(){const db=leer();db.sesion=null;guardar(db);return {error:null};}
    }
  })};
})();
