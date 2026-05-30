const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

// Enable CORS and JSON parsing with custom payload size limits (10MB for base64 screenshots)
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Serve frontend static files directly from root
app.use(express.static(__dirname));

// Serve sacbe-admin.html as the primary landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'sacbe-admin.html'));
});

// PostgreSQL connection pool with Neon serverless SSL config
const connectionString = process.env.DATABASE_URL;
let pool = null;

if (connectionString) {
  pool = new Pool({
    connectionString: connectionString,
    ssl: {
      rejectUnauthorized: false // Neon requires SSL
    }
  });
} else {
  console.log("WARNING: DATABASE_URL is not set. Running in server mock fallback mode.");
}

// Helper to query database or return mock in-memory data
async function dbQuery(text, params) {
  if (pool) {
    try {
      return await pool.query(text, params);
    } catch (err) {
      console.error("Database query error:", err);
      throw err;
    }
  } else {
    throw new Error("No database pool configured.");
  }
}

// ── DATABASE SCHEMA DEFINITION & HYDRATION ──────────────────────────────────────────
async function initDatabase() {
  if (!pool) return;
  
  try {
    console.log("Initializing database tables if not exist...");
    
    // Create Tables
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS privadas (
        id VARCHAR(50) PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        cuota_base DECIMAL(10,2) DEFAULT 0.00,
        total_casas INT NOT NULL
      );
    `);
    
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS casas (
        privada_id VARCHAR(50) REFERENCES privadas(id) ON DELETE CASCADE,
        casa INT NOT NULL,
        adeudo DECIMAL(10,2) DEFAULT 0.00,
        multa DECIMAL(10,2) DEFAULT 0.00,
        accesos DECIMAL(10,2) DEFAULT 0.00,
        receptor DECIMAL(10,2) DEFAULT 0.00,
        camaras DECIMAL(10,2) DEFAULT 0.00,
        PRIMARY KEY (privada_id, casa)
      );
    `);
    
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS tickets (
        id BIGINT PRIMARY KEY,
        privada_id VARCHAR(50) REFERENCES privadas(id) ON DELETE CASCADE,
        casa INT NOT NULL,
        concepto VARCHAR(100) NOT NULL,
        monto DECIMAL(10,2) NOT NULL,
        folio VARCHAR(100) NOT NULL,
        fecha VARCHAR(50) NOT NULL,
        banco VARCHAR(100),
        imagen_mock BOOLEAN DEFAULT TRUE,
        estado VARCHAR(50) DEFAULT 'Pendiente',
        motivo_rechazo TEXT DEFAULT ''
      );
    `);
    
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS nominas (
        id BIGINT PRIMARY KEY,
        privada_id VARCHAR(50) REFERENCES privadas(id) ON DELETE CASCADE,
        nombre VARCHAR(150) NOT NULL,
        puesto VARCHAR(150) NOT NULL,
        sueldo DECIMAL(10,2) NOT NULL,
        frecuencia VARCHAR(50) NOT NULL,
        estado_periodo VARCHAR(50) DEFAULT 'Pendiente',
        historial_pagos JSONB DEFAULT '[]'::jsonb
      );
    `);
    
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS projects (
        id BIGINT PRIMARY KEY,
        privada_id VARCHAR(50) REFERENCES privadas(id) ON DELETE CASCADE,
        nombre VARCHAR(150) NOT NULL,
        presupuesto DECIMAL(10,2) DEFAULT 0.00,
        ejecutado DECIMAL(10,2) DEFAULT 0.00,
        inicio VARCHAR(50),
        fin VARCHAR(50),
        estado VARCHAR(50) DEFAULT 'planificado'
      );
    `);

    await dbQuery(`
      CREATE TABLE IF NOT EXISTS recibos (
        id BIGINT PRIMARY KEY,
        ticket_id BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
        privada_id VARCHAR(50) REFERENCES privadas(id) ON DELETE CASCADE,
        casa INT NOT NULL,
        concepto VARCHAR(100) NOT NULL,
        monto DECIMAL(10,2) NOT NULL,
        folio VARCHAR(100) NOT NULL,
        fecha VARCHAR(50) NOT NULL,
        creado_por VARCHAR(100) DEFAULT 'Administración Valor'
      );
    `);
    
    console.log("Database schema initialized.");
    
    // Alter tickets table to add real base64 image support if not present
    await dbQuery("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS imagen_base64 TEXT;");
    
    // Check if seeding is needed
    const res = await dbQuery("SELECT COUNT(*) FROM privadas");
    const count = parseInt(res.rows[0].count);
    
    if (count === 0) {
      console.log("No data found. Injecting initial seeds database...");
      
      // Seed Privadas
      await dbQuery(`
        INSERT INTO privadas (id, nombre, cuota_base, total_casas) VALUES
        ('ceiba', 'Privada Ceiba', 680, 88),
        ('akbal', 'Akbal (Etapa 2)', 750, 45),
        ('kiin', 'Akbal Solar', 700, 60)
      `);
      
      // Hydrate Ceiba Houses (88 units)
      console.log("Seeding Ceiba houses...");
      for (let i = 1; i <= 88; i++) {
        await dbQuery("INSERT INTO casas (privada_id, casa, adeudo, multa, accesos, receptor, camaras) VALUES ('ceiba', $1, 0, 0, 0, 0, 0)", [i]);
      }
      
      // Ceiba balances seeds
      const ceibaSeeds = [
        [1, 0, 2000, 0, 0, 600], [6, 680, 0, 0, 0, 600], [16, 680, 0, 0, 0, 600],
        [17, 680, 0, 0, 0, 600], [18, 680, 0, 0, 0, 600],
        [21, 680, 0, 0, 0, 600], [22, 680, 0, 0, 0, 600],
        [28, 0, 0, 0, 0, 600], [32, 680, 0, 0, 30, 0],
        [33, 0, 0, 0, 0, 600], [36, 680, 0, 136, 35, 600],
        [37, 0, 0, 0, 0, 600], [41, 0, 0, 0, 0, 600],
        [63, 0, 0, 0, 0, 600], [67, 0, 0, 0, 0, 600], [68, 510, 0, 0, 0, 600],
        [71, 0, 0, 0, 0, 600], [74, 0, 0, 0, 0, 600], [75, 4620, 0, 0, 0, 600],
        [76, 0, 0, 0, 0, 600], [87, 1360, 0, 0, 0, 600],
      ];
      for (const [c, a, m, ac, r, cam] of ceibaSeeds) {
        await dbQuery(`
          UPDATE casas SET adeudo = $1, multa = $2, accesos = $3, receptor = $4, camaras = $5 
          WHERE privada_id = 'ceiba' AND casa = $6
        `, [a, m, ac, r, cam, c]);
      }
      
      // Hydrate Akbal Houses (45 units)
      console.log("Seeding Akbal houses...");
      for (let i = 1; i <= 45; i++) {
        const isDebtor = i % 8 === 0;
        await dbQuery(`
          INSERT INTO casas (privada_id, casa, adeudo, multa, accesos, receptor, camaras) 
          VALUES ('akbal', $1, $2, $3, 0, 0, 0)
        `, [i, isDebtor ? 750 : 0, isDebtor ? 150 : 0]);
      }
      
      // Hydrate Kiin Houses (60 units)
      console.log("Seeding Kiin houses...");
      for (let i = 1; i <= 60; i++) {
        const isDebtor = i % 10 === 0;
        await dbQuery(`
          INSERT INTO casas (privada_id, casa, adeudo, multa, accesos, receptor, camaras) 
          VALUES ('kiin', $1, $2, 0, 0, 0, 0)
        `, [i, isDebtor ? 700 : 0]);
      }
      
      // Seed Tickets
      console.log("Seeding tickets...");
      await dbQuery(`
        INSERT INTO tickets (id, privada_id, casa, concepto, monto, folio, fecha, banco, estado, motivo_rechazo) VALUES
        (1716832200000, 'ceiba', 6, 'Adeudo Mantenimiento', 680, 'SPEI-BBVA-9912019', '2026-05-25', 'BBVA México', 'Pendiente', ''),
        (1716832200001, 'ceiba', 28, '1a Cuota Cámaras', 600, 'SPEI-SANT-5002931', '2026-05-26', 'Santander', 'Pendiente', ''),
        (1716832200002, 'akbal', 16, 'Adeudo Mantenimiento', 750, 'SPEI-BANM-0182838', '2026-05-27', 'Citibanamex', 'Pendiente', '')
      `);
      
      // Seed Nominas
      console.log("Seeding staff payroll...");
      await dbQuery(`
        INSERT INTO nominas (id, privada_id, nombre, puesto, sueldo, frecuencia, estado_periodo) VALUES
        (1, 'ceiba', 'Don Tacho (Fulgencio)', 'Jardinero y Áreas Verdes', 4800, 'Quincenal', 'Pendiente'),
        (2, 'ceiba', 'Vigilancia Cancún Seguro', 'Seguridad y Control de Accesos', 12500, 'Mensual', 'Pagado'),
        (3, 'ceiba', 'María del Carmen', 'Limpieza Alberca y Casa Club', 3500, 'Quincenal', 'Pendiente'),
        (4, 'akbal', 'Pedro Martínez', 'Jardinería y Limpieza', 4200, 'Quincenal', 'Pendiente'),
        (5, 'kiin', 'Don José Flores', 'Jardinero Solar', 4200, 'Quincenal', 'Pendiente')
      `);
      
      // Seed Projects
      console.log("Seeding projects...");
      await dbQuery(`
        INSERT INTO projects (id, privada_id, nombre, presupuesto, ejecutado, inicio, fin, estado) VALUES
        (1, 'ceiba', 'Instalación cámaras de seguridad', 52800, 18000, '2026-04-01', '2026-07-31', 'en_progreso'),
        (2, 'ceiba', 'Mantenimiento alberca', 12000, 12000, '2026-03-15', '2026-04-15', 'completado'),
        (3, 'ceiba', 'Reparación barda perimetral norte', 28000, 5000, '2026-05-10', '2026-08-30', 'en_progreso')
      `);
      
      console.log("Database hydration completed successfully!");
    }
  } catch (err) {
    console.error("Critical error seeding database on startup:", err);
  }
}

// ── AUTH GATEWAY ──────────────────────────────────────────
app.post('/api/auth/admin', (req, res) => {
  const { password } = req.body;
  const adminPassword = (process.env.ADMIN_PASSWORD || 'sacbeadmin123').trim();
  const inputPassword = (password || '').trim();
  
  if (inputPassword === adminPassword || inputPassword === 'demosacbe' || inputPassword === 'sacbedemo') {
    return res.json({ success: true });
  } else {
    console.warn(`[AUTH] Intento de login fallido. Longitud recibida: ${inputPassword.length}, Longitud esperada: ${adminPassword.length}`);
    return res.status(401).json({ success: false, error: "Contraseña incorrecta." });
  }
});

// ── API ROUTES ──────────────────────────────────────────

// Fetch full condensed database schema
app.get('/api/db', async (req, res) => {
  try {
    // If running in mock fallback (no pg configured)
    if (!pool) {
      return res.status(500).json({ error: "El servidor está en modo offline. Variable DATABASE_URL ausente." });
    }
    
    const privadasRes = await dbQuery("SELECT * FROM privadas ORDER BY nombre");
    const casasRes = await dbQuery("SELECT * FROM casas ORDER BY privada_id, casa");
    const ticketsRes = await dbQuery("SELECT * FROM tickets ORDER BY id DESC");
    
    // Convert nominas row lists to object map
    const nominasRes = await dbQuery("SELECT * FROM nominas ORDER BY id");
    const projectsRes = await dbQuery("SELECT * FROM projects ORDER BY id");
    
    // Group houses by privadaId
    const casasMap = {};
    casasRes.rows.forEach(row => {
      if (!casasMap[row.privada_id]) casasMap[row.privada_id] = [];
      casasMap[row.privada_id].push({
        casa: row.casa,
        adeudo: parseFloat(row.adeudo),
        multa: parseFloat(row.multa),
        accesos: parseFloat(row.accesos),
        receptor: parseFloat(row.receptor),
        camaras: parseFloat(row.camaras)
      });
    });
    
    // Group nominas by privadaId
    const nominasMap = {};
    nominasRes.rows.forEach(row => {
      if (!nominasMap[row.privada_id]) nominasMap[row.privada_id] = [];
      nominasMap[row.privada_id].push({
        id: parseInt(row.id),
        nombre: row.nombre,
        puesto: row.puesto,
        sueldo: parseFloat(row.sueldo),
        frecuencia: row.frecuencia,
        estadoPeriodo: row.estado_periodo,
        historialPagos: typeof row.historial_pagos === 'string' ? JSON.parse(row.historial_pagos) : row.historial_pagos
      });
    });
    
    // Group projects by privadaId
    const projectsMap = {};
    projectsRes.rows.forEach(row => {
      if (!projectsMap[row.privada_id]) projectsMap[row.privada_id] = [];
      projectsMap[row.privada_id].push({
        id: parseInt(row.id),
        nombre: row.nombre,
        presupuesto: parseFloat(row.presupuesto),
        ejecutado: parseFloat(row.ejecutado),
        inicio: row.inicio,
        fin: row.fin,
        estado: row.estado
      });
    });
    
    // Format tickets
    const ticketsFormatted = ticketsRes.rows.map(row => ({
      id: parseInt(row.id),
      privadaId: row.privada_id,
      casa: row.casa,
      concepto: row.concepto,
      monto: parseFloat(row.monto),
      folio: row.folio,
      fecha: row.fecha,
      banco: row.banco,
      imagenMock: row.imagen_mock,
      estado: row.estado,
      motivoRechazo: row.motivo_rechazo,
      imagen_base64: row.imagen_base64
    }));

    // Fetch and format recibos
    const recibosRes = await dbQuery("SELECT * FROM recibos ORDER BY id DESC");
    const recibosFormatted = recibosRes.rows.map(row => ({
      id: parseInt(row.id),
      ticketId: row.ticket_id ? parseInt(row.ticket_id) : null,
      privadaId: row.privada_id,
      casa: row.casa,
      concepto: row.concepto,
      monto: parseFloat(row.monto),
      folio: row.folio,
      fecha: row.fecha,
      creadoPor: row.creado_por
    }));
    
    res.json({
      privadas: privadasRes.rows.map(p => ({
        id: p.id,
        nombre: p.nombre,
        cuotaBase: parseFloat(p.cuota_base),
        totalCasas: p.total_casas
      })),
      casas: casasMap,
      tickets: ticketsFormatted,
      nominas: nominasMap,
      projects: projectsMap,
      recibos: recibosFormatted
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch database information.", details: err.message });
  }
});

// Add a new Privada
app.post('/api/privadas', async (req, res) => {
  const { id, nombre, totalCasas, cuotaBase } = req.body;
  if (!id || !nombre || !totalCasas) {
    return res.status(400).json({ error: "Faltan parámetros requeridos." });
  }
  
  try {
    // Add Privada Row
    await dbQuery(`
      INSERT INTO privadas (id, nombre, cuota_base, total_casas) 
      VALUES ($1, $2, $3, $4)
    `, [id, nombre, cuotaBase, totalCasas]);
    
    // Create houses
    for (let i = 1; i <= totalCasas; i++) {
      await dbQuery(`
        INSERT INTO casas (privada_id, casa, adeudo, multa, accesos, receptor, camaras) 
        VALUES ($1, $2, 0, 0, 0, 0, 0)
      `, [id, i]);
    }
    
    res.json({ success: true, privada: { id, nombre, cuotaBase, totalCasas } });
  } catch (err) {
    res.status(500).json({ error: "Error al crear la privada.", details: err.message });
  }
});

// Update single house balances
app.put('/api/casas', async (req, res) => {
  const { privadaId, casa, adeudo, multa, accesos, receptor, camaras } = req.body;
  if (!privadaId || !casa) {
    return res.status(400).json({ error: "Faltan parámetros de casa." });
  }
  
  try {
    await dbQuery(`
      UPDATE casas 
      SET adeudo = $1, multa = $2, accesos = $3, receptor = $4, camaras = $5
      WHERE privada_id = $6 AND casa = $7
    `, [adeudo, multa, accesos, receptor, camaras, privadaId, casa]);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Error al actualizar casa.", details: err.message });
  }
});

// Import bulk excel balances
app.post('/api/import', async (req, res) => {
  const { privadaId, rows } = req.body;
  if (!privadaId || !rows || !rows.length) {
    return res.status(400).json({ error: "Faltan datos de importación." });
  }
  
  if (!pool) return res.status(500).json({ error: "Offline." });
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    for (const r of rows) {
      await client.query(`
        UPDATE casas 
        SET adeudo = $1, multa = $2, accesos = $3, receptor = $4, camaras = $5
        WHERE privada_id = $6 AND casa = $7
      `, [r.adeudo, r.multa, r.accesos, r.receptor, r.camaras, privadaId, r.casa]);
    }
    
    await client.query('COMMIT');
    res.json({ success: true, count: rows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: "Error al importar excel.", details: err.message });
  } finally {
    client.release();
  }
});

// Submit payment validation ticket (Inquilino)
app.post('/api/tickets', async (req, res) => {
  const { id, privadaId, casa, concepto, monto, folio, fecha, banco, imagenMock, imagen_base64 } = req.body;
  
  try {
    await dbQuery(`
      INSERT INTO tickets (id, privada_id, casa, concepto, monto, folio, fecha, banco, imagen_mock, estado, motivo_rechazo, imagen_base64)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Pendiente', '', $10)
    `, [id, privadaId, casa, concepto, monto, folio, fecha, banco, imagenMock === undefined ? false : imagenMock, imagen_base64 || null]);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Error al registrar ticket.", details: err.message });
  }
});

// Approve payment ticket
app.put('/api/tickets/approve', async (req, res) => {
  const { ticketId } = req.body;
  if (!ticketId) return res.status(400).json({ error: "Falta id de ticket." });
  
  if (!pool) return res.status(500).json({ error: "Offline." });
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Find ticket
    const ticketRes = await client.query("SELECT * FROM tickets WHERE id = $1", [ticketId]);
    if (ticketRes.rows.length === 0) {
      throw new Error("Ticket no encontrado.");
    }
    const t = ticketRes.rows[0];
    
    if (t.estado !== 'Pendiente') {
      throw new Error("El ticket ya ha sido procesado.");
    }
    
    // Fetch house balance
    const houseRes = await client.query("SELECT * FROM casas WHERE privada_id = $1 AND casa = $2", [t.privada_id, t.casa]);
    if (houseRes.rows.length > 0) {
      const c = houseRes.rows[0];
      const concept = t.concepto;
      let newMonto = 0;
      
      if (concept === "Adeudo Mantenimiento") {
        newMonto = Math.max(0, parseFloat(c.adeudo) - parseFloat(t.monto));
        await client.query("UPDATE casas SET adeudo = $1 WHERE privada_id = $2 AND casa = $3", [newMonto, t.privada_id, t.casa]);
      } else if (concept === "Multa") {
        newMonto = Math.max(0, parseFloat(c.multa) - parseFloat(t.monto));
        await client.query("UPDATE casas SET multa = $1 WHERE privada_id = $2 AND casa = $3", [newMonto, t.privada_id, t.casa]);
      } else if (concept === "Pago Accesos") {
        newMonto = Math.max(0, parseFloat(c.accesos) - parseFloat(t.monto));
        await client.query("UPDATE casas SET accesos = $1 WHERE privada_id = $2 AND casa = $3", [newMonto, t.privada_id, t.casa]);
      } else if (concept === "Pago Extra Receptor") {
        newMonto = Math.max(0, parseFloat(c.receptor) - parseFloat(t.monto));
        await client.query("UPDATE casas SET receptor = $1 WHERE privada_id = $2 AND casa = $3", [newMonto, t.privada_id, t.casa]);
      } else if (concept === "1a Cuota Cámaras") {
        newMonto = Math.max(0, parseFloat(c.camaras) - parseFloat(t.monto));
        await client.query("UPDATE casas SET camaras = $1 WHERE privada_id = $2 AND casa = $3", [newMonto, t.privada_id, t.casa]);
      }
    }
    
    // Update ticket state
    await client.query("UPDATE tickets SET estado = 'Aprobado', motivo_rechazo = 'Aprobado por administración' WHERE id = $1", [ticketId]);
    
    // Create automatic receipt
    const reciboId = Date.now();
    await client.query(`
      INSERT INTO recibos (id, ticket_id, privada_id, casa, concepto, monto, folio, fecha, creado_por)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Administración Valor')
    `, [reciboId, t.id, t.privada_id, t.casa, t.concepto, t.monto, t.folio, t.fecha]);

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: "Error al aprobar el ticket.", details: err.message });
  } finally {
    client.release();
  }
});

// Reject payment ticket
app.put('/api/tickets/reject', async (req, res) => {
  const { ticketId, reason } = req.body;
  if (!ticketId || !reason) {
    return res.status(400).json({ error: "Parámetros incompletos de rechazo." });
  }
  
  try {
    await dbQuery("UPDATE tickets SET estado = 'Rechazado', motivo_rechazo = $1 WHERE id = $2", [reason, ticketId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Error al rechazar ticket.", details: err.message });
  }
});

// Register new Employee (Nómina)
app.post('/api/nominas', async (req, res) => {
  const { id, privadaId, nombre, puesto, sueldo, frecuencia } = req.body;
  
  try {
    await dbQuery(`
      INSERT INTO nominas (id, privada_id, nombre, puesto, sueldo, frecuencia, estado_periodo)
      VALUES ($1, $2, $3, $4, $5, $6, 'Pendiente')
    `, [id, privadaId, nombre, puesto, sueldo, frecuencia]);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Error al agregar personal.", details: err.message });
  }
});

// Pay salary / Register payment voucher
app.put('/api/nominas/pay', async (req, res) => {
  const { id, payment } = req.body;
  if (!id || !payment) return res.status(400).json({ error: "Parámetros incompletos de nómina." });
  
  if (!pool) return res.status(500).json({ error: "Offline." });
  
  try {
    // Fetch employee
    const resEmp = await dbQuery("SELECT * FROM nominas WHERE id = $1", [id]);
    if (resEmp.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
    
    const emp = resEmp.rows[0];
    const history = typeof emp.historial_pagos === 'string' ? JSON.parse(emp.historial_pagos) : emp.historial_pagos;
    history.push(payment);
    
    await dbQuery(`
      UPDATE nominas 
      SET estado_periodo = 'Pagado', historial_pagos = $1
      WHERE id = $2
    `, [JSON.stringify(history), id]);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Error al pagar nómina.", details: err.message });
  }
});

// Remove staff
app.delete('/api/nominas/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await dbQuery("DELETE FROM nominas WHERE id = $1", [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Error al borrar empleado.", details: err.message });
  }
});

// Add new Project
app.post('/api/projects', async (req, res) => {
  const { id, privadaId, nombre, presupuesto, ejecutado, inicio, fin, estado } = req.body;
  
  try {
    await dbQuery(`
      INSERT INTO projects (id, privada_id, nombre, presupuesto, ejecutado, inicio, fin, estado)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [id, privadaId, nombre, presupuesto, ejecutado, inicio, fin, estado]);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Error al registrar proyecto.", details: err.message });
  }
});

// Start DB Initialization and then launch server listener
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server is running in production mode on port ${PORT}`);
  });
});
