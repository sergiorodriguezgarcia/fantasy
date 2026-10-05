#!/bin/bash
# Script de setup de PostgreSQL para desarrollo local (WSL/Ubuntu)
# Ejecutar con: bash setup-db.sh

set -e

echo "=== Instalando PostgreSQL ==="
sudo apt-get update -qq
sudo apt-get install -y postgresql postgresql-client

echo ""
echo "=== Iniciando servicio PostgreSQL ==="
sudo service postgresql start

echo ""
echo "=== Creando usuario y base de datos ==="
sudo -u postgres psql <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fantasy_user') THEN
    CREATE USER fantasy_user WITH PASSWORD 'fantasy_pass';
  END IF;
END $$;

SELECT 'CREATE DATABASE fantasy_asturfutbol OWNER fantasy_user'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'fantasy_asturfutbol') \gexec

GRANT ALL PRIVILEGES ON DATABASE fantasy_asturfutbol TO fantasy_user;
SQL

echo ""
echo "=== Comprobando conexión ==="
PGPASSWORD=fantasy_pass psql -h localhost -U fantasy_user -d fantasy_asturfutbol -c "SELECT version();" | head -2

echo ""
echo "=== Listo! Ahora ejecuta ==="
echo "  cd apps/backend"
echo "  npm run migrate"
echo "  npm start"
