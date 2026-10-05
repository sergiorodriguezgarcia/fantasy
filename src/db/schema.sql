-- ============================================================
-- Fantasy Asturfutbol — Esquema PostgreSQL
-- ============================================================

-- Extensión para UUIDs (opcional, usamos SERIAL por simplicidad)
-- CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Usuarios ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usuarios (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(100) NOT NULL,
  email       VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  rol         VARCHAR(10)  NOT NULL DEFAULT 'user' CHECK (rol IN ('user', 'admin')),
  creado_en   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── Equipos reales de la liga ───────────────────────────────
CREATE TABLE IF NOT EXISTS equipos_reales (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(150) NOT NULL UNIQUE,
  cod_equipo  VARCHAR(50),  -- código de asturfutbol.es (si disponible)
  activo      BOOLEAN NOT NULL DEFAULT TRUE
);

-- ─── Jugadores reales ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jugadores (
  id              SERIAL PRIMARY KEY,
  nombre          VARCHAR(150) NOT NULL,
  posicion        VARCHAR(3) CHECK (posicion IN ('POR', 'DEF', 'MED', 'DEL')),
  id_equipo_real  INTEGER REFERENCES equipos_reales(id) ON DELETE SET NULL,
  cod_jugador     VARCHAR(50),  -- ID en asturfutbol.es (jugador=XXXX)
  precio_actual   BIGINT NOT NULL DEFAULT 5000000,  -- en euros (sin decimales)
  precio_inicial  BIGINT NOT NULL DEFAULT 5000000,
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Equipos fantasy (uno por usuario) ──────────────────────
CREATE TABLE IF NOT EXISTS equipos_fantasy (
  id                  SERIAL PRIMARY KEY,
  id_usuario          INTEGER NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre              VARCHAR(100) NOT NULL,
  saldo_disponible    BIGINT NOT NULL DEFAULT 100000000,  -- 100M
  saldo_bloqueado     BIGINT NOT NULL DEFAULT 0,  -- pujas activas
  formacion           VARCHAR(10),  -- '4-3-3' | '4-4-2' | '3-5-2' | '3-4-3' (NULL = sin alinear)
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Ligas fantasy ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ligas (
  id                  SERIAL PRIMARY KEY,
  nombre              VARCHAR(100) NOT NULL,
  codigo_invitacion   VARCHAR(10)  NOT NULL UNIQUE,
  id_creador          INTEGER REFERENCES equipos_fantasy(id),
  publica             BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE = liga global
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS equipos_en_liga (
  id_equipo_fantasy   INTEGER NOT NULL REFERENCES equipos_fantasy(id) ON DELETE CASCADE,
  id_liga             INTEGER NOT NULL REFERENCES ligas(id) ON DELETE CASCADE,
  PRIMARY KEY (id_equipo_fantasy, id_liga)
);

-- ─── Jornadas ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jornadas (
  id            SERIAL PRIMARY KEY,
  numero        INTEGER NOT NULL UNIQUE,
  fecha_inicio  DATE,
  fecha_fin     DATE,
  estado        VARCHAR(15) NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE', 'EN_CURSO', 'CERRADA', 'CALCULADA'))
);

-- ─── Partidos ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS partidos (
  id                  SERIAL PRIMARY KEY,
  id_jornada          INTEGER NOT NULL REFERENCES jornadas(id),
  id_equipo_local     INTEGER REFERENCES equipos_reales(id),
  id_equipo_visitante INTEGER REFERENCES equipos_reales(id),
  nombre_local        VARCHAR(150),  -- nombre en texto (si no está en BD)
  nombre_visitante    VARCHAR(150),
  goles_local         INTEGER,
  goles_visitante     INTEGER,
  cod_acta            VARCHAR(50),  -- código de asturfutbol.es
  procesado           BOOLEAN NOT NULL DEFAULT FALSE,
  fuente              VARCHAR(15) NOT NULL DEFAULT 'scraper'
    CHECK (fuente IN ('scraper', 'manual')),
  UNIQUE (id_jornada, nombre_local, nombre_visitante)
);

-- ─── Estadísticas por jugador y jornada ─────────────────────
CREATE TABLE IF NOT EXISTS estadisticas (
  id                SERIAL PRIMARY KEY,
  id_jugador        INTEGER NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
  id_jornada        INTEGER NOT NULL REFERENCES jornadas(id),
  id_partido        INTEGER REFERENCES partidos(id),
  minutos_jugados   INTEGER NOT NULL DEFAULT 0,
  goles             INTEGER NOT NULL DEFAULT 0,
  goles_propio      INTEGER NOT NULL DEFAULT 0,
  amarillas         INTEGER NOT NULL DEFAULT 0,
  rojas             INTEGER NOT NULL DEFAULT 0,
  porteria_cero     BOOLEAN NOT NULL DEFAULT FALSE,
  goles_encajados   INTEGER NOT NULL DEFAULT 0,
  puntos            INTEGER,  -- calculado tras cerrar jornada
  es_capitan        BOOLEAN NOT NULL DEFAULT FALSE,  -- si fue capitán en esa jornada
  UNIQUE (id_jugador, id_jornada)
);

-- ─── Plantilla fantasy (jugadores en propiedad) ──────────────
CREATE TABLE IF NOT EXISTS plantillas (
  id                    SERIAL PRIMARY KEY,
  id_equipo_fantasy     INTEGER NOT NULL REFERENCES equipos_fantasy(id) ON DELETE CASCADE,
  id_jugador            INTEGER NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
  es_titular            BOOLEAN NOT NULL DEFAULT TRUE,
  es_capitan            BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_fichaje         DATE NOT NULL DEFAULT CURRENT_DATE,
  precio_compra         BIGINT NOT NULL,  -- precio al que se fichó
  clausula_monto        BIGINT NOT NULL,  -- cláusula de rescisión vigente
  clausula_activa_desde DATE NOT NULL,    -- fecha_fichaje + 15 días
  UNIQUE (id_equipo_fantasy, id_jugador)
);

-- ─── Puntuaciones por equipo y jornada ──────────────────────
CREATE TABLE IF NOT EXISTS puntuaciones_jornada (
  id                  SERIAL PRIMARY KEY,
  id_equipo_fantasy   INTEGER NOT NULL REFERENCES equipos_fantasy(id) ON DELETE CASCADE,
  id_jornada          INTEGER NOT NULL REFERENCES jornadas(id),
  puntos_jornada      INTEGER NOT NULL DEFAULT 0,
  puntos_acumulados   INTEGER NOT NULL DEFAULT 0,
  valor_plantilla     BIGINT NOT NULL DEFAULT 0,
  UNIQUE (id_equipo_fantasy, id_jornada)
);

-- ─── Historial de precios de jugadores ──────────────────────
CREATE TABLE IF NOT EXISTS historial_precios (
  id            SERIAL PRIMARY KEY,
  id_jugador    INTEGER NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
  id_jornada    INTEGER NOT NULL REFERENCES jornadas(id),
  precio        BIGINT NOT NULL,
  UNIQUE (id_jugador, id_jornada)
);

-- ─── Subastas (mercado diario) ───────────────────────────────
CREATE TABLE IF NOT EXISTS subastas (
  id                  SERIAL PRIMARY KEY,
  id_jugador          INTEGER NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
  id_vendedor         INTEGER REFERENCES equipos_fantasy(id) ON DELETE CASCADE,
  precio_minimo       BIGINT NOT NULL,
  fecha_inicio        TIMESTAMPTZ NOT NULL,
  fecha_cierre        TIMESTAMPTZ NOT NULL,
  tipo                VARCHAR(10) NOT NULL DEFAULT 'SISTEMA'
    CHECK (tipo IN ('SISTEMA', 'USUARIO')),
  estado              VARCHAR(10) NOT NULL DEFAULT 'ACTIVA'
    CHECK (estado IN ('ACTIVA', 'RESUELTA', 'DESIERTA', 'CANCELADA')),
  id_ganador          INTEGER REFERENCES equipos_fantasy(id),
  precio_final        BIGINT,
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS config_mercado (
  clave               VARCHAR(50) PRIMARY KEY,
  valor               VARCHAR(100) NOT NULL
);

INSERT INTO config_mercado (clave, valor) VALUES
  ('jugadores_por_ventana', '5'),
  ('hora_apertura', '17'),
  ('duracion_horas', '24')
ON CONFLICT (clave) DO NOTHING;

-- ─── Pujas en subastas ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS pujas (
  id                  SERIAL PRIMARY KEY,
  id_subasta          INTEGER NOT NULL REFERENCES subastas(id) ON DELETE CASCADE,
  id_equipo_fantasy   INTEGER NOT NULL REFERENCES equipos_fantasy(id) ON DELETE CASCADE,
  monto               BIGINT NOT NULL,
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Una sola puja activa por equipo y subasta (la más reciente)
CREATE UNIQUE INDEX IF NOT EXISTS idx_puja_activa
  ON pujas (id_subasta, id_equipo_fantasy);

-- ─── Activaciones de cláusula ────────────────────────────────
CREATE TABLE IF NOT EXISTS activaciones_clausula (
  id              SERIAL PRIMARY KEY,
  id_plantilla    INTEGER NOT NULL REFERENCES plantillas(id) ON DELETE CASCADE,
  id_comprador    INTEGER NOT NULL REFERENCES equipos_fantasy(id),
  monto_pagado    BIGINT NOT NULL,
  estado          VARCHAR(15) NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE', 'COMPLETADA', 'RECHAZADA')),
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Ofertas directas (sistema o usuario→usuario) ────────────
CREATE TABLE IF NOT EXISTS ofertas (
  id                  SERIAL PRIMARY KEY,
  id_jugador          INTEGER NOT NULL REFERENCES jugadores(id),
  id_equipo_vendedor  INTEGER NOT NULL REFERENCES equipos_fantasy(id),
  id_equipo_comprador INTEGER REFERENCES equipos_fantasy(id), -- NULL = oferta del sistema
  tipo                VARCHAR(10) NOT NULL DEFAULT 'USUARIO'
    CHECK (tipo IN ('USUARIO', 'SISTEMA')),
  monto               BIGINT NOT NULL,
  estado              VARCHAR(15) NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE', 'ACEPTADA', 'RECHAZADA', 'EXPIRADA')),
  fecha_creacion      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fecha_expiracion    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ofertas_vendedor ON ofertas(id_equipo_vendedor, estado);
CREATE INDEX IF NOT EXISTS idx_ofertas_jugador  ON ofertas(id_jugador, estado);

-- ─── Migraciones compatibles (columnas añadidas tras creación inicial) ───────
ALTER TABLE estadisticas ADD COLUMN IF NOT EXISTS goles_encajados INTEGER NOT NULL DEFAULT 0;
ALTER TABLE partidos DROP CONSTRAINT IF EXISTS partidos_id_jornada_nombre_local_nombre_visitante_key;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partidos_jornada_equipos_uq') THEN
    ALTER TABLE partidos ADD CONSTRAINT partidos_jornada_equipos_uq UNIQUE (id_jornada, nombre_local, nombre_visitante);
  END IF;
END $$;

-- ─── Índices útiles ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_jugadores_equipo ON jugadores(id_equipo_real);
CREATE INDEX IF NOT EXISTS idx_estadisticas_jornada ON estadisticas(id_jornada);
CREATE INDEX IF NOT EXISTS idx_estadisticas_jugador ON estadisticas(id_jugador);
CREATE INDEX IF NOT EXISTS idx_plantillas_equipo ON plantillas(id_equipo_fantasy);
CREATE INDEX IF NOT EXISTS idx_subastas_estado ON subastas(estado);
CREATE INDEX IF NOT EXISTS idx_subastas_fecha ON subastas(fecha_cierre);
