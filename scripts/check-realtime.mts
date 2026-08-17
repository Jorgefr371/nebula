/**
 * Verificación de la colaboración en vivo, contra el Supabase real.
 *
 * Levanta DOS clientes autenticados —como dos personas del equipo con el mismo
 * libro abierto— y comprueba que lo que escribe uno le llega al otro, y que la
 * presencia dice quién está trabajando.
 *
 * Necesita el usuario de prueba y las credenciales en el entorno:
 *   REALTIME_TEST_EMAIL / REALTIME_TEST_PASSWORD
 *
 *   npx tsx scripts/check-realtime.mts
 */
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const EMAIL = process.env.REALTIME_TEST_EMAIL!;
const PASSWORD = process.env.REALTIME_TEST_PASSWORD!;

const failures: string[] = [];
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures.push(label);
    console.log(`  FALLO ${label}${detail ? `\n        ${detail}` : ""}`);
  }
}

const waitFor = <T,>(
  label: string,
  promise: Promise<T>,
  ms = 12000,
): Promise<T | null> =>
  Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]).then((value) => {
    if (value === null) console.log(`        (timeout esperando ${label})`);
    return value as T | null;
  });

// Dos clientes independientes: Ana lee, Beto escribe.
const ana = createClient(URL, KEY);
const beto = createClient(URL, KEY);

for (const [name, client] of [
  ["Ana", ana],
  ["Beto", beto],
] as const) {
  const { error } = await client.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (error) {
    console.error(`No se pudo iniciar sesión como ${name}: ${error.message}`);
    process.exit(1);
  }
}

const {
  data: { user },
} = await ana.auth.getUser();

console.log(`Sesión iniciada · usuario ${user!.id}\n`);

// --- Preparar un libro de prueba -------------------------------------------
const { data: ebook, error: ebookError } = await ana
  .from("ebooks")
  .insert({ owner_id: user!.id, title: "Libro de prueba de Realtime" })
  .select()
  .single();

if (ebookError || !ebook) {
  console.error(`No se pudo crear el libro: ${ebookError?.message}`);
  process.exit(1);
}

const { data: chapter } = await ana
  .from("chapters")
  .insert({
    ebook_id: ebook.id,
    position: 1,
    title: "Capítulo inicial",
    content: "",
  })
  .select()
  .single();

console.log("Suscribiendo a Ana al canal del libro…");

// --- Ana se suscribe --------------------------------------------------------
const {
  data: { session },
} = await ana.auth.getSession();
ana.realtime.setAuth(session!.access_token);

let resolveUpdate: (value: unknown) => void;
const updateReceived = new Promise((resolve) => (resolveUpdate = resolve));

let resolveInsert: (value: unknown) => void;
const insertReceived = new Promise((resolve) => (resolveInsert = resolve));

let resolveDelete: (value: unknown) => void;
const deleteReceived = new Promise((resolve) => (resolveDelete = resolve));

let resolvePresence: (value: unknown) => void;
const presenceSeen = new Promise((resolve) => (resolvePresence = resolve));

const anaChannel = ana
  .channel(`ebook:${ebook.id}`, {
    config: { presence: { key: "ana" } },
  })
  .on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "chapters",
      filter: `ebook_id=eq.${ebook.id}`,
    },
    (payload) => {
      if (payload.eventType === "UPDATE") resolveUpdate(payload.new);
      if (payload.eventType === "INSERT") resolveInsert(payload.new);
      if (payload.eventType === "DELETE") resolveDelete(payload.old);
    },
  )
  .on("presence", { event: "sync" }, () => {
    const state = anaChannel.presenceState();
    const others = Object.entries(state).filter(([key]) => key !== "ana");
    if (others.length > 0) resolvePresence(others);
  });

await new Promise<void>((resolve) => {
  anaChannel.subscribe((status) => {
    if (status === "SUBSCRIBED") resolve();
  });
});

console.log("Ana suscrita. Beto empieza a escribir…\n");
console.log("Cambios en vivo:");

// --- Beto escribe -----------------------------------------------------------
await beto
  .from("chapters")
  .update({ content: "Beto acaba de escribir este capítulo." })
  .eq("id", chapter!.id);

const update = (await waitFor("UPDATE", updateReceived)) as {
  content?: string;
} | null;

check("Ana recibe el UPDATE de Beto", update !== null);
check(
  "el evento trae el contenido nuevo",
  update?.content === "Beto acaba de escribir este capítulo.",
  update ? `recibido: ${JSON.stringify(update.content)?.slice(0, 60)}` : undefined,
);

// INSERT: un capítulo nuevo aparece en la lista de la otra persona.
const { data: added } = await beto
  .from("chapters")
  .insert({
    ebook_id: ebook.id,
    position: 2,
    title: "Capítulo que añade Beto",
    content: "",
  })
  .select()
  .single();

const inserted = (await waitFor("INSERT", insertReceived)) as {
  title?: string;
} | null;
check("Ana recibe el INSERT de un capítulo nuevo", inserted !== null);
check(
  "el evento trae el título",
  inserted?.title === "Capítulo que añade Beto",
);

// DELETE: Supabase expone SOLO la clave primaria, aun con REPLICA IDENTITY
// FULL. Es deliberado: sobre una fila ya borrada no se puede evaluar RLS, así
// que mandar la fila entera filtraría datos que quizá no podías leer. Al cliente
// le basta el id para quitar el capítulo de la lista.
await beto.from("chapters").delete().eq("id", added!.id);

const deleted = (await waitFor("DELETE", deleteReceived)) as {
  id?: string;
} | null;
check("Ana recibe el DELETE", deleted !== null);
check(
  "el DELETE trae el id, que es lo que necesita el cliente",
  deleted?.id === added!.id,
  deleted ? `campos recibidos: ${Object.keys(deleted).join(", ")}` : undefined,
);

// --- Presencia --------------------------------------------------------------
console.log("\nPresencia:");

const {
  data: { session: betoSession },
} = await beto.auth.getSession();
beto.realtime.setAuth(betoSession!.access_token);

const betoChannel = beto.channel(`ebook:${ebook.id}`, {
  config: { presence: { key: "beto" } },
});

await new Promise<void>((resolve) => {
  betoChannel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await betoChannel.track({
        userId: "beto",
        name: "Beto",
        phase: "working",
      });
      resolve();
    }
  });
});

const presence = (await waitFor("presencia", presenceSeen)) as
  | [string, { phase?: string }[]][]
  | null;

check("Ana ve que Beto está conectado", presence !== null);
check(
  "la presencia dice que Beto está trabajando",
  presence?.[0]?.[1]?.[0]?.phase === "working",
  presence ? JSON.stringify(presence[0]?.[1]?.[0]) : undefined,
);

// --- Limpieza ---------------------------------------------------------------
await ana.removeChannel(anaChannel);
await beto.removeChannel(betoChannel);
await ana.from("ebooks").delete().eq("id", ebook.id);

console.log(
  failures.length === 0
    ? "\n✅ La colaboración en vivo funciona."
    : `\n❌ ${failures.length} fallo(s):\n${failures.map((f) => ` - ${f}`).join("\n")}`,
);

process.exit(failures.length === 0 ? 0 : 1);
