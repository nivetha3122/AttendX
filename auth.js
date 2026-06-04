const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const supabase = createClient(process.env.SUPABASE_URL, supabaseKey);

console.log('Supabase key loaded:', supabaseKey ? 'YES ✓' : 'NO ✗ — check .env');

function toStudentResponse(student) {
  return {
    name: `${student.first_name} ${student.last_name}`,
    firstName: student.first_name,
    lastName: student.last_name,
    regNo: student.reg_no,
    dept: student.dept,
    sem: student.sem
  };
}

// ── REGISTER ─────────────────────────────────────────────────
// Matches HTML fields: regFirstName, regLastName, regNumber, regDept, regSem, regPass
router.post('/register', async (req, res) => {
  const { firstName, lastName, regNo, dept, sem, password } = req.body;

  // Validate all fields (mirrors HTML doRegister() checks)
  if (!firstName || !lastName || !regNo || !dept || !sem || !password) {
    return res.status(400).json({ error: '⚠ Please fill in all fields.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: '⚠ Password must be at least 6 characters.' });
  }

  // Check if register number already exists
  const { data: existing, error: existingError } = await supabase
    .from('students')
    .select('id')
    .eq('reg_no', regNo.toUpperCase())
    .maybeSingle();

  if (existingError) {
    console.error('Register lookup error:', existingError);
    return res.status(500).json({ error: 'Could not check existing registration.' });
  }

  if (existing) {
    return res.status(409).json({ error: '⚠ This register number is already registered.' });
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, 10);

  // Insert new student
  const { data, error } = await supabase
    .from('students')
    .insert([{
      first_name: firstName,
      last_name: lastName,
      reg_no: regNo.toUpperCase(),
      dept,
      sem,
      password: passwordHash
    }])
    .select()
    .single();

  if (error) {
    console.error('Register error:', error);
    if (error.code === '42501') {
      return res.status(500).json({
        error: 'Supabase RLS is blocking registration. Add your service_role key to SUPABASE_SERVICE_ROLE_KEY in .env, then restart the backend.'
      });
    }
    if (error.code === '22001') {
      return res.status(500).json({
        error: 'Supabase students.password column is too short for secure password storage. Run: alter table public.students alter column password type text;'
      });
    }
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }

  res.status(201).json({
    success: true,
    message: '✓ Account created successfully!',
    student: toStudentResponse(data)
  });
});

// ── LOGIN ─────────────────────────────────────────────────────
// Matches HTML fields: loginReg, loginPass
router.post('/login', async (req, res) => {
  const { regNo, password } = req.body;

  if (!regNo || !password) {
    return res.status(400).json({ error: '⚠ Please enter both fields.' });
  }

  // Find student by register number
  const { data: student, error } = await supabase
    .from('students')
    .select('*')
    .eq('reg_no', regNo.toUpperCase())
    .single();

  if (error || !student) {
    return res.status(404).json({ error: '⚠ Student not found. Please register first.' });
  }

  // Check password
  const isValid = await bcrypt.compare(password, student.password);
  if (!isValid) {
    return res.status(401).json({ error: '⚠ Invalid password. Please try again.' });
  }

  // Return student data (matches what HTML stores in sessionStorage)
  res.json({
    success: true,
    student: toStudentResponse(student)
  });
});

module.exports = router;
