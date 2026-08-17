# Nébula

Herramienta interna para escribir ebooks con IA. Describes la idea, el agente
propone el índice, escribe los capítulos y los exporta a EPUB, PDF o GitHub.

Cerrada al equipo: solo los correos de la lista blanca pueden entrar, y los
libros son compartidos entre todos.

## Puesta en marcha

```bash
cp .env.local.example .env.local   # rellena ANTHROPIC_API_KEY
npm install
npm run dev                        # http://localhost:3100
```

Las claves de Supabase ya vienen puestas en `.env.local`. Falta la de Anthropic,
que solo se usa en el servidor y nunca llega al navegador.

### Dar de alta a alguien del equipo

El registro está cerrado por un trigger en la base de datos. Para añadir a una
persona, inserta su correo desde el SQL Editor de Supabase:

```sql
insert into allowed_emails (email, note) values ('nombre@equipo.com', 'Diseño');
```

Sin eso, el alta falla aunque reciba el enlace de acceso.

## Arquitectura

```
Navegador
├── UI (chat · índice · libro maquetado)
├── Store del libro      lib/store/ebook.ts    Zustand sobre Supabase
├── Bucle del agente     lib/agent/loop.ts     ejecuta las herramientas AQUÍ
└── Exportación          lib/export/           EPUB (JSZip) · PDF (print CSS)

Servidor Next.js
├── proxy.ts             refresco de sesión + cierre de la app
├── POST /api/chat       proxy SSE a Claude; custodia la API key
├── /api/github/*        OAuth + push del libro como .md
└── /auth/callback       enlace mágico → sesión

Supabase (eu-west-3)
├── Postgres    ebooks · chapters · messages · allowed_emails · profiles
├── Auth        enlace mágico, alta restringida por trigger
└── Storage     covers · exports (buckets privados)
```

**El bucle del agente vive en el cliente.** El servidor solo reenvía el stream
del modelo; quien ejecuta las herramientas es el navegador, contra Supabase. Eso
mantiene el servidor sin estado.

### Ficheros que importan

| Fichero | Por qué |
|---|---|
| `lib/agent/system-prompt.ts` | El activo del producto. Debe ser **byte-estable**: lleva el breakpoint de caché. |
| `lib/agent/tools.ts` | 10 herramientas. **El orden es load-bearing** — reordenarlo invalida la caché de todas las conversaciones. |
| `lib/agent/executors.ts` | Los ejecutores. Los errores vuelven como `is_error`, nunca se lanzan. |
| `lib/export/epub.ts` | EPUB 3. Ver más abajo por qué es delicado. |
| `app/globals.css` | Los estilos del libro son **también** los del PDF: exportar es imprimir este marcado. |
| `proxy.ts` | Refresco de sesión y cierre de la app. En Next.js 16 esto ya no se llama `middleware`. |

## Tres cosas que rompen si se tocan sin querer

**1. Prompt caching.** El orden de renderizado es `tools` → `system` →
`messages`, y el breakpoint está en el último bloque de `system`. Nada dinámico
puede aparecer por encima: el índice y el contenido de los capítulos se inyectan
en el último mensaje de usuario en tiempo de petición y **no** se guardan en el
historial (`prepareRequestMessages`). Si `cache_read_input_tokens` sale 0 en la
segunda petición, algo volátil se ha colado en el prompt de sistema.

**2. El EPUB es XML, no HTML.** Un `<br>` sin cerrar hace que el lector rechace
el fichero entero, no que lo maquete peor. `lib/ebook/render.ts` convierte el
HTML de marked a XHTML y escapa las entidades. Además, `mimetype` tiene que ser
la primera entrada del ZIP y estar sin comprimir. Todo eso está cubierto:

```bash
npm run check:epub
```

**3. Reordenar capítulos necesita transacción.** Insertar, borrar o mover pasa
por estados con posiciones duplicadas. La restricción única es `DEFERRABLE
INITIALLY DEFERRED`, así que esas operaciones viven en funciones de Postgres
(`insert_chapter`, `delete_chapter_at`, `move_chapter`, `replace_outline`), no en
el cliente. `replace_outline` se niega a ejecutarse si ya hay capítulos escritos:
borraría trabajo.

## Estado

Funcionando y verificado:
- Login por enlace mágico, con la lista blanca rechazando correos no autorizados
- Cierre de toda la aplicación vía `proxy.ts`
- Esquema, políticas RLS y funciones de reordenamiento (0 advertencias de seguridad)
- Generación de EPUB válida (21/21 comprobaciones)
- Build de producción, typecheck y lint limpios

Sin verificar end-to-end (hace falta `ANTHROPIC_API_KEY` y una sesión iniciada):
- La escritura real de capítulos por el agente
- La exportación a GitHub (necesita además una OAuth App)

Pendiente:
- Portadas: el bucket existe, falta subida y generación
- Edición manual de capítulos (el preview es de solo lectura)
- Historial de versiones por capítulo
