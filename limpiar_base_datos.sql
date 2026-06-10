-- =============================================
-- LIMPIAR BASE DE DATOS - VQR Control de Bicicletas
-- ⚠️  ADVERTENCIA: Este script BORRA TODOS LOS DATOS.
--     Usar únicamente al finalizar pruebas o para
--     reiniciar el sistema desde cero.
-- Ejecutar en: Supabase > SQL Editor
-- =============================================

-- Elimina las tablas en orden correcto (primero registros
-- por la FK hacia bicicletas, luego bicicletas).
-- CASCADE elimina también índices y políticas RLS asociadas.

DROP TABLE IF EXISTS public.registros   CASCADE;
DROP TABLE IF EXISTS public.bicicletas  CASCADE;

-- Confirmar que las tablas ya no existen
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('bicicletas', 'registros');

-- Si la consulta anterior devuelve 0 filas, la limpieza fue exitosa.
-- Para volver a usar el sistema ejecuta nueva_base_datos.sql
