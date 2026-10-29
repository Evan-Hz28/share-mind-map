INSERT INTO api_test_environments (id, key, name, base_url)
VALUES
  ('01900000-0000-7000-8000-000000000304', 'lfx', 'lfx (lfxapi.kitarx.com)', 'https://lfxapi.kitarx.com'),
  ('01900000-0000-7000-8000-000000000305', 'lw', 'lw (lwapi.kitarx.com)', 'https://lwapi.kitarx.com')
ON CONFLICT (key) DO NOTHING;
