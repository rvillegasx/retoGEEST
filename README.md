# retoGEEST

API REST en Node.js/TypeScript para gestión de tareas — reto de código del proceso de selección de GEEST.

## Stack

- Node.js 24 (ver `.node-version`) + TypeScript
- Fastify
- MySQL (`mysql2`), SQL directo con migraciones propias versionadas en `db/migrations`
- Vitest para tests

## Cómo correr localmente

1. `fnm use` (o Node 24+ manualmente)
2. `npm install`
3. `docker compose up -d` — levanta MySQL local con las bases `retogeest` (dev) y `retogeest_test`
4. `cp .env.example .env` y `cp .env.test.example .env.test`
5. `npm run migrate` — aplica el esquema (`db/migrations`) a `retogeest`
6. `npm run dev` — servidor en `http://localhost:3000`

## Tests

```
npm run migrate:test   # una vez, aplica el esquema a retogeest_test
npm test
```

Corren contra la base `retogeest_test` (aislada de la de desarrollo), levantada por el mismo `docker-compose.yml`. Cada test limpia las tablas relevantes antes de correr (`tests/helpers/db.ts`).

## Despliegue

_Pendiente — se documenta al cerrar el proyecto._

## Decisiones técnicas

- **Fastify** sobre Express: validación de esquemas integrada y mejor soporte de TypeScript.
- **SQL directo con `mysql2`, sin ORM**: control total y transparencia sobre cómo se resuelven idempotencia y bloqueos de concurrencia, que son el punto más delicado del reto (sección Confiabilidad).
- **Migraciones propias**: archivos `.sql` numerados en `db/migrations`, aplicados y registrados por un runner (`db/migrate.ts`) contra una tabla `schema_migrations`. Sin dependencia de un ORM/CLI externo.
- **MySQL en Docker para desarrollo local**; en producción se usa una instancia MySQL ya existente en el Dokploy "beta" — el código no cambia entre ambientes, solo las variables de entorno (`DB_HOST`, etc.).
- **Tests de archivo secuenciales (`fileParallelism: false`)**: los tests corren contra una base MySQL real compartida y cada archivo limpia sus tablas en `beforeEach`; correr archivos en paralelo causaba que un archivo truncara datos a mitad de otro test.

## Supuestos

- **Email único por usuario**: el reto no lo especifica, pero se asume que no puede haber dos usuarios con el mismo correo. `POST /users` responde `409 EMAIL_ALREADY_REGISTERED` en ese caso.
- **Completar dos veces la misma parte no es error**: si un usuario ya había marcado su parte como completada y vuelve a llamar `POST /tasks/:idTask/complete`, la respuesta es éxito (operación idempotente a nivel de dominio) en lugar de un error — el estado resultante es el mismo.
- **`Idempotency-Key` es opcional**: el reto pide que los endpoints POST lo acepten, no que lo exijan. Sin el header, el comportamiento es el normal (no idempotente).
- **Alcance de la clave de idempotencia**: se escopea por `(Idempotency-Key, método, path)`, no solo por el valor del header, para que la misma clave usada por error en dos endpoints distintos no colisione.
- **Mismo `Idempotency-Key` con body distinto → `409 IDEMPOTENCY_KEY_REUSED`**: el reto no lo especifica, pero es el comportamiento estándar de este patrón (evita devolver una respuesta que no corresponde al request actual).
- **Reintento de un request que falló**: se guarda y repite también la respuesta de error (4xx) para reintentos con la misma clave — solo un fallo interno inesperado (5xx) libera la clave para permitir un reintento real.

### Cómo funciona la idempotencia

Tabla `idempotency_keys` con PK compuesta `(idempotency_key, method, path)`. El primer request hace un `INSERT` (que actúa como lock atómico gracias a la PK); si otro request concurrente con la misma clave llega antes de que termine, su `INSERT` falla por duplicado y hace polling corto (cada 50ms, hasta 5s) hasta leer la respuesta ya guardada por el que "ganó". Así, incluso en paralelo, la operación se ejecuta una sola vez y ambas respuestas son idénticas. Un lock huérfano (proceso caído a medias) se considera abandonado después de 30s y se libera.

### Archivado sin duplicados y notificaciones

El riesgo real no es que dos requests marquen `archived` dos veces (`UPDATE tasks ... WHERE status = 'open'` ya lo evita por sí solo, vía el lock de fila de InnoDB), sino que **ambos** request lean "ya no queda nadie pendiente" y **ambos** intenten notificar. La solución: `archiveTask` devuelve `affectedRows === 1`, es decir, si *este* request fue el que realmente hizo la transición `open → archived`. Solo ese request dispara `notifyTaskArchived`; el que pierde la carrera ve `affectedRows === 0` y no notifica. Probado con dos `POST /tasks/:idTask/complete` disparados en paralelo (`Promise.all`) para los dos últimos usuarios asignados.

El envío a `NOTIFY_URL` (opcional; si no está configurado, simplemente no se notifica) se espera de forma síncrona dentro del request que archiva — no es fire-and-forget. Esto añade latencia a esa respuesta cuando hay reintentos (hasta ~1.5s con 3 intentos), pero hace el comportamiento determinista: al recibir la respuesta de `/complete`, `GET /tasks/:idTask/notifications` ya refleja todos los intentos. Reintentos: hasta 3 intentos en total, con espera creciente (500ms, 1000ms) entre ellos, solo si la respuesta es `5xx` o no hay respuesta (error de red). Un `4xx` no reintenta. Cada intento se registra (número, timestamp, status HTTP o `null` si no hubo respuesta).

## Extra (mejora de nivel): protección de la API

**Qué implementa:** autenticación por API key (header `x-api-key`, obligatorio en todos los endpoints excepto `GET /health`) + rate limiting (por defecto 300 requests/minuto, configurable con `RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW`, respuesta `429` con el mismo formato uniforme de error). Cuenta como una sola mejora: "proteger la API contra uso no autorizado y abuso", no dos features independientes.

**Para probarla:** cualquier request (salvo `GET /health`) necesita el header `x-api-key` con el valor configurado en `API_KEY`. La API key de la instancia desplegada está en la sección [Despliegue](#despliegue) más abajo.

**Qué problema resuelve:** la API queda expuesta en una URL pública durante 7 días. Sin autenticación, cualquiera en internet puede leer y escribir datos (crear usuarios, tareas, archivar) o saturarla con requests. Ninguno de los dos problemas está cubierto por la especificación funcional del reto.

**Por qué era necesaria:** es la primera preocupación real al publicar cualquier API sin capa de red que la proteja (sin VPN, sin IP allowlist) — es exactamente la situación de este despliegue.

**Por qué esta sobre otras alternativas:**
- Sobre **OpenAPI/Swagger**: documentar sin proteger deja la API igual de expuesta; sirve para explorarla, no para asegurarla.
- Sobre **health/logging/observabilidad**: útil en producción real, pero no evita que alguien abuse de la API pública durante la ventana de evaluación.
- Sobre implementar solo una de las dos (auth *o* rate limit): una API key filtrada o compartida (inevitable si se publica en el README para que la evalúen) sin límite de requests sigue siendo vulnerable a abuso por fuerza bruta o carga; el rate limit es el complemento necesario, no una feature aparte.

**Decisiones dentro de esta mejora:**
- Una sola API key compartida (no hay tabla de usuarios/roles) — proporcional al alcance del reto; documentado como límite conocido.
- El rate limit se aplica por IP (`request.ip`, con `trustProxy: true` para leer la IP real detrás del proxy de Dokploy), no por API key: como todos comparten la misma key, limitar por key equivaldría a un límite global compartido entre todos los clientes legítimos.
- No afecta la funcionalidad requerida: los tests de las Fases 1–5 siguen intactos (ver `tests/helpers/app.ts`, que inyecta el header por defecto en los tests existentes).
