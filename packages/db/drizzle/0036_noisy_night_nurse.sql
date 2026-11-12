-- Hash api_keys at rest (expand step). Re-enable audit tracking with key_hash
-- redacted before the backfill, so backfill history rows never record a hash.
-- enable_tracking drops and recreates its trigger, so re-calling it is safe.
SELECT audit.enable_tracking('public.api_keys', ARRAY['updated'], ARRAY['key','key_hash']);--> statement-breakpoint

UPDATE public.api_keys
   SET key_hash = encode(sha256(convert_to(key, 'UTF8')), 'hex'),
       key_hint = right(key, 4)
 WHERE key IS NOT NULL AND key_hash IS NULL;--> statement-breakpoint

-- Until the application writes key_hash and key_hint itself, fill them from
-- key on every write so rows created by older code are never left unhashed.
CREATE OR REPLACE FUNCTION public.api_keys_fill_hash() RETURNS trigger AS $$
BEGIN
  IF NEW.key IS NOT NULL THEN
    NEW.key_hash := encode(sha256(convert_to(NEW.key, 'UTF8')), 'hex');
    NEW.key_hint := right(NEW.key, 4);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER api_keys_fill_hash
  BEFORE INSERT OR UPDATE OF key ON public.api_keys
  FOR EACH ROW EXECUTE FUNCTION public.api_keys_fill_hash();
