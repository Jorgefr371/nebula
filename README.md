# Nébula

Herramienta interna para escribir ebooks con IA. Describes la idea, el agente
propone el índice, escribe los capítulos y los exporta a EPUB, PDF o GitHub.

Cerrada al equipo: solo los correos de la lista blanca pueden entrar, y los
libros son compartidos entre todos.

## Puesta en marcha

```bash
cp .env.local.example .env.local   # rellena OPENAI_API_KEY (o ANTHROPIC_API_KEY)
npm install
npm run dev                        # http://localhost:3100
```

Las claves de Supabase ya vienen puestas. Para el modelo basta **una** de las
dos claves: si están las dos gana OpenAI, y `MODEL_PROVIDER` fuerza una concreta.
Solo se usan en el servidor; nunca llegan al navegador.

Comprobar que el modelo responde bien, contra la API real:

```bash
npm run check:provider
```

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

## Cambiar de modelo

`lib/agent/providers/` es la costura. El formato canónico interno es el de
bloques de contenido de Anthropic —es lo que hay guardado en Postgres y lo que
lee la UI—, y cada proveedor traduce a lo suyo. Añadir un tercero es escribir un
fichero que cumpla `Provider`.

Diferencias entre los dos que ya están, y que se notan:

| | OpenAI (`gpt-5.2`) | Anthropic (`claude-opus-5`) |
|---|---|---|
| Caché de prompt | Automática por prefijo desde 1024 tokens | Explícita, breakpoint en el último bloque de `system` |
| Resultados de herramienta | Un mensaje `tool` por llamada | Todos en un único mensaje de usuario |
| Razonamiento | Se queda en el servidor | Bloques de pensamiento, devueltos con firma |
| Texto + herramientas | **Nunca en el mismo turno** | En el mismo turno |

Esa última fila tiene consecuencia visible: con gpt-5.2 el chat **va mudo
mientras trabaja** y solo escribe al terminar. Durante el trabajo lo único que
ve el usuario son las líneas de actividad ("Creando la estructura",
"Escribiendo capítulo 3"). Con Claude, el agente va comentando a la vez que
escribe. No es un bug; conviene saberlo antes de tocar el prompt intentando
arreglarlo.

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
- El agente contra la API real: llamadas a herramientas, vuelta de resultados,
  modo conversación y caché de prompt (`npm run check:provider`, 14/14)
- Login por enlace mágico, con la lista blanca rechazando correos no autorizados
- Cierre de toda la aplicación vía `proxy.ts`
- Esquema, políticas RLS y funciones de reordenamiento (0 advertencias de seguridad)
- Generación de EPUB válida (`npm run check:epub`, 21/21)
- Build de producción, typecheck y lint limpios

Sin verificar end-to-end (hace falta una sesión iniciada en el navegador):
- El recorrido completo desde la interfaz: prompt → libro maquetado → EPUB
- La exportación a GitHub (necesita además una OAuth App)

Pendiente:
- Portadas: el bucket existe, falta subida y generación
- Edición manual de capítulos (el preview es de solo lectura)
- Historial de versiones por capítulo
