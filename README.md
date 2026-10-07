# Europa 2026

Aplicación de viaje con frontend estático en GitHub Pages y API de Apps Script mediante Cloudflare. Permite instalarla y consultar el último viaje descargado sin conexión.

## Uso durante el viaje

Ingresá una vez con conexión y dejá que cargue el viaje. En las siguientes aperturas, la información guardada aparece primero; si hay conexión, se actualiza en segundo plano sin cambiar la vista seleccionada.

Sin conexión se pueden consultar itinerario, plan, búsqueda, lista de lugares, teléfonos, datos y enlaces de documentos, y los estados de checks de la última descarga. Las imágenes externas pueden no aparecer. El mapa interactivo y los archivos enlazados necesitan internet.

Durante la actualización, un indicador de carga ocupa el lugar del botón «+», que vuelve al terminar si la sesión permite agregar.

Las altas, ediciones, checks y administración requieren sesión validada y viaje actualizado online. Al guardar un lugar o agregar/editar un evento, se descarga nuevamente el viaje y se renueva la copia offline. Las respuestas anteriores al cambio se descartan. Si el cambio se guardó pero falló la descarga, se muestra un aviso para reabrir con conexión. No se guardan operaciones pendientes. Tema y zona horaria pueden cambiar localmente sin conexión.

La copia guardada vence en `config.FechaFin + 24 horas`. `FechaFin` se interpreta a medianoche en la zona horaria del dispositivo: si termina el 15 de octubre, la copia vence el 16 a las 00:00. Cada descarga usa la fecha de finalización del viaje, independientemente del vencimiento de la sesión. Las copias existentes se evalúan con esta misma regla al reabrir. Cerrar sesión borra la copia local, incluso offline, y limpia otras pestañas. La revocación del servidor y los cambios remotos de permisos se detectan al reconectar. El navegador puede eliminar los datos locales, por ejemplo al borrar los datos del sitio; en ese caso hay que descargar el viaje nuevamente.

## Instalación

En navegadores compatibles, usar **Ajustes → Instalar aplicación** o la opción de instalación del navegador. En iPhone/iPad, abrir en Safari y elegir **Compartir → Agregar a pantalla de inicio**. Las notificaciones requieren permiso y configuración de OneSignal; la consulta del viaje funciona independientemente de ellas.

## Desarrollo y pruebas

Servir la carpeta con un servidor HTTP local; por ejemplo:

```sh
python -m http.server 8080
```

Abrir `http://localhost:8080/`. Los service workers requieren HTTPS o localhost; no funciona abrir el HTML como archivo.

Pruebas automatizadas con Node.js 18 o posterior:

```sh
node tests/notifications.cjs
node tests/pwa.cjs
```

Las pruebas verifican políticas de sesión, render antes de red, recuperación offline, aislamiento, preferencias, almacenamiento fallido, recarga tras guardar, respuestas fuera de orden, fin del indicador de carga ante errores y notificaciones del backend. Las pruebas PWA usan almacenamiento simulado; IndexedDB y Cache Storage deben comprobarse también en navegador.

Comprobaciones de aceptación en navegador:

1. Ingresar online, esperar que cargue el viaje, cerrar y reabrir sin red. Consultar plan, búsqueda, lugares, teléfonos y checks; confirmar que no se emiten escrituras.
2. Simular una API lenta o caída: el viaje guardado debe aparecer antes de completar la validación. Al actualizar, conservar vista, filtros y día; el spinner debe reemplazar al «+» y desaparecer al terminar.
   Agregar un lugar, agregar un evento y editar otro: comprobar los cambios en la misma pantalla y al reabrir offline. Probar también una descarga fallida después de un guardado exitoso.
3. Verificar primer acceso offline, vencimiento, revocación al reconectar, cambio de usuario y logout entre dos pestañas.
4. Instalar en Android/Chrome, iPhone/Safari y escritorio; probar push con la aplicación cerrada y apertura desde la notificación.
5. Publicar una versión nueva: el aviso debe permitir seguir leyendo hasta aceptar **Actualizar**.

La verificación local se realizó con Chrome: IndexedDB real, reapertura con red bloqueada, navegación y búsqueda, bloqueo de checks, logout offline, apertura antes de una API retenida y actualización del service worker. Las pruebas en dispositivos físicos y entrega real de push requieren el despliegue.

## Publicación

1. Incorporar los cambios de `Code.gs` al proyecto existente de Apps Script, conservando sus helpers y backend original. Publicar una nueva versión del despliegue usado por Cloudflare. Las altas y ediciones confirman las escrituras de la planilla antes de responder, para permitir la descarga inmediata posterior.
2. Comprobar que `getAppData` devuelve `config.FechaFin` con formato `YYYY-MM-DD`. `expiresAt` de login/sesión puede seguir utilizándose para validar cambios online, pero no condiciona el guardado ni la lectura offline.
3. Publicar los archivos del frontend en la misma base de GitHub Pages. Las rutas relativas admiten tanto raíz como `/europa-2026/`.
4. Comprobar en HTTPS manifest, iconos y `sw.js`; luego descargar un viaje y reabrir sin red.
5. Verificar OneSignal: `push/onesignal-sw.js` debe responder JavaScript y su scope debe quedar bajo la base publicada más `push/`. La PWA controla la base de la aplicación. Mantener configurado el mismo origen y App ID de OneSignal.
6. Probar instalación y push en dispositivos reales antes de dar por terminado el despliegue.

La publicación inspeccionada exponía `push/onesignal-sw.js`; las rutas predeterminadas de OneSignal en la raíz del dominio y del proyecto devolvían 404. Se conserva el archivo publicado y ahora se configura explícitamente su ruta. Si existen suscriptores registrados en otra URL, conservar ese archivo original al menos un año; no eliminar suscripciones ni desregistrar workers de push para limpiar la PWA.

El vencimiento de los datos guardados depende únicamente de la fecha del viaje; no requiere interpretar el token ni actualizar el backend para obtener metadatos de sesión. Una revocación confirmada online sigue eliminando el acceso local.

## Mantenimiento de versiones

Incrementar `RELEASE` en `sw.js` siempre que cambie la interfaz o un recurso precargado. El worker prepara la versión completa antes de ofrecer actualizar. La limpieza afecta únicamente las cachés de esta aplicación y su base de publicación; no borra IndexedDB ni los workers de OneSignal.

Las respuestas de API y credenciales nunca se guardan en Cache Storage. IndexedDB guarda una sola copia asociada a la huella SHA-256 de la sesión, sin duplicar el token ni guardar `userCode`. Al cambiar el formato guardado, incrementar su versión y rechazar copias incompatibles.

Las bibliotecas Lucide 0.344.0 y Leaflet 1.9.4 se sirven localmente con sus licencias en `public/vendor/`.
