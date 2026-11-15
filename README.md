# Cajas Rurales

Control de la tarjeta BAM y de las cajas rurales Santa Sofía y San Rafael.

- **César** entra con su usuario de Cobros (`cesar`); la sesión queda abierta y pide la contraseña cada 30 días. Registra retiros y abonos (deslizar a la izquierda para eliminar), ve los registros por periodo o por fechas, saca PDF y administra los accesos.
- **Intereses de la tarjeta**: debajo del saldo de la tarjeta se ve el interés de hoy y el acumulado del corte; al tocarlo, el detalle día por día y dónde escribir lo que cobró el banco para comparar. Fórmula de BAM (comprobada con los estados de sep y oct 2026): saldo al cierre de cada día × tasa mensual ÷ 30. La tasa y el día de corte se cambian ahí mismo (se guardan en el teléfono).
- **Encargadas** entran con el usuario y la contraseña que César les pone en Ajustes. Solo ven su caja, sin poder cambiar nada. Su sesión dura 30 días.

## Archivos

- `index.html` — la app completa.
- `supabase/cajas_rurales.sql` — tablas (`cr_*`), reglas y funciones. Va en el mismo proyecto de Supabase de Cobros y no toca sus tablas. Se puede correr más de una vez.
- `pruebas/` — prueba automática con una nube simulada (`prueba-app.js`).

## Antes de publicar un cambio

1. Cambiar `const VERSION='...'` en `index.html`: los teléfonos se actualizan solos al ver una versión nueva.
2. Correr la prueba: `python3 -m http.server 8123` y `node pruebas/prueba-app.js` (y `node pruebas/prueba-intereses.js`, que repite el estado de cuenta de septiembre: debe dar Q6,711.70 contra Q6,711.74 del banco).

Si alguna vez se vuelve a correr `supabase/seguridad.sql` de Cobros, después hay que volver a correr `supabase/cajas_rurales.sql` (aquel le quita a la clave pública el permiso de las funciones de entrada de las encargadas).
