// Prueba completa de Cajas Rurales con una nube simulada (pruebas/nube-falsa.js).
// Uso: desde la carpeta del proyecto, con un servidor en http://localhost:8123
//   python3 -m http.server 8123 &  node pruebas/prueba-app.js
const fs=require('fs'),path=require('path');
const {chromium}=require(process.env.PW||'playwright');
const RAIZ=path.join(__dirname,'..');
const FAKE=fs.readFileSync(path.join(__dirname,'nube-falsa.js'),'utf8');
const JSPDF=process.env.JSPDF&&fs.readFileSync(process.env.JSPDF,'utf8');
const URL_APP='http://localhost:8123/index.html';
const FOTOS=process.env.FOTOS||'/tmp/cr/fotos';fs.mkdirSync(FOTOS,{recursive:true});
let fallos=0,n=0;
const ok=(t,c)=>{n++;if(c)console.log('  ✓ '+t);else{fallos++;console.log('  ✗ '+t);}};

(async()=>{
  const nav=await chromium.launch({executablePath:process.env.CHROME||undefined});
  const ctx=await nav.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,acceptDownloads:true});
  await ctx.route('**/@supabase/supabase-js@*',r=>r.fulfill({status:200,contentType:'application/javascript',body:FAKE}));
  await ctx.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
  await ctx.route('https://fonts.gstatic.com/**',r=>r.abort());
  await ctx.route('https://cdnjs.cloudflare.com/**',r=>JSPDF?r.fulfill({status:200,contentType:'application/javascript',body:JSPDF}):r.abort());
  const p=await ctx.newPage();
  const errores=[];p.on('pageerror',e=>errores.push(e.message));
  const txt=async s=>(await p.textContent(s)||'').replace(/\s+/g,' ').trim();
  const foto=async nom=>p.screenshot({path:path.join(FOTOS,nom+'.png')});
  const clic=async s=>{await p.click(s);await p.waitForTimeout(120);};
  const nube=f=>p.evaluate(f);

  await p.goto(URL_APP);await p.evaluate(()=>{localStorage.clear();sessionStorage.clear();});await p.reload();await p.waitForTimeout(300);
  console.log('Entrada');
  ok('Arranca en la pantalla de entrada',await p.isVisible('#lgForm'));
  await foto('01-entrada');
  await p.fill('#lgU','cesar');await p.fill('#lgP','mala');await clic('#lgBtn');await p.waitForTimeout(150);
  ok('Contraseña mala: avisa',(await txt('#lgErr'))==='Usuario o contraseña incorrectos.');
  await p.fill('#lgU','tienda');await p.fill('#lgP','ClaveTienda1');await clic('#lgBtn');await p.waitForTimeout(150);
  ok('Tienda no entra (usuario de Cobros sin acceso)',(await txt('#lgErr'))==='Usuario o contraseña incorrectos.');
  await p.fill('#lgU','  César'.replace('é','e'));await p.fill('#lgP','ClaveCesar1');await clic('#lgBtn');await p.waitForTimeout(300);
  ok('César entra y la primera vez pide saldos iniciales',(await txt('h1'))==='Saldos iniciales');
  await foto('02-saldos-iniciales');

  console.log('Saldos iniciales');
  await p.fill('[data-sal="bam"]','470000');await p.fill('[data-sal="ss"]','8000');await p.fill('[data-sal="sr"]','6000');
  ok('El saldo se escribe con comas',(await p.inputValue('[data-sal="bam"]'))==='470,000');
  await clic('[data-a="saldosGuardar"]');await p.waitForTimeout(300);
  ok('Panel con la tarjeta en −Q 470,000.00',(await txt('.tarjeta .big'))==='−Q 470,000.00');
  ok('Santa Sofía −Q 8,000.00 y San Rafael −Q 6,000.00',(await txt('[data-v="ss"].caja .v'))==='−Q 8,000.00'&&(await txt('[data-v="sr"].caja .v'))==='−Q 6,000.00');
  ok('Total de cajas −Q 14,000.00',(await txt('.secH span')).includes('−Q 14,000.00'));
  const cu=await nube(()=>__nube.leer().cuentas);
  ok('En la nube quedan negativos',cu.find(c=>c.id==='bam').saldo_inicial===-470000&&cu.every(c=>c.configurada));

  console.log('Movimientos');
  const registrar=async(tipo,dest,monto,sinTarjeta)=>{
    await clic('[data-a="nuevo"]');
    if(tipo==='abono')await clic('[data-a="nvTipo"][data-v="abono"]');
    await clic(`[data-a="nvDest"][data-v="${dest}"]`);
    if(sinTarjeta)await clic('[data-a="nvCandado"]');
    await p.fill('#nvMonto','');await p.type('#nvMonto',monto);
    await clic('#nvGuardar');await p.waitForTimeout(250);
  };
  await clic('[data-a="nuevo"]');
  ok('Retiro viene marcado por defecto',(await p.getAttribute('[data-v="retiro"]','class')).includes('ret'));
  ok('Sin cuenta: dice Requerido y no deja guardar',(await p.isVisible('.req'))&&(await p.isDisabled('#nvGuardar')));
  await p.type('#nvMonto','1234567.891');
  ok('Monto con comas y 2 decimales',(await p.inputValue('#nvMonto'))==='1,234,567.89');
  await clic('[data-a="nvDest"][data-v="ss"]');
  ok('Retiro a caja: aparece "Afecta la tarjeta"',(await txt('.candado'))==='Afecta la tarjeta');
  ok('Vista previa con tarjeta y caja',(await txt('#nvPrev')).includes('Tarjeta BAM')&&(await txt('#nvPrev')).includes('Caja Santa Sofía'));
  await clic('[data-a="nvTipo"][data-v="abono"]');
  ok('Abono a caja: no hay candado',!(await p.isVisible('.candado')));
  await foto('03-nuevo');
  await clic('[data-a="ir"][data-v="panel"]');

  await registrar('retiro','ss','2500');
  ok('Retiro 2,500 a Santa Sofía: tarjeta −472,500 y caja −10,500',(await txt('.tarjeta .big'))==='−Q 472,500.00'&&(await txt('[data-v="ss"].caja .v'))==='−Q 10,500.00');
  await registrar('retiro','sr','1000',true);
  ok('Retiro sin afectar la tarjeta: tarjeta igual, San Rafael −7,000',(await txt('.tarjeta .big'))==='−Q 472,500.00'&&(await txt('[data-v="sr"].caja .v'))==='−Q 7,000.00');
  ok('Se marca "Retiro · solo caja"',(await txt('.lista .mov .t'))==='Retiro · solo caja');
  await registrar('abono','ss','500');
  ok('Abono de 500 de Santa Sofía: solo baja la caja (−10,000)',(await txt('[data-v="ss"].caja .v'))==='−Q 10,000.00'&&(await txt('.tarjeta .big'))==='−Q 472,500.00');
  await registrar('abono','bam','24000');
  ok('Abono a la tarjeta: −448,500',(await txt('.tarjeta .big'))==='−Q 448,500.00');
  await registrar('retiro','bam','6000');
  ok('Retiro de la tarjeta: −454,500',(await txt('.tarjeta .big'))==='−Q 454,500.00');
  const ms=await nube(()=>__nube.leer().movs);
  ok('En la nube: 5 movimientos con la regla de tarjeta correcta',ms.length===5&&ms[0].afecta_tarjeta===true&&ms[1].afecta_tarjeta===false&&ms[2].afecta_tarjeta===false&&ms[3].afecta_tarjeta&&ms[4].afecta_tarjeta);
  await foto('04-panel');

  console.log('Filtros del panel');
  const filas=async()=>p.$$eval('.lista .mov',e=>e.length);
  await clic('.chip[data-v="bam"]');ok('Tarjeta: 3 movimientos (no cuenta el solo caja ni el abono de caja)',(await filas())===3);
  ok('Saldo de la tarjeta en cada fila',(await txt('.lista .mov .mm .s'))==='Saldo −454,500.00');
  await clic('.chip[data-v="ss"]');ok('Santa Sofía: 2',(await filas())===2);
  await clic('.chip[data-v="sr"]');ok('San Rafael: 1',(await filas())===1);
  await clic('[data-a="filtroT"][data-v="sr"]');ok('Tocar la caja seleccionada vuelve a Todos',(await filas())===5);

  console.log('Anular');
  await clic('.lista .mov');
  ok('Detalle del movimiento',(await txt('.det h2'))==='Retiro'&&(await txt('.det')).includes('−Q 6,000.00'));
  await clic('[data-a="detConfirmar"]');await clic('[data-a="detAnular"]');await p.waitForTimeout(250);
  ok('Anulado: la tarjeta vuelve a −448,500',(await txt('.tarjeta .big'))==='−Q 448,500.00'&&(await filas())===4);
  ok('En la nube queda anulado, no borrado',(await nube(()=>__nube.leer().movs.filter(m=>m.anulado).length))===1);

  console.log('Deslizar para eliminar');
  const deslizar=async(sel,dx)=>{const b=await p.$eval(sel,e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width-40,y:r.y+r.height/2};});
    await p.mouse.move(b.x,b.y);await p.mouse.down();for(let i=1;i<=8;i++)await p.mouse.move(b.x+dx*i/8,b.y+1);await p.mouse.up();await p.waitForTimeout(300);};
  await deslizar('.lista .desliza:nth-child(1) .mov',-150);
  ok('Deslizar a la izquierda muestra "Eliminar"',!!(await p.$('.desliza.abierto'))&&!(await p.$('.det')));
  await clic('.lista .desliza:nth-child(1) .mov');
  ok('Tocar el renglón abierto lo cierra sin abrir el detalle',!(await p.$('.desliza.abierto'))&&!(await p.$('.det')));
  await deslizar('.lista .desliza:nth-child(1) .mov',-30);
  ok('Deslizar poquito no lo abre',!(await p.$('.desliza.abierto')));
  await deslizar('.lista .desliza:nth-child(1) .mov',-150);
  const tituloAntes=await txt('.lista .desliza:nth-child(1) .mov .t');
  await clic('.desliza.abierto .borrar');
  ok('Eliminar pide confirmar',(await txt('.det')).includes('¿Eliminar este movimiento?'));
  await clic('[data-a="detNo"]');await clic('[data-a="detCerrar"]');
  ok('Cancelar no borra nada',(await filas())===4);
  await deslizar('.lista .desliza:nth-child(1) .mov',-150);await clic('.desliza.abierto .borrar');
  await clic('[data-a="detAnular"]');await p.waitForTimeout(300);
  ok('Confirmado: se elimina ('+tituloAntes+' +24,000) y la tarjeta vuelve a −472,500',(await filas())===3&&(await txt('.tarjeta .big'))==='−Q 472,500.00');
  await nube(()=>{const db=__nube.leer();db.movs.forEach(m=>{if(m.monto===24000)m.anulado=false;});__nube.guardar(db);});
  await p.reload();await p.waitForTimeout(400);

  console.log('Registros y periodos');
  await nube(()=>{const db=__nube.leer();const d=(dias,h)=>{const x=new Date();x.setDate(x.getDate()-dias);x.setHours(h,15,0,0);return x.toISOString();};
    for(let i=0;i<22;i++)db.movs.push({id:'v'+i,fecha:d(2+i%3,9),creado_en:d(2+i%3,9),tipo:'abono',cuenta:'sr',monto:100,afecta_tarjeta:false,anulado:false});
    db.movs.push({id:'viejo1',fecha:d(40,10),creado_en:d(40,10),tipo:'retiro',cuenta:'ss',monto:1000,afecta_tarjeta:true,anulado:false});
    db.movs.push({id:'viejo2',fecha:d(200,10),creado_en:d(200,10),tipo:'abono',cuenta:'bam',monto:5000,afecta_tarjeta:true,anulado:false});
    __nube.guardar(db);});
  await p.reload();await p.waitForTimeout(400);
  ok('Al recargar sigue dentro (sesión abierta)',(await txt('h1'))==='Panel');
  ok('Guarda la fecha de entrada para pedir contraseña en 30 días',!!(await p.evaluate(()=>localStorage.getItem('cr_admin_desde'))));
  ok('Panel muestra 20 y "Mostrar más"',(await filas())===20&&(await txt('.btnSec')).startsWith('Mostrar más'));
  ok('Saldos ya incluyen lo agregado',(await txt('[data-v="sr"].caja .v'))==='−Q 4,800.00');
  await clic('.btnSec');
  ok('Abre Registros',(await txt('h1'))==='Registros');
  const info=async()=>txt('.scr .s[style*="13px"]');
  ok('7 días por defecto: 26 movimientos',(await info()).startsWith('26 movimientos'));
  ok('Agrupado por día',(await p.$$eval('.diaH',e=>e.length))>=3);
  await foto('05-registros');
  await clic('[data-a="regPreset"][data-v="30d"]');ok('30 días: 26 (el de hace 40 días no entra)',(await info()).startsWith('26 movimientos'));
  await clic('[data-a="regPreset"][data-v="12s"]');ok('12 semanas: 27',(await info()).startsWith('27 movimientos'));
  await clic('[data-a="regPreset"][data-v="1a"]');ok('1 año: 28',(await info()).startsWith('28 movimientos'));
  await clic('[data-a="regCuenta"][data-v="ss"]');ok('Solo Santa Sofía en 1 año: 3',(await info()).startsWith('3 movimientos'));
  ok('Totales de Santa Sofía: retiros 3,500 y abonos 500',(await txt('.resumen')).includes('−3,500.00')&&(await txt('.resumen')).includes('+500.00'));
  await clic('[data-a="regCuenta"][data-v="todo"]');
  // Fechas: desde hace 3 días hasta hace 2 días
  const f=dias=>{const x=new Date();x.setDate(x.getDate()-dias);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');};
  await p.$eval('#rgDesde',(e,v)=>{e.value=v;e.dispatchEvent(new Event('change',{bubbles:true}));},f(3));await p.waitForTimeout(120);
  await p.$eval('#rgHasta',(e,v)=>{e.value=v;e.dispatchEvent(new Event('change',{bubbles:true}));},f(2));await p.waitForTimeout(150);
  ok('Rango de fechas: 15 movimientos (días -3 y -2)',(await info()).startsWith('15 movimientos'));
  ok('Al elegir fechas se ve la página de fechas',(await p.getAttribute('#pt1','class'))==='on'&&!(await p.$eval('.presets button.on',()=>true).catch(()=>false)));
  await p.waitForTimeout(300);await foto('06-registros-fechas');
  await p.$eval('#rgHasta',(e,v)=>{e.value=v;e.dispatchEvent(new Event('change',{bubbles:true}));},f(5));await p.waitForTimeout(150);
  ok('Hasta antes que Desde: se ajusta Desde',(await p.inputValue('#rgDesde'))===f(5));

  console.log('PDF');
  await clic('[data-a="regPreset"][data-v="1a"]');
  const descarga=p.waitForEvent('download',{timeout:8000}).catch(()=>null);
  await clic('#btnPdf');const dl=await descarga;await p.waitForTimeout(300);
  ok('Se genera el PDF',!!dl||(await p.evaluate(()=>!!window.__ultimoPdf)));
  if(dl){const dest=path.join(FOTOS,'reporte.pdf');await dl.saveAs(dest);ok('Nombre del archivo',/^Cajas Rurales - Todas las cuentas - \d{4}-\d\d-\d\d al \d{4}-\d\d-\d\d\.pdf$/.test(dl.suggestedFilename()));}

  console.log('Ajustes y accesos');
  await clic('[data-a="ir"][data-v="panel"]');await clic('[data-a="ir"][data-v="ajustes"]');await p.waitForTimeout(250);
  ok('Ajustes con los 2 accesos',(await p.$$eval('.card .h b',e=>e.length))>=2);
  await clic('[data-a="accActivo"][data-v="ss"]');await clic('[data-a="accGuardar"][data-v="ss"]');await p.waitForTimeout(200);
  ok('Sin usuario: avisa',(await txt('.card .err'))==='El usuario debe tener al menos 3 letras.');
  await p.fill('[data-acc="ss"][data-c="nombre"]','Daniela');
  await p.fill('[data-acc="ss"][data-c="usuario"]','Santa Sofia');
  ok('El usuario se escribe sin espacios y en minúscula',(await p.inputValue('[data-acc="ss"][data-c="usuario"]'))==='santasofia');
  await clic('[data-a="accGuardar"][data-v="ss"]');await p.waitForTimeout(200);
  ok('Activo sin contraseña: avisa',(await txt('.card .err'))==='Pon una contraseña antes de activar el acceso.');
  await p.fill('[data-acc="ss"][data-c="clave"]','Daniela2026');await clic('[data-a="accGuardar"][data-v="ss"]');await p.waitForTimeout(200);
  ok('Guardado',(await txt('.card .ok')).startsWith('Guardado'));
  ok('Después muestra "Sin cambio" en contraseña',(await p.getAttribute('[data-acc="ss"][data-c="clave"]','placeholder'))==='Sin cambio');
  await foto('07-ajustes');
  await clic('[data-a="ir"][data-v="panel"]');await clic('[data-a="ir"][data-v="prev"]');
  ok('Vista previa de encargada: Santa Sofía con su saldo',(await txt('h1'))==='Caja Santa Sofía'&&(await txt('.tarjeta .big'))==='−Q 11,000.00');
  ok('Vista previa sin botones de editar',(await p.$$eval('button.mov',e=>e.length))===0);
  await clic('[data-a="ir"][data-v="panel"]');await clic('[data-a="ir"][data-v="ajustes"]');await p.waitForTimeout(200);
  await clic('[data-a="salirAdmin"]');await p.waitForTimeout(400);
  ok('Cerrar sesión vuelve a la entrada',await p.isVisible('#lgForm'));

  console.log('Encargada');
  await p.fill('#lgU','santasofia');await p.fill('#lgP','mala');await clic('#lgBtn');await p.waitForTimeout(150);
  ok('Clave mala',(await txt('#lgErr'))==='Usuario o contraseña incorrectos.');
  await p.fill('#lgP','Daniela2026');await clic('#lgBtn');await p.waitForTimeout(300);
  ok('Entra a su caja',(await txt('h1'))==='Caja Santa Sofía'&&(await txt('header')).includes('Daniela'));
  ok('Ve su saldo −Q 11,000.00',(await txt('.tarjeta .big'))==='−Q 11,000.00');
  ok('Ve 3 movimientos de su caja, sin nada de la tarjeta ni San Rafael',(await p.$$eval('.lista .mov',e=>e.length))===3&&!(await txt('.lista')).includes('San Rafael'));
  ok('Primero el más nuevo: Abono +500.00 con saldo −11,000.00',(await txt('.lista .mov .t'))==='Abono'&&(await txt('.lista .mov .m'))==='+500.00'&&(await txt('.lista .mov .mm .s'))==='Saldo −11,000.00');
  ok('No puede registrar ni editar',!(await p.$('.fab'))&&(await p.$$eval('button.mov',e=>e.length))===0);
  await foto('08-encargada');
  await p.reload();await p.waitForTimeout(300);
  ok('Al volver a abrir no pide contraseña',(await txt('h1'))==='Caja Santa Sofía');
  await nube(()=>{const db=__nube.leer();db.accesos[0].activo=false;db.sesionesEnc=[];__nube.guardar(db);});
  await p.reload();await p.waitForTimeout(300);
  ok('Si César la desactiva, se cierra y avisa',(await p.isVisible('#lgForm'))&&(await txt('#lgErr'))==='Tu sesión terminó. Vuelve a entrar.');

  console.log('Sesión de César: 30 días');
  await p.fill('#lgU','cesar');await p.fill('#lgP','ClaveCesar1');await clic('#lgBtn');await p.waitForTimeout(300);
  await p.evaluate(()=>localStorage.setItem('cr_admin_desde',String(Date.now()-29*86400000)));await p.reload();await p.waitForTimeout(300);
  ok('A los 29 días sigue dentro',(await txt('h1'))==='Panel');
  await p.evaluate(()=>localStorage.setItem('cr_admin_desde',String(Date.now()-31*86400000)));await p.reload();await p.waitForTimeout(300);
  ok('A los 31 días pide la contraseña otra vez',(await p.isVisible('#lgForm'))&&(await txt('#lgErr')).startsWith('Por seguridad'));

  console.log('Sin conexión');
  await p.fill('#lgU','cesar');await p.fill('#lgP','ClaveCesar1');await clic('#lgBtn');await p.waitForTimeout(300);
  await clic('[data-a="nuevo"]');await clic('[data-a="nvDest"][data-v="bam"]');await p.type('#nvMonto','100');
  await p.evaluate(()=>localStorage.setItem('__sin_red','1'));
  await clic('#nvGuardar');await p.waitForTimeout(200);
  ok('Sin internet: no se guarda y avisa, se queda en la pantalla',(await txt('#nvErr')).startsWith('No se guardó')&&(await txt('h1'))==='Nuevo movimiento');
  await p.evaluate(()=>localStorage.removeItem('__sin_red'));
  await clic('#nvGuardar');await p.waitForTimeout(250);
  ok('Con internet de nuevo: se guarda una sola vez',(await nube(()=>__nube.leer().movs.filter(m=>m.monto===100&&m.cuenta==='bam').length))===1);

  ok('Sin errores de JavaScript',errores.length===0);
  if(errores.length)console.log(errores);
  await nav.close();
  console.log(`\n${n-fallos}/${n} bien`);
  process.exit(fallos?1:0);
})();
