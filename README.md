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

## Extra (mejora de nivel)

_Pendiente — se implementa y documenta en la fase final._
