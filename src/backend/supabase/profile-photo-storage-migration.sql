-- Allow cropped client profile photos in the existing private document bucket.
-- Keeps the bucket private and preserves any MIME types already configured.
update storage.buckets
set allowed_mime_types = array(
  select distinct mime_type
  from unnest(
    coalesce(allowed_mime_types, array[]::text[])
    || array['image/jpeg', 'image/png', 'image/webp']::text[]
  ) as allowed_type(mime_type)
)
where id = 'client-documents';
