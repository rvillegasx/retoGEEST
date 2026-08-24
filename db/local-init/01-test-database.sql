-- Runs once, only on first container start, via docker-entrypoint-initdb.d.
-- MYSQL_DATABASE/MYSQL_USER/MYSQL_PASSWORD (docker-compose.yml) already create
-- the main dev database and grant the app user on it; this just adds an
-- isolated database for automated tests using the same app user.
CREATE DATABASE IF NOT EXISTS retogeest_test;
GRANT ALL PRIVILEGES ON retogeest_test.* TO 'retogeest_app'@'%';
FLUSH PRIVILEGES;
