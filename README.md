# Cajas Rurales

Control de la tarjeta BAM y de las cajas rurales Santa Sofía y San Rafael.

- **César** entra con su usuario de Cobros (`cesar`); la sesión queda abierta y pide la contraseña cada 30 días. Registra retiros y abonos (deslizar a la izquierda para eliminar), ve los registros por periodo o por fechas, saca PDF y administra los accesos.
- **Encargadas** entran con el usuario y la contraseña que César les pone en Ajustes. Solo ven su caja, sin poder cambiar nada. Su sesión dura 30 días.

## Archivos

- `index.html` — la app completa.
- `supabase/cajas_rurales.sql` — tablas (`cr_*`), reglas y funciones. Va en el mismo proyecto de Supabase de Cobros y no toca sus tablas. Se puede correr más de una vez.
- `pruebas/` — prueba automática con una nube simulada (`prueba-app.js`).

## Antes de publicar un cambio

1. Cambiar `const VERSION='...'` en `index.html`: los teléfonos se actualizan solos al ver una versión nueva.
2. Correr la prueba: `python3 -m http.server 8123` y `node pruebas/prueba-app.js`.

Si alguna vez se vuelve a correr `supabase/seguridad.sql` de Cobros, después hay que volver a correr `supabase/cajas_rurales.sql` (aquel le quita a la clave pública el permiso de las funciones de entrada de las encargadas).
