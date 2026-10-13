ALTER TABLE employees
ADD COLUMN IF NOT EXISTS employee_id VARCHAR(50);

UPDATE employees
SET employee_id = CASE
    WHEN LOWER(TRIM(email)) = 'lakshmi.hyd@vjcoverseas.com'
        THEN 'VJC-1009-0002'
    WHEN LOWER(TRIM(email)) = 'kumar@vjcoverseas.com'
        THEN 'VJC-1009-0006'
    WHEN LOWER(TRIM(email)) = 'bhavya@vjcoverseas.com'
        THEN 'VJC-1009-0010'
    WHEN LOWER(TRIM(email)) = 'priyanka@vjcoverseas.com'
        THEN 'VJC-1009-0007'
    ELSE employee_id
END
WHERE LOWER(TRIM(email)) IN (
    'lakshmi.hyd@vjcoverseas.com',
    'kumar@vjcoverseas.com',
    'bhavya@vjcoverseas.com',
    'priyanka@vjcoverseas.com'
);







CREATE UNIQUE INDEX IF NOT EXISTS
    employees_employee_id_unique
ON employees (employee_id)
WHERE employee_id IS NOT NULL
  AND TRIM(employee_id) <> '';


CREATE TABLE IF NOT EXISTS public.ops_sso_used_tokens (
    jti UUID PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ops_sso_used_tokens_expires_at
    ON public.ops_sso_used_tokens (expires_at);



  DELETE FROM public.ops_sso_used_tokens
WHERE expires_at < NOW() - INTERVAL '1 day';