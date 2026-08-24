# UML de base de datos — retoGEEST

Generado a partir del esquema real en `db/migrations/`. Motor: MySQL 8, `InnoDB`, `utf8mb4`.

```mermaid
erDiagram
    USERS ||--o{ TASK_ASSIGNMENTS : "asignado a"
    TASKS ||--o{ TASK_ASSIGNMENTS : "tiene"
    TASKS ||--o{ NOTIFICATION_ATTEMPTS : "genera"

    USERS {
        int_unsigned id PK "AUTO_INCREMENT"
        varchar_255 name
        varchar_255 last_name
        varchar_320 email UK "unico, ver Supuestos"
        timestamp created_at
    }

    TASKS {
        int_unsigned id PK "AUTO_INCREMENT"
        varchar_255 title
        text description "NULL"
        enum status "open | archived, default open"
        timestamp created_at
        timestamp archived_at "NULL"
    }

    TASK_ASSIGNMENTS {
        int_unsigned task_id PK "tambien FK -> TASKS.id"
        int_unsigned user_id PK "tambien FK -> USERS.id"
        timestamp completed_at "NULL hasta que el usuario completa su parte"
        timestamp created_at
    }

    NOTIFICATION_ATTEMPTS {
        int_unsigned id PK "AUTO_INCREMENT"
        int_unsigned task_id FK
        tinyint_unsigned attempt_number "1..3"
        timestamp attempted_at
        smallint_unsigned response_status "NULL si no hubo respuesta"
    }

    IDEMPOTENCY_KEYS {
        varchar_255 idempotency_key PK
        varchar_10 method PK "GET|POST|..."
        varchar_500 path PK
        char_64 request_hash "sha256 del body"
        enum status "in_progress | completed"
        smallint_unsigned response_status "NULL"
        longtext response_body "NULL, JSON serializado"
        timestamp created_at
        timestamp completed_at "NULL"
    }
```

## Notas

- **`TASK_ASSIGNMENTS`** es la tabla de relación N:M entre `USERS` y `TASKS`. Su PK compuesta `(task_id, user_id)` es lo que impide asignaciones duplicadas (`POST /tasks/:idTask/assign`) sin necesidad de una constraint `UNIQUE` adicional.
- **`IDEMPOTENCY_KEYS`** no tiene relación FK con las demás tablas — es de propósito general, aplica a cualquier endpoint `POST` (identificada por `method` + `path`, no solo por el valor del header).
- **`NOTIFICATION_ATTEMPTS`** registra cada intento de notificación a `NOTIFY_URL` cuando una tarea se archiva (hasta 3 filas por tarea archivada).
- Además existe `schema_migrations (name VARCHAR(255) PK, applied_at TIMESTAMP)`, tabla de control interno del runner de migraciones (`db/migrate.ts`), no forma parte del modelo de negocio.
