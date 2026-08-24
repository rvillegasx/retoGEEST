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

## Extra (mejora de nivel)

_Pendiente — se implementa y documenta en la fase final._
