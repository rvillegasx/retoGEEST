# retoGEEST

API REST en Node.js/TypeScript para gestión de tareas — reto de código del proceso de selección de GEEST.

## 🔗 URL de prueba

> ### **[`https://retogeest.appsmx.tech`](https://retogeest.appsmx.tech)**
>
> Requiere header `x-api-key` en cualquier request salvo `GET /health` (valor en la sección [Despliegue](#despliegue)).

## Stack

- Node.js 24 (`.node-version`) + TypeScript, Fastify
- MySQL (`mysql2`), SQL directo, migraciones propias versionadas en `db/migrations`
- Vitest — tests contra una base MySQL real, no mocks

## Cómo correr localmente

1. `fnm use` (o Node 24+)
2. `npm install`
3. `docker compose up -d` — MySQL local con las bases `retogeest` (dev) y `retogeest_test`
4. `cp .env.example .env && cp .env.test.example .env.test`
5. `npm run migrate`
6. `npm run dev` → `http://localhost:3000`. Todo endpoint salvo `GET /health` requiere el header `x-api-key` (valor en `.env`).

## Tests

```
npm run migrate:test   # una vez, aplica el esquema a retogeest_test
npm test
```

## Despliegue

- **Dónde:** `https://retogeest.appsmx.tech` — Dokploy, en un VPS propio.
- **Por qué:** ya opero esa infraestructura (Docker + Nginx + Dokploy) para otros proyectos; costo marginal cero, control total sobre logs y redeploy, sin límites de horas/sleep de un PaaS gratuito de terceros.
- **Cómo:** `Dockerfile` multi-stage en el repo; Dokploy hace build y redeploy automático en cada push a `main` vía webhook de GitHub. Las migraciones corren solas al arrancar el contenedor (`npm start` = migrar + levantar el servidor), así que un despliegue nuevo nunca queda con el esquema desactualizado.
- **Cómo acceder:** header `x-api-key: <API_KEY>` en cualquier request salvo `GET /health`. La key real se inyecta vía variable de entorno en el despliegue; pídela al autor del repo.

## UML de la base de datos

Ver [`docs/database-uml.md`](docs/database-uml.md) (diagrama entidad-relación con tipos y relaciones).

## Decisiones técnicas

- **Fastify** sobre Express: validación de esquemas integrada, mejor soporte de TypeScript.
- **SQL directo (`mysql2`), sin ORM**: control total y transparencia sobre cómo se resuelven idempotencia y concurrencia — el punto más delicado del reto.
- **Migraciones propias** (`db/migrate.ts` + tabla `schema_migrations`), sin CLI externo.
- **MySQL en Docker en desarrollo**; en producción, una instancia ya existente en el mismo Dokploy — el código no cambia entre ambientes, solo las variables de entorno.
- **Tests de archivo secuenciales** (`fileParallelism: false`): los tests comparten una BD real y truncan tablas en cada uno; en paralelo, un archivo borraba datos a mitad de otro.
- **Idempotencia**: la PK compuesta `(idempotency_key, method, path)` de `idempotency_keys` actúa como lock atómico — el primer `INSERT` gana; el que pierde hace polling corto (50ms, hasta 5s) en vez de bloquear la conexión, y ambas respuestas terminan siendo idénticas incluso en paralelo real.
- **Archivado sin duplicados**: `archiveTask` reporta si *este* request fue el que hizo la transición `open → archived` (`UPDATE ... WHERE status='open'`, vía `affectedRows`). Solo ese request dispara la notificación, aunque los dos últimos usuarios completen simultáneamente.
- **Notificación síncrona** (no fire-and-forget): añade latencia al `/complete` final cuando hay reintentos (~1.5s máx.), pero hace el resultado determinista — `GET /tasks/:idTask/notifications` ya refleja todos los intentos en cuanto responde `/complete`.
- **Extra**: auth por API key + rate limiting por IP, como una sola mejora de "protección de la API" (detalle abajo).

## Supuestos

- **Email único por usuario** → `POST /users` responde `409 EMAIL_ALREADY_REGISTERED` en duplicados.
- **Completar dos veces la misma parte no es error** — es idempotente a nivel de dominio, no solo vía el header.
- **`Idempotency-Key` es opcional**: el reto pide que los POST lo acepten, no que lo exijan.
- **Mismo `Idempotency-Key` con body distinto** → `409 IDEMPOTENCY_KEY_REUSED`. Un reintento con la misma clave y el mismo body de un request que falló repite la misma respuesta de error; solo un `5xx` interno inesperado libera la clave para un reintento real.

## Funcionalidades recortadas

- Sin paginación en `GET /users` / `GET /tasks` — crecen sin límite; razonable para la ventana de evaluación, no para producción real.
- Una sola API key compartida, sin rotación/expiración ni múltiples clientes.
- Sin limpieza automática de `idempotency_keys` / `notification_attempts` — crecerían indefinidamente en un sistema de larga vida.
- Sin endpoints de edición/borrado de usuarios o tareas (no pedidos por el reto).
- Sin CI (GitHub Actions); el gate de calidad fue manual — tests en verde antes de cada commit por fase (ver historial de commits).

## Extra (mejora de nivel): protección de la API

API key (`x-api-key`, obligatoria salvo `GET /health`) + rate limiting (300 req/min por defecto vía `RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW`, por IP, `429` con el mismo formato uniforme de error). Cuenta como **una sola mejora** — "proteger la API pública contra uso no autorizado y abuso" — no dos features independientes.

- **Qué problema resuelve:** la API queda expuesta en una URL pública durante 7 días, sin VPN ni IP allowlist. Sin esto, cualquiera en internet puede leer/escribir datos o saturarla con requests.
- **Por qué era necesaria:** es la primera preocupación real al publicar cualquier API sin capa de red que la proteja — exactamente la situación de este despliegue.
- **Por qué esta sobre otras alternativas:** documentar (OpenAPI/Swagger) no protege, solo facilita explorar; observabilidad/logging no evita el abuso. Y auth sin rate limit sigue siendo vulnerable a carga/fuerza bruta sobre una key que, para que puedan evaluarla, tiene que estar publicada en este mismo README — el rate limit es el complemento necesario, no una feature aparte.
- El límite se aplica por IP (`trustProxy: true`, necesario para leer la IP real detrás del proxy de Dokploy), no por API key: con una sola key compartida, limitar por key equivaldría a un límite global entre todos los clientes legítimos.
