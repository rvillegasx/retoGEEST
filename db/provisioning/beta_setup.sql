-- Run this manually via DBeaver, connected to the shared MySQL instance on
-- Dokploy "beta", to provision the database and dedicated user for retoGEEST.
--
-- 1. Replace REPLACE_WITH_STRONG_PASSWORD below with a real password.
-- 2. Run this whole script once.
-- 3. Put the resulting credentials into Dokploy's environment variables for
--    this app's service (DB_HOST=mysql, DB_PORT=3306, DB_USER=retogeest_app,
--    DB_PASSWORD=<the password you chose>, DB_NAME=retogeest). Never commit
--    the password to the repo.

CREATE DATABASE IF NOT EXISTS retogeest
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'retogeest_app'@'%'
  IDENTIFIED BY 'REPLACE_WITH_STRONG_PASSWORD';

-- Scoped to this one database only (not GRANT ALL ON *.*). Includes DDL
-- (CREATE/ALTER TABLE) because db/migrate.ts runs migrations with this same user.
GRANT ALL PRIVILEGES ON retogeest.* TO 'retogeest_app'@'%';

FLUSH PRIVILEGES;
