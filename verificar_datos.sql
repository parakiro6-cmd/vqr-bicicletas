-- =============================================
-- VERIFICAR DATOS EN LAS 3 TABLAS
-- Ejecutar en: Supabase > SQL Editor
-- =============================================

-- Ver todas las personas registradas
SELECT 'PERSONAS' as tabla, id, cedula, nombre, telefono, created_at
FROM public.personas
ORDER BY created_at DESC;

-- Ver todas las bicicletas con su propietario
SELECT
  'BICICLETAS' as tabla,
  b.id,
  b.codigo_qr,        -- ← aquí debe aparecer el QR escaneado
  b.marca,
  b.color,
  p.cedula,
  p.nombre,
  b.created_at
FROM public.bicicletas b
LEFT JOIN public.personas p ON p.id = b.persona_id
ORDER BY b.created_at DESC;

-- Ver todos los registros de entrada/salida
SELECT
  'REGISTROS' as tabla,
  r.id,
  r.tipo,
  r.fecha_hora,
  b.codigo_qr,
  b.marca,
  p.nombre,
  p.cedula
FROM public.registros r
LEFT JOIN public.bicicletas b ON b.id = r.bicicleta_id
LEFT JOIN public.personas   p ON p.id = b.persona_id
ORDER BY r.fecha_hora DESC;

-- Conteo rápido de registros en cada tabla
SELECT
  (SELECT COUNT(*) FROM public.personas)   AS total_personas,
  (SELECT COUNT(*) FROM public.bicicletas) AS total_bicicletas,
  (SELECT COUNT(*) FROM public.registros)  AS total_registros;
