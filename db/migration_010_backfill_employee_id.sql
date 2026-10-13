-- ============================================================
-- VJC OPS PORTAL
-- Migration 010 - Backfill employee_id for HRMS SSO integration
-- ============================================================
-- Purpose: Ensure all employees have employee_id for HRMS SSO matching.
-- The employee_id column serves as the employee_code that HRMS uses
-- for identity matching. Format: VJC-1009-XXXX
-- ============================================================

-- Check existing employee_id values to determine next available numbers
DO $$
DECLARE
  existing_ids TEXT[];
  next_num INT := 1;
  max_num INT := 0;
  updated_count INT := 0;
BEGIN
  -- Extract existing numbers from employee_id values (format: VJC-1009-XXXX)
  SELECT ARRAY_AGG(SUBSTRING(employee_id FROM 12 FOR 4)::INT)
  INTO existing_ids
  FROM employees
  WHERE employee_id ~ '^VJC-1009-[0-9]{4}$';

  -- Find the maximum existing number
  IF existing_ids IS NOT NULL THEN
    FOR i IN 1..array_length(existing_ids, 1) LOOP
      IF existing_ids[i] > max_num THEN
        max_num := existing_ids[i];
      END IF;
    END LOOP;
  END IF;

  RAISE NOTICE 'Existing employee_id numbers: %', existing_ids;
  RAISE NOTICE 'Maximum existing number: %', max_num;

  -- Fill gaps first (numbers 1 to max_num that don't exist)
  WHILE next_num <= max_num LOOP
    UPDATE employees
    SET employee_id = 'VJC-1009-' || LPAD(next_num::TEXT, 4, '0')
    WHERE id IN (
      SELECT id FROM employees
      WHERE employee_id IS NULL
      LIMIT 1
    )
    AND NOT EXISTS (
      SELECT 1 FROM employees WHERE employee_id = 'VJC-1009-' || LPAD(next_num::TEXT, 4, '0')
    );

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    IF updated_count > 0 THEN
      RAISE NOTICE 'Assigned employee_id VJC-1009-%', LPAD(next_num::TEXT, 4, '0');
    END IF;

    next_num := next_num + 1;
  END LOOP;

  -- If we still have NULL employee_id values, continue from max_num + 1
  IF EXISTS (SELECT 1 FROM employees WHERE employee_id IS NULL) THEN
    next_num := max_num + 1;
    WHILE EXISTS (SELECT 1 FROM employees WHERE employee_id IS NULL) LOOP
      UPDATE employees
      SET employee_id = 'VJC-1009-' || LPAD(next_num::TEXT, 4, '0')
      WHERE employee_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM employees WHERE employee_id = 'VJC-1009-' || LPAD(next_num::TEXT, 4, '0')
      )
      LIMIT 1;

      GET DIAGNOSTICS updated_count = ROW_COUNT;
      IF updated_count > 0 THEN
        RAISE NOTICE 'Assigned employee_id VJC-1009-%', LPAD(next_num::TEXT, 4, '0');
      END IF;

      next_num := next_num + 1;

      -- Safety limit to prevent infinite loop
      IF next_num > 9999 THEN
        RAISE EXCEPTION 'Employee_id generation exceeded maximum number';
      END IF;
    END LOOP;
  END IF;
END $$;

-- Verify backfill
DO $$
DECLARE
  null_count INT;
  total_count INT;
BEGIN
  SELECT COUNT(*) INTO null_count FROM employees WHERE employee_id IS NULL;
  SELECT COUNT(*) INTO total_count FROM employees;

  RAISE NOTICE 'Total employees: %', total_count;
  RAISE NOTICE 'Employees with NULL employee_id after migration: %', null_count;

  IF null_count > 0 THEN
    RAISE WARNING 'Migration incomplete: % employees still have NULL employee_id', null_count;
  ELSE
    RAISE NOTICE 'All employees have employee_id values';
  END IF;
END $$;

-- Display final employee_id values
SELECT id, name, email, employee_id, work_profile
FROM employees
ORDER BY employee_id NULLS LAST;
